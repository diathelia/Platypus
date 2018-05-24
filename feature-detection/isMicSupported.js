/*
    This feature detection script aims to pre-empt whether a users device + browser configuration
    can support Platypus by initialising and testing core dependencies and other property values.
    
    The results are returned to the IsMicSupported module as an object with 3 string values:
    
    IsMicSupported.support = indicates the level of dependency support {full, partial, none, unkown}.
    IsMicSUpported.samples = the preferred audio samples per second rate of the Web Audio API.
    IsMicSupported.buffer  = the preferred processing buffer size of the Web Audio API.
    
    This script could be triggered to run when a user is about to be offered the use of this tool
    just before any HTML is rendered. If the module object has the property 'support' with the string
    'full support' then reveal HTML.

    This way, only users who will not encounter any forseeable problems will see the option, while
    other users could either be given the link and warned, or not given the link.

    Issue: Edge on Desktop will give an error message about revoking the blobURL.
    Its equivalent msSaveOrOpenBlob does not seem to need a revoke method.
    Attempted exception conditional left commented at the bottom of this script.
*/      

var IsMicSupported = (function () {
    'use strict';
    // public object. property 'support' will contain the 'featureAnswer'
    var pub = {};

    // store results in array, expect booleans (except isBlobURL() which returns a string)
    var featureResults = [],

    // expect a string indicating level of dependency support
    featureAnswer = 'unknown support',

    // used to log errors to screen for mobile debug
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
        var bothContexts;

        // alias contexts to var
        if (window.webkitAudioContext) {
            bothContexts = window.webkitAudioContext;
        } else if ('AudioContext' in window) {
            bothContexts = window.AudioContext;
        } else {
            bothContexts = 0;
        }

        if (bothContexts !== 0) {
            try {
                var testContext = new bothContexts();
                // save the preferred sampleRate for this user
                pub.samples = testContext.sampleRate;

                var testProcessor = testContext.createScriptProcessor(0, 1, 1);
                // save the preferred bufferSize for this user
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
                testContext.close();
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

    // query other is-X-Supported functions and log results
    isGetUserMedia();   // expect true / false
    isAudioContext();   // expect true / false
    isWebWorker();      // expect true / false

    // tests a Blob that is then referenced to test a BlobURL, then save featureAnswer to pub
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
                            // blobURL success, send back two thumbs up
                            featureAnswer = ('full support');
                        } else {
                            // BlobURLs not reliable, could use dataURLs eg for <Opera, Samsung, UC>
                            featureAnswer = ('partial support');
                        }
        
                        // save featureAnswer
                        pub.support = featureAnswer;

                        // save pub to module
                        window.IsMicSupported = pub;
                        
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

// attempted exception due to revokeObjectURL failure on Edge
// function isMsBlob() {
//     if (window.navigator.msSaveOrOpenBlob) {
//         var aFileParts = ['<a id="a"><b id="b">hey!</b></a>'];        // code from the MDN Blob page
//         var oMyBlob = new Blob(aFileParts, {type : 'text/html'});     // code from the MDN Blob page
//         var msBlob = window.navigator.msSaveOrOpenBlob(oMyBlob);
//         console.log(msBlob);
//         if (msBlob.toString().startsWith('blob')) {
//             pub.edge = 'yes';
//         }
//         window.URL.revokeObjectURL(msBlob);
//     } else {
//         pub.edge = 'no';
//     }
// }
