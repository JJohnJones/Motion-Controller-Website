const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const math = require('../motion-math.js');
function harness(permissionFactory) {
  const elements = new Map(), intervals = [], timeouts = new Map(), sockets = [], windowEvents = {}, documentEvents = {};
  let now = 100, timer = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', disabled: false, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } });
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
  const document = { hidden: false, getElementById: element, addEventListener(type, fn) { documentEvents[type] = fn; } };
  const screen = { orientation: { angle: 0 } };
  const context = { window, document, screen, DeviceOrientationEvent: window.DeviceOrientationEvent, DeviceMotionEvent: window.DeviceMotionEvent,
    MotionMath: math, location: { hash: '', pathname: '/', search: '' }, history: { replaceState() {} }, navigator: {},
    URL, URLSearchParams, WebSocket: Socket, performance: { now: () => now },
    setInterval: (fn, delay) => intervals.push({fn, delay}), setTimeout: fn => { timeouts.set(++timer, fn); return timer; }, clearTimeout: id => timeouts.delete(id) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controller.js'), 'utf8'), context);
  return { element, sockets, screen, document, windowEvents, documentEvents, timeouts,
    click: id => element(id).handlers.click(), advance: ms => { now += ms; }, tick: delay => intervals.find(t => t.delay === delay).fn(),
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
