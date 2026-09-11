const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const math = require('../motion-math.js');
const HoldButton = require('../hold-button.js');

test('Unity diagnostic ping is echoed without changing sensor timestamps', () => {
  const h = harness(); const s = h.connect();
  s.receive({ version:1, type:'serverPing', controllerId:'b'.repeat(32), timestamp:123.456 });
  assert.deepEqual(s.sent.at(-1), { version:1, type:'serverPong', controllerId:'b'.repeat(32), timestamp:123.456 });
});
function harness(permissionFactory) {
  const elements = new Map(), intervals = [], timeouts = new Map(), sockets = [], windowEvents = {}, documentEvents = {};
  let now = 100, timer = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false, handlers: {}, dataset: {},
      setAttribute() {}, setPointerCapture(id) { this.captured = id; }, hasPointerCapture(id) { return this.captured === id; }, releasePointerCapture() { this.captured = null; },
      addEventListener(type, fn) { this.handlers[type] = fn; } });
    return elements.get(id);
  };
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.handlers = {}; this.sent = []; sockets.push(this); }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.handlers.close?.(); }
    open() { this.readyState = 1; this.handlers.open(); }
    receive(data) { this.handlers.message({ data: JSON.stringify(data) }); }
  }
  const device = permissionFactory || (() => Promise.resolve('granted'));
  const window = { isSecureContext: true, DeviceOrientationEvent: { requestPermission: device }, DeviceMotionEvent: { requestPermission: device }, addEventListener(type, fn) { windowEvents[type] = fn; } };
  const document = { hidden: false, body: { classList: { toggle() {} } }, getElementById: element, addEventListener(type, fn) { documentEvents[type] = fn; } };
  const screen = { orientation: { angle: 0 } };
  const context = { window, document, screen, DeviceOrientationEvent: window.DeviceOrientationEvent, DeviceMotionEvent: window.DeviceMotionEvent,
    MotionMath: math, HoldButton, location: { hash: '', pathname: '/', search: '' }, history: { replaceState() {} }, navigator: {},
    URL, URLSearchParams, WebSocket: Socket, performance: { now: () => now },
    setInterval: (fn, delay) => intervals.push({fn, delay}), setTimeout: fn => { timeouts.set(++timer, fn); return timer; }, clearTimeout: id => timeouts.delete(id) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controller.js'), 'utf8'), context);
  return { element, sockets, screen, document, windowEvents, documentEvents, timeouts,
    click: id => element(id).handlers.click(), advance: ms => { now += ms; }, tick: delay => intervals.find(t => t.delay === delay).fn(),
    pointer: (type, id = 1) => element('hold-ball').handlers[type]({ pointerId: id, button: 0, isPrimary: true, preventDefault() {} }),
    async enable() { await element('enable-motion').handlers.click(); },
    orient() { windowEvents.deviceorientation({alpha: 30, beta: 20, gamma: 10, absolute: false}); },
    connect() {
      element('server').value = 'wss://test.example/controller'; element('token').value = 'a'.repeat(32);
      element('connect').handlers.click(); const s = sockets.at(-1); s.open();
      s.receive({version: 1, type: 'welcome', controllerId: 'b'.repeat(32)}); return s;
    }
  };
}
test('both iOS permission requests happen before either promise resolves', async () => {
  const resolvers = [];
  const h = harness(() => new Promise(resolve => resolvers.push(resolve)));
  const enabling = h.click('enable-motion');
  assert.equal(resolvers.length, 2);
  resolvers.forEach(resolve => resolve('granted')); await enabling;
  h.orient(); h.tick(200);
  assert.match(h.element('orientation').textContent, /30.0/);
});
test('insecure endpoints are rejected before constructing a socket', () => {
  const h = harness(); h.element('server').value = 'ws://192.168.1.2/controller';
  h.click('connect'); assert.equal(h.sockets.length, 0); assert.match(h.element('status').textContent, /wss:/);
});
test('pairing, sensor availability, snapshot calibration and acknowledgement', async () => {
  const h = harness(); const s = h.connect(); await h.enable(); h.orient();
  h.windowEvents.devicemotion({rotationRate: {alpha: 3, beta: 1, gamma: 2}, acceleration: {x:null,y:0,z:0}, accelerationIncludingGravity: {x:0,y:0,z:9.8}});
  h.tick(8);
  const frame = s.sent.at(-1);
  assert.equal(frame.type, 'motion'); assert.equal(frame.controllerId, 'b'.repeat(32));
  assert.equal(frame.hasDeviceAngles,true); assert.deepEqual(frame.deviceAngles,{x:30,y:20,z:10});
  assert.deepEqual(frame.angularVelocity, {x:1,y:2,z:3}); assert.equal(frame.hasAcceleration, false); assert.equal(frame.hasGravity, true);
  h.click('calibrate'); const calibration = s.sent.at(-1);
  assert.equal(calibration.type, 'calibrate'); assert.equal(calibration.sequence, frame.sequence+1);
  assert.deepEqual(calibration.orientation, frame.orientation); assert.equal(calibration.timestamp, frame.timestamp);
  s.receive({version:1,type:'calibrated',sequence:calibration.sequence});
  assert.match(h.element('calibration-status').textContent, /^Calibrated/);
});
test('stale samples and congestion do not accumulate a sensor send queue', async () => {
  const h = harness(); const s = h.connect(); await h.enable(); h.orient();
  s.bufferedAmount = 9000; h.tick(8); assert.equal(s.sent.length, 1);
  s.bufferedAmount = 0; h.tick(8); assert.equal(s.sent.length, 2);
  h.advance(20); h.tick(8); assert.equal(s.sent.length, 2); // same sample is not resent
  h.advance(300); h.tick(8); h.tick(200); assert.equal(s.sent.length, 2); assert.equal(h.element('calibrate').disabled, true);
});
test('screen changes require calibration, heartbeat measures RTT and hiding disconnects', async () => {
  const h = harness(); const s = h.connect(); await h.enable(); h.orient();
  h.screen.orientation.angle = 90; h.tick(200); assert.match(h.element('calibration-status').textContent, /Screen orientation changed/);
  h.tick(1000); const ping = s.sent.at(-1); h.advance(45);
  s.receive({version:1,type:'pong',timestamp:ping.timestamp}); h.tick(200);
  assert.match(h.element('network').textContent, /RTT 45 ms/);
  h.document.hidden = true; h.documentEvents.visibilitychange(); assert.equal(s.readyState, 3);
  assert.match(h.element('status').textContent, /Paused/);
});
test('permission denial leaves a retry action and no false sensor stream', async () => {
  const h = harness(() => Promise.resolve('denied')); await h.enable();
  assert.match(h.element('motion-status').textContent, /denied/);
  assert.equal(h.element('enable-motion').disabled, false); assert.equal(h.windowEvents.deviceorientation, undefined);
});
async function bowlingReady() {
  const h = harness(); const s = h.connect(); await h.enable(); h.orient(); h.click('calibrate');
  s.receive({ version: 1, type: 'calibrated', sequence: s.sent.at(-1).sequence });
  return {h, s};
}
test('finger-down/up send exactly two ordered transitions with release-time snapshot', async () => {
  const {h,s} = await bowlingReady(); h.pointer('pointerdown');
  assert.equal(h.element('hold-ball').dataset.phase, 'held');
  h.advance(30); h.orient(); h.tick(8); h.pointer('pointerup'); h.pointer('lostpointercapture');
  const buttons = s.sent.filter(p => p.type === 'button');
  assert.equal(buttons.length, 2); assert.equal(buttons[0].phase, 'pressed'); assert.equal(buttons[1].phase, 'released');
  assert.equal(buttons[1].buttonSequence, 2); assert.equal(buttons[1].eventTimestamp, 130);
  assert.equal(buttons[1].timestamp, 130); assert.equal(buttons[1].hasSnapshot, true);
  assert.equal(h.element('hold-ball').dataset.phase, 'released');
});
test('second fingers cannot release the primary hold and pointercancel never throws', async () => {
  const {h,s} = await bowlingReady(); h.pointer('pointerdown'); h.pointer('pointerdown',2); h.pointer('pointerup',2);
  assert.equal(h.element('hold-ball').dataset.phase, 'held');
  h.pointer('pointercancel'); h.pointer('pointerup');
  const buttons=s.sent.filter(p=>p.type==='button'); assert.deepEqual(buttons.map(p=>p.phase),['pressed','canceled']);
  assert.equal(buttons[1].hasSnapshot,false);
});
test('hidden pages cancel a hold; backed-up release closes connection instead of dropping silently', async () => {
  const {h,s} = await bowlingReady(); h.pointer('pointerdown'); h.document.hidden=true; h.documentEvents.visibilitychange();
  assert.equal(s.sent.at(-1).phase,'canceled'); assert.equal(s.readyState,3);
  const other = await bowlingReady(); other.h.pointer('pointerdown'); other.s.bufferedAmount=9000; other.h.pointer('pointerup');
  assert.equal(other.s.readyState,3); assert.match(other.h.element('status').textContent,/delivery failed/);
  assert.equal(other.s.sent.filter(p=>p.phase==='released').length,0);
});
test('uncalibrated or stale input cannot press; screen rotation cancels an existing hold', async () => {
  const h=harness(); const s=h.connect(); await h.enable(); h.orient(); h.pointer('pointerdown');
  assert.equal(s.sent.filter(p=>p.type==='button').length,0);
  const ready=await bowlingReady(); ready.h.pointer('pointerdown'); ready.h.screen.orientation.angle=90; ready.h.tick(200);
  assert.equal(ready.s.sent.at(-1).phase,'canceled'); assert.equal(ready.h.element('hold-ball').disabled,true);
});
