# Rejected Draft Simulator Companion

This is a read-only Tampermonkey bridge between the game page and the local simulator.

## Install

1. Install Tampermonkey in Chrome or Edge.
2. Open `companion/rejected-draft-companion.user.js`.
3. Install the script in Tampermonkey.
4. Start the simulator with `npm.cmd run dev` or `Start Simulator.cmd`.
5. Open `https://kuzzigames.com/rejected_draft/`.
6. Use the in-game overlay button: `Analyze current run`.
7. In game options, enable `Combat Logging` for the best real-fight fixtures.
8. After a fight, use `Capture fight fixture` to ask the local simulator to build and compare a single-fight parity fixture.

For the current game build, the most reliable combat-log capture is the visible in-game `Combat Log` modal. Open that modal, select `Live Combat` or the specific previous fight you want to capture, then press `Capture fight fixture` in the companion overlay. If the modal is closed, the companion falls back to saved logs, localStorage candidates, and recent save-history deltas.

## Safety

The script reads `localStorage["unnamed-battler-save"]`, keeps a short in-memory history of recent save snapshots, and reads a small set of read-only localStorage keys whose names look like combat or battle logs. It sends them to local simulator endpoints:

```text
http://127.0.0.1:5173/api/companion/analyze
http://127.0.0.1:5173/api/companion/fight-fixture
```

If the simulator uses another local port, the script tries ports `5173` through `5193`.

`Capture fight fixture` returns an immediate parity result and shows a `Download fixture JSON` link. With `Combat Logging` enabled, the endpoint first uses an explicit browser observation when available, then the visible `Combat Log` modal, then the game's saved combat logs. If no log is present, it falls back to recent save-history deltas so it can still infer a basic win/loss observation. If neither source is available, the fixture still downloads with save/player/target context, `captureDiagnostics`, and a warning explaining that no observed fight was found.

The companion samples save changes every 250ms and observes save writes in memory. It still does not write to game storage.

The script does not write to game storage, does not click game buttons and does not change the save.
