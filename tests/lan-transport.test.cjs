const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function harness() {
  const sockets = [], peers = [], timers = new Set(); let now = 0;
  class Socket extends EventTarget {
    static OPEN = 1;
    constructor() { super(); this.readyState = 0; this.bufferedAmount = 0; this.sent = []; sockets.push(this); }
    send(json) { this.sent.push(JSON.parse(json)); }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
    message(m) { this.dispatchEvent(new MessageEvent('message', {data:JSON.stringify(m)})); }
  }
  class Peer {
    constructor(config) { this.connectionState = 'connected'; this.config = config; this.ice = []; peers.push(this); }
    async setRemoteDescription(d) { this.remoteDescription = d; }
    async addIceCandidate(c) { this.ice.push(c); }
    async createAnswer() { return {type:'answer',sdp:'answer-sdp'}; }
    async setLocalDescription(d) { this.localDescription = d; }
    close() { this.closed = true; }
  }
  const context = { module: {exports:{}}, EventTarget, Event, MessageEvent, URL, WebSocket:Socket, RTCPeerConnection:Peer,
    console:{info(){}}, performance:{now:()=>now}, setInterval:fn=>{timers.add(fn);return fn;}, clearInterval:fn=>timers.delete(fn),
    setTimeout: fn => {timers.add(fn);return fn;}, clearTimeout: fn=>timers.delete(fn) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lan-transport.js'),'utf8'),context);
  const transport = new context.module.exports.LanControllerTransport('wss://signal.example/signal','a'.repeat(32));
  return { transport, socket:sockets[0], sockets, peers, timers, advance:ms=>{now+=ms;transport.tick();} };
}
test('LAN adapter queues early ICE and accepts one ordered controller channel', async () => {
  const {transport:t,socket:s,peers,timers}=harness();
  s.open(); assert.equal(s.sent[0].type,'join');
  const peer='b'.repeat(32);
  s.message({type:'joined',peer,ticket:'c'.repeat(32)}); await t.work;

  s.message({type:'ice',peer,revision:1,candidate:'candidate:local',sdpMid:'0',sdpMLineIndex:0}); await t.work;
  assert.equal(t.pendingIce.length,1);
  s.message({type:'offer',peer,revision:1,sdp:'offer-sdp'}); await t.work;
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
  assert.equal(t.recovering,true);assert.equal(t.readyState,0);t.close();
});

async function paired(h) {
 const t=h.transport; h.socket.open();
 await t.receive(JSON.stringify({type:'joined',peer:'b'.repeat(32),ticket:'c'.repeat(32)}));
 await t.receive(JSON.stringify({type:'offer',peer:t.peer,revision:1,reset:true,sdp:'offer'}));
 const channel={label:'controller-v1',ordered:true,maxRetransmits:null,maxPacketLifeTime:null,readyState:'open',bufferedAmount:0,send(){},close(){this.readyState='closed';}};
 t.acceptChannel(channel); return channel;
}
test('signaling outage resumes the same ticket without closing a healthy channel', async()=>{
 const h=harness(),t=h.transport,ch=await paired(h),pc=t.pc;
 h.socket.close(); assert.equal(ch.readyState,'open'); assert.equal(t.recovering,false);
 h.advance(1100); const ws=h.sockets[1];ws.open();
 assert.equal(ws.sent[0].type,'resumePeer'); assert.equal(ws.sent[0].ticket,t.ticket);
 ws.message({type:'resumed',peer:t.peer});await t.work;
 assert.equal(t.pc,pc);assert.equal(t.signalReady,true);t.close();
});
test('transient ICE disconnect recovers with heartbeat before restart; 60s failure budget is bounded', async()=>{
 const h=harness(),t=h.transport;await paired(h);
 t.pc.iceConnectionState='disconnected';t.pc.oniceconnectionstatechange();
 h.advance(7000);assert.equal(h.socket.sent.some(m=>m.type==='restart-request'),false);
 t.noteHeartbeat();assert.equal(t.recovering,false);
 t.requestRecovery('wifi lost');h.advance(8000);
 assert.equal(h.socket.sent.at(-1).type,'restart-request');
 t.requestRecovery('still lost');h.advance(52000);assert.equal(t.closed,true);
});
test('host ICE restart keeps PeerConnection; replacement closes it and keeps ticket; stale revision ignored', async()=>{
 const h=harness(),t=h.transport;await paired(h);const pc=t.pc,ticket=t.ticket;
 await t.receive(JSON.stringify({type:'offer',peer:t.peer,revision:2,reset:false,sdp:'restart'}));
 assert.equal(t.pc,pc);assert.equal(pc.remoteDescription.sdp,'restart');
 await t.receive(JSON.stringify({type:'ice',peer:t.peer,revision:1,candidate:'stale'}));assert.equal(pc.ice.length,0);
 await t.receive(JSON.stringify({type:'offer',peer:t.peer,revision:3,reset:true,sdp:'replacement'}));
 assert.equal(pc.closed,true);assert.notEqual(t.pc,pc);assert.equal(t.ticket,ticket);t.close();
});
test('background visibility retains DataChannel and identity', async()=>{
 const h=harness(),t=h.transport,ch=await paired(h);t.setVisibility(true);t.setVisibility(false);
 assert.equal(ch.readyState,'open');assert.equal(t.closed,false);assert.equal(t.peer,'b'.repeat(32));t.close();
});
