/*
    This feature detection script aims to pre-empt whether a users device + browser configuration
    can support the Web Audio Tool by initialising and testing its core dependencies one by one.
    The results are logged to the console (for now) and returned to the IsMicSupported module itself.

    This script could be triggered to run when a user is about to be offered the use of this tool
    just before any HTML is rendered. If the module object has a property 'support' with the string
    'full support' then reveal HTML.

    This way, only users who will not encounter any forseeable problems will see the option, while
    other users could either be given the link and warned, or not given the link.

    Issue: Edge on Desktop will give an error message about revoking the blobURL.
    Its equivalent msSaveOrOpenBlob does not seem to need a revoke method.
*/      

var IsMicSupported = (function () {
    'use strict';
    // public object. property 'support' will contain the 'featureAnswer'
    var pub = {};

    // store results in array, expect booleans (except isBlobURL() which returns a string)
    var featureResults = [],

    // expect a string indicating level of dependency support
    featureAnswer = 'unknown support',

    // log errors to screen
    featureLog = $('#log');

    // asks if the getUserMedia object hangs off navigator (or .mediaDevices) and is defined
    function isGetUserMedia() {
        'use strict';
        if ('getUserMedia' in navigator) {
            if (navigator.getUserMedia === undefined) {
                featureResults.push(false);
            } else {
                featureResults.push(true);
            }
        } else if ('getUserMedia' in navigator.mediaDevices) {
            if (navigator.mediaDevices.getUserMedia === undefined) {
                featureResults.push(false);
            } else {
                featureResults.push(true);
            }
        } else {
            featureResults.push(false);
        }
    }

    // constructs, tests and closes the asynchronous Web Audio Environment promise
    function isAudioContext() {
        'use strict';
        // relies on AudioContextMonkeyPatch.js
        if ('AudioContext' in window) {
            try {
                var testContext = new window.AudioContext();
                pub.samples = testContext.sampleRate;

                var testProcessor = testContext.createScriptProcessor(0, 1, 1);
                pub.buffer = testProcessor.bufferSize;
            }
            catch (e) {
                featureLog.append('AudioContext error: ', e, '<br>');
            }
            finally {
                if (testContext === undefined) {
                    featureResults.push(false);
                } else {
                    featureResults.push(true);
                }
                testContext.close().then(console.log('context closed'))
                    .catch(function(){console.log('context not closed')});
                //  .close resolves to void, will this .catch work?
                //  MDN uses 'await' which I can't use (unsupported ES6)
            }
        }
    }

    // asks if a Web Worker object hangs off window
    function isWebWorker() {
        'use strict';
        // MDN uses if (window.Worker) {...}
        if ('Worker' in window) {
            featureResults.push(true);
        } else {
            featureResults.push(false);
        }
    }

    // query other is-X-Supported functions and log results in array
    isGetUserMedia();   // expect true / false
    isAudioContext();   // expect true / false
    isWebWorker();      // expect true / false

    // tests a Blob that is then referenced to test a BlobURL
    var blobURL = (function isBlobAndURL() {
        'use strict';
        // test URL API
        var testURL = window.URL || window.webkitURL;
        
        // set here so the finally block can revoke the URL
        var urlToBlob;

        if (testURL) {
            // URL API supported, so test BlobURL
            try {
                // Create XHR and Blob objects
                var xhr = new XMLHttpRequest(), blob;

                // open local blob mp3 test (4179 bytes)
                xhr.open('GET', 'blobURL_test.mp3', true);
                // load as arraybuffer for broadest compatability
                xhr.responseType = 'arraybuffer';

                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 4) {
                        // recreate blob from the arraybuffer response
                        blob = new Blob([xhr.response], {type: 'audio/mpeg'});

                        urlToBlob = testURL.createObjectURL(blob);
    
                        if (urlToBlob.toString().startsWith('blob')) {
                            featureResults.push('yes');
                        } else {
                            featureResults.push('no');
                        }

                        if (featureResults.includes(false)) {
                            // not all core dependencies can be handled, prompt user / don't insert any HTML
                            featureAnswer = ('no support');
                        } else if (featureResults.includes('yes')) {
                            // blobURL success, send Main two thumbs up
                            featureAnswer = ('full support');
                        } else {
                            // BlobURLs not reliable so use dataURLs eg: <Opera & Samsung>
                            featureAnswer = ('partial support');
                        }
        
                        // save featureAnswer
                        pub.support = featureAnswer;

                        window.IsMicSupported = pub;
                        
                        // display for testing purposes
                        console.log(pub);
                        $('#log').html(pub.support.toString())
                                 .append(' ', pub.buffer.toString())
                                 .append(' ', pub.samples.toString());
                        
                        // revoke URL
                        testURL.revokeObjectURL(urlToBlob);
                    }
                };

                // Send XHR
                xhr.send();
            }
            catch (e) {
                featureLog.append(e, '<br>');
            }
        }
    })();
})();

// exception due to revokeObjectURL failure on Edge
// if (window.navigator.msSaveOrOpenBlob) {
//     var msBlob = window.navigator.msSaveOrOpenBlob(new Blob(aFileParts, {type : 'text/plain'}));
//     var msURL = window.URL.createObjectURL(msBlob);
//     console.log(msURL);
//     featureResults.push('yesMsURL');
//     window.URL.revokeObjectURL(msBlob);
// }