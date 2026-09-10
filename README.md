# Motion Controller Website

## Bowling update (0.3.0)

The controller now includes a large **HOLD BALL** touch button and original alpha/beta/gamma values in its packets. Update Unity first, publish all changed website assets including `hold-button.js`, then close old PWA tabs/app instances and reload so the v3-bowling-axes service worker shell is active. Recalibrate after updating.

Connect, enable motion, hold the phone screen-up with its top pointing down the lane (Wii-style grip), and calibrate. Aim with **alpha** while Unity is **Ready**. Hold the button through your swing and lift your finger while acceleration is forward and **beta is increasing**. A press locks aim. Relative gamma wrist roll controls hook, not aim. The button itself never launches based on a threshold. Faster valid angular swings produce faster balls; holding longer does not charge power. Wait for the desktop to reset before another press.

The button sends reusable `primary` transitions (`pressed`, `released`, `canceled`) with `buttonSequence` and a phone `eventTimestamp`. Press/release also attach the most recent sensor snapshot. Pointer capture preserves the hold if your finger slides off the button; only the original finger can release it. Browser cancellation, screen rotation, recalibration, hiding the page or connection failure cancel without throwing. Scrolling/selection are suppressed while holding. Keep holding the phone securely; lift only your finger from the on-screen button.

Local Held/Released text reports touch state. The Unity panel reports whether the throw was accepted and whether the ball is Ready/Holding/Rolling/Resetting. There is no desktop game-state feedback on the phone yet. Gyroscope availability is required to calculate bowling power; orientation alone still works for the cube. See the Unity project's `Documentation/BOWLING_SETUP.md` and `CONTROLLER_BUTTON_PROTOCOL.md` for tuning and the protocol extension.

These files belong at the root of **git@github.com:JJohnJones/Motion-Controller-Website.git**, separate from the Unity game repository.

A minimal static PWA for the Unity phone-to-cube prototype. No framework, build, backend or runtime npm dependency is required. Sensor and connection behavior is implemented in `controller.js`; `motion-math.js` only converts browser orientation angles to a right-handed quaternion. Unity owns screen-coordinate conversion, calibration, smoothing and motion history. No absolute position estimation is performed.

## Run

1. Deploy this directory as a normal **HTTPS** website. For GitHub Pages publish the intended branch root and use the URL Pages reports. Relative asset paths, manifest scope and worker registration support a project path such as `/Motion-Controller-Website/`.
2. In the separate Unity project create the scene with **Tools → Motion Controllers → Create Phone Cube Prototype Scene**. Set ControllerReceiver's Allowed Origin to this site's exact origin (e.g. `https://jjohnj.github.io`, without the repository path), then press Play.
3. On the PC install cloudflared using its official instructions and run `cloudflared tunnel --url http://127.0.0.1:8080`. Keep it running. From its reported `https://HOST.trycloudflare.com` address, use **`wss://HOST.trycloudflare.com/controller`** in this PWA.
4. Open the PWA directly in iPhone Safari or Android Chrome. Enter that WSS endpoint and the random 32-character token shown in Unity. Tap **Connect**, then **Enable Motion**, granting any permission requests. Confirm live orientation values.
5. Hold the phone facing you, tap **Calibrate**, wait for acknowledgement, and rotate it. Recalibrate after changing portrait/landscape. Keep the page visible and the phone awake. Backgrounding disconnects; reconnect/recalibrate on return.

The optional pairing link is `https://YOUR-PWA/#server=URL-ENCODED-WSS-ENDPOINT&token=SESSION-TOKEN`; Unity's debug panel can copy it. The fragment is removed after prefilling; secrets are not put in localStorage or the service-worker cache. Do not publish a real pairing link/token in this repo.

The browser requires a secure context for sensors. This PWA intentionally rejects insecure `ws://` addresses. GitHub Pages hosts only the static app, **not** the WebSocket receiver. A tunnel provides trusted WSS and forwards to Unity loopback; its internet route can add latency. WebRTC is a later transport option with the same logical motion input model.

## Install / update

On iPhone use Safari's **Share → Add to Home Screen**; on Android use the browser's install/add-to-home-screen action when offered. Menu wording varies. Normal browser operation works before installation. The manifest includes 192px/512px PNG icons and standalone mode. No screen-orientation lock is imposed.

The service worker caches only shell assets for offline opening. **Offline opening does not provide an offline network connection:** the current tunnel needs internet. Change the worker's `VERSION` when assets change. Close old tabs/app instances and reopen to activate an updated worker; clear site data for a clean engineering test. Permission/pairing must be checked in the installed context as well.

## Debug / test

- UI shows raw α/β/γ (degrees), angular velocity x/y/z (degrees/s), acceleration and gravity-inclusive acceleration (m/s²), availability, sent/sequence/skipped counts, socket buffered bytes and RTT.
- Null/unsupported axes are unavailable, not zero. `rotationRate` x/y/z maps from browser beta/gamma/alpha. Motion and orientation callbacks have independent monotonic timestamps.
- Permission requests happen together inside the Enable Motion gesture before awaiting either response. If orientation permission is denied, change site permissions, reload and try again. If only gyro/acceleration permission is denied, orientation can still operate the cube.
- Page sends up to 60 fresh orientation updates/s. It does not integrate acceleration or queue old samples behind a congested socket. The browser's actual cadence may be lower.
- Use `npm test` for math and mocked-browser behavior tests. No `npm install` is needed. Tests do not replace physical iPhone/Android or public WSS verification.
- For desktop markup inspection you can use any local static server. Phone testing must use a valid HTTPS host; a plain HTTP LAN server will not suffice.

Wire protocol v1: `hello` with token → `welcome` with assigned controller ID → `motion`/`calibrate` snapshots. Every snapshot contains `version`, `type`, `controllerId`, `sequence`, `timestamp`, `motionTimestamp`, `orientation` `{x,y,z,w}`, `screenAngle`, `absoluteOrientation`, vectors `angularVelocity`, `acceleration`, `accelerationIncludingGravity`, and flags `hasAngularVelocity`, `hasAcceleration`, `hasGravity`. Calibration replies echo its sequence. `ping`/`pong` echo the phone timestamp for RTT. Server clocks are never subtracted from phone clocks. See the Unity repository's `Documentation/CONTROLLER_PROTOCOL.md` for the full contract and `PHONE_CUBE_SETUP.md` for setup/firewall/manual checks.

References: [motion permission](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static), [browser coordinate specification](https://www.w3.org/TR/orientation-event/), [WebSocket secure-context guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications), [tunnel setup](https://developers.cloudflare.com/tunnel/setup/).
