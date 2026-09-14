const {test} = require('node:test');
const assert = require('node:assert/strict');
const {screenFor} = require('../controller-ui.js');
const {modes,valid} = require('../controller-layouts.js');
const ready = { connected:true, motionEnabled:true, calibrated:true, mode:'bowling' };
test('connection and setup override game mode, recovery retains setup readiness', () => {
  assert.equal(screenFor({...ready,connected:false},modes),'connecting');
  assert.equal(screenFor({...ready,connected:false,recovering:true},modes),'recovering');
  assert.equal(screenFor({...ready,calibrated:false},modes),'setup');
  assert.equal(screenFor({...ready,paused:true},modes),'paused');
  assert.equal(screenFor({...ready,mode:'future-unknown'},modes),'waiting');
  assert.equal(screenFor(ready,modes),'gameplay');
});
test('single through four-zone definitions validate independent action IDs', () => {
  assert.ok(valid(modes.bowling));
  ['single','double','triple','quad'].forEach((layout,i)=> {
    const buttons=Array.from({length:i+1},(_,n)=>({id:'action'+n,idle:'Ready',pressed:'Held'}));
    assert.ok(valid({layout,buttons}));
    assert.equal(valid({layout,buttons:[...buttons,buttons[0]]}),false);
  });
});
