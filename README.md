# Motion Controller Website

The only controller transport is WebRTC DataChannel. Scan Unity's HTTPS QR link, tap Enable Motion, then Calibrate. No manual IP/port/token fields remain. The static app stays on GitHub Pages; the existing public WSS service is used only for session/SDP/ICE signaling.

`config.js` contains only the public signaling URL. `lan-transport.js` receives expiring ICE configuration from authenticated signaling, configures STUN and TURN UDP/TCP/TLS candidates, and performs host-owned negotiation/recovery. Neither the permanent Cloudflare API token nor static TURN passwords belong here. See the separate signaling repository's **TURN_SETUP.md** for Render configuration and deployment instructions.

Deploy backend changes first, then all changed PWA files. The service-worker version is `motion-controller-shell-v6-turn`; close old tabs/installed-app instances and reopen to update. It caches only static assets, never tickets, credentials or sensor frames. Offline app opening does not provide offline signaling.

Normal ICE policy is `all`, permitting direct or TURN paths. A backend-authorized diagnostic session may use relay-only or direct-only, selected by Unity's development setting. The phone needs no configuration. Connection diagnostics report the selected candidate pair, protocol/relay protocol, ICE RTT and state/error timestamps. Unity separately reports application heartbeat RTT. Neither is a measured one-way motion latency.

The QR fragment holds a temporary session capability and is removed from the visible URL after parsing. Tickets/configuration stay in memory. Brief network interruptions preserve identity/calibration; full reload or terminal session expiration requires a new scan. Keep the phone awake and browser visible for sensors. Browser suspension can outlast recovery.

Run `npm test` (no dependency installation needed) for sensor math, permission/hold behavior, ICE configuration, selected-path diagnostics and recovery unit tests. Test real iPhone Safari and Android Chrome plus relay-only separately after deployment. There is no microphone/camera requirement for the DataChannel; motion access still requires HTTPS and an iOS user gesture.

## Bowling update (0.3.0)

The controller includes a large **HOLD BALL** touch button and original alpha/beta/gamma values in its packets. Recalibrate after updating. WebRTC preserves this input behavior.

Connect, enable motion, hold the phone screen-up with its top pointing down the lane (Wii-style grip), and calibrate. Aim with **alpha** while Unity is **Ready**. Hold the button through your swing and lift your finger while acceleration is forward and **beta is increasing**. A press locks aim. Relative gamma wrist roll controls hook, not aim. The button itself never launches based on a threshold. Faster valid angular swings produce faster balls; holding longer does not charge power. Wait for the desktop to reset before another press.

The button sends reusable `primary` transitions (`pressed`, `released`, `canceled`) with `buttonSequence` and a phone `eventTimestamp`. Press/release also attach the most recent sensor snapshot. Pointer capture preserves the hold if your finger slides off the button; only the original finger can release it. Browser cancellation, screen rotation, recalibration, hiding the page or connection failure cancel without throwing. Scrolling/selection are suppressed while holding. Keep holding the phone securely; lift only your finger from the on-screen button.

Local Held/Released text reports touch state. The Unity panel reports whether the throw was accepted and whether the ball is Ready/Holding/Rolling/Resetting. There is no desktop game-state feedback on the phone yet. Gyroscope availability is required to calculate bowling power; orientation alone still works for the cube. See the Unity project's `Documentation/BOWLING_SETUP.md` and `CONTROLLER_BUTTON_PROTOCOL.md` for tuning and the protocol extension.

These files belong at the root of **git@github.com:JJohnJones/Motion-Controller-Website.git**, separate from the Unity game repository.

A minimal static PWA with no framework, build step or runtime npm dependency. LAN pairing uses the separate signaling backend described above. Sensor behavior is implemented in `controller.js`, with LAN delivery in `lan-transport.js`; `motion-math.js` only converts browser orientation angles to a right-handed quaternion. Unity owns screen-coordinate conversion, calibration, smoothing and motion history. No absolute position estimation is performed.

## LAN recovery diagnostics

Deploy matching signaling and temporary ICE configuration support before these PWA changes. No endpoint changes are needed. The service-worker shell version is bumped; close old controller tabs and reopen once after deploying.

Expand **Connection diagnostics** for timestamped PC connection, ICE connection/gathering, SDP signaling, channel open/close/error and signaling WebSocket transitions. ICE candidate errors include the browser error code/text. The panel also reports the last incoming heartbeat and outgoing pong on the phone clock. Browser console lines start with `[LAN controller]`; secrets and SDP are omitted.

The host alone creates offers. The phone answers numbered revisions and requests host recovery rather than creating competing offers. `reset: true` replaces only the peer/channel, retaining the ticket and controller ID. Socket resume uses the same in-memory ticket; a full page reload does not retain it. Signaling retries after 1, 2, 4, 8, then 10 seconds and never closes a healthy DataChannel solely because signaling is offline.

Transient disconnects wait 8 seconds before requesting a restart. Failed ICE/channel errors request one immediately; requests are rate-limited to once per 5 seconds. A 12-second receive gap starts recovery. Recovery has a 60-second budget; repeated events do not extend it. A received heartbeat restores the phone UI, while Unity independently requires a fresh successful round trip before accepting gameplay input. A held gesture is canceled across recovery; start a new hold after reconnecting.

Keep the page foregrounded for continuous motion. iOS/Android can suspend background timers, sensors and networking; connection preservation cannot prevent OS suspension. `pagehide` with BFCache persistence retains the connection; explicit navigation/close sends best-effort leave. If the OS kills the page without an unload event, the host observes timeout rather than a provable browser-close reason.
