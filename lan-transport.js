'use strict';
// Transport only. The host is the sole offerer; controller packets retain their codec.
class LanControllerTransport extends EventTarget {
  constructor(url, session, onState = () => {}) {
    super();
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'wss:' || endpoint.pathname !== '/signal' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || /^SIGNALING-HOST$/i.test(endpoint.hostname))
      throw new Error('Configure the public WSS signaling service.');
    if (!/^[a-f0-9]{32}$/.test(session)) throw new Error('Invalid pairing link. Scan the QR in Unity again.');
    this.url = endpoint.href; this.session = session; this.onState = onState;
    this.readyState = 0; this.closed = false; this.recovering = false;
    this.peer = this.ticket = ''; this.revision = 0; this.pc = this.channel = null;
    this.logs = []; this.work = Promise.resolve(); this.pendingIce = []; this.localIce = [];
    this.createdAt = this.lastReceive = performance.now(); this.recoveryAt = null;
    this.lastRestart = -Infinity; this.retryAt = 0; this.attempts = 0;
    this.lastPing = this.lastPong = null;
    this.connectSignal(); this.timer = setInterval(() => this.tick(), 1000);
  }
  log(detail) {
    const line = `${new Date().toISOString()} +${(performance.now()/1000).toFixed(3)} ${detail}`;
    this.logs.push(line); if (this.logs.length > 80) this.logs.shift();
    console.info('[LAN controller]', line);
  }
  get diagnostics() {
    return `PC=${this.pc?.connectionState || 'none'} ICE=${this.pc?.iceConnectionState || 'none'} gathering=${this.pc?.iceGatheringState || 'none'} SDP=${this.pc?.signalingState || 'none'}\nDataChannel=${this.channel?.readyState || 'none'} signaling WS=${this.signal?.readyState ?? 'offline'} authenticated=${!!this.signalReady}\nLast received=${this.lastReceive.toFixed(0)} ping=${this.lastPing ?? '—'} pong sent=${this.lastPong ?? '—'} ms (phone clock)\n${this.logs.join('\n')}`;
  }
  get bufferedAmount() { return this.channel?.bufferedAmount || 0; }
  signalSend(m) {
    if (this.closed || this.signal?.readyState !== WebSocket.OPEN || this.signal.bufferedAmount > 131072) return false;
    try { this.signal.send(JSON.stringify(m)); return true; } catch { return false; }
  }
  connectSignal() {
    if (this.closed) return;
    const ws = this.signal = new WebSocket(this.url); this.signalReady = false;
    this.signalStarted = performance.now(); this.log('signaling WS=CONNECTING');
    if (!this.pc) this.onState('Signaling', 'Contacting game…');
    ws.addEventListener('open', () => {
      if (this.signal !== ws || this.closed) return;
      this.log('signaling WS=OPEN');
      this.signalSend(this.peer ? {type:'resumePeer', session:this.session, peer:this.peer, ticket:this.ticket} : {type:'join',session:this.session});
    });
    ws.addEventListener('message', e => {
      this.work = this.work.then(() => this.signal === ws && !this.closed && this.receive(e.data))
        .catch(e => { this.log('negotiation error: ' + e.message); this.requestRecovery('SDP/ICE negotiation error', true); });
    });
    ws.addEventListener('error', () => this.log('signaling WebSocket error (browser supplies no details)'));
    ws.addEventListener('close', e => {
      if (this.signal !== ws || this.closed) return;
      this.log(`signaling WS=CLOSED code=${e.code} reason=${e.reason || 'unspecified'}; retaining DataChannel`);
      this.signal = null; this.signalReady = false;
      this.retryAt = performance.now() + Math.min(10000, 1000 * 2 ** Math.min(this.attempts++, 4));
    });
  }
  async receive(json) {
    if (typeof json !== 'string' || json.length > 65536) throw new Error('Invalid signaling packet');
    const m = JSON.parse(json);
    if (m.type === 'error' || m.type === 'ended') {
      this.log(`signaling ${m.type}: ${m.code}`);
      if (m.code === 'host-offline' && !this.peer) return; // retry join when host signaling resumes
      this.fail('Session unavailable: ' + m.code + '. Scan the current QR in Unity.'); return;
    }
    if (m.type === 'joined' && !this.peer && /^[a-f0-9]{32}$/.test(m.peer) && /^[a-f0-9]{32}$/.test(m.ticket)) {
      this.peer = m.peer; this.ticket = m.ticket; this.signalReady = true; this.attempts = 0;
      this.log('joined; controller ticket retained in memory'); return;
    }
    if (m.type === 'resumed' && m.peer === this.peer) {
      this.signalReady = true; this.attempts = 0; this.log('signaling resumed; same controller');
      if (this.recovering) this.askRestart(); return;
    }
    if (m.type === 'host-offline' || m.type === 'host-online') {
      this.log(m.type + ' (signaling only)');
      if (m.type === 'host-online' && this.recovering) this.askRestart(); return;
    }
    if (m.peer !== this.peer || !Number.isSafeInteger(m.revision) || m.revision < 1) throw new Error('Unexpected peer/revision');
    if (m.revision < this.revision) return;
    if (m.type === 'offer' && typeof m.sdp === 'string') {
      if (m.revision === this.revision) return;
      this.revision = m.revision; this.remoteReady = this.answerSent = false;
      this.localIce = []; this.pendingIce = this.pendingIce.filter(i => i.revision === m.revision);
      if (m.reset || !this.pc) this.createPeer();
      const pc = this.pc, revision = this.revision;
      this.log(`host offer revision=${revision} reset=${!!m.reset}`);
      this.onState(this.recovering ? 'Reconnecting' : 'Connecting', 'Negotiating direct controller connection…');
      await pc.setRemoteDescription({type:'offer',sdp:m.sdp});
      if (this.closed || this.pc !== pc) return;
      this.remoteReady = true;
      for (const ice of this.pendingIce.splice(0)) await pc.addIceCandidate(ice);
      await pc.setLocalDescription(await pc.createAnswer());
      if (this.closed || this.pc !== pc) return;
      if (!this.signalSend({type:'answer',peer:this.peer,revision,sdp:pc.localDescription.sdp})) throw new Error('Signaling unavailable for answer');
      this.answerSent = true;
      for (const ice of this.localIce.splice(0)) this.signalSend(ice);
    } else if (m.type === 'ice' && typeof m.candidate === 'string' && m.candidate.length < 2048) {
      const ice = {candidate:m.candidate,sdpMid:m.sdpMid,sdpMLineIndex:m.sdpMLineIndex,revision:m.revision};
      if (m.revision === this.revision && this.remoteReady) await this.pc.addIceCandidate(ice);
      else if (this.pendingIce.length < 64) this.pendingIce.push(ice);
      else throw new Error('Too many ICE candidates');
    } else throw new Error('Unexpected signaling message');
  }
  disposePeer() {
    if (this.channel) {
      this.channel.onopen = this.channel.onclose = this.channel.onerror = this.channel.onmessage = null;
      this.channel.close(); this.channel = null;
    }
    if (this.pc) {
      this.pc.onconnectionstatechange = this.pc.oniceconnectionstatechange = this.pc.onicegatheringstatechange = this.pc.onsignalingstatechange = this.pc.onicecandidate = this.pc.onicecandidateerror = this.pc.ondatachannel = null;
      this.pc.close(); this.pc = null;
    }
    this.readyState = 0;
  }
  createPeer() {
    this.disposePeer();
    const pc = this.pc = new RTCPeerConnection({iceServers:[]});
    for (const [event, field] of [['connectionstatechange','connectionState'],['iceconnectionstatechange','iceConnectionState'],['icegatheringstatechange','iceGatheringState'],['signalingstatechange','signalingState']]) {
      pc['on'+event] = () => {
        if (this.pc !== pc || this.closed) return;
        this.log(`${field}=${pc[field]}`);
        if (pc[field] === 'disconnected') this.requestRecovery(field + ' disconnected');
        if (pc[field] === 'failed' || pc[field] === 'closed') this.requestRecovery(field + ' ' + pc[field], true);
      };
    }
    pc.onicecandidateerror = e => this.log(`ICE candidate error code=${e.errorCode} text=${e.errorText || 'unspecified'}`);
    pc.onicecandidate = e => {
      if (!e.candidate || this.pc !== pc || this.closed) return;
      const m = {type:'ice',peer:this.peer,revision:this.revision,candidate:e.candidate.candidate,sdpMid:e.candidate.sdpMid || '0',sdpMLineIndex:e.candidate.sdpMLineIndex || 0};
      if (this.answerSent) this.signalSend(m); else if (this.localIce.length < 64) this.localIce.push(m);
    };
    pc.ondatachannel = e => this.acceptChannel(e.channel);
    this.log('PeerConnection created (host owns negotiation)');
  }
  acceptChannel(channel) {
    if (this.closed || this.channel || channel.label !== 'controller-v1' || !channel.ordered || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null) {
      channel.close(); this.fail('Unexpected controller channel.'); return;
    }
    this.channel = channel; this.log('DataChannel=' + channel.readyState);
    let opened = false;
    channel.onopen = () => {
      if (opened || this.closed) return;
      opened = true; this.readyState = 1; this.log('DataChannel=OPEN');
      this.dispatchEvent(new Event('open')); // re-authenticate replacement channel with the same ticket
    };
    channel.onmessage = e => {
      if (typeof e.data !== 'string' || e.data.length > 8192) { this.fail('Invalid controller message'); return; }
      this.lastReceive = performance.now(); this.dispatchEvent(new MessageEvent('message',{data:e.data}));
    };
    channel.onclose = () => { this.readyState = 0; this.log('DataChannel=CLOSED'); this.requestRecovery('DataChannel closed', true); };
    channel.onerror = e => { this.log(`DataChannel error: ${e.error?.errorDetail || ''} ${e.error?.message || e.message || 'unspecified'}`); this.requestRecovery('DTLS/DataChannel error', true); };
    if (channel.readyState === 'open') channel.onopen();
  }
  noteHeartbeat() {
    this.lastPing = this.lastPong = performance.now();
    if (this.recovering && this.pc?.connectionState === 'connected' && this.channel?.readyState === 'open') {
      this.recovering = false; this.recoveryAt = null; this.log('heartbeat restored; same controller/player');
      this.onState('Connected','LAN WebRTC'); this.dispatchEvent(new Event('recovered'));
    }
  }
  requestRecovery(reason, immediate = false) {
    if (this.closed) return;
    if (!this.recovering) {
      this.recovering = true; this.recoveryAt = performance.now();
      this.log('Recovering: ' + reason); this.onState('Recovering', reason);
      this.dispatchEvent(new Event('recovering'));
    }
    if (immediate) this.askRestart();
  }
  askRestart() {
    if (!this.signalReady || performance.now() - this.lastRestart < 5000) return;
    if (this.signalSend({type:'restart-request',peer:this.peer})) {
      this.lastRestart = performance.now(); this.log('requested host ICE restart'); this.onState('Reconnecting','Waiting for host recovery…');
    }
  }
  tick() {
    if (this.closed) return;
    const now = performance.now();
    if (!this.signal && now >= this.retryAt) this.connectSignal();
    if (this.signal && !this.signalReady && now - this.signalStarted > 20000) this.signal.close();
    if (!this.recovering && now - this.lastReceive > (this.readyState === 1 ? 12000 : 25000)) this.requestRecovery('heartbeat/connection timeout');
    if (this.recovering) {
      if (now - this.recoveryAt >= 60000) { this.fail('Recovery timed out after 60 seconds.'); return; }
      if (now - this.recoveryAt >= 8000) this.askRestart();
    }
  }
  setVisibility(hidden) {
    this.log('browser visibility=' + (hidden ? 'hidden; retaining connection' : 'visible'));
    if (!hidden) this.tick();
  }
  send(data) {
    if (this.closed || this.channel?.readyState !== 'open') throw new Error('Controller not connected');
    this.channel.send(data);
  }
  fail(reason) {
    if (this.closed) return;
    this.reason = reason; this.terminal = true; this.log('Failed: ' + reason);
    this.onState('Failed',reason); this.close(); this.dispatchEvent(new Event('close'));
  }
  close() {
    if (this.closed) return;
    this.signalSend({type:'leave',peer:this.peer});
    this.closed = true; clearInterval(this.timer); this.disposePeer(); this.readyState = 3;
    this.signal?.close();
  }
}
if (typeof module !== 'undefined') module.exports = { LanControllerTransport };
