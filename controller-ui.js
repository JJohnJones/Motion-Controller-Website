'use strict';
// Navigation and zones own no sensor listeners or network connections.
(function(root) {
  function screenFor(s, modes) {
    if (!s.connected) return s.recovering ? 'recovering' : 'connecting';
    if (!s.motionEnabled || !s.calibrated || s.setup) return 'setup';
    if (s.paused) return 'paused';
    if ((s.mode || '').startsWith('ready-')) return 'pregame';
    return modes[s.mode] ? 'gameplay' : 'waiting';
  }
  function create({ document, canPress, onTransition }) {
    const $ = id => document.getElementById(id);
    let bindings = [], currentMode = null, currentScreen = null, state = {}, presenters = [], lastPhase = null;
    const readyButton = HoldButton.bindHoldButton($('ready'), {
      primaryOnly: true, canPress: () => currentScreen === 'pregame' && state.gameState === 'prepare' && canPress(),
      onTransition: phase => onTransition(phase, 'primary'), onState: () => {}
    });
    function cancel() { readyButton.cancel(); bindings.forEach(b => b.cancel()); }
    function build(mode) {
      cancel(); bindings = []; presenters = []; currentMode = mode;
      const surface = $('gameplay'); surface.replaceChildren();
      const config = ControllerLayouts.modes[mode];
      if (!ControllerLayouts.valid(config)) return;
      surface.dataset.layout = config.layout;
      config.buttons.forEach((button, index) => {
        const zone = document.createElement('button'); zone.type = 'button';
        zone.className = 'control-zone'; zone.id = mode === 'bowling' ? 'hold-ball' : `zone-${index}`;
        const hint = document.createElement('small'), label = document.createElement('span');
        hint.textContent = button.hint || 'READY'; zone.append(hint, label); surface.append(zone);
        bindings.push(HoldButton.bindHoldButton(zone, {
          primaryOnly: config.buttons.length === 1,
          canPress: () => currentScreen === 'gameplay' && (!button.states || button.states[state.gameState]?.enabled === true) && canPress(),
          onTransition: phase => onTransition(phase, button.id),
          onState: phase => {
            const variant = button.states?.[state.gameState] || button;
            label.textContent = phase === 'held' ? button.pressed : variant.idle;
            hint.textContent = phase === 'held' ? 'HELD' : phase === 'released' ? 'RELEASED' : (button.states?.[state.gameState]?.hint || button.hint || 'READY');
          }
        }));
        presenters.push(() => {
          if (zone.dataset.phase === 'held') return;
          const variant = button.states?.[state.gameState] || button;
          label.textContent = variant.idle; hint.textContent = variant.hint || 'READY';
        });
      });
    }
    function render(next) {
      state = next;
      const screen = screenFor(state, ControllerLayouts.modes);
      if (screen !== currentScreen || currentMode !== state.mode || lastPhase !== state.gameState) cancel();
      lastPhase = state.gameState;
      if (currentMode !== state.mode) build(state.mode);
      currentScreen = screen; presenters.forEach(show => show());
      document.body.dataset.screen = screen;
      for (const name of ['connecting', 'setup', 'waiting', 'pregame', 'gameplay', 'paused', 'recovering'])
        $('screen-' + name).hidden = name !== screen;
      $('connection-message').textContent = state.status || 'Scan the QR code displayed by your game.';
      $('recovering-message').textContent = state.status || 'Restoring your controller…';
      $('mode-status').textContent = `Game mode: ${state.mode} · Controller v12` + (ControllerLayouts.modes[state.mode] || state.mode.startsWith('ready-') || ['menu','waiting','pairing','connection'].includes(state.mode) ? '' : ' · This controller version does not support that game. Reopen the updated website.');
      $('player-name').textContent = state.playerNumber ? `PLAYER ${state.playerNumber}` : 'CONTROLLER READY';
      $('setup-player').textContent = state.playerNumber ? `PLAYER ${state.playerNumber}` : 'CONNECTED';
      $('setup-title').textContent = ControllerLayouts.modes[state.mode] ? `${state.mode.toUpperCase()} SETUP` : 'GET READY';
      $('setup-required').textContent = !state.motionEnabled ? 'Tap Enable Motion to use your phone as a racket or controller.' :
        !state.calibrated ? 'Lay the phone flat, SCREEN FACE UP, TOP pointed FORWARD toward the TV/monitor. Hold still and tap Calibrate.' :
        'Motion and calibration are ready. Continue to your controller.';
      $('setup-done').hidden = !state.motionEnabled || !state.calibrated;

      const sport = state.mode.replace(/^ready-/, '');
      $('pregame-title').textContent = sport === 'sword' ? 'SWORD DUEL' : sport.toUpperCase();
      $('grip-instructions').textContent = sport === 'bowling' ? 'Point the top forward like a Wii controller. Hold the screen, swing forward, and release to bowl.' :
        sport === 'tennis' ? 'Hold the phone UPRIGHT, TOP UP, like a tennis racket handle. Tap to toss; swing to serve. Do not recalibrate upright.' :
        'Hold the phone UPRIGHT, TOP UP, SCREEN facing inward: right hand = screen LEFT; left hand = screen RIGHT. Set your handedness in the game Settings. In the arena, tap in this guard pose to ready each round. Do not recalibrate upright.';
      $('ready').disabled = state.gameState !== 'prepare';
      $('ready').textContent = state.gameState === 'ready' ? 'Ready!' : 'I’m ready';
      $('ready-status').textContent = state.gameState === 'spectator' ? 'This game’s player slots are full.' : state.gameState === 'ready' ? 'Waiting for Start on the big screen…' : 'Tap Ready after changing to your playing grip.';
      $('debug-panel').hidden = !state.debug || screen === 'gameplay';
    }
    return { render, cancel, reset: () => { readyButton.reset(); bindings.forEach(b => b.reset()); },
      get held() { return readyButton.held || bindings.some(b => b.held); }, get screen() { return currentScreen; } };
  }
  const api = { screenFor, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ControllerUI = api;
})(globalThis);
