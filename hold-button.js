'use strict';
// Pointer handling is independent of sensors, networking and bowling rules.
(function (root) {
  function bindHoldButton(element, { canPress, onTransition, onState, primaryOnly = true }) {
    let pointerId = null;
    const state = phase => {
      element.dataset.phase = phase;
      element.setAttribute('aria-pressed', phase === 'held' ? 'true' : 'false');
      onState(phase);
    };
    function finish(phase, notify = true) {
      if (pointerId === null) return;
      const id = pointerId; pointerId = null; // Lost capture after a normal lift must not cancel it.
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
      state(phase);
      if (notify && onTransition(phase) === false) state('canceled');
    }
    element.addEventListener('pointerdown', event => {
      if (pointerId !== null || (primaryOnly && !event.isPrimary) || event.button !== 0 || !canPress()) return;
      event.preventDefault(); pointerId = event.pointerId;
      try { element.setPointerCapture(pointerId); }
      catch { pointerId = null; state('canceled'); return; }
      state('held');
      if (onTransition('pressed') === false) finish('canceled', false);
    });
    element.addEventListener('pointerup', event => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault(); finish('released');
    });
    element.addEventListener('pointercancel', event => { if (event.pointerId === pointerId) finish('canceled'); });
    element.addEventListener('lostpointercapture', event => { if (event.pointerId === pointerId) finish('canceled'); });
    element.addEventListener('contextmenu', event => event.preventDefault());
    state('idle');
    return { get held() { return pointerId !== null; }, cancel: () => finish('canceled'), reset: () => { finish('canceled', false); state('idle'); } };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { bindHoldButton };
  else root.HoldButton = { bindHoldButton };
})(typeof globalThis !== 'undefined' ? globalThis : this);
