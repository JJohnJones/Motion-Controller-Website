const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function harness() {
  const sockets = [], peers = [], timers = new Set();
  class Socket extends EventTarget {
    static OPEN = 1;
    constructor() { super(); this.readyState = 0; this.bufferedAmount = 0; this.sent = []; sockets.push(this); }
    send(json) { this.sent.push(JSON.parse(json)); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
    message(m) { this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify(m)})); }
  }
  class Peer {
    constructor(config) { this.config = config; this.ice = []; peers.push(this); }
    async setRemoteDescription(d) { this.remoteDescription = d; }
    async addIceCandidate(c) { this.ice.push(c); }
    async createAnswer() { return {type:'answer',sdp:'answer-sdp'}; }
    async setLocalDescription(d) { this.localDescription = d; }
    close() { this.closed = true; }
  }
  const context = { module: {exports:{}}, EventTarget, Event, MessageEvent, URL, WebSocket:Socket, RTCPeerConnection:Peer,
    setTimeout: fn => {timers.add(fn);return fn;}, clearTimeout: fn=>timers.delete(fn) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lan-transport.js'),'utf8'),context);
  const transport = new context.module.exports.LanControllerTransport('wss://signal.example/signal','a'.repeat(32));
  return { transport, socket:sockets[0], peers, timers };
}
test('LAN adapter queues early ICE and accepts one ordered controller channel', async () => {
  const {transport:t,socket:s,peers,timers}=harness();
  s.open(); assert.equal(s.sent[0].type,'join');
  const peer='b'.repeat(32);
  s.message({type:'joined',peer,ticket:'c'.repeat(32)}); await t.work;
  assert.equal(peers[0].config.iceServers.length,0);
  s.message({type:'ice',peer,candidate:'candidate:local',sdpMid:'0',sdpMLineIndex:0}); await t.work;
  assert.equal(peers[0].ice.length,0);
  s.message({type:'offer',peer,sdp:'offer-sdp'}); await t.work;
  assert.equal(peers[0].ice.length,1); assert.equal(s.sent.at(-1).type,'answer');
  const channel={label:'controller-v1',ordered:true,maxRetransmits:null,maxPacketLifeTime:null,readyState:'open',bufferedAmount:42,
    send(data){this.last=data;},close(){this.closed=true;}};
  let opened=0, received='';t.addEventListener('open',()=>opened++);t.addEventListener('message',e=>received=e.data);
  peers[0].ondatachannel({channel});
  assert.equal(opened,1);assert.equal(t.readyState,1);assert.equal(t.bufferedAmount,42);
  t.send('motion'); assert.equal(channel.last,'motion'); channel.onmessage({data:'welcome'}); assert.equal(received,'welcome');
  t.close();assert.equal(peers[0].closed,true);assert.equal(timers.size,0);
});
test('expired sessions terminate retries and close signaling', async () => {
  const {transport:t,socket:s,timers}=harness();let closes=0;t.addEventListener('close',()=>closes++);
  s.open();s.message({type:'error',code:'session-expired'});await t.work;
  assert.equal(t.terminal,true);assert.equal(closes,1);assert.equal(s.readyState,3);assert.equal(timers.size,0);
});
test('unexpected channels and malformed signaling cannot become controller input', async () => {
  const {transport:t,socket:s}=harness();s.open();s.message({type:'motion',peer:'x'});await t.work;
  assert.equal(t.closed,true);assert.equal(t.readyState,3);
});
