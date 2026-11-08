import test from 'node:test';
import assert from 'node:assert/strict';
import { AttentionDetector } from './attention.js';
const f = {headX:0,headY:0,gazeX:0.5,gazeY:0.1};
test('reset retains trained samples and permits screen predictions',()=>{
 const d=new AttentionDetector();
 for(let i=0;i<110;i++) assert.equal(d.classifier.addSample(f,'screen'),true);
 for(let i=0;i<88;i++) d.classifier.addSample({ ...f, gazeX:0.95 },'away');
 d.reset();
 assert.equal(d.classifier.count('screen'),110);
 assert.equal(d.classifier.count('away'),88);
 assert.equal(d.classifier.predict(f).state,'likely-screen');
});
test('clearCalibration removes samples',()=>{
 const d=new AttentionDetector();
 d.classifier.addSample(f,'screen');
 d.clearCalibration();
 assert.equal(d.classifier.samples.length,0);
});
