# Motion Controller Website

## LAN WebRTC update (0.4.0)

The default new pairing flow is **scan Unity QR → automatic WebRTC pairing → Enable Motion → Calibrate**. The production files stay in this repository. No player enters a networking address or token.

Before publishing, set `window.ControllerConfig.signalingUrl` in `config.js` to your deployed `wss://YOUR-DOMAIN/signal`. Configure the same URL and this website's full HTTPS URL in Unity's LAN component. The sibling `Controller Signaling` folder supplies a separate Node/Docker signaling service and deployment instructions. GitHub Pages can continue hosting this PWA, but cannot run that backend. The placeholder configuration deliberately fails with a useful message until deployment is complete.

Publish `config.js`, `lan-transport.js`, the changed `controller.js`, `index.html`, and `service-worker.js`, together with the existing styles, icons, sensor math and hold-button files. Close old tabs/installed-app instances and reload so the `v4-lan-webrtc` shell is active. The service worker caches the static shell, never pairing secrets or sensor data. Website availability offline does not provide offline signaling.

`lan-transport.js` handles signaling and the ordered `controller-v1` DataChannel. `controller.js` keeps the existing JSON motion/calibration/button behavior and iOS gesture-driven permission requests. `motion-math.js` and `hold-button.js` are unchanged. Both native and browser peers use host ICE candidates, without STUN/TURN; high-rate input is direct, not routed through signaling. All messages on the signal socket are negotiation/lifecycle messages.

The QR's `#session=...` is a temporary pairing capability, held in memory and removed from the visible URL after loading. It is not saved in localStorage. Page reload needs a fresh scan; temporary disconnects can retry from memory up to five times. A new peer/controller ID requires calibration again. Expired sessions ask for the current QR; full sessions ask for a free slot. Hiding the page cancels the hold and disconnects; returning retries a still-valid session. Keep the controller visible and awake.

Sensor and network values are under **Sensor and network diagnostics**. Unity also sends a diagnostic ping and measures its own RTT. Ping does not rewrite sensor timing. **Legacy WebSocket fallback** remains available when opening the page without a LAN session fragment; existing `#server=...&token=...` links still work through the manual Connect/Reconnect button.

Run `node --test tests/*.test.cjs` (or `npm test`). Physical iPhone/Safari and Android/Chrome testing remains necessary: same LAN, no guest/client isolation, and a Private-network firewall allowance for Unity/the built game. See the Unity project's `LAN_CONTROLLER_MODE.md` for exact scene setup and troubleshooting. This is local controller networking, independent from any future online game networking.

## Bowling update (0.3.0)

The controller includes a large **HOLD BALL** touch button and original alpha/beta/gamma values in its packets. Recalibrate after updating. The LAN transport update above supersedes the earlier tunnel setup while preserving this input behavior.

Connect, enable motion, hold the phone screen-up with its top pointing down the lane (Wii-style grip), and calibrate. Aim with **alpha** while Unity is **Ready**. Hold the button through your swing and lift your finger while acceleration is forward and **beta is increasing**. A press locks aim. Relative gamma wrist roll controls hook, not aim. The button itself never launches based on a threshold. Faster valid angular swings produce faster balls; holding longer does not charge power. Wait for the desktop to reset before another press.

The button sends reusable `primary` transitions (`pressed`, `released`, `canceled`) with `buttonSequence` and a phone `eventTimestamp`. Press/release also attach the most recent sensor snapshot. Pointer capture preserves the hold if your finger slides off the button; only the original finger can release it. Browser cancellation, screen rotation, recalibration, hiding the page or connection failure cancel without throwing. Scrolling/selection are suppressed while holding. Keep holding the phone securely; lift only your finger from the on-screen button.

Local Held/Released text reports touch state. The Unity panel reports whether the throw was accepted and whether the ball is Ready/Holding/Rolling/Resetting. There is no desktop game-state feedback on the phone yet. Gyroscope availability is required to calculate bowling power; orientation alone still works for the cube. See the Unity project's `Documentation/BOWLING_SETUP.md` and `CONTROLLER_BUTTON_PROTOCOL.md` for tuning and the protocol extension.

These files belong at the root of **git@github.com:JJohnJones/Motion-Controller-Website.git**, separate from the Unity game repository.

A minimal static PWA with no framework, build step or runtime npm dependency. LAN pairing uses the separate signaling backend described above. Sensor behavior is implemented in `controller.js`, with LAN delivery in `lan-transport.js`; `motion-math.js` only converts browser orientation angles to a right-handed quaternion. Unity owns screen-coordinate conversion, calibration, smoothing and motion history. No absolute position estimation is performed.

## Legacy WebSocket fallback setup

Use this section only when validating the preserved tunnel transport. For normal LAN mode, follow the LAN WebRTC setup above.

1. Deploy this directory as a normal **HTTPS** website. For GitHub Pages publish the intended branch root and use the URL Pages reports. Relative asset paths, manifest scope and worker registration support a project path such as `/Motion-Controller-Website/`.
2. In the separate Unity project create the scene with **Tools → Motion Controllers → Create Phone Cube Prototype Scene**. Set ControllerReceiver's Allowed Origin to this site's exact origin (e.g. `https://jjohnj.github.io`, without the repository path), then press Play.
3. On the PC install cloudflared using its official instructions and run `cloudflared tunnel --url http://127.0.0.1:8080`. Keep it running. From its reported `https://HOST.trycloudflare.com` address, use **`wss://HOST.trycloudflare.com/controller`** in this PWA.
4. Open the PWA directly in iPhone Safari or Android Chrome. Enter that WSS endpoint and the random 32-character token shown in Unity. Tap **Connect**, then **Enable Motion**, granting any permission requests. Confirm live orientation values.
5. Hold the phone facing you, tap **Calibrate**, wait for acknowledgement, and rotate it. Recalibrate after changing portrait/landscape. Keep the page visible and the phone awake. Backgrounding cancels a held button but retains LAN pairing. Brief interruptions recover with the same player and calibration; OS suspension beyond the 60-second recovery budget may require pairing again. The legacy WebSocket debug mode retains its previous behavior.

The optional pairing link is `https://YOUR-PWA/#server=URL-ENCODED-WSS-ENDPOINT&token=SESSION-TOKEN`; Unity's debug panel can copy it. The fragment is removed after prefilling; secrets are not put in localStorage or the service-worker cache. Do not publish a real pairing link/token in this repo.

The browser requires a secure context for sensors. This PWA intentionally rejects insecure `ws://` addresses. GitHub Pages hosts only the static app, **not** the WebSocket receiver. In this legacy mode, a tunnel provides trusted WSS and forwards to Unity loopback; its internet route can add latency. LAN WebRTC uses the same logical motion input model without that tunnel.

## Install / update

On iPhone use Safari's **Share → Add to Home Screen**; on Android use the browser's install/add-to-home-screen action when offered. Menu wording varies. Normal browser operation works before installation. The manifest includes 192px/512px PNG icons and standalone mode. No screen-orientation lock is imposed.

The service worker caches only shell assets for offline opening. **Offline opening does not provide offline pairing:** LAN signaling and the legacy tunnel both need internet. Change the worker's `VERSION` when assets change. Close old tabs/app instances and reopen to activate an updated worker; clear site data for a clean engineering test. Permission/pairing must be checked in the installed context as well.

## Debug / test

- UI shows raw α/β/γ (degrees), angular velocity x/y/z (degrees/s), acceleration and gravity-inclusive acceleration (m/s²), availability, sent/sequence/skipped counts, socket buffered bytes and RTT.
- Null/unsupported axes are unavailable, not zero. `rotationRate` x/y/z maps from browser beta/gamma/alpha. Motion and orientation callbacks have independent monotonic timestamps.
- Permission requests happen together inside the Enable Motion gesture before awaiting either response. If orientation permission is denied, change site permissions, reload and try again. If only gyro/acceleration permission is denied, orientation can still operate the cube.
- Page sends up to 60 fresh orientation updates/s. It does not integrate acceleration or queue old samples behind a congested socket. The browser's actual cadence may be lower.
- Use `npm test` for math and mocked-browser behavior tests. No `npm install` is needed. Tests do not replace physical iPhone/Android or public WSS verification.
- For desktop markup inspection you can use any local static server. Phone testing must use a valid HTTPS host; a plain HTTP LAN server will not suffice.

Wire protocol v1: `hello` with token → `welcome` with assigned controller ID → `motion`/`calibrate` snapshots. Every snapshot contains `version`, `type`, `controllerId`, `sequence`, `timestamp`, `motionTimestamp`, `orientation` `{x,y,z,w}`, `screenAngle`, `absoluteOrientation`, vectors `angularVelocity`, `acceleration`, `accelerationIncludingGravity`, and flags `hasAngularVelocity`, `hasAcceleration`, `hasGravity`. Calibration replies echo its sequence. `ping`/`pong` echo the phone timestamp for RTT. Server clocks are never subtracted from phone clocks. See the Unity repository's `Documentation/CONTROLLER_PROTOCOL.md` for the full contract and `PHONE_CUBE_SETUP.md` for setup/firewall/manual checks.

References: [motion permission](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static), [browser coordinate specification](https://www.w3.org/TR/orientation-event/), [WebSocket secure-context guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications), [tunnel setup](https://developers.cloudflare.com/tunnel/setup/).


## LAN recovery diagnostics

Deploy the matching signaling `resumeHost` / `resumePeer` support before these PWA changes. No endpoint changes are needed. The service-worker shell version is bumped; close old controller tabs and reopen once after deploying.

Expand **Connection diagnostics** for timestamped PC connection, ICE connection/gathering, SDP signaling, channel open/close/error and signaling WebSocket transitions. ICE candidate errors include the browser error code/text. The panel also reports the last incoming heartbeat and outgoing pong on the phone clock. Browser console lines start with `[LAN controller]`; secrets and SDP are omitted.

The host alone creates offers. The phone answers numbered revisions and requests host recovery rather than creating competing offers. `reset: true` replaces only the peer/channel, retaining the ticket and controller ID. Socket resume uses the same in-memory ticket; a full page reload does not retain it. Signaling retries after 1, 2, 4, 8, then 10 seconds and never closes a healthy DataChannel solely because signaling is offline.

Transient disconnects wait 8 seconds before requesting a restart. Failed ICE/channel errors request one immediately; requests are rate-limited to once per 5 seconds. A 12-second receive gap starts recovery. Recovery has a 60-second budget; repeated events do not extend it. A received heartbeat restores the phone UI, while Unity independently requires a fresh successful round trip before accepting gameplay input. A held gesture is canceled across recovery; start a new hold after reconnecting.

Keep the page foregrounded for continuous motion. iOS/Android can suspend background timers, sensors and networking; connection preservation cannot prevent OS suspension. `pagehide` with BFCache persistence retains the connection; explicit navigation/close sends best-effort leave. If the OS kills the page without an unload event, the host observes timeout rather than a provable browser-close reason.
