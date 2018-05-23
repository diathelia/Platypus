# Platypus
<img src="https://i.pinimg.com/originals/17/5e/f2/175ef22c95918002bba266a898644de8.jpg">

An audio tool which uses the Web Audio API to record, visualize and edit mp3 blobs

Adapted from Zhuker's excellent LAME.js library https://github.com/zhuker/lamejs

The full 4.47mb Library can be found there but is omitted here to reduce app size

Platypus uses a callback polyfill for the Streams API getUserMedia promise

Platypus uses a monkey patch to alias Web Audio API syntax for WebKit browsers

Platypus uses FileSaver.js to give blob downloads semantic filenames instead of UID's

~ | ~

This repo also contains a feature detection script for all core dependencies and also<br>
run Platypus audio specific tests properties on the following two bugs:

 - Sometimes the audio blob is properly encoded but the browser fails to display it;<br>
   to counteract this a sample blob mp3 from Platypus is included to test blob URLs

 - Sometimes the hardware and browser prefers sample rates and buffer sizes which<br>
   can cause a sporadic mixture of sped-up playback and high-end artifacts;<br>
   while this is currently fixed via a forced huge bufferSize of 16384 bytes,<br>
   new devices and operating systems may have issues reoccur. To help debug them<br>
   the preferred sample and buffer values are also saved.
   
When run, this script saves the level of support and preferred sample/buffer values;<br>
these are all returned as an object to the IsMicSupported global module for access
