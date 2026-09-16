'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const ZERO = { x: 0, y: 0, z: 0 };
  const MAX_BUFFER = 8192;
  let socket = null, controllerId = '', sequence = 0, orientation = null, motion = null;
  let motionEnabled = false, enabling = false, enabledAt = 0, motionNote = '';
  let screenAngle = readScreenAngle(), lastSentSample = -1, lastSend = 0;
  let sent = 0, skipped = 0;
  let calibrationSequence = null, calibrationSentAt = 0;
  let calibrated = false, buttonSequence = 0;
  let gameState = '', uiMode = 'menu', paused = false, playerNumber = 0, setupRequested = false;
  const debug = new URLSearchParams(location.search).get('debug') === '1';
  const holdButton = ControllerUI.create({ document,
    canPress: () => connected() && calibrated && freshOrientation() && !document.hidden,
    onTransition: sendButton
  });
  function renderUi() {
    holdButton.render({ connected: connected(), recovering: !!socket?.recovering,
      motionEnabled, calibrated, mode: uiMode, gameState, paused, playerNumber, setup: setupRequested,
      status: $('status').textContent, debug });
  }
  let showOrientation = true;
  $('sensor-overlay').addEventListener('change', () => { showOrientation = $('sensor-overlay').checked; });
  $('pregame-setup').addEventListener('click', () => { setupRequested = true; renderUi(); });
  $('setup').addEventListener('click', () => { setupRequested = true; renderUi(); });
  $('setup-done').addEventListener('click', () => { if (motionEnabled && calibrated) { setupRequested = false; renderUi(); } });
  const fragment = new URLSearchParams(location.hash.slice(1));
  const lanSession = fragment.get('session');
  let lanStopped = false, retryTimer = null, retryCount = 0;
  // Pairing secrets stay out of HTTP requests, localStorage, and the visible URL after loading.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  function readScreenAngle() {
    return typeof screen.orientation?.angle === 'number' ? screen.orientation.angle :
      typeof window.orientation === 'number' ? window.orientation : 0;
  }
  function freshOrientation() { return orientation && performance.now() - orientation.timestamp < 250; }
  function connected() { return socket?.readyState === WebSocket.OPEN && !!controllerId && !socket.recovering; }
  function reset(reason) {
    clearTimeout(retryTimer); retryTimer = null;
    holdButton.cancel();
    holdButton.reset(); calibrated = false;
    const old = socket; socket = null; controllerId = ''; calibrationSequence = null;
    if (old) old.close();
    $('status').textContent = reason;
    $('controller-id').textContent = '—'; playerNumber = 0;
    $('connect').disabled = false; $('disconnect').disabled = true;
    $('calibration-status').textContent = 'Calibration required after connecting.';
    renderUi();
    if (lanSession && !lanStopped && !document.hidden && retryCount < 5)
      retryTimer = setTimeout(startLan, Math.min(10000, 1000 * 2 ** retryCount++));
  }
  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > MAX_BUFFER) { skipped++; return false; }
    try { socket.send(JSON.stringify(message)); } catch { return false; }
    return true;
  }
  $('connect').addEventListener('click', () => {
    if (!lanSession) { $('status').textContent = 'Scan the QR code in Unity to connect.'; return; }
    lanStopped = false; retryCount = 0; startLan();
  });
  function attach(current) {
    $('connect').disabled = true; $('disconnect').disabled = false;
    current.addEventListener('open', () => {
      if (socket !== current) return;
      $('status').textContent = 'Connected to endpoint; pairing…';
      send({ version: 1, type: 'hello', token: current.ticket });
    });
    current.addEventListener('recovering', () => { if (socket === current) { holdButton.cancel(); renderUi(); } });
    current.addEventListener('recovered', () => { if (socket === current) { $('status').textContent = 'Connected · LAN WebRTC'; renderUi(); } });
    current.addEventListener('message', event => {
      if (socket !== current) return;
      let reply;
      try { reply = JSON.parse(event.data); } catch { reset('Invalid server response.'); return; }
      if (reply.version !== 1) { reset('Unsupported server protocol.'); return; }
      if (reply.type === 'welcome' && /^[a-f0-9]{32}$/.test(reply.controllerId)) {
        retryCount = 0;
        if (controllerId && controllerId !== reply.controllerId) calibrated = false;
        controllerId = reply.controllerId; playerNumber = reply.playerNumber || 0;
        $('controller-id').textContent = reply.playerNumber ? `Player ${reply.playerNumber} · ${controllerId}` : controllerId;
        $('status').textContent = 'Connected · WebRTC';
      } else if (reply.type === 'ui-mode' && typeof reply.mode === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(reply.mode)) {
        if (reply.mode !== uiMode && ControllerLayouts.modes[reply.mode] && motionEnabled && calibrated) setupRequested = false;
        uiMode = reply.mode; gameState = typeof reply.state === 'string' ? reply.state : ''; paused = reply.paused === true; renderUi();
      } else if (reply.type === 'serverPing' && Number.isFinite(reply.timestamp) && reply.controllerId === controllerId) {
        if (send({ version: 1, type: 'serverPong', controllerId, timestamp: reply.timestamp })) current.noteHeartbeat?.();

      } else if (reply.type === 'calibrated' && reply.sequence === calibrationSequence) {
        calibrationSequence = null;
        calibrated = true; setupRequested = false;
        $('calibration-status').textContent = 'Calibrated from the flat pose. Now pick up the phone in your game’s playing grip.';
        renderUi();
      }
      renderUi();
    });
    current.addEventListener('close', () => {
      if (socket !== current) return;
      if (current.terminal) lanStopped = true;
      reset(current.reason || 'Disconnected. Check the network or scan the current QR code.');
    });
    current.addEventListener('error', () => { if (socket === current) reset('Connection failed. Check signaling and ICE diagnostics.'); });
  }
  function startLan() {
    clearTimeout(retryTimer); retryTimer = null;
    if (lanStopped || document.hidden) return;
    if (socket && !socket.closed && socket instanceof LanControllerTransport) { socket.requestRecovery('Reconnect requested', true); return; }
    // Suppress automatic retry while replacing an existing transport.
    lanStopped = true; reset('Connecting…'); lanStopped = false;
    sequence = sent = skipped = buttonSequence = 0; lastSentSample = -1;
    try {
      const current = new LanControllerTransport(window.ControllerConfig?.signalingUrl, lanSession,
        (state, detail) => { $('status').textContent = state + ' · ' + detail; });
      socket = current; attach(current);
    } catch (e) { lanStopped = true; reset(e.message); }
  }
  $('disconnect').addEventListener('click', () => { lanStopped = true; reset('Disconnected'); });

  $('enable-motion').addEventListener('click', async () => {
    if (motionEnabled || enabling) return;
    if (!window.isSecureContext) { $('motion-status').textContent = 'Open this page over HTTPS to access motion.'; return; }
    if (!window.DeviceOrientationEvent) { $('motion-status').textContent = 'This browser does not expose device orientation.'; return; }
    enabling = true;
    try {
      // Invoke BOTH permission requests synchronously in this user gesture, before any await.
      const orientationRequest = typeof DeviceOrientationEvent.requestPermission === 'function' ?
        DeviceOrientationEvent.requestPermission() : Promise.resolve('granted');
      const motionRequest = window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function' ?
        DeviceMotionEvent.requestPermission() : Promise.resolve('granted');
      const [o, m] = await Promise.allSettled([orientationRequest, motionRequest]);
      if (o.status !== 'fulfilled' || o.value !== 'granted') throw new Error('Orientation permission denied. Allow access in site settings, reload, and tap Enable Motion.');
      window.addEventListener('deviceorientation', event => {
        if (![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return;
        orientation = { alpha: event.alpha, beta: event.beta, gamma: event.gamma,
          q: MotionMath.orientationQuaternion(event.alpha, event.beta, event.gamma),
          absolute: event.absolute === true, timestamp: performance.now() };
      });
      if (m.status === 'fulfilled' && m.value === 'granted') {
        window.addEventListener('devicemotion', event => {
          const rate = event.rotationRate;
          const angularVelocity = rate ? { x: rate.beta, y: rate.gamma, z: rate.alpha } : null;
          // Copy browser event values: do not retain event objects between callbacks.
          const copy = v => MotionMath.validVector(v) ? { x: v.x, y: v.y, z: v.z } : null;
          motion = { angularVelocity: copy(angularVelocity), acceleration: copy(event.acceleration),
            gravity: copy(event.accelerationIncludingGravity), timestamp: performance.now() };
        });
      } else motionNote = ' Gyroscope/acceleration permission was denied; orientation can still work.';
      motionEnabled = true; enabledAt = performance.now(); $('enable-motion').disabled = true;
      $('motion-status').textContent = 'Permission granted; waiting for sensor readings.' + motionNote;
    } catch (e) { $('motion-status').textContent = e.message; }
    finally { enabling = false; renderUi(); }
  });

  function packet(type) {
    updateScreenAngle();
    const m = motion && performance.now() - motion.timestamp < 250 ? motion : null;
    return { version: 1, type, controllerId, sequence: ++sequence, timestamp: orientation.timestamp,
      motionTimestamp: m ? m.timestamp : 0, orientation: orientation.q, screenAngle,
      absoluteOrientation: orientation.absolute,
      hasDeviceAngles: true, deviceAngles: { x: orientation.alpha, y: orientation.beta, z: orientation.gamma },
      angularVelocity: m?.angularVelocity || ZERO, acceleration: m?.acceleration || ZERO,
      accelerationIncludingGravity: m?.gravity || ZERO,
      hasAngularVelocity: !!m?.angularVelocity, hasAcceleration: !!m?.acceleration, hasGravity: !!m?.gravity };
  }
  function sendButton(phase, button = 'primary') {
    if (!connected()) return false;
    updateScreenAngle();
    // Cancellation never becomes a release. If required input cannot be sent, disconnect
    // instead of silently dropping it and leaving Unity holding a ball indefinitely.
    if (phase !== 'canceled' && (!calibrated || !freshOrientation())) phase = 'canceled';
    const snapshot = phase !== 'canceled' && freshOrientation();
    const p = snapshot ? packet('button') : { version: 1, type: 'button', controllerId };
    Object.assign(p, { button, phase, buttonSequence: ++buttonSequence,
      eventTimestamp: performance.now(), hasSnapshot: !!snapshot });
    if (!send(p)) {
      socket?.requestRecovery('Button delivery failed', true);
      return false;
    }
    return phase !== 'canceled';
  }
  $('calibrate').addEventListener('click', () => {
    if (!connected() || !freshOrientation()) return;
    holdButton.cancel(); calibrated = false;
    const p = packet('calibrate');
    if (send(p)) {
      calibrationSequence = p.sequence; calibrationSentAt = performance.now();
      $('calibration-status').textContent = 'Waiting for Unity calibration acknowledgement…';
    } else $('calibration-status').textContent = 'Network is backed up. Wait and tap Calibrate again.';
  });
  setInterval(() => {
    const now = performance.now();
    if (document.hidden || !connected() || !freshOrientation() || now - lastSend < 1000 / 60 || orientation.timestamp === lastSentSample) return;
    if (send(packet('motion'))) { sent++; lastSentSample = orientation.timestamp; lastSend = now; }
  }, 8);
  const format = v => v ? [v.x, v.y, v.z].map(n => n.toFixed(2)).join(' / ') : 'Unavailable';
  function updateScreenAngle() {
    const nextScreenAngle = readScreenAngle();
    if (nextScreenAngle !== screenAngle) {
      screenAngle = nextScreenAngle; calibrationSequence = null; calibrated = false;
      holdButton.cancel();
      $('calibration-status').textContent = 'Screen orientation changed. Hold still and calibrate again.';
    }
  }
  setInterval(() => {
    updateScreenAngle();
    if (holdButton.held && (!connected() || !calibrated || !freshOrientation())) holdButton.cancel();
    renderUi();
    $('calibrate').disabled = !connected() || !freshOrientation() || calibrationSequence !== null;
    if (calibrationSequence !== null && performance.now() - calibrationSentAt > 5000) {
      calibrationSequence = null; $('calibration-status').textContent = 'Calibration acknowledgement timed out. Try again.';
    }
    const m = motion && performance.now() - motion.timestamp < 250 ? motion : null;
    $('orientation').textContent = orientation ? [orientation.alpha, orientation.beta, orientation.gamma].map(n => n.toFixed(1)).join(' / ') + (freshOrientation() ? '' : ' (stale)') : 'Unavailable';
    $('orientation-overlay').hidden = !showOrientation || !motionEnabled || !connected();
    $('live-orientation').textContent = $('orientation').textContent;
    $('live-screen-angle').textContent = 'Screen angle: ' + screenAngle + '°';
    $('rotation').textContent = format(m?.angularVelocity);
    $('acceleration').textContent = format(m?.acceleration);
    $('gravity').textContent = format(m?.gravity);
    $('screen').textContent = String(screenAngle);
    if (motionEnabled && performance.now() - enabledAt > 3000) $('motion-status').textContent = (freshOrientation() ? 'Receiving orientation.' : 'No fresh orientation. Keep the page visible; check permissions and sensor availability.') + motionNote;
    if ($('transport-log')) $('transport-log').textContent = socket?.diagnostics || 'No LAN diagnostics';
    $('network').textContent = `Sent ${sent} · seq ${sequence} · skipped ${skipped} · buffered ${socket?.bufferedAmount || 0} B · ICE RTT ${socket?.iceRtt == null ? '—' : socket.iceRtt.toFixed(0) + ' ms'} · ${socket?.path || 'No connection'}`;
  }, 200);
  document.addEventListener('visibilitychange', () => {
    if (socket && !socket.closed) {
      if (document.hidden) holdButton.cancel();
      socket.setVisibility(document.hidden); return;
    }
    if (!document.hidden && lanSession && !lanStopped) { retryCount = 0; startLan(); }
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted && lanSession) { holdButton.cancel(); socket?.setVisibility(true); return; }
    lanStopped = true; reset('Browser page closed');
  });
  window.addEventListener('pageshow', () => { if (lanSession) socket?.setVisibility(false); });
  renderUi();
  if (lanSession) startLan();
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./service-worker.js').catch(() => {
    $('status').textContent += ' (Offline installation unavailable; online control still works.)';
  });
})();
