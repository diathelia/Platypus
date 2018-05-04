# Platypus
<img src="https://i.pinimg.com/originals/17/5e/f2/175ef22c95918002bba266a898644de8.jpg">

An audio tool which uses the Web Audio API to record, visualize and edit mp3 blobs

Adapted from Zhuker's excellent LAME.js library https://github.com/zhuker/lamejs

The full 4.47mb Library can be found there but is omitted here to reduce app size

Platypus uses a callback-polyfill for the Streams API getUserMedia promise

Platypus uses a monkey patch to alias Web Audio API syntax for WebKit browsers

Platypus uses normalize.css in an attempt to coax-together browser slider behaviours

This repo also contains a feature detection script to specifically test for audio:

 - Sometimes the audio blob is properly encoded but the browser fails to display it.
   to counteract this a sample blob mp3 from Platypus is included to test blob URLs

 - Sometimes the hardware & browser combination prefer sample rates and buffer sizes.<br>
   These can cause a sporadic mixture of sped-up playback and high-end artifacts.<br>
   To help debug them the preferred sample and buffer values are also saved.<br>
   
 - When run, this script saves the level of support and preferred sample/buffer values.<br>
   These are all returned as an object to the IsMicSupported global module for access.
