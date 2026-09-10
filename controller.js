'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const ZERO = { x: 0, y: 0, z: 0 };
  const MAX_BUFFER = 8192;
  let socket = null, controllerId = '', sequence = 0, orientation = null, motion = null;
  let motionEnabled = false, enabling = false, enabledAt = 0, motionNote = '';
  let screenAngle = readScreenAngle(), lastSentSample = -1, lastSend = 0;
  let sent = 0, skipped = 0, rtt = null, lastPong = 0, pingAt = null, welcomeTimer;
  let calibrationSequence = null, calibrationSentAt = 0;
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (fragment.has('server')) $('server').value = fragment.get('server');
  if (fragment.has('token')) $('token').value = fragment.get('token');
  // Pairing secrets stay out of HTTP requests, localStorage, and the visible URL after loading.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  function readScreenAngle() {
    return typeof screen.orientation?.angle === 'number' ? screen.orientation.angle :
      typeof window.orientation === 'number' ? window.orientation : 0;
  }
  function freshOrientation() { return orientation && performance.now() - orientation.timestamp < 250; }
  function connected() { return socket?.readyState === WebSocket.OPEN && !!controllerId; }
  function reset(reason) {
    const old = socket; socket = null; controllerId = ''; calibrationSequence = null;
    clearTimeout(welcomeTimer);
    if (old) old.close();
    $('status').textContent = reason;
    $('controller-id').textContent = '—';
    $('connect').disabled = false; $('disconnect').disabled = true;
    $('server').disabled = false; $('token').disabled = false;
    $('calibration-status').textContent = 'Calibration required after connecting.';
  }
  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > MAX_BUFFER) { skipped++; return false; }
    socket.send(JSON.stringify(message));
    return true;
  }
  $('connect').addEventListener('click', () => {
    let url;
    try {
      url = new URL($('server').value.trim());
      if (url.protocol !== 'wss:' || url.pathname !== '/controller' || url.search || url.hash || url.username || url.password)
        throw new Error('Use wss://hostname/controller without a query or credentials.');
      if (!/^[a-fA-F0-9]{32}$/.test($('token').value.trim())) throw new Error('Paste the 32-character pairing token shown by Unity.');
    } catch (e) { $('status').textContent = e.message; return; }
    reset('Connecting…');
    sequence = sent = skipped = 0; rtt = null; pingAt = null; lastSentSample = -1;
    const current = new WebSocket(url.href); socket = current;
    $('connect').disabled = true; $('disconnect').disabled = false;
    $('server').disabled = true; $('token').disabled = true;
    welcomeTimer = setTimeout(() => { if (socket === current && !controllerId) reset('Pairing timed out. Check Unity, endpoint, token, and allowed origin.'); }, 10000);
    current.addEventListener('open', () => {
      if (socket !== current) return;
      $('status').textContent = 'Connected to endpoint; pairing…';
      send({ version: 1, type: 'hello', token: $('token').value.trim().toLowerCase() });
    });
    current.addEventListener('message', event => {
      if (socket !== current) return;
      let reply;
      try { reply = JSON.parse(event.data); } catch { reset('Invalid server response.'); return; }
      if (reply.version !== 1) { reset('Unsupported server protocol.'); return; }
      if (reply.type === 'welcome' && /^[a-f0-9]{32}$/.test(reply.controllerId)) {
        controllerId = reply.controllerId; lastPong = performance.now();
        clearTimeout(welcomeTimer);
        $('controller-id').textContent = controllerId;
        $('status').textContent = 'Connected to Unity';
      } else if (reply.type === 'pong' && reply.timestamp === pingAt) {
        rtt = performance.now() - pingAt; lastPong = performance.now(); pingAt = null;
      } else if (reply.type === 'calibrated' && reply.sequence === calibrationSequence) {
        calibrationSequence = null;
        $('calibration-status').textContent = 'Calibrated. Rotate your phone to move the cube.';
      }
    });
    current.addEventListener('close', () => { if (socket === current) reset('Disconnected. Check token, allowed origin, capacity, or network; then reconnect.'); });
    current.addEventListener('error', () => { if (socket === current) reset('Connection failed. Check WSS address, tunnel, and Unity allowed origin.'); });
  });
  $('disconnect').addEventListener('click', () => reset('Disconnected'));

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
    finally { enabling = false; }
  });

  function packet(type) {
    updateScreenAngle();
    const m = motion && performance.now() - motion.timestamp < 250 ? motion : null;
    return { version: 1, type, controllerId, sequence: ++sequence, timestamp: orientation.timestamp,
      motionTimestamp: m ? m.timestamp : 0, orientation: orientation.q, screenAngle,
      absoluteOrientation: orientation.absolute,
      angularVelocity: m?.angularVelocity || ZERO, acceleration: m?.acceleration || ZERO,
      accelerationIncludingGravity: m?.gravity || ZERO,
      hasAngularVelocity: !!m?.angularVelocity, hasAcceleration: !!m?.acceleration, hasGravity: !!m?.gravity };
  }
  $('calibrate').addEventListener('click', () => {
    if (!connected() || !freshOrientation()) return;
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
  setInterval(() => {
    if (!connected()) return;
    if (performance.now() - lastPong > 10000) { reset('Unity heartbeat timed out. Reconnect when the network is available.'); return; }
    if (pingAt === null) {
      pingAt = performance.now();
      if (!send({ version: 1, type: 'ping', controllerId, timestamp: pingAt })) pingAt = null;
    }
  }, 1000);
  const format = v => v ? [v.x, v.y, v.z].map(n => n.toFixed(2)).join(' / ') : 'Unavailable';
  function updateScreenAngle() {
    const nextScreenAngle = readScreenAngle();
    if (nextScreenAngle !== screenAngle) {
      screenAngle = nextScreenAngle; calibrationSequence = null;
      $('calibration-status').textContent = 'Screen orientation changed. Hold still and calibrate again.';
    }
  }
  setInterval(() => {
    updateScreenAngle();
    $('calibrate').disabled = !connected() || !freshOrientation() || calibrationSequence !== null;
    if (calibrationSequence !== null && performance.now() - calibrationSentAt > 5000) {
      calibrationSequence = null; $('calibration-status').textContent = 'Calibration acknowledgement timed out. Try again.';
    }
    const m = motion && performance.now() - motion.timestamp < 250 ? motion : null;
    $('orientation').textContent = orientation ? [orientation.alpha, orientation.beta, orientation.gamma].map(n => n.toFixed(1)).join(' / ') + (freshOrientation() ? '' : ' (stale)') : 'Unavailable';
    $('rotation').textContent = format(m?.angularVelocity);
    $('acceleration').textContent = format(m?.acceleration);
    $('gravity').textContent = format(m?.gravity);
    $('screen').textContent = String(screenAngle);
    if (motionEnabled && performance.now() - enabledAt > 3000) $('motion-status').textContent = (freshOrientation() ? 'Receiving orientation.' : 'No fresh orientation. Keep the page visible; check permissions and sensor availability.') + motionNote;
    $('network').textContent = `Sent ${sent} · seq ${sequence} · skipped ${skipped} · buffered ${socket?.bufferedAmount || 0} B · RTT ${rtt === null ? '—' : rtt.toFixed(0) + ' ms'}`;
  }, 200);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset('Paused while hidden. Return here and reconnect.'); });
  window.addEventListener('pagehide', () => reset('Disconnected'));
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('./service-worker.js').catch(() => {
    $('status').textContent += ' (Offline installation unavailable; online control still works.)';
  });
})();
