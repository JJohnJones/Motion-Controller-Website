'use strict';
// ICE servers/temporary TURN credentials come from authenticated signaling, never this public file.
// Deployment configuration, not player input. Keep this aligned with Unity's Inspector.
window.ControllerConfig = Object.freeze({ signalingUrl: 'wss://motion-controller-signaling.onrender.com/signal' });
