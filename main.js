var Main = (function () {
    //  audio + canvas environment variables:
    var blobs = [],                                     // array to hold latest recording for the session
        edits = [],                                     // array to hold latest edited recording for the session
        timer,                                          // needed by startBtn and stopBtn
        recorder,                                       // single instance constructed, used in many places
        audioCtx,                                       // single session audioContext that is used in many places
        analyser,                                       // set-up by mic, connected by on.startBtn, used by draw()
        source,                                         // for current source <audio>: defined by 'this' when loaded
        canvas = document.getElementById('canvas'),     // avoided jQuery object due to canvas issues when painting
        canvasCtx,                                      // single session canvasContext used in MP3Recorder and draw()
        drawVisual,                                     // requestAnimationFrame id to cancel draw() callback loop
        handledURL = window.URL || window.webkitURL,    // alias to avoid overwriting the window objects themselves
        saveCount = 0,                                  // counts saved mp3s to determine if beforeunload prompt appears
        configSampleRate,                               // shares dynamic sampleRate between audioCtx and edit equation

    //  authoring values:
        leftHandle,         // sliding percentage to trim from audio start
        rightHandle,        // sliding percentage to trim from audio end
        timeValue,          // current audio time in int percentage for timeHandle
        leftFrames,         // discrete n frames to trim (requires leftHandle)
        rightFrames,        // discrete n frames to trim (requires rightHandle)
        totalFrames;        // a constant per each audio recording

    // initiate application resources
    function init () {
        'use strict';

        // init Web Audio API context (prefixed by AudioContextMonkeyPatch.js)
        try {
            audioCtx = new window.AudioContext();
        }
        catch (e) {
            alert('Web Audio API not supported, please try updating or switching browsers to continue. Error: ', e);
        }

        // config recorder and connect to audio and canvas contexts
        try {
            recorder = new MP3Recorder({bitRate: 128});
        }
        catch (e) {
            alert('Recorder not supported, please try updating or switching browsers to continue. Error: ', e);
        }
        finally {
            // suspend audioContext until user starts recording
            if (recorder && audioCtx.state === 'running') {
                    audioCtx.suspend();
            }
        }

        // init canvas 2d context
        if (canvas.getContext) {
            canvasCtx = canvas.getContext('2d');
            // set colors here instead of inside draw() callback to avoid flickering
            canvasCtx.fillStyle = 'rgb(' + 10 + ',' + 211 + ',' + (256 >> 0) + ')';
            var gradient = canvasCtx.createLinearGradient(0, 0, 0, 200);
            gradient.addColorStop(0, 'white');
            gradient.addColorStop(1, 'red');
            canvasCtx.strokeStyle = gradient;
        } else {
            alert('canvas context unsupported, please try updating or switching browsers to see visualisations');
        }

        // construct slider once (updated dynamically)
        initSlider();

        // start playback/slider interval once (updated dynamically)
        initInterval();

        // init audio player controls
        initPlayerUI();

        // attach the two FileSaver.js events in init & therefore only once - avoids queued file downloads
        $('#download').on('click', function() {
            // use FileSaver.js saveAs() to stop UID.mp3 filenames
            saveAs(blobs[blobs.length - 1], getFilename(false));
            saveCount++;
        });

        $('#download-edit').on('click', function() {
            // use FileSaver.js saveAs() to stop UID.mp3 filenames
            saveAs(edits[edits.length - 1], getFilename(true));
            saveCount++;
        });

    }

/** handles Web Audio API processing and delegating to Web Worker *****************************************************/

    // inits recorder object, populate AudioContext & prepares Worker communication
    var MP3Recorder = function (config) {
        recorder = this;
        recorder.startTime = 0;
        config = config || {};
        var realTimeWorker = new Worker('worker-realtime.js');

        // Initializes LAME so that we can record
        this.initialize = function () {
            // let context decide sampleRate - informed by browser / hardware 
            config.sampleRate = audioCtx.sampleRate;

            // save sampleRate to global to share with edit equation
            configSampleRate = config.sampleRate;

            realTimeWorker.postMessage({cmd: 'init', config: config});
        };
        // This function finalizes LAME output and saves the MP3 data to a file
        var microphone, processor;

        // Function that handles getting audio out of the browser's media API
        function beginRecording(stream) {
            // Set up Web Audio API to process data from the media stream (microphone)
            // optional: setting a bufferSize of 0 instructs the browser to choose the best bufferSize
            // note: Webkit version 31 requires that a valid bufferSize be passed when calling this method

            // set bufferSize to largest size to avoid all mobile noise artifacts (at the possible expense of latency)
            processor = audioCtx.createScriptProcessor(16384, 1, 1); // (largest buffer possible)
            analyser  = audioCtx.createAnalyser();

            // for each bufferSize of raw audio (while recording), send it to Worker to be encoded with LAME
            processor.onaudioprocess = function (event) {
                realTimeWorker.postMessage({cmd: 'encode', buf: event.inputBuffer.getChannelData(0)});
            };

            // iOS likes createMediaStreamSource to go after processor code...arbitrarily AFAIK
            microphone = audioCtx.createMediaStreamSource(stream);

            // Begin retrieving microphone data
            microphone.connect(analyser);
            microphone.connect(processor);
            processor.connect(audioCtx.destination);
        }

        // Return a function which will stop recording and return all MP3 data
        this.stop = function () {
            if (processor && microphone) {
                // Clean up the Web Audio API resources
                microphone.disconnect();
                processor.disconnect();
                analyser.disconnect();
                // Return the buffers array. Note that there may be more Worker buffers pending
                processor.onaudioprocess = null;
            }
        };

        // Function for kicking off recording on 'start' click
        // refactored for promise-based MediaDevices and polyfilled
        this.start = function (onSuccess, onError) {
            // Request access to the microphone
            window.navigator.mediaDevices.getUserMedia({audio: true}).then(function (stream) {
                // Begin recording and get a function that stops the recording
                var stopRecording = beginRecording(stream);
                recorder.startTime = Date.now();
                if (onSuccess && typeof onSuccess === 'function') {
                    onSuccess();
                }
                // Run a function every 100 ms to update the UI and dispose it after 5 seconds
            }).catch(function (error) {
                if (onError && typeof onError === 'function') {
                    onError(error);
                }
            });
        };

        var mp3ReceiveSuccess, currentErrorCallback;

        this.getMp3Blob = function (onSuccess, onError) {
            currentErrorCallback = onError;
            mp3ReceiveSuccess = onSuccess;
            realTimeWorker.postMessage({cmd: 'finish'});
        };

        realTimeWorker.onmessage = function (e) {
            switch (e.data.cmd) {
                case 'end':
                    if (mp3ReceiveSuccess) {
                        mp3ReceiveSuccess(new Blob(e.data.buf, {type: 'audio/mpeg'}));
                    }
                    break;
                case 'error':
                    if (currentErrorCallback) {
                        currentErrorCallback(e.data.error);
                    }
                    break;
                default :
                alert('Web Worker received a message it does not know how to handle: ' +
                e.data);
            }
        };
        this.initialize();
    };

/** canvas visualisation function *************************************************************************************/

    // repeatedly called from requestAnimationFrame callback
    function draw () {
        'use strict';

        // callback to parent function gives requestAnimationFrame control over draws per second (aims at 60fps)
        drawVisual = window.requestAnimationFrame(draw);

        // clear canvas before drawing
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        
        // get byte-based array data
        var bytes = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bytes);

        // create bouncing colored bars
        for (var i = 1; i < bytes.length; i++) {
            canvasCtx.fillStyle = 'rgb(' + i + ',' + 211 + ',' + (256 >> 0) + ')';
            canvasCtx.strokeRect(i, canvas.height - bytes[i] / 2, 10, canvas.height);
            canvasCtx.fillRect(i, canvas.height - bytes[i] / 1.8, 10, canvas.height);
        }
    }

/** slider, authoring and playback functions [interelated] ************************************************************/

    // init jquery-ui slider
    function initSlider () {
        'use strict';

        // reveal DOM slider
        $('#slider').slider({
            step   : 0.1,
            range  : false,
            animate: true, // inconsistent at best: being thrown off by setInterval currentTime mapping to css
            values : [0.0, 100.0, 0.0], // jquery gives lowest index value precedence upon overlap

            // define convienient handle id's to target for editing and playback
            create: function () {
                $('.ui-slider-handle').eq(0).attr('id', 'leftHandle');
                $('.ui-slider-handle').eq(1).attr('id', 'rightHandle');
                $('.ui-slider-handle').eq(2).attr('id', 'timeHandle');
            },

            // restrict handles from sliding over each other update editing values
            slide: function (event, ui) {
                // force mapping timeHandle ⇌ currentTime while user is dragging timeHandle
                if ($('#timeHandle').hasClass('ui-state-active')) {
                    source.currentTime = (source.duration / 100) * ui.values[2];
                }

                // if left/right Handles get too close to overlapping, return false to stop slide
                if ((ui.values[0] + 2 >= (ui.values[1])) || (ui.values[1] <= (ui.values[0] + 2))) {
                    // force mouseup so timeHandle is not dragged past its bounds
                    $('#leftHandle').trigger('mouseup');
                    return false;
                }

                // attempt to smooth currentTime animation when being dragged forward by leftHandle.
                // needs to update currentTime from here and not interfere with setIntervals job of
                // watching currentTime changes driven by playback rather than slider user actions.

                // if (ui.values[2] <= ui.values[0]) {
                //     ui.values[2] = (0.1 + ui.values[0]);
                //     $('#timeHandle').css('left', (ui.values[2] + '\%'));
                // }

                // color in slider to the left of leftHandle and the right of rightHandle
                $('#leftDiv').css('width', (ui.values[0] + '\%'));
                $('#rightDiv').css('width', ((100 - ui.values[1]) + '\%'));
            },

            // refresh frame values when handles are explicitly moved by the user
            stop: function (event, ui) {
                checkFrames();
                // fixes a removing-your-finger bug on some touch screens
                $('.ui-slider-handle').blur();
            }
        });
    }

    // check frame values are mapped to current slider values
    function checkFrames () {
        'use strict';
        leftFrames = (totalFrames / 100) * leftHandle;
        rightFrames = (totalFrames / 100) * (100 - rightHandle);

        // check for meaningful values, enable/disable edit button
        if ((leftFrames === 0) && (rightFrames === 0)) {
            $('#editBtn').css('pointer-events', 'none');
        } else {
            $('#editBtn').css('pointer-events', 'auto');
        }
    }

    // set up playerUI
    function initPlayerUI () {
        'use strict';

        // prepare player
        $('#pause, #muted').hide();
        $('#duration').html('0:00');

        // remembers pre-muted volume value and muted status
        var preMuted, muted;

        $('#source').on('loadedmetadata', function() {
            preMuted = parseFloat(source.volume);
        });
        
        // volume vontrol
        $('#volume').on('input', function () {
            source.volume = parseFloat(this.value / 10);

            if (source.volume !== 0 && muted === true) {
                muted = false;
                $('#volume-btn, #muted').toggle();
                source.volume = parseFloat(this.value / 10);
            }
        });

        $('#volume-btn').on('click', function () {
            muted = true;
            preMuted = parseFloat(source.volume);
            source.volume = parseFloat(0);
            $('#volume').value = 0;
            $('#volume-btn, #muted').toggle();
        });

        $('#muted').on('click', function () {
            muted = false;
            source.volume = preMuted;
            $('#volume').value = preMuted * 10;
            $('#volume-btn, #muted').toggle();
        });

        // play button
        $('#play').on('click', function () {
            // store a time value for reference with setTimeout
            var time = source.currentTime;
            $('#play, #pause').toggle();

            source.play().then(function() {
                setTimeout(function () {
                    // if after 30ms the source time has not changed give it a refresh and a nudge
                    if (time === source.currentTime) {
                        resetSlider(leftHandle, rightHandle);
                        checkFrames();
                        // seperate function to try avoid a ...play().then().play()... loop when timeHandle gets stuck
                        resumePlay();
                    }
                }, 30); // delay > 26ms allows setInterval to clear one loop and update timeValue
            }).catch(function(){
                $('#play, #pause').toggle();
            });

            $('#play').blur();
        });

        //pause button
        $('#pause').on('click', function () {
            source.pause();
            $('#play, #pause').toggle();
        });
    }

    // seperate function to try avoid a ...play().then().play()... loop when timeHandle gets stuck
    function resumePlay () {
        source.play();
    }

    // tries to re-calibrate the slider if playerUI gets stuck / loses track
    function resetSlider (left, right) {
        // refresh handle positions
        source.pause();

        leftHandle  = left;
        $('#slider').slider('values', 0, left);
        rightHandle = right;
        $('#slider').slider('values', 1, right);
        
        // bump timeHandle off of leftHandle to stop Firefox Mobile getting stuck
        source.currentTime = source.currentTime + 0.001;
    }

    // runs once on repeat to keep handle values up to date and within range
    function initInterval () {
        'use strict';

        setInterval(function () {
            // only runs if interval has some audio to affect
            if (source) {
                // timeValue (int) is given to both timeHandle value & CSS position
                timeValue = (source.currentTime / source.duration) * 100;

                // add percentage and update position
                $('#timeHandle').css('left', (timeValue  + '\%'));
                // assigns up-to-date timeValue to timeHandle
                $('#slider').slider('values', 2, timeValue.toFixed(1));

                // keep these top-scope variables up-to-date for other authoring/playback functions
                leftHandle  = $('#slider').slider('values')[0];
                rightHandle = $('#slider').slider('values')[1];
            
                // set lower-bound of currentTime to wherever leftHandle currently is
                if (source.currentTime < (source.duration / 100) * leftHandle) {
                    source.currentTime = (((source.duration / 100) * leftHandle) + 0.001);
                    resetSlider(leftHandle, rightHandle);
                    $('#play').show();
                    $('#pause').hide();
                }

                // set upper-bound of currentTime to wherever rightHandle currently is
                if (source.currentTime > (source.duration / 100) * rightHandle) {
                    source.currentTime = (((source.duration / 100) * leftHandle) + 0.001);
                    resetSlider(leftHandle, rightHandle);
                    $('#play').show();
                    $('#pause').hide();
                }

                // if playback reaches the end, reset currentTime and buttons
                if (source.currentTime === source.duration) {
                    source.currentTime = 0;
                    source.pause();
                    $('#pause').hide();
                    $('#play').show();
                }
                
                //Get hours and minutes
                var s = parseInt(source.currentTime % 60);
                var m = parseInt((source.currentTime / 60) % 60);

                //Add 0 if seconds less than 10
                if (s < 10) {
                    s = '0' + s;
                }

                // update duration
                $('#duration').html(m + ':' + s);	
            }
        }, 26); // ms is exactly 1 mp3 frame and the fastest possible event rate of 'timeupdate' that I am circumventing
    }
    
/** edit and upload functions and their respective button functions ***************************************************/

    // returns semantic filename for up/downloads
    function getFilename (ifEdit) {
        // check if filename is for an edited mp3
        var string = '';
        if (ifEdit === true) {
            string = 'edit_';
        }

        var date = new Date();
        var filename = 'recording_' + string + date.getDate() + '.' + (1 + date.getMonth()) +
                        '.' + date.getFullYear() + '.mp3';
        return filename;
    }

    // pass current source blob to edit function
    $('#editBtn').on('click', function (e) {
        e.preventDefault();
        edit(blobs[blobs.length - 1]);
    });

    function edit(blob2edit) {
        'use strict';

        // check for previous blob to revoke URL and then delete
        if (edits.length > 0) {
            handledURL.revokeObjectURL(edits[edits.length - 1]);
            edits.splice(edits.length - 1, 1);
        }

        // mp3 seconds per frame = 0.026             (constant)
        // CBR mp3 at a 128,000 bitRate              (constant)
        // 1152 samples per frame                    (constant)
        // 1152 / 8 = 144 bits per sample            (constant)
        
        // 'bits / frame = frame_size * bit_rate / sample_rate' - http://lame.sourceforge.net/tech-FAQ.txt
        //  new b/f rate = 144        * 128000   / x

        // Web Audio API sampleRate can be changed according to hardware detection, so use audioCtx value
        var bitsPerFrame = 144 * (128000 / configSampleRate);

        // get closest quantity of bits to the nearest byte - http://lame.sourceforge.net/tech-FAQ.txt
        // if (padding-bit) {use .round} else {use .floor}, we use MPEG-1 Layer 3 which uses the padding-bit
        var leftBytes = Math.round(leftFrames * bitsPerFrame);
        var rightBytes = Math.round(rightFrames * bitsPerFrame);

        // protect from slicing by -0
        if (rightBytes === 0) {
            rightBytes = blob2edit.size;
        } else {
            rightBytes = -rightBytes;
        }

        // trim n bytes, equal to the nearest n mp3 frames, equal to the sliding percent values set by the user
        try {
            var newEdit = blob2edit.slice(leftBytes, rightBytes, 'audio/mpeg');
            newEdit.name = getFilename(true);
            edits.push(newEdit);
        }
        catch (e) {
            alert('failed to create edit, please try again. error: ' + e);
        }
        finally {
            if (edits.length > 0) {
                try {
                    // create URL object
                    var editURL = handledURL.createObjectURL(edits[edits.length - 1]);
    
                    // attach new src and reveal audio element
                    $('#edited').attr('src', editURL)
                                .css('display', 'block')
                                .on('error', function (e) {
                                    alert('media error: ' + e.code + ': ' + e.message);
                    });

                    // pause playback before modal overlay
                    if (!source.paused) {
                        source.pause();
                        $('#play').show();
                        $('#pause').hide();
                    }
                    
                    // present 'Keep / Discard' dialog modal
                    $('#keep-discard').dialog({
                        title: 'Your Edited Audio',
                        modal: true,
                        closeOnEscape: true,
                        minWidth: 310,
                        buttons: [
                                    { 
                                        text: 'Keep', click: function() {

                                            upload(edits[edits.length - 1], true);
                                            $('#keep-discard').dialog('close');
                                        }
                                    },
                                    { 
                                        text: 'Discard', click: function() {
                                            handledURL.revokeObjectURL(edits[edits.length - 1]);
                                            edits.pop();
                                            $('#keep-discard').dialog('close');
                                        }
                                    }
                                ]
                    });

                    // fixes odd auto-highlighting bug on download button (without removing <a> highlighting)
                    $('#download-edit').blur();
                    $('#edited').focus();
                    $('#edited').blur();
                }
                catch (e) {
                    alert('failed to display your edit, please try again');
                    console.log('edit blobURL error: ', e);
                }
            } else {
                alert('failed to create an mp3 of your edit, please try again');
            }
        }
    }

    // pass current source blob to upload function
    $('#upBtn').on('click', function (e) {
        e.preventDefault();
        upload(blobs[blobs.length - 1], false);
    });

    function upload(blob2upload, ifEdit) {
        'use strict';

        // prepare blob for form upload
        var formData = new FormData();
        // check for edited mp3 and change filename accordingly 
        if (ifEdit === true) {
            formData.append('blob', blob2upload, getFilename(true));
        } else {
            formData.append('blob', blob2upload, getFilename(false));
        }

        // upload to server with no added type-processing
        $.ajax({
            type: 'POST',
            url: 'UploadHandler.ashx',
            headers: {
                'x-user-id': 'custom-value'
                // 'x-zone-id': 'custom-value'
            },
            data: formData,
            cache: false,
            processData: false,         // tell jQuery not to process the data
            contentType: false,        // tell jQuery not to set a contentType
            success: function (data) {
                saveCount++;
                alert('Your recording has been sent to your Media Manager');
            },
            error: function (error) {
                alert('Could not upload your audio, please try again or contact us.');
                console.log('Upload error message: ' + error);
            }
        });
    }

/** Start initiates recording, Stop gets and presents blob  ***********************************************************/

    $('#startBtn').on('click', function (e) {
        'use strict';
        e.preventDefault();

        // iOS will only allow recording in direct response to a user gesture
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        // this stops possibility of qeueing multiple overlapping recordings at once by
        // forcing users to resolve getUserMedia prompt before allowing more start clicks
        $('#startBtn').attr('pointer-events', 'none');

        var btn = $(this);

        recorder.start(function () {
            $('#timer, #bg').css('visibility', 'visible');
            // start timer
            var start = 0, s = 0, m = 0;
            //Add 0 if seconds less than 10
            if (s < 10) {
                s = '0' + s;
            }

            timer = setInterval(function () {
                start++;
                //Get hours and minutes
                s = parseInt(start % 60);
                m = parseInt((start / 60) % 60);
                //Add 0 if seconds less than 10
                if (s < 10) {
                    s = '0' + s;
                }
                updateTimer();
            }, 1000);

            var updateTimer = function () {
                $('#timer').text(m + ':' + s);
            };

            updateTimer();

            // return clickable property to start button
            $('#startBtn').attr('pointer-events', 'auto');

            // kick-off drawing: requestAnimationFrame callback drives animation from within draw();
            draw();
            
            // swap out start button for stop button
            $('#startBtn, #stopBtn').toggle();

        }, function (e) {
            alert(e, 'Could not make use of your microphone, please check your hardware is working:');
            // reset context and buttons
            if (audioCtx.state === 'running') {
                audioCtx.suspend();
            }
            // swap out start button for stop button
            $('#startBtn, #stopBtn').toggle();
        });
    });

    $('#stopBtn').on('click', function (e) {
        'use strict';
        e.preventDefault();

        // if source was playing, toggle pause/play buttons
        if (source && !source.paused) {
            $('#play').show();
            $('#pause').hide();
        }

        // cancel animation callback
        window.cancelAnimationFrame(drawVisual);
        // stop timer
        clearInterval(timer);
        // stop recorder
        recorder.stop();

        // swap out stop button for start button
        $(this).css('display', 'none');
        $('#startBtn').css('display', 'inline-block');
        // why not toggle?

        recorder.getMp3Blob(function (blob) {

            // check for previous blob to revoke URL and then delete
            if (blobs.length > 0) {
                handledURL.revokeObjectURL(blobs[blobs.length-1]);
                blobs.splice(blobs.length - 1, 1);
            }

            // check if the recording is broken via empty buffers
            if (blob.size === 0) {
                alert('there was a problem with the recording, please try again');
            } else {
                // removed <%-- filename = mediaid + fileExt; --%> from UploadHandler.ashx to stop it renaming the file
                blob.name = getFilename(false);
                blobs.push(blob);
            }

            try {
                // create URL object
                var blobURL = handledURL.createObjectURL(blobs[blobs.length - 1]);
            }
            catch (e) {
                alert('could not display your recording please try again. error: ' + e);
            }
            finally {
                // attach blobURL and use new audio.src to update authoring values
                $('#source').attr('src', blobURL).on('durationchange', function () {
                    // keep relevant slider values up to date
                    source = this;
                    totalFrames = source.duration * 38.28125;

                    // refresh / reset authoring values for new source
                    leftHandle  = 0;
                    $('#slider').slider('values', 0, 0);
                    rightHandle = 100;
                    $('#slider').slider('values', 1, 100);
                    source.currentTime = 0.0;
                    timeValue = ((source.currentTime / source.duration) * 100);
                    $('#leftDiv, #rightDiv').css('width', '0.0\%');
                    checkFrames();
                })
                .on('error', function (e) {
                    alert('media error: ' + e.code + ': ' + e.message);
                });
            }

        });

        if (audioCtx.state === 'running') {
            audioCtx.suspend();
        }
        
        // reveal UI elements
        $('#slide-wrap, #slider, #playerUI, #storeBtn, #upBtn, #editBtn').css('visibility', 'visible');
    });

/** resource unload functions and call to init() **********************************************************************/

    // jQuery appears to have removed their beforeunload API entries, so using vanilla JS to be safe
    window.addEventListener('beforeunload', function (e) {

        // if the user has made a recording but has not uploaded, offer a 'are you sure'
        if (blobs.length !== 0 && saveCount === 0) {
            var confirmationMessage = 'Are you sure you want to leave? Any unsaved recordings will be lost';

            e.returnValue = confirmationMessage;     // Gecko, Trident, Chrome 34+
            return confirmationMessage;              // Gecko, WebKit, Chrome <34
        }
    });

    $(window).on('unload', function () {
        // unload URL objects
        handledURL.revokeObjectURL(edits[edits.length - 1]);
        handledURL.revokeObjectURL(blobs[blobs.length - 1]);

        // delete session array blobs
        blobs = [];
        edits = [];

        // force stop --> disconnect nodes (Zhuker warns this may not empty all Web Worker buffers)
        recorder.stop();
       
        // close audio context
        audioCtx.close().then(console.log('context closed'));
    });
    
    // initiate required resources
    init();
})();
