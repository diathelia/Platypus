var Main = function () {
    // mp3 array's for edit / store / upload functions to access
    var blobs = [],                                        // array to load blobs into
        edits = [],                                        // array to load edits into
        timer,                                             // needed by startBtn and stopBtn (not keeping in long-term?)
        recorder,                                          // instance constructed per recording, used in many places
        context,                                           // single session context that is used in many places
        analyser,                                          // set-up by mic.js, connected by on.startBtn, used by draw()
        the,                                               // to be assigned to the current recording src via 'this'
        handledURL = window.URL || window.webkitURL,       // use this to avoid overwriting window objects
        random = Math.random,                              // a sheer convenience for using random() within canvas
        log = $('#log');                                   // a sheer convenience for using a console.log on mobile

    // authoring values: hopefully can be reduced with a getFreshValues() or (getFrames + getHandles)() approach

    // why do edits sometimes break ????

    var leftHandle,         // (detail where each is needed)
        rightHandle,        //
        leftFrames,         //
        rightFrames,        //
        totalFrames,        //
        wasPlayed;          //

    // grab feature detection string from another script
    log.prepend('<li>' + IsMicSupported + '</li>');

/****** setup canvas visualisation  ***********************************************************************************/

    function getRandomColor () {
        return random() * 255 >> 0;
    }

    function draw () {
        'use strict';
        // setup canvas
        var canvas = document.getElementById('webAudioCtx');
        if (canvas.getContext) {
            var canvasCtx =  canvas.getContext('2d');
        } else {
            console.log('canvas unsupported');
        }
        
        // clear canvas before drawing
        canvasCtx.fillStyle = 'rgb(0, 0, 0)';
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

        // get time-based array data
        var times = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(times);

        // create a particle-like oscilloscope
        for (var i = 0; i < times.length; i++) {
            var value = times[i];
            var percent = value / 200; // 256 = centered
            var _height = canvas.height * percent;
            var offset = canvas.height - _height - 1;
            var barWidth = canvas.width / times.length;
            canvasCtx.fillStyle = 'white';
            canvasCtx.fillRect(i * barWidth, offset, 1, 1);
        }

        // get byte-based array data
        var bytes = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bytes);

        // create some misc blocks and crap [currently]
        for (var i = 1; i < bytes.length; i++) {
            // canvasCtx.rotate(i * Math.PI / 180);
            canvasCtx.fillStyle = 'rgb(' + getRandomColor() + ',' + getRandomColor() + ',' + getRandomColor() + ')';
            canvasCtx.fillRect(i, canvas.height - bytes[i] * 0.2, 10, canvas.height);
            canvasCtx.strokeRect(i, canvas.height - bytes[i] * 0.0001, 10, canvas.height);
        }
    }
    // * 0.2
    // canvasCtx.fillRect(i++, canvas.height - dataArray[i], 10, canvas.height);
    // canvasCtx.strokeRect(i, i, canvas.width, canvas.height / 500);
    // canvasCtx.fillRect(i++, canvas.height - dataArray[i], 10, canvas.height);
    //canvasCtx.setTransform(1, 0, 0, 1, 0, 0);

/****** setup context and microphone **********************************************************************************/

    // construct a single AudioContext instance (prefixed by AudioContextMonkeyPatch.js)
    try {
        context = new window.AudioContext();
        // log.prepend('<li>audio context constructed: ' + context + '</li>');
    }
    catch (e) {
        alert(e + ': Web Audio API not supported, please try updating or switching browsers to continue');
    }

    // populate AudioContext & prepare Worker communication for the recorder object
    var MP3Recorder = function (config) {
        recorder = this;
        recorder.startTime = 0;
        config = config || {};
        var realTimeWorker = new Worker('worker-realtime.js');

        // Initializes LAME so that we can record
        this.initialize = function () {
            // let context decide best (usually 44100, sometimes 48000)
            config.sampleRate = context.sampleRate;
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
            microphone = context.createMediaStreamSource(stream);

            processor = context.createScriptProcessor(0, 1, 1);
            // Add all buffers from LAME into an array

            analyser = context.createAnalyser();
            microphone.connect(analyser);

            processor.onaudioprocess = function (event) {
                // Send microphone data to LAME for MP3 encoding while recording
                var array = event.inputBuffer.getChannelData(0);
                realTimeWorker.postMessage({cmd: 'encode', buf: array});
                draw();
            };
            microphone.connect(processor);
            // Begin retrieving microphone data
            processor.connect(context.destination);
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

        // Function for kicking off recording on button press --> refactored for promise-based MediaDevices
        this.start = function (onSuccess, onError) {
            // Request access to the microphone
            window.navigator.mediaDevices.getUserMedia({audio: true}).then(function (stream) {
                // Begin recording and get a function that stops the recording
                var stopRecording = beginRecording(stream);
                //log.prepend('<li>UUID for getUserMedia(stream): ' + stream.id + '</li>');
                recorder.startTime = Date.now();
                // if onSuccess
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

    // now context is running and populated, construct a single recorder instance outside of any click event
    try {
        recorder = new MP3Recorder({bitRate: 128});
        // log.prepend('<li>recorder constructed: ' + recorder + '</li>');
    }
    catch (e) {
        alert(e + ': recorder was not instanced, could be a (MP3Recorder || web worker || browser) issue');
    }

    // suspend context here so that clicking start = resume, stop = suspend
    context.suspend().then(function () {
        log.prepend('<li>audio context suspended</li>');
    }).catch(function(e) {
        log.prepend('<li>context did not suspend with the error: ' + e + '</li>');
    });

/****** setup slider **************************************************************************************************/

    // setup jquery-ui slider
    $('#slider').slider({
        min: 0.0,
        max: 100.0,
        step: 0.1,
        range: false, // needed for a 3-handled slider
        values: [0, 0, 100],
        // set authoring values (slidestop = mouse only, change = inc. programmatic)
        change: function (event, ui) {
            'use strict';
            leftHandle = ui.values[0];
            // ui.values[1] is for mapping to currentTime, but not from within this change event
            rightHandle = ui.values[2];

            totalFrames = the.duration * 38.28125; // mp3 frames per second (constant independent of bitrate)
            leftFrames = (totalFrames / 100) * leftHandle;
            rightFrames = (totalFrames / 100) * (100 - rightHandle);

            // log.prepend('<li>slides  = [' + leftHandle + ', ' + rightHandle + ']</li>');
            log.prepend('<li>frames  = [' + leftFrames + ', ' + rightFrames + ']</li>');

            // check for meaningful values
            if ((leftFrames === 0) && (rightFrames === 0)) { // why frames? would slides be better to check against?
                $('.editBtn').attr('disabled', true);
            } else {
                $('.editBtn').attr('disabled', false);
            }

            // this does nothing, diagnose ACTUAL editing issue wrt defined percentages feeding into frame calculation.
            // if ((leftHandle === 0) && (rightHandle === 100)) {
            //     $('.editBtn').attr('disabled', true);
            // } else {
            //     $('.editBtn').attr('disabled', false);
            // }


            // fixes a removing-your-finger bug on (some) touch screens (investigate: many mobiles ignore this)
            $('.ui-slider-handle').blur();
        }
    });

/** restrict playback to within slide positions ***********************************************************************/

    // fires if play is resumed from pause, and the loop only catches when play should resume from the leftHandle
    // cannot use play/pause within this listener because it will call itself mid-execution, so it inits shouldPlay();
    $('#source').on('play', function() {
        'use strict';

        // should I map this handle elsewhere?
        $('.ui-slider-handle').eq(1).attr('id', 'timeHandle');

        // if shouldPlay wasn't just fulfilled (which can only be requested from this loop), react normally to play();
        if (wasPlayed === false) {

            // this loop play's from a non-zero L position, so if the leftHandle is not at 0%, continue
            if (leftHandle !== 0) {

                // merely helps to clean up calculation below
                var rMax = (the.duration / 100) * (rightHandle);

                // approximates if currentTime is the near position of the rightHandle and sets currentTime to the left
                if (((the.currentTime >= (rMax - .075)) && (the.currentTime <= (rMax + .075))) || rightHandle === 100) {

                    the.currentTime = ((the.duration / 100) * leftHandle);
                    log.prepend('<li>loop</li>');
                    console.log('shouldPlay(1)');
                    shouldPlay();
                } else {
                    log.prepend('<li>~loop</li>');
                }
            } else {
                console.log('leftHandle === 0');
            }

        } else {
            console.log('wasPlayed = true');
            wasPlayed = false;
        }
    });

    // only called from on.play(): handles kicking off play() with a boolean and delay to avoid re-initiating on.play()
    function shouldPlay () {
        'use strict';
        var lMax = (the.duration / 100) * (leftHandle);
        if ((the.currentTime >= (lMax - 0.075)) && (the.currentTime <= (lMax + 0.075))) {
            console.log('shouldPlay in 250ms (2)');
            setTimeout(function() {
                console.log('inside (4)');
                the.play();
                wasPlayed = false;
            }, 250);
            console.log('afterward (3)');
            wasPlayed = true;
        } else {
            console.log('was not at L%');
            wasPlayed = false;
        }
    }

    // runs once on repeat to keep handle values up to date and within range
    setInterval(function () {
        'use strict';

        // only restrict playback if there is audio to restrict
        if (the) {
            // set the timeHandle to mirror playback
            $('#timeHandle').css('left', ((the.currentTime / the.duration) * 100) + '\%');

            if (leftHandle) {
                if (the.currentTime <= (the.duration / 100) * leftHandle) {
                    the.pause();
                    the.currentTime = ((the.duration / 100) * leftHandle);
                }
            }

            if (rightHandle) {
                if ((the.currentTime >= ((the.duration / 100) * (rightHandle) - 0.125))) {
                    the.pause();
                    the.currentTime = (the.duration / 100) * (rightHandle);
                }
            }
        }
    }, 100);

/** button functions **************************************************************************************************/

    function edit(blob2edit) {
        'use strict';
        // 1 second of CBR mp3 at 128kb/s = 16,000 bytes
        // 1152 samples per frame is constant
        // 8 bits per sample is constant
        // therefore 1152 / 8 = 144 bits per sample (constant)
        // slider frames multiplied by bytes per frame
        // (417.95918367 for a 44100 sampleRate, 384 for a 48000 sampleRate)
        // mp3 frames per second = 38.28125 (independent of bitrate)
        // An MP3 frame always represents 26ms of audio, regardless of the bitrate.
        // 1/0.026 = 38.46 frames per second (does this 38.46 relate to the 384 byte value below?)

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
                handledURL.revokeObjectURL(blobs[blobs.length - 2]);
                console.log('revoked');
            } else {
                console.log('nothing to revoke yet');
            }

            // attach new src and reveal audio element

            $('#edited').attr('src', handledURL.createObjectURL(edits[edits.length - 1]))
                        .css('display', 'block')
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
            processData: false,                                                   // tell jQuery not to process the data
            contentType: false,                                                  // tell jQuery not to set a contentType
            success: function (data) {
                log.prepend('<li>onSuccess data: ' + data + '\n</li>');
            },
            error: function (error) {
                log.prepend('<li>Could not upload audio, please try again or contact us.' +
                    'Error message: ' + error + '\n</li>');
            }
        });
    }

/** Start initiates recording, Stop gets and presents blob, then enables secondary buttons ****************************/

    $('#startBtn').on('click', function (e) {
        'use strict';
        e.preventDefault();
        // clicking start directly resumes context but doesn't wastefully create a new context
        if (context.state === 'suspended') {
            context.resume().then(function () {
                log.prepend('<li>audio context resumed</li>');
            }).catch(function(e) {
                log.prepend('<li>audio context failed to resume with the error: ' + e + '</li>');
            });
        } else {
            log.prepend('<li>audio context was not suspended when start was clicked</li>');
        }

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
            // disable start button
            btn.attr('disabled', true);
            $('#stopBtn').removeAttr('disabled');
        }, function (e) {
            alert(e, 'Could not make use of your microphone, please check your hardware is working:');
        });
    });

    $('#stopBtn').on('click', function (e) {
        'use strict';
        e.preventDefault();
        clearInterval(timer);

        recorder.stop();
        $(this).attr('disabled', true);
        $('#startBtn').removeAttr('disabled');

        recorder.getMp3Blob(function (blob) {
            // check if the blob itself is broken
            if (blob.size === 0) {
                log.prepend('<li>blob.size was zero</li>');
            } else {
                blobs.push(blob);
            }

            // create a url and update authoring values
            try {
                // first check for previous blob URL to revoke
                if (blobs[blobs.length-2]) {
                    handledURL.revokeObjectURL(blobs[blobs.length-2]);
                    console.log('revoked');
                } else {
                    console.log('nothing to revoke yet');
                }

                // reveal audio element & update {'the'} duration target variables
                $('#source').attr('src', handledURL.createObjectURL(blobs[blobs.length-1]))
                            .css('display', 'block')
                            .on('durationchange', function () {
                                the = this;
                                totalFrames = the.duration * 38.28125;
                                leftFrames = (totalFrames / 100) * leftHandle;
                                rightFrames = (totalFrames / 100) * (100 - rightHandle);

                                // check for meaningful values
                                if ((leftFrames === 0) && (rightFrames === 0)) {
                                    $('.editBtn').attr('disabled', true);
                                } else {
                                    $('.editBtn').attr('disabled', false);
                                }
                            }).on('error', function(e) {
                                log.prepend('<li>media error: ' + e.code + ': ' + e.message + '</li>');
                            });
            }
            catch (e) {
                log.prepend('<li>createObjectURL failed (from source), error: ' + e + '</li>');
            }

            // reveal slider
            $('#slider').css('display', 'block');
        });

        // logic so that clicking stop 'directly' suspends recording (for iOS)
        if (context.state === 'running') {
                context.suspend().then(function() {
                    log.prepend('<li>audio context suspended</li>');
                }).catch(function(e) {
                    log.prepend('<li>audio context could not be suspended with the error: ' + e + '</li>');
                });
        } else {
            log.prepend('<li>audio context was not running when stop was clicked</li>');
        }

        // enable secondary buttons
        $('.storeBtn, .upBtn').removeAttr('disabled');
    });

/** buttons pass a blob to their respective functions *****************************************************************/

    // pass (source || eBlob) to edit function
    $('.editBtn').on('click', function (e) {
        e.preventDefault();
        edit(blobs[blobs.length - 1]);
    });

    // pass (source || eBlob) to store function
    $('.storeBtn').on('click', function (e) {
        e.preventDefault();
        store(blobs[blobs.length - 1]);
    });

    // pass (source || eBlob) to upload function
    $('.upBtn').on('click', function (e) {
        e.preventDefault();
        upload(blobs[blobs.length - 1]);
    });

    window.addEventListener("beforeunload", function () {
        // unload URL objects
        handledURL.revokeObjectURL(blobs[blobs.length-1]);
        handledURL.revokeObjectURL(edits[edits.length-1]);
        
        // delete session array blobs
        blobs = [];
        edits = [];
        
        // empty localStorage (til I find an actual implementation for it)
        localStorage.clear();

        // force stop --> disconnect nodes
        recorder.stop();
       
        // close audio context
        context.close()
               .then(console.log('context closed'))
               .catch(function (e) {console.log('context not closed', e)});
        // event.returnValue = '';
    });
};
$(Main);

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
    totalFrames = the.duration * 38.28125;
    leftFrames = (totalFrames / 100) * leftHandle;
    rightFrames = (totalFrames / 100) * (100 - rightHandle);

    // check for meaningful values
    if ((leftFrames === 0) && (rightFrames === 0)) {
        $('.editBtn').attr('disabled', true);
    } else {
        $('.editBtn').attr('disabled', false);
    }
*/