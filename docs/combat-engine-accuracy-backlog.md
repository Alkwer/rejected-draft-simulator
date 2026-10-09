# Combat Engine Accuracy Backlog

Priority 26 is a parity backlog for moving the simulator closer to the current game combat engine. The current slice starts with observability, because every later mechanic fix needs a way to compare one simulated fight against the game step by step.

## Current Game Data

- Source: https://kuzzigames.com/rejected_draft/
- Captured: 2026-05-23
- Main asset: `main-B8xwsW5G.js`
- Sketch data asset: `data-sketches-BTox30FG.js`
- Store asset: `game-store-fxPIKm8H.js`
- Save version: `52`
- Reference extraction: `docs/combat-engine-reference.md`
- Simulator parity map: `docs/combat-engine-parity-map.md`

## Started Slice

- Added status-state delta tracing per fight event.
- Added optional ordered RNG tracing for one fight.
- Added RNG decision metadata for percent rolls, range rolls and status stack rolls.
- Added mechanic trace entries for Leap blocking, Remedy clears, Balloon pops and Hot Potato branch/pass transitions.
- Added defensive mechanic trace entries for dodge, parry, block, armor and absorb.
- Added offensive mechanic trace entries for base damage roll, Inspiration, execute, crit, glancing blow and golden luck.
- Added damage modifier trace entries for Curse, Frailty, Brittle and Electrocute, including before/after damage values.
- Added post-hit trace entries for Energy Wave on-hit damage, Brittle stack growth and lifesteal healing.
- Added survival/reactive trace entries for Varnish restores, Counter damage and Thorns damage.
- Added post-hit status mutation trace entries for Exacerbate, Resonance and Purge.
- Added tick trace entries for regen, freeze damage, Energy Wave periodic ticks and status growth.
- Added per-hit `damageEvents` trace entries with requested/applied/overkill damage, side/source and source tags for direct modifiers, periodic status damage and reflected damage.
- Added Markdown/CLI trace formatting for `damageEvents` so direct/status/reflected damage applications are visible outside raw JSON.
- Added Markdown/CLI before/after rendering for regen and status growth mechanics so tick traces show the starting value, delta and final value.
- Added a generated combat reference document from the current minified `game-store-fxPIKm8H.js` bundle, covering status caps, Varnish survival, direct damage resolution and full attack resolution.
- Added a generated combat parity map that compares the extracted game reference against `src/combat.js` and lists current matched mechanics, gaps and mechanics that still need real-fight confirmation.
- Fixed Hypnotize so it redirects into a normal mitigated self-attack path instead of applying raw attack self-damage.
- Fixed Curse so it is end-of-turn reflection after Bleed recoil and before Lifesteal, not a direct-hit damage multiplier.
- Fixed Hot Potato turn order so Multistrike count is rolled before the Hot Potato branch, matching the extracted attack resolver.
- Fixed direct damage modifier order so Electrocute is calculated from post-mitigation damage before Frailty and Brittle are added.
- Fixed Energy Wave so hits grant stacks only; damage is dealt by periodic stack consumption.
- Replaced elapsed-time combat ticks with game-like regen/status tick clocks: regen every 1001ms and status every 1002ms in simulator seconds.
- Fixed Haste and Slow timing scale to 0.1% per stack, matching the bundle attack delay formula.
- Moved Inspiration stack rolls from post-hit self-buffs to the status tick, matching the current `qn` status tick block.
- Replaced immediate Counter damage with a delayed pending effect scheduled 0.2s after the triggering hit, then resolved through the direct damage pipeline.
- Added `--trace-rng` to the CLI so a trace can show random decisions without changing normal simulation output.
- Added a `--fight-fixture` single-fight parity comparator that runs one deterministic simulator trace against an observed fight fixture and compares outcome, duration, final HP, damage breakdown and optional intermediate events.
- Added a read-only companion endpoint and Tampermonkey button for `Capture fight fixture`, which builds a downloadable fixture and runs the same parity comparison from the live game page.
- Added a companion save-history fallback: with `Combat Logging` enabled the endpoint prefers saved combat logs, and without a log it can still infer a basic observed win/loss from recent save deltas.
- Added capture diagnostics to downloaded fixtures and tightened the companion save-history sampler to 250ms plus read-only save-write observation.
- Added focused tests for trace status deltas, RNG output, offensive/defensive mechanic traces, damage modifiers, detailed damage events, Markdown damage event output, post-hit mechanics, survival/reactive mechanics, post-hit status mutations, tick mechanics, combat reference extraction, combat parity map generation, CLI export behavior and single-fight parity fixtures.

This does not claim full combat parity yet. It gives us the instrumentation needed to verify later fixes against real fights.

## How To Use

Run a one-fight trace with RNG decisions:

```powershell
npm.cmd run simulate -- --save C:\path\to\save.txt --target duct --trace-fight --trace-rng --trace-seconds 10 --export json
```

Run a real/observed single-fight parity fixture:

```powershell
npm.cmd run simulate -- --save C:\path\to\save.txt --target duct --fight-fixture C:\path\to\fight-fixture.json --trace-rng --trace-seconds 20 --export markdown
```

From the live game page, install `companion/rejected-draft-companion.user.js`, start the local server, enable `Combat Logging` in game options, finish or attempt a fight, then press `Capture fight fixture`. The companion sends the current save, read-only combat-log candidates and recent in-memory save history to `/api/companion/fight-fixture`, shows the parity result, and exposes a `Download fixture JSON` link.

Minimal fixture shape:

```json
{
  "id": "duct_observed_attempt_001",
  "targetId": "duct_taped_banana",
  "observed": {
    "outcome": "loss",
    "seconds": 37.42,
    "playerHp": 0,
    "enemyHp": 1.28e12,
    "damageBreakdown": {
      "player": { "direct": 9.8e12, "total": 9.8e12 },
      "enemy": { "direct": 2.1e12, "status": 4.5e11, "total": 2.55e12 }
    },
    "events": [
      { "event": "attack", "time": 1.9, "enemyHp": 3.29e12 },
      { "event": "tick", "time": 2.004, "enemyHp": 3.28e12 }
    ]
  }
}
```

If the fixture also contains `player` and `enemy`, those stats override the save/target stats for the parity run. Without those fields, the comparator uses the selected save stats and target data.

Relevant JSON fields:

- `events[].statusDelta.player` and `events[].statusDelta.enemy` show status changes since the previous event.
- `events[].rng[]` lists ordered RNG calls made during that event.
- Each RNG entry has `index`, `label`, and `value`.
- Percent rolls also include `chance`, `threshold`, and `success`.
- Range rolls also include `min`, `max`, and `result`.
- Status stack rolls also include `totalChance`, `guaranteedStacks`, `fractionalChance`, and `stacks`.
- `events[].mechanics[]` lists important combat decisions such as Leap blocking, Remedy clearing, Balloon popping, Hot Potato branch/pass transitions, dodge/parry resolution, block/armor/absorb mitigation, offensive multipliers, direct damage modifiers, post-hit effects, survival rolls, reactive damage, post-hit status mutations and tick mechanics.
- `events[].damageEvents[]` lists each HP-changing damage application with `side`, `source`, `requestedDamage`, `appliedDamage`, `overkillDamage`, HP before/after values and tags such as `direct`, `crit`, `execute`, `frailty`, `brittle`, `electrocute`, `periodic`, `Burn`, `reflected`, `counter`, `thorns` and `overkill`.
- Counter now appears in two trace steps: `counter_scheduled` during the triggering attack, then a later `pending_effect` event with the actual Counter damage.

Markdown traces include `Damage Events`, `Mechanics` and `RNG` columns, limited to the first few entries per event so the table stays readable. Regen and status growth mechanics render as `before +delta ->after` when the trace includes the starting value.

## Known Limitations

- RNG labels are simulator-side labels. The random order is now visible, but still needs to be compared against the current minified bundle.
- The generated parity map now shows no remaining static gaps in the checked attack-resolution items, but this is not the same as full combat parity.
- Combat loop timing now follows the extracted fixed regen/status tick clocks and delayed Counter queue, and the CLI can compare a single observed fight fixture, but actual game log coverage is still needed to prove wall-clock drift and simultaneous-event behavior.
- Mechanic traces do not yet cover every system. Remaining trace gaps should be found from current bundle extraction and real fight comparisons.
- Damage events expose source tags and overkill, but they do not yet allocate exact numeric contribution per modifier when several multipliers stack in one direct hit.

## Next Tasks

1. Capture real observed fight fixtures through the companion with `Combat Logging` enabled for Duct, Rose, Mobius, Abe Linkin, Vinchy, Joan of Art, Kahlo and Transcendent Paragon.
2. Compare fixed tick timestamps, simultaneous attacks and delayed Counter actions against those real fixtures.
3. Compare detailed damage event tags and overkill numbers against real combat logs, then add exact per-modifier contribution accounting if the game exposes it.
4. Extend the parity map beyond the current checked blocks into periodic ticks, Inspiration tick rolls, Energy Wave consumption, Counter/Thorns chains and other delayed effects.
5. Verify enemy-only caps and talent-modified caps, especially Inspiration cap behavior on player vs enemy statuses.
