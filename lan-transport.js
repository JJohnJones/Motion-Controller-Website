'use strict';
// WebSocket-shaped delivery adapter: motion/calibration/buttons keep their existing codec.
// Reconnect creates a new authenticated controller; the caller must recalibrate.
class LanControllerTransport extends EventTarget {
  constructor(url, session, onState = () => {}) {
    super();
    this.readyState = 0;
    this.session = session;
    this.onState = onState;
    this.pendingIce = [];
    this.remoteReady = false;
    this.closed = false;
    this.ticket = '';
    this.pc = null;
    this.channel = null;
    this.peer = '';
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'wss:' || endpoint.pathname !== '/signal' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || /SIGNALING-HOST/i.test(endpoint.hostname))
      throw new Error('The game developer must configure the public WSS signaling service.');
    if (!/^[a-f0-9]{32}$/.test(session)) throw new Error('Invalid pairing link. Scan the QR in Unity again.');
    if (typeof RTCPeerConnection !== 'function') throw new Error('This browser does not support WebRTC. Open the link in Safari or Chrome.');
    this.onState('Signaling', 'Contacting game…');
    this.signal = new WebSocket(endpoint.href);
    this.signal.addEventListener('open', () => this.signalSend({ type: 'join', session }));
    // Serialize asynchronous SDP operations. ICE may arrive before the offer.
    this.work = Promise.resolve();
    this.signal.addEventListener('message', event => {
      this.work = this.work.then(() => this.receive(event.data)).catch(() => this.fail('WebRTC negotiation failed. Check LAN and firewall.'));
    });
    this.signal.addEventListener('close', () => this.fail('Signaling disconnected. Reconnecting…'));
    this.signal.addEventListener('error', () => this.fail('Signaling service unavailable.'));
    this.timeout = setTimeout(() => this.fail('Direct connection timed out. Use the same LAN; check firewall and guest Wi-Fi isolation.'), 25000);
  }
  get bufferedAmount() { return this.channel?.bufferedAmount || 0; }
  signalSend(m) {
    if (this.closed || this.signal.readyState !== WebSocket.OPEN) return;
    if (this.signal.bufferedAmount > 131072) { this.fail('Signaling overloaded.'); return; }
    this.signal.send(JSON.stringify(m));
  }
  async receive(json) {
    if (this.closed) return;
    if (typeof json !== 'string' || json.length > 65536) throw new Error('Invalid signaling packet');
    const m = JSON.parse(json);
    if (m.type === 'error') {
      const terminal = ['session-expired', 'session-full'].includes(m.code);
      this.fail(m.code === 'session-expired' ? 'Session expired. Scan the current QR in Unity.' :
        m.code === 'session-full' ? 'All four controller slots are occupied.' : 'Signaling rejected the connection.', terminal);
      return;
    }
    if (m.type === 'joined' && !this.pc && /^[a-f0-9]{32}$/.test(m.peer) && /^[a-f0-9]{32}$/.test(m.ticket)) {
      this.peer = m.peer; this.ticket = m.ticket;
      this.pc = new RTCPeerConnection({ iceServers: [] });
      this.pc.onicecandidate = event => {
        if (event.candidate) this.signalSend({ type: 'ice', peer: this.peer, candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid || '0', sdpMLineIndex: event.candidate.sdpMLineIndex || 0 });
      };
      this.pc.onconnectionstatechange = () => {
        if (this.pc?.connectionState === 'failed') this.fail('Direct connection lost. Reconnecting…');
      };
      this.pc.ondatachannel = event => this.acceptChannel(event.channel);
      this.onState('Connecting', 'Connecting directly to your game…');
      return;
    }
    if (!this.pc || m.peer !== this.peer) throw new Error('Unexpected signaling peer');
    if (m.type === 'offer' && !this.remoteReady && typeof m.sdp === 'string') {
      const pc = this.pc;
      await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      if (this.closed) return;
      this.remoteReady = true;
      for (const ice of this.pendingIce.splice(0)) await pc.addIceCandidate(ice);
      await pc.setLocalDescription(await pc.createAnswer());
      if (!this.closed) this.signalSend({ type: 'answer', peer: this.peer, sdp: pc.localDescription.sdp });
    } else if (m.type === 'ice' && typeof m.candidate === 'string' && m.candidate.length < 2048) {
      const ice = { candidate: m.candidate, sdpMid: m.sdpMid, sdpMLineIndex: m.sdpMLineIndex };
      if (this.remoteReady) await this.pc.addIceCandidate(ice);
      else if (this.pendingIce.length < 64) this.pendingIce.push(ice);
      else throw new Error('Too many ICE candidates');
    } else throw new Error('Unexpected signaling message');
  }
  acceptChannel(channel) {
    if (this.closed || this.channel || channel.label !== 'controller-v1' || !channel.ordered || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null) {
      channel.close(); this.fail('Unexpected controller channel.'); return;
    }
    this.channel = channel;
    const opened = () => {
      if (this.closed || this.readyState === 1) return;
      clearTimeout(this.timeout); this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    };
    channel.onopen = opened;
    channel.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > 8192) { this.fail('Invalid controller message.'); return; }
      this.dispatchEvent(new MessageEvent('message', { data: event.data }));
    };
    channel.onclose = () => this.fail('Controller disconnected. Reconnecting…');
    channel.onerror = () => this.fail('Controller channel failed.');
    if (channel.readyState === 'open') opened();
  }
  send(data) {
    if (this.readyState !== 1 || this.closed) throw new Error('Controller not connected');
    this.channel.send(data);
  }
  fail(reason, terminal = false) {
    if (this.closed) return;
    this.reason = reason; this.terminal = terminal;
    this.onState(terminal ? 'Failed' : 'Disconnected', reason);
    this.close(); this.dispatchEvent(new Event('close'));
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.readyState = 3; clearTimeout(this.timeout);
    if (this.channel) { this.channel.onclose = this.channel.onerror = this.channel.onmessage = null; this.channel.close(); }
    if (this.pc) { this.pc.onconnectionstatechange = this.pc.onicecandidate = this.pc.ondatachannel = null; this.pc.close(); }
    this.signal.close();
  }
}
if (typeof module !== 'undefined') module.exports = { LanControllerTransport };
