/*/
 * <button class="toolIconButton" data-action="Media.CreateAudio" title="Insert an audio element">
 *
 * add null detectors where relevant (exists explicitly as value-less)
 *
 * can use (x === undefined) when I know x exists
 *
 * can use (typeof x === 'undefined') when undeclared should count too
 *
 * alert('cannot load Web Worker, please try updating or switching browsers to continue');
/*/

var IsMicSupported = (function () {
    'use strict';
    // store results in array, expect booleans (except isBlobURL() which returns a string)
    var featureResults = [];

    // logs semantic results to screen
    var featureLog = $('#log');

    // flag for blobURL feature test (delayed due to XHR)
    var urlReady = null;

    // asks if the getUserMedia object hangs off navigator(.mediaDevices) and is defined
    function isGetUserMedia(featureResults) {
        'use strict';
        if ('getUserMedia' in navigator) {
            // featureLog.append('gUM is in navigator<br>');
            if (navigator.getUserMedia === undefined) {
                featureResults.push(false);
            } else {
                featureResults.push(true);
            }
        } else if ('getUserMedia' in navigator.mediaDevices) {
            // featureLog.append('gUM is in mediaDevices<br>');
            if (navigator.mediaDevices.getUserMedia === undefined) {
                featureResults.push(false);
            } else {
                featureResults.push(true);
            }
        } else {
            // featureLog.append('gUM is NOT in mediaDevices NOR navigator<br>');
            featureResults.push(false);
        }
    }

    // constructs, tests and closes the asynchronous Web Audio Environment promise
    function isAudioContext(featureResults) {
        'use strict';
        // relies on AudioContextMonkeyPatch.js
        if ('AudioContext' in window) {
            // featureLog.append('AudioContext is in window<br>');
            try {
                var testContext = new window.AudioContext();
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
                // .close resolves to void, will this .catch work?
                // MDN uses 'await' which I can't use (unsupported ES6)
            }
        }
    }

    // asks if a Web Worker object hangs off window
    function isWebWorker(featureResults) {
        'use strict';
        // MDN uses if (window.Worker) {...}
        if ('Worker' in window) {
            featureResults.push(true);
        } else {
            featureResults.push(false);
        }
    }

    // tests a Blob that is then referenced to test a BlobURL
    function isBlobAndURL(featureResults) {
        'use strict';
        // var aFileParts = ['testBlobString'];
        // var testBlob = new Blob(aFileParts, {type : 'application/octet-binary'});

        // Blob object supported, so test URL API
        var testURL = window.URL || window.webkitURL;
        
        // set here so the finally block can revoke the URL
        var urlToBlob;

        if (testURL) {
            // featureLog.append('URL support<br>');

            // URL API supported, so test BlobURL
            try {
                // Create XHR, Blob and FileReader objects
                var xhr = new XMLHttpRequest(),
                    blob,
                    fileReader = new FileReader();

                // open local blob mp3 test (4179 bytes)
                xhr.open('GET', 'blobURL_test.mp3', true);
                // load as arraybuffer for broadest compatability
                xhr.responseType = 'arraybuffer';

                xhr.addEventListener('load', function () {

                    if (xhr.status === 200) {
                        // set flag for featureAnswer to be determined
                        urlReady === true;

                        // recreate blob from the arraybuffer response
                        blob = new Blob([xhr.response], {type: 'audio/mpeg'});

                        urlToBlob = testURL.createObjectURL(blob);

                        $('#test').attr('src', urlToBlob);
    
                        if (urlToBlob.toString().startsWith('blob')) {
                            featureResults.push('yesBlobURL');
                            console.log(urlToBlob);
                        }
                    }
                }, false);

                // Send XHR
                xhr.send();
            }
            catch (e) {
                featureLog.append(e, '<br>');
            }
            // finally {
            //     testURL.revokeObjectURL(urlToBlob);
            // }
        }
    }

    // expect a string indicating level of dependency support (to return to window.Module)
    var featureAnswer = 'unknown support';

    // second flag: set when script is ready to return featureAnswer
    var returnReady = null;
    // (function() {
    // query is-X-Supported functions and log results in array
    isGetUserMedia(featureResults);   // expect true / false
    isAudioContext(featureResults);   // expect true / false
    isWebWorker(featureResults);      // expect true / false
    // will be delayed due to XHR
    try {
        isBlobAndURL(featureResults);     // expect 'yesBlobURL'
    }
    catch (e) {
        console.log('idk');
    }
    finally {
    // setTimeout(function() {
        if (urlReady === true) {
            // featureLog.append(featureResults.join(), '<br>');
            if (featureResults.includes(false)) {
                // not all core dependencies can be handled, prompt user / don't insert any HTML
                featureAnswer = ('no support');
            } else if (featureResults.includes('yesBlobURL')) {
                // send Main two thumbs up
                featureAnswer = ('full support');
            } else {
                // BlobURLs not reliable so use dataURLs eg: <Opera & Samsung>
                featureAnswer = ('partial support'); 
            }
            // ready to return featureAnswer flag set
            returnReady === true;
        } else {
            console.log('urlReady = ', urlReady);
        }
    // }, 500);
    }
    if (returnReady === true) {
        return featureAnswer;
    }
    // })();
})();

// exception due to revokeObjectURL failure on Edge
// if (window.navigator.msSaveOrOpenBlob) {
//     var msBlob = window.navigator.msSaveOrOpenBlob(new Blob(aFileParts, {type : 'text/plain'}));
//     var msURL = window.URL.createObjectURL(msBlob);
//     console.log(msURL);
//     featureResults.push('yesMsURL');
//     window.URL.revokeObjectURL(msBlob);
// }