var Main = (function () {

    var blobs = [],                                     // array to hold recordings for the session
        edits = [],                                     // array to load edited recordings for the session
        timer,                                          // needed by startBtn and stopBtn (replace with [m:ss])
        recorder,                                       // single instance constructed, used in many places
        audioCtx,                                       // single session audioContext that is used in many places
        analyser,                                       // set-up by mic.js, connected by on.startBtn, used by draw()
        source,                                         // for current source <audio>: defined by 'this' when loaded
    //  sourceNode,                                     // audioContext node for HTML audio element, not microphone
        canvas = document.getElementById('canvas'),     // jQuery object canvas causes issues when painting
        canvasCtx,                                      // single session canvasContext used in MP3Recorder and draw()
        drawVisual,                                     // requestAnimationFrame id to cancel callback loop
        handledURL = window.URL || window.webkitURL,    // alias to avoid overwriting the window objects themselves
        blobURL,                                        // allows audio.src and download.href to share the same object URL
        random = Math.random,                           // a sheer convenience for using random() within canvas
        log = $('#log'),                                // a sheer convenience for using a HTML console.log for mobile

    //  authoring values:
        leftHandle,         // sliding percentage to trim from audio start
        rightHandle,        // sliding percentage to trim from audio end
    //  #timeHandle         // the DOM element (created & defined later)
        timeValue,          // current audio time in int percentage
        leftFrames,         // discrete n frames to trim (requires leftHandle)
        rightFrames,        // discrete n frames to trim (requires rightHandle)
        totalFrames;        // a constant per each audio recording
    //  wasPlayed = false;  // Only used within the playback restrict section to control looping playback

    // grab feature detection string from isMicSupported.js Module
    log.prepend('<li>' + IsMicSupported + '</li>');

/** prepare application for recording *********************************************************************************/

    // initiate application resources
    function init () {
        'use strict';

        // init Web Audio API context (prefixed by AudioContextMonkeyPatch.js)
        try {
            audioCtx = new window.AudioContext();
            log.prepend('<li>audio context constructed: ' + audioCtx.state + '</li>');
        }
        catch (e) {
            alert(e + ': Web Audio API not supported, please try updating or switching browsers to continue');
        }

        // config recorder and connect to audio and canvas contexts
        try {
            recorder = new MP3Recorder({bitRate: 128});
            // log.prepend('<li>recorder constructed: ' + recorder + '</li>');
        }
        catch (e) {
            alert(e + ': recorder was not instanced, could be a (MP3Recorder || web worker || browser) issue');
        }
        finally {
            // suspend audioContext until user starts recording
            if (recorder) {
                suspendAudioCtx();
            }
        }

        // init canvas 2d context
        if (canvas.getContext) {
            canvasCtx = canvas.getContext('2d'); 
        } else {
            log.prepend('<li>canvas context unsupported</li>');
        }

        // construct slider once (updated dynamically)
        initSlider();

        // start playback/slider interval once (updated dynamically)
        initInterval();

        // init player UI
        initPlayerUI();

        // reveal source media element for debugging
        // $('#source').css('visibility', 'visible');
    }

/** audioContext and microphone functions *****************************************************************************/

    // inits recorder object, populate AudioContext & prepares Worker communication
    var MP3Recorder = function (config) {
        recorder = this;
        recorder.startTime = 0;
        config = config || {};
        var realTimeWorker = new Worker('worker-realtime.js');

        // Initializes LAME so that we can record
        this.initialize = function () {
            // let context decide best (usually 44100, sometimes 48000)
            config.sampleRate = 44100; // audioCtx.sampleRate;
            realTimeWorker.postMessage({cmd: 'init', config: config});
        };
        // This function finalizes LAME output and saves the MP3 data to a file
        var microphone, processor;

        // Function that handles getting audio out of the browser's media API
        function beginRecording(stream) {
            // Set up Web Audio API to process data from the media stream (microphone)
            // Settings a bufferSize of 0 instructs the browser to choose the best bufferSize
            // Webkit version 31 requires that a valid bufferSize be passed when calling this method

            // createMediaStreamSource likes to go after processor code for iOS
            microphone = audioCtx.createMediaStreamSource(stream);

            // Add all buffers from LAME into an array
            processor = audioCtx.createScriptProcessor(0, 1, 1);

            analyser = audioCtx.createAnalyser();
            microphone.connect(analyser);

            processor.onaudioprocess = function (event) {
                // immediately update canvas, then send off buffer 
                // draw(); // seems to only work here, the only on-repeat processing function (others are mostly inits)
                // Send microphone data to LAME for MP3 encoding while recording
                var array = event.inputBuffer.getChannelData(0);
                realTimeWorker.postMessage({cmd: 'encode', buf: array});
            };

            // Begin retrieving microphone data
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
                processor.onaudioprocess = null;
                // Return the buffers array. Note that there may be more buffers pending here
            }
        };

        // Function for kicking off recording on 'start' click --> refactored for promise-based MediaDevices
        this.start = function (onSuccess, onError) {
            // Request access to the microphone
            window.navigator.mediaDevices.getUserMedia({audio: true}).then(function (stream) {
                // Begin recording and get a function that stops the recording
                var stopRecording = beginRecording(stream);
                //log.prepend('<li>UUID for getUserMedia(stream): ' + stream.id + '</li>');
                recorder.startTime = Date.now();
                if (onSuccess && typeof onSuccess === 'function') {
                    onSuccess();
                }
                // Run a function every 100 ms to update the UI and dispose it after 5 seconds
            }).catch(function (error) {
                if (onError && typeof onError === 'function') {
                    onError(error);
                }
                log.prepend('<li>' + error + '</li>');
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
                        mp3ReceiveSuccess(new Blob(e.data.buf, {type: 'audio/mpeg'}));       // application/octet-binary
                    }
                    break;
                case 'error':
                    if (currentErrorCallback) {
                        currentErrorCallback(e.data.error);
                    }
                    break;
                default :
                log.prepend('<li>Web Worker received a message it does not know how to handle: ' +
                e.data + '</li>');
            }
        };
        this.initialize();
    };

    // suspends context until required by start button
    function suspendAudioCtx () {
        'use strict';
        if (audioCtx.state === 'running') {
                audioCtx.suspend().then(function() {
                    log.prepend('<li>audio context suspended</li>');
                });
        } else {
            log.prepend('<li>audio context was not running when suspendAudioCtx ran</li>');
        }
    }

/** canvas visualisation functions ************************************************************************************/

    function getRandomColor () {
        'use strict';
        return (random() * 256) >> 0;
    }

    // repeatedly called from on.audioprocess
    function draw () {
        'use strict';

        // callback to parent function gives requestAnimationFrame control over calls per second
        drawVisual = window.requestAnimationFrame(draw);

        // clear canvas before drawing
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        // canvasCtx.fillStyle = 'rgb(0, 0, 0)';
        
        // get time-based array data for particles
        var particles = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(particles);
        analyser.getByteFrequencyData(particles);

        // create a white-particle oscilloscope
        for (var i = 0; i < particles.length; i++) {
            var value = particles[i],
                percent = value / 200, // 256 = centered
                _height = canvas.height * percent,
                offset = canvas.height - _height - 1,
                barWidth = canvas.width / particles.length;

            canvasCtx.fillStyle = 'white';
            canvasCtx.fillRect(i * barWidth, offset, 1, 1);

            // canvasCtx.rotate(i * Math.PI / 180);    (this change made the palette blue/purple) ↓
            canvasCtx.fillStyle = 'rgb(' + getRandomColor() + ',' + getRandomColor() + ',' + (256 >> 0) + ')';
            // coloured bouncing city-scape
            canvasCtx.fillRect(i, canvas.height - particles[i] * 0.2, 10, canvas.height);
            canvasCtx.strokeRect(i, canvas.height - particles[i] * 0.0001, 10, canvas.height);
        }
        // get byte-based array data
        // var bytes = new Uint8Array(analyser.frequencyBinCount);
        // analyser.getByteFrequencyData(bytes);

        // create some misc blocks and crap [currently]
        // for (i = 1; i < bytes.length; i++) {
        // }
    }

/** [experimental & historical canvas mappings] ***********************************************************************/
    /*
    // get time-based array data for waveform
    var waveform = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatTimeDomainData(waveform);

    // draw black-lined oscilloscope
    canvasCtx.beginPath();
    for (i = 0; i < waveform.length; i++) {
        var x = i;
        var y = (0.5 + waveform[i] / 2) * canvas.height;
        if (i == 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
    }
    canvasCtx.stroke();

    // short color lines dance overtop oscilloscope 
    canvasCtx.fillRect(x, canvas.height - bytes[x] * 0.666, 0.666, canvas.height / 13);

    // black bullets rain down from top of canvas
    canvasCtx.strokeRect(i, canvas.height - (bytes[i] / 0.03), 0.001, canvas.height / 25);

    // misc
    canvasCtx.fillRect(i++, canvas.height - dataArray[i], 10, canvas.height);
    canvasCtx.strokeRect(i, i, canvas.width, canvas.height / 500);
    canvasCtx.fillRect(i++, canvas.height - dataArray[i], 10, canvas.height);

    // for resetting a transform (like rotate)
    canvasCtx.setTransform(1, 0, 0, 1, 0, 0);
    */
/** slider and playback functions *************************************************************************************/

    // init jquery-ui slider
    function initSlider () {
        'use strict';

        log.prepend('<li>initSlider fired</li>');

        // reveal DOM slider
        $('#slider').slider({
            step   : 1,
            range  : false,
            animate: true,
            values : [0, 100, 0], // (jquery gives lowest index value precedence upon overlap)

            // define convienient handle id's to target for editing and playback
            create: function () {
                $('.ui-slider-handle').eq(0).attr('id', 'leftHandle');
                $('.ui-slider-handle').eq(1).attr('id', 'rightHandle');
                $('.ui-slider-handle').eq(2).attr('id', 'timeHandle');
            },

            // restrict handles from sliding over each other update editing values
            slide: function (event, ui) {
                // keep these top-scope variables up-to-date for other authoring/playback functions
                leftHandle  = ui.values[0];
                rightHandle = ui.values[1];

                // timeHandle ⇌ currentTime:
                if ($('#timeHandle').hasClass('ui-state-active')) { // this could also go inside interval if needed
                    source.currentTime = (source.duration / 100) * ui.values[2];
                    console.log('timeHandle is active');
                }
                /*
                    $('#timeHandle').on('focus', function () {
                        console.log('focused');
                    });
                    interval maps currentTime onto slider via timeValue...
                    this function maps ui.values[2] back to currentTime...
                    I guess this is the UI issue: two competing functions.
                    but why does this push timeHandle to the left?
                    why does moving left/rightHandle affect the timeHandle?
                */

                // if left/right Handles get too close to overlapping, return false to stop slide
                if ((ui.values[0] >= (ui.values[1] - 1)) || (ui.values[1] <= (ui.values[0] + 1))) {
                    console.log('[collision]');
                    return false;
                }
            },

            // refresh frame values when handles are explicitly moved by the user
            stop: function () {
                checkFrames();
                // fixes a removing-your-finger bug on some touch screens (investigate: many mobiles ignore this)
                $('.ui-slider-handle').blur();
            }
        });
    }

    // check frame values are mapped to current slider values
    function checkFrames () {
        'use strict';
        leftFrames = (totalFrames / 100) * leftHandle;
        rightFrames = (totalFrames / 100) * (100 - rightHandle);

        log.prepend('<li>frames  = [' + leftFrames + ', ' + rightFrames + ']</li>');

        // check for meaningful values, enable/disable edit button
        if ((leftFrames === 0) && (rightFrames === 0)) { // why frames? would slides be better to check against?
            $('#editBtn').attr('disabled', true);
        } else {
            $('#editBtn').attr('disabled', false);
        }
    }

    // set up playerUI
    function initPlayerUI () {
        'use strict';

        log.prepend('<li>initPlayerUI fired</li>');

        // prepare player
        $('#pause').css('display', 'none');
        $('#duration').html('0:00');
        
        //volume vontrol
        $('#volume').on('input', function () {
            source.volume = parseFloat(this.value / 10);
        });

        //play button
        $('#play').on('click', function () {
            source.play(); // whyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
            $('#play').css('display', 'none');
            $('#pause').css('display', 'inline-block');
            // $('#duration').fadeIn(400);
        });

        //pause button
        $('#pause').on('click', function () {
            source.pause();
            $('#play').css('display', 'inline-block');
            $('#pause').css('display', 'none');
        });
    }

    // runs once on repeat to keep handle values up to date and within range
    function initInterval () {
        'use strict';

        log.prepend('<li>initInterval fired</li>');

        setInterval(function () {
            // only runs if interval has some audio to affect
            if (source) {
                // timeValue (int) is given to both timeHandle value & CSS position
                timeValue = parseInt((source.currentTime / source.duration) * 100);
                // add percentage and update position
                $('#timeHandle').css('left', (timeValue  + '\%'));
                // assigns up-to-date timeValue to timeHandle
                $('#slider').slider('values', 2, timeValue);

                // set lower-bound of currentTime to wherever leftHandle currently is
                if (source.currentTime <= (source.duration / 100) * leftHandle) {
                    source.currentTime = ((source.duration / 100) * leftHandle) + 0.01; // temp fix, better to re-position leftHandle
                    $('#pause').css('display', 'none');
                    $('#play').css('display', 'inline-block');
                    source.pause();
                }

                // set upper-bound of currentTime to wherever rightHandle currently is
                if (source.currentTime >= (source.duration / 100) * rightHandle) {
                    source.currentTime = ((source.duration / 100) * leftHandle) + 0.01; // temp fix, better to re-position leftHandle
                    $('#pause').css('display', 'none');
                    $('#play').css('display', 'inline-block');
                    source.pause();

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

                // if playback ends, reset currentTime and buttons
                if (source.currentTime === source.duration) {
                    source.currentTime = 0; // issue: leftHandle = 0, therefore inits other interval loops (worse when sliders have moved)
                    source.pause();
                    $('#pause').css('display', 'none');
                    $('#play').css('display', 'inline-block');
                }
            }
        }, 26); // 26 ms is both the exact frame length and the fastest possible 'timeupdate' event that I am circumventing
    }
    
/** [restricting playback experimental section] ***********************************************************************/

    // (these aren't stopping timeHandle, nor pausing rn... but is immobilising [L/R]handles instead)
    // sets leftHandle as lower limit for timeHandle
    // if (timeValue < leftHandle) {
    //     console.log('[lower]');
    //     source.pause();
    //     return false;
    // }
    // sets rightHandle as upper limit for timeHandle
    // if (timeValue > rightHandle) {
    //     console.log('[upper]');
    //     source.pause();
    //     return false;
    // }


    // yet another way to call draw() repeatedly. works without connecting sourceNode (colors change, no motion)
    // if (!source.paused) {
    //     draw();
    // }

    // strange visual bug: when source becomes a sourceNode, playback breaks.
    // maybe the added task is slowing playback such that timeIntervals are breaking? doubt it. connection/piping issue.
    /*$('#source').on('loadedmetadata', function () {
        // 'use strict';
        sourceNode = audioCtx.createMediaElementSource(source);
        sourceNode.connect(analyser);
        navigator.mediaDevices.enumerateDevices()
            .then(function(devices) {
                devices.forEach(function(device) {
                    console.log(device.kind + ": " + device.label +
                        " id = " + device.deviceId);
                });
            })
            .catch(function(err) {
                console.log(err.name + ": " + err.message);
            });
        sourceNode.connect(audioCtx.destination);
    }).on('timeupdate', function () {
        console.log('shouldDraw');
        draw();
    })*/
    // .on('play', function() {
        // uses a boolean 'wasPlayed' to indicate currentTime was stopped at rightHandle when play() event fired
        // fires if play is resumed from pause, and the loop only catches when play should resume from the leftHandle
        // cannot use play/pause within this listener because it will call itself mid-execution, so it inits shouldPlay.
        // 'use strict';
        // if shouldPlay wasn't just fulfilled (which can only be requested from this loop), react normally to play();
        // if (wasPlayed === false) {

            // this loop play's from a non-zero L position, so if the leftHandle is not at 0%, continue
            // if ((leftHandle || rightHandle) !== 0) {

                // merely helps to clean up calculation below
                // var rMax = (source.duration / 100) * (rightHandle);

                // approximates if currentTime is the near position of the rightHandle and sets currentTime to the left
    //             if (((source.currentTime >= (rMax - .075)) && (source.currentTime <= (rMax + .075))) || rightHandle === 100) {

    //                 source.currentTime = ((source.duration / 100) * leftHandle);
    //                 log.prepend('<li>loop</li>');
    //                 console.log('shouldPlay(1)');
    //                 shouldPlay();
    //             } else {
    //                 log.prepend('<li>~loop</li>');
    //             }
    //         } else {
    //             console.log('leftHandle || rightHandle === 0');
    //         }

    //     } else {
    //         console.log('wasPlayed = true');
    //         wasPlayed = false;
    //     }
    // });

    // only called from on.play(): handles kicking off play() with a boolean and delay to avoid re-initiating on.play()
    // function shouldPlay () {
    //     'use strict';
    //     var lMax = (source.duration / 100) * (leftHandle);
    //     if ((source.currentTime >= (lMax - 0.075)) && (source.currentTime <= (lMax + 0.075))) {
    //         console.log('shouldPlay in 250ms (2)');
    //         setTimeout(function() {
    //             console.log('inside (4)');
    //             source.play();
    //             wasPlayed = false;
    //         }, 250);
    //         console.log('afterward (3)');
    //         wasPlayed = true;
    //     } else {
    //         console.log('was not at L%');
    //         wasPlayed = false;
    //     }
    // }

/** edit / store / upload button functions ****************************************************************************/

    function edit(blob2edit) {
        'use strict';
        // mp3 seconds per frame = 0.026             (constant)
        // CBR mp3 at a 128,000 bitRate              (constant)
        // 1152 samples per frame                    (constant)
        // 1152 / 8 = 144 bits per sample            (constant)
        
        // 'bits / frame = frame_size * bit_rate / sample_rate' - http://lame.sourceforge.net/tech-FAQ.txt
        //  417.95918367 = 144        * 128000   / 44100

        var leftBytes = Math.round(leftFrames * 417.95918367);
        var rightBytes = Math.round(rightFrames * 417.95918367);

        // protect from slicing by -0
        if (rightBytes === 0) {
            log.prepend('<li>rightBytes would equal -0 and break math itself, so set R to blob.size</li>');
            rightBytes = blob2edit.size;
        } else {
            rightBytes = -rightBytes;
        }

        // trim n bytes, equal to the nearest n of mp3 frames, equal to the slider percent values, set by the user
        edits.push(blob2edit.slice(leftBytes, rightBytes, 'audio/mpeg'));

        try {
            // first check for previous blob URL to revoke
            if (edits[edits.length - 2]) {
                handledURL.revokeObjectURL(blobs[blobs.length - 2]);   // could also delete this blob from array here...
                console.log('revoked');
            } else {
                console.log('nothing to revoke yet');
            }

            // attach new src and reveal audio element
            $('#edited').attr('src', handledURL.createObjectURL(edits[edits.length - 1]))
                        .css('visibility', 'visible')
                        .on('error', function (e) {
                            log.prepend('<li>media error: ' + e.code + ': ' + e.message + '</li>');
                        });
        }
        catch (e) {
            log.prepend('<li>createObjectURL failed (from edit), error: ' + e + '</li>');
        }
    }

    function store(blob2store) {
        // 'use strict'; will break store function
        // feature detection snippet for web storage from Mozilla Documentation:
        // https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API

        var storageAvailable = function (type) {
            try {
                var storage = window[type],
                    x = '__storage_test__';
                storage.setItem(x, x);
                storage.removeItem(x);
                return true;
            }
            catch (e) {
                return e instanceof DOMException && (
                        // everything except Firefox
                    e.code === 22 ||
                    // Firefox
                    e.code === 1014 ||
                    // test name field too, because code might not be present
                    // everything except Firefox
                    e.name === 'QuotaExceededError' ||
                    // Firefox
                    e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
                    // acknowledge QuotaExceededError only if there's something already stored
                    storage.length !== 0;
            }
        };

        var reader = new FileReader();

        // on load end of the readAs method which is written below this function, run this loop
        reader.onloadend = function () {
            // check storage availability and store the blob via file reader result
            if (storageAvailable('localStorage')) {
                try {
                    localStorage.setItem('blob2store', reader.result);
                    log.prepend('<li>' + localStorage + '</li>');
                    // if the key we just set is not null (ie it worked), then display html
                    if (localStorage.getItem('blob2store') !== null) {
                        // get blob from storage & display
                        $('#store').append('<audio controls src="' + localStorage.getItem('blob2store') + '"></audio>');
                    } else {
                        log.prepend('<li>blob2store from localStorage could not be found</li>');
                    }
                }
                catch (e) {
                    log.prepend('<li>Item could not be stored: ' + e + '</li>');
                }
            } else {
                log.prepend('<li>localStorage is unavailable: If you do not save your audio and' +
                                 ' this tab is closed, you will lose the audio from this session</li>');
            }
        };

        //read blob as X (this must happen before storage can succeed)
        reader.readAsDataURL(blob2store);
    }

    function upload(blob2upload) {
        'use strict';

        // prepare blob for form upload
        var formData = new FormData();
        formData.append('blob', blob2upload, 'blob.mp3');
        formData.append('name', 'value');

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
            processData: false, // tell jQuery not to process the data
            contentType: false, // tell jQuery not to set a contentType
            success: function (data) {
                log.prepend('<li>onSuccess data: ' + data + '\n</li>');
            },
            error: function (error) {
                log.prepend('<li>Could not upload audio, please try again or contact us.' +
                    'Error message: ' + error + '\n</li>');
            }
        });
    }

/** button events pass a blob to their respective functions ***********************************************************/

    // pass source to edit function
    $('#editBtn').on('click', function (e) {
        e.preventDefault();
        edit(blobs[blobs.length - 1]);
    });

    // pass (source || edit) to store function (base on keep / discard prompt)
    $('#storeBtn').on('click', function (e) {
        e.preventDefault();
        // if (keep === true) {store(edits[edits.length - 1]);} else {...
        store(blobs[blobs.length - 1]);
    });

    // pass (source || edit) to upload function (base on keep / discard prompt)
    $('#upBtn').on('click', function (e) {
        e.preventDefault();
        // if (keep === true) {upload(edits[edits.length - 1]);} else {...
        upload(blobs[blobs.length - 1]);
    });

/** Start initiates recording, Stop gets and presents blob  ***********************************************************/

    $('#startBtn').on('click', function (e) {
        'use strict';
        e.preventDefault();

        // clicking start directly resumes context but doesn't wastefully create a new audioCtx
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().then(function () {
                log.prepend('<li>audio context resumed</li>');
            });
        } else {
            log.prepend('<li>context was not suspended when resume ran</li>');
        }

        // forces user to resolve getUserMedia prompt before allowing more start clicks:
        // stops possibility of qeueing multiple recordings at once (functionality works but breaks UI)
        $('#startBtn').attr('disabled', true);

        var btn = $(this);

        recorder.start(function () {
            // start timer
            var seconds = 0, updateTimer = function () {
                $('#timer').text(seconds < 10 ? '0' + seconds : seconds);
            };
            timer = setInterval(function () {
                seconds++;
                updateTimer();
            }, 1000);
            updateTimer();
            $('#stopBtn').removeAttr('disabled');

            // kick-off drawing: requestAnimationFrame callback drives animation from within draw();
            draw();

        }, function (e) {
            alert(e, 'Could not make use of your microphone, please check your hardware is working:');
        });

        // swap out start button for stop button
        $('#startBtn').css('display', 'none');
        $('#stopBtn').css('display', 'inline-block');
    });

    $('#stopBtn').on('click', function (e) {
        'use strict';
        e.preventDefault();

        // cancel animation callback
        window.cancelAnimationFrame(drawVisual);
        // stop timer
        clearInterval(timer);
        // stop recorder
        recorder.stop();

        // swap out stop button for start button
        $(this).attr('disabled', true).css('display', 'none');
        $('#startBtn').removeAttr('disabled').css('display', 'inline-block');

        recorder.getMp3Blob(function (blob) {

            // check if the blob itself is broken
            if (blob.size === 0) {
                log.prepend('<li>blob.size was zero</li>');
            } else {
                blobs.push(blob);
            }

            // first check for previous blob URL to revoke
            try {
                if (blobs[blobs.length-2]) {
                    handledURL.revokeObjectURL(blobs[blobs.length-2]); // could also delete this blob from array here...
                    log.prepend('<li>revoked via blobs array</li>');
                } else {
                    log.prepend('<li>nothing in blobs array to revoke yet</li>');
                }

                // create a blobURL for the audio element and the download button to share
                blobURL = handledURL.createObjectURL(blobs[blobs.length - 1]);

                // attach blobURL and use new audio.src to update authoring values
                $('#source').attr('src', blobURL)
                            .on('durationchange', function () {
                                // keep relevant slider values up to date
                                source = this;
                                totalFrames = source.duration * 38.28125;
                                log.prepend('<li>.on durationchange #source = ' + source + '</li>');
                                // append the same blobURL as a download link
                                $('#download').html('<a href="' + blobURL + 
                                '"download class="btn btn-primary">⇩</a>'); // Chrome = no 'save as' prompt (does in firefox)
                            })
                            .on('error', function (e) {
                                log.prepend('<li>media error: ' + e.code + ': ' + e.message + '</li>');
                            });
            }
            catch (e) {
                log.prepend('<li>createObjectURL failed (from source), error: ' + e + '</li>');
            }
            // finally {
                // var srcAttr = $('#source').attr('src');
                // if (srcAttr === blobURL) {
                //     srcFlag = true;
                // } else {
                //     srcFlag = false;
                // }
                // } else {
                //     log.prepend('<li>srcAttr !== blobURL = ' + source + '</li>');
                // }

                // now define slider in relation to new 'source' variables
                // alternative place to connect to visualisation to playback
                // console.log(source);
                // sourceNode = audioCtx.createMediaElementSource(source);
                // sourceNode.connect(analyser);
                // sourceNode.connect(audioCtx.destination);
            // }
        });

        suspendAudioCtx(); // warning: iOS may not like this function reference...

        // enable store and upload buttons (not edit which is enabled when an editHandle is moved)
        $('#storeBtn, #upBtn').removeAttr('disabled');
        // reveal UI elements
        log.prepend('<li>about to reveal UI</li>');
        $('#slider, #playerUI, #storeBtn, #upBtn, #editBtn').css('visibility', 'visible');
    });

/** warn user to save progress before unloading resources *************************************************************/

    // $(window).on('beforeunload', function () {
    //     return 'Are you sure you want to leave? Any unsaved recordings will be lost';
    // });

    $(window).on('unload', function () {
        // unload URL objects
        handledURL.revokeObjectURL(blobs[blobs.length-1]);
        handledURL.revokeObjectURL(edits[edits.length-1]);
        
        // delete session array blobs
        blobs = [];
        edits = [];
        
        // empty localStorage (til I find an actual implementation for it)
        localStorage.clear();

        // force stop --> disconnect nodes (Zhuker warns this may not empty all buffers (some might still be in Worker?)
        recorder.stop();
       
        // close audio context
        audioCtx.close().then(console.log('context closed'));
        // await audioCtx.close();
        // .catch(function (e) {console.log('context not closed', e)});

        // terminate worker, somehow trigger it to empty its buffer first (postMessage!)
        // event.returnValue = '';
    });

    // initiate required resources
    init();
})();
/* 
 * 1) define the 'create audio' DOM (class=”toolIconButton” for authoring)
 * 2) call $(Main.init) on click of data-action="Media.CreateAudio" button
 * 3) run init function to test API + device compatability (msg user or hide?)
 * 4) set flags for dataURL's & other exception handling detected by init
 * 4) offer Web Audio button, or possibly ask to switch browsers to continue
 * 5) (research how to use Bracken's media editors as fallbacks for mine?)
 * 6) watch how data-action="Media.CreateAudio" DOM is altered on click.
 * 7) replicate onInitSuccess and button onclick: insert tool HTML into DOM
 * 8) try more things like function doSmallTask(arg1, arg2) {...return x, y;}
    tack on (disabled) edit button
    $('#edit').append(
        '<button class="btn btn-primary editBtn" disabled="true">' +
        '<i class="glyphicon glyphicon-edit"></i> Edit</button>'
    );

    tack on (disabled) store button
    $('#store').append(
        '<button class="btn btn-primary storeBtn" disabled="true">' +
        '<i class="glyphicon glyphicon-save"></i> Store' +
        '</button>'
    );
    the = this;
    totalFrames = source.duration * 38.28125;
    leftFrames = (totalFrames / 100) * leftHandle;
    rightFrames = (totalFrames / 100) * (100 - rightHandle);

    // check for meaningful values
    if ((leftFrames === 0) && (rightFrames === 0)) {
        $('#editBtn').attr('disabled', true);
    } else {
        $('#editBtn').attr('disabled', false);
    }
    // this does nothing, diagnose ACTUAL editing issue wrt defined percentages feeding into frame calculation.
    // if ((leftHandle === 0) && (rightHandle === 100)) {
    //     $('#editBtn').attr('disabled', true);
    // } else {
    //     $('#editBtn').attr('disabled', false);
    // }*/