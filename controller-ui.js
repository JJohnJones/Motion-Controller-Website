'use strict';
// Navigation and zones own no sensor listeners or network connections.
(function(root) {
  function screenFor(s, modes) {
    if (!s.connected) return s.recovering ? 'recovering' : 'connecting';
    if (!s.motionEnabled || !s.calibrated || s.setup) return 'setup';
    if (s.paused) return 'paused';
    return modes[s.mode] ? 'gameplay' : 'waiting';
  }
  function create({ document, canPress, onTransition }) {
    const $ = id => document.getElementById(id);
    let bindings = [], currentMode = null, currentScreen = null, state = {}, presenters = [], lastPhase = null;
    function cancel() { bindings.forEach(b => b.cancel()); }
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
      for (const name of ['connecting', 'setup', 'waiting', 'gameplay', 'paused', 'recovering'])
        $('screen-' + name).hidden = name !== screen;
      $('connection-message').textContent = state.status || 'Scan the QR code displayed by your game.';
      $('recovering-message').textContent = state.status || 'Restoring your controller…';
      $('player-name').textContent = state.playerNumber ? `PLAYER ${state.playerNumber}` : 'CONTROLLER READY';
      $('setup-player').textContent = state.playerNumber ? `PLAYER ${state.playerNumber}` : 'CONNECTED';
      $('debug-panel').hidden = !state.debug || screen === 'gameplay';
    }
    return { render, cancel, reset: () => bindings.forEach(b => b.reset()),
      get held() { return bindings.some(b => b.held); }, get screen() { return currentScreen; } };
  }
  const api = { screenFor, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ControllerUI = api;
})(globalThis);
