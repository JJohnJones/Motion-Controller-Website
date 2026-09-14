# Controller screens update

The phone now has Connecting, Setup, Waiting, Gameplay, Paused, and Recovering screens. Pair as usual, tap **Enable Motion**, and **Calibrate**. Calibration acknowledgement enters Waiting (or the current game if already running). Waiting offers **Calibrate / Setup**. Unity selects Bowling automatically; the whole usable viewport is one hold/release surface. No setup/debug controls appear over it. Browser chrome remains controlled by Safari/Chrome; adding the PWA to the home screen gives a standalone surface.

Deploy the PWA files in this repository to the existing HTTPS host and use the updated Unity sources. No signaling/backend/config changes are required. Close existing PWA windows and reopen after deployment so the new service worker activates. No Unity scene regeneration or Inspector wiring is required.

## Presentation architecture

- `controller-layouts.js`: small mode registry, layouts `single`, `double`, `triple`, `quad` (1–4 zones). Three zones use a full-width top zone and two lower zones.
- `controller-ui.js`: screen selection and zone creation. It owns DOM/pointers only.
- `hold-button.js`: capture, independent pointer ownership, release and cancellation. Bowling ignores extra fingers; split layouts can hold different zones independently.
- `controller.js`: retains the existing sensors, permission, calibration and packet coordination; routes `ui-mode` to the UI. No sensor subscriptions restart on screen changes.
- `lan-transport.js`: unchanged WebRTC/signaling/recovery.

Unity's scene flow presents its GameDefinition `controllerUiMode` through `IControllerUiPresenter` / the lobby adapter. The transport-independent protocol router sends `{ "version":1, "type":"ui-mode", "mode":"bowling", "paused":false }`. It caches this state, sends changes, and replays it after authentication or recovery. Pause and scene transitions disable phone gameplay; resume restores the previous game. Unknown modes safely display Waiting.

Future games add a registry entry with `layout` and `buttons` (`id`, `idle`, `pressed`, optional `hint`), then set their GameDefinition mode. Action IDs must also be supported by the Unity input protocol/game: the current Unity protocol accepts `primary` only. The layout infrastructure supports multiple zones, but this change deliberately does not add unused Unity gameplay actions. No DOM IDs are transmitted.

Bowling still sends `primary` pressed/released/canceled packets, including the existing motion snapshot. Mode changes, pause, pointer cancellation and backgrounding cancel a hold without throwing. Recovery disables all zones and preserves the requested mode; an interrupted hold never resumes automatically. Calibration is retained during temporary transport recovery; a new identity or reload requires setup again. Motion continues in menu and gameplay while the browser supplies samples.

## Test on phones after deployment

1. Scan QR, grant motion on an explicit tap, calibrate, and verify Waiting / Player number.
2. Start Bowling: touch near each corner or the center, hold, move, and lift; all locations operate the same button. Slide before lifting and try a second accidental finger.
3. Pause or leave Bowling while held: it must cancel, never throw. Resume/re-enter restores the surface without rescanning.
4. Briefly interrupt Wi-Fi: Reconnecting disables touches; recovery restores the mode and requires a fresh press.
5. Return to Game Select/results and replay. Check calibration, motion, and controller identity remain intact.
6. Optional diagnostics: add `?debug=1` to the PWA URL before its session fragment. Diagnostics remain hidden in gameplay, even with that flag.

`npm test` exercises permissions, unchanged motion packets, pointer cancellation, screen routing, mode transitions, recovery and layout definitions. Real iPhone/Android interaction still needs device testing; visual checks were intentionally skipped.

---

# Motion Controller Website

The only controller transport is WebRTC DataChannel. Scan Unity's HTTPS QR link, tap Enable Motion, then Calibrate. No manual IP/port/token fields remain. The static app stays on GitHub Pages; the existing public WSS service is used only for session/SDP/ICE signaling.

`config.js` contains only the public signaling URL. `lan-transport.js` receives expiring ICE configuration from authenticated signaling, configures STUN and TURN UDP/TCP/TLS candidates, and performs host-owned negotiation/recovery. Neither the permanent Cloudflare API token nor static TURN passwords belong here. See the separate signaling repository's **TURN_SETUP.md** for Render configuration and deployment instructions.

Deploy backend changes first, then all changed PWA files. The service-worker version is `motion-controller-shell-v7-controller-modes`; close old tabs/installed-app instances and reopen to update. It caches only static assets, never tickets, credentials or sensor frames. Offline app opening does not provide offline signaling.

Normal ICE policy is `all`, permitting direct or TURN paths. A backend-authorized diagnostic session may use relay-only or direct-only, selected by Unity's development setting. The phone needs no configuration. Connection diagnostics report the selected candidate pair, protocol/relay protocol, ICE RTT and state/error timestamps. Unity separately reports application heartbeat RTT. Neither is a measured one-way motion latency.

The QR fragment holds a temporary session capability and is removed from the visible URL after parsing. Tickets/configuration stay in memory. Brief network interruptions preserve identity/calibration; full reload or terminal session expiration requires a new scan. Keep the phone awake and browser visible for sensors. Browser suspension can outlast recovery.

Run `npm test` (no dependency installation needed) for sensor math, permission/hold behavior, ICE configuration, selected-path diagnostics and recovery unit tests. Test real iPhone Safari and Android Chrome plus relay-only separately after deployment. There is no microphone/camera requirement for the DataChannel; motion access still requires HTTPS and an iOS user gesture.

## Bowling update (0.3.0)

The controller includes a large **HOLD BALL** touch button and original alpha/beta/gamma values in its packets. Recalibrate after updating. WebRTC preserves this input behavior.

Connect, enable motion, hold the phone screen-up with its top pointing down the lane (Wii-style grip), and calibrate. Aim with **alpha** while Unity is **Ready**. Hold the button through your swing and lift your finger while acceleration is forward and **beta is increasing**. A press locks aim. Relative gamma wrist roll controls hook, not aim. The button itself never launches based on a threshold. Faster valid angular swings produce faster balls; holding longer does not charge power. Wait for the desktop to reset before another press.

The button sends reusable `primary` transitions (`pressed`, `released`, `canceled`) with `buttonSequence` and a phone `eventTimestamp`. Press/release also attach the most recent sensor snapshot. Pointer capture preserves the hold if your finger slides off the button; only the original finger can release it. Browser cancellation, screen rotation, recalibration, hiding the page or connection failure cancel without throwing. Scrolling/selection are suppressed while holding. Keep holding the phone securely; lift only your finger from the on-screen button.

Local Held/Released text reports touch state. The Unity panel reports whether the throw was accepted and whether the ball is Ready/Holding/Rolling/Resetting. Unity now selects the controller screen and pause state; individual turn/roll readiness remains displayed on the desktop. Gyroscope availability is required to calculate bowling power; orientation alone still works for the cube. See the Unity project's `Documentation/BOWLING_SETUP.md` and `CONTROLLER_BUTTON_PROTOCOL.md` for tuning and the protocol extension.

These files belong at the root of **git@github.com:JJohnJones/Motion-Controller-Website.git**, separate from the Unity game repository.

A minimal static PWA with no framework, build step or runtime npm dependency. LAN pairing uses the separate signaling backend described above. Sensor behavior is implemented in `controller.js`, with LAN delivery in `lan-transport.js`; `motion-math.js` only converts browser orientation angles to a right-handed quaternion. Unity owns screen-coordinate conversion, calibration, smoothing and motion history. No absolute position estimation is performed.

## LAN recovery diagnostics

Deploy matching signaling and temporary ICE configuration support before these PWA changes. No endpoint changes are needed. The service-worker shell version is bumped; close old controller tabs and reopen once after deploying.

Open the PWA with `?debug=1` before the QR fragment, then expand **Developer diagnostics** outside gameplay for timestamped PC connection, ICE connection/gathering, SDP signaling, channel open/close/error and signaling WebSocket transitions. ICE candidate errors include the browser error code/text. The panel also reports the last incoming heartbeat and outgoing pong on the phone clock. Browser console lines start with `[LAN controller]`; secrets and SDP are omitted.

The host alone creates offers. The phone answers numbered revisions and requests host recovery rather than creating competing offers. `reset: true` replaces only the peer/channel, retaining the ticket and controller ID. Socket resume uses the same in-memory ticket; a full page reload does not retain it. Signaling retries after 1, 2, 4, 8, then 10 seconds and never closes a healthy DataChannel solely because signaling is offline.

Transient disconnects wait 8 seconds before requesting a restart. Failed ICE/channel errors request one immediately; requests are rate-limited to once per 5 seconds. A 12-second receive gap starts recovery. Recovery has a 60-second budget; repeated events do not extend it. A received heartbeat restores the phone UI, while Unity independently requires a fresh successful round trip before accepting gameplay input. A held gesture is canceled across recovery; start a new hold after reconnecting.

Keep the page foregrounded for continuous motion. iOS/Android can suspend background timers, sensors and networking; connection preservation cannot prevent OS suspension. `pagehide` with BFCache persistence retains the connection; explicit navigation/close sends best-effort leave. If the OS kills the page without an unload event, the host observes timeout rather than a provable browser-close reason.
