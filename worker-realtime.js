/*
 the original structure of this script came from here:
 https://github.com/zhuker/lamejs/tree/master/worker-example

 Modifications: 1) removed one intermediary array variable (var data;)
                2) added use strict
                3) configured mp3 quality
                4) added some comments

 Although this code is not strictly a part of the LAME library
 here is the appropriate license for modification just in case:

 LICENSED UNDER THE LGPL 2.1 OR LATER WITH THESE CONDITIONS:

 1. Link to LAME as separate jar (lame.min.js or lame.all.js)

 2. Fully acknowledge that you are using LAME, and give a link
 to our web site, www.mp3dev.org

 3. If you make modifications to LAME, you *must* release these
 these modifications back to the LAME project, under the LGPL.
 */

(function () {
    'use strict';

    console.log('realtime MP3 conversion worker started');
    importScripts('lame.min.js');

    var mp3Encoder, maxSamples = 1152, samples, config, dataBuffer;
    var clearBuffer = function () {
        dataBuffer = [];
    };

    var appendToBuffer = function (mp3Buf) {
        dataBuffer.push(new Int8Array(mp3Buf));
    };

    var init = function (prefConfig) {
        config = prefConfig || {debug: true};
        mp3Encoder = new lamejs.Mp3Encoder(1, config.sampleRate || 44100, config.bitRate || 128);
        clearBuffer();
    };

    // takes LAME encoded values and corrects for Web Audio API
    var floatTo16BitPCM = function floatTo16BitPCM(input, output) {
        // var offset = 0;
        for (var i = 0; i < input.length; i++) {
            var s = Math.max(-1, Math.min(1, input[i]));
            output[i] = (s < 0 ? s * 0x8000 : s * 0x7FFF);
        }
    };

    // creates empty Float32Array for LAME output, creates empty Int16Array for Web Audio API
    var convertBuffer = function(arrayBuffer) {
        // var data = new Float32Array(arrayBuffer); // removed this intermediary array
        var out = new Int16Array(arrayBuffer.length);
        floatTo16BitPCM(arrayBuffer, out);
        return out;
    };

    // passes via convertBuffer to floatTo16BitPCM
    var encode = function (arrayBuffer) {
        samples = convertBuffer(arrayBuffer);
        var remaining = samples.length;
        for (var i = 0; remaining >= 0; i += maxSamples) {
            var mono = samples.subarray(i, i + maxSamples);
            var mp3buf = mp3Encoder.encodeBuffer(mono);
            appendToBuffer(mp3buf);
            remaining -= maxSamples;
        }
    };

    var finish = function () {
        appendToBuffer(mp3Encoder.flush());
        self.postMessage({
            cmd: 'end',
            buf: dataBuffer
        });
        if (config.debug) {
            console.log('Sending finished command');
        }
        // free up memory
        clearBuffer();
    };

    self.onmessage = function (e) {
        switch (e.data.cmd) {
            case 'init':
                init(e.data.config);
                break;

            case 'encode':
                encode(e.data.buf);
                break;

            case 'finish':
                finish();
                break;
        }
    };
})();
