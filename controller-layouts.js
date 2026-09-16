'use strict';
// Action IDs are protocol values, never DOM IDs. Add future game definitions here.
(function(root) {
  const modes = {
    sword: { layout: 'single', buttons: [
      { id: 'primary', idle: 'SWORD DUEL', pressed: 'READY', hint: 'SWORD DUEL', states: {
        ready: { idle: 'HOLD SWORD-READY POSE\nTAP TO READY', hint: 'SET YOUR GUARD', enabled: true },
        guard: { idle: 'SWING TO ATTACK\nMOVE SWORD TO GUARD', hint: 'DUEL', enabled: false },
        attack: { idle: 'FOLLOW THROUGH', hint: 'ATTACK / RECOVERY', enabled: false },
        stagger: { idle: 'REGAIN YOUR GUARD', hint: 'STAGGERED', enabled: false },
        waiting: { idle: 'GET READY', hint: 'WAITING', enabled: false }
      } }
    ] },
    tennis: { layout: 'single', buttons: [
      { id: 'primary', idle: 'TAP TO TOSS\nTHEN SWING', pressed: 'PREPARE TO SWING', hint: 'YOUR SERVE',
        states: {
          serve: { idle: 'TAP TO TOSS\nTHEN SWING', hint: 'YOUR SERVE', enabled: true },
          rally: { idle: 'SWING!', hint: 'RALLY', enabled: false },
          waiting: { idle: 'GET READY', hint: 'WAITING', enabled: false }
        } }
    ] },
    bowling: { layout: 'single', buttons: [
      { id: 'primary', idle: 'HOLD SCREEN\nTO HOLD BALL', pressed: 'BALL HELD\nSWING AND RELEASE', hint: 'READY' }
    ] }
  };
  const sizes = { single: 1, double: 2, triple: 3, quad: 4 };
  function valid(definition) {
    return !!definition && sizes[definition.layout] === definition.buttons?.length &&
      new Set(definition.buttons.map(b => b.id)).size === definition.buttons.length &&
      definition.buttons.every(b => /^[a-zA-Z][a-zA-Z0-9]{0,31}$/.test(b.id) && typeof b.idle === 'string' && typeof b.pressed === 'string');
  }
  const api = { modes, valid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ControllerLayouts = api;
})(globalThis);
