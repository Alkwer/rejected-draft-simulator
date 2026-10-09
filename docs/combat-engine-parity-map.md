# Combat Engine Parity Map

Generated comparison between the current game combat reference and the local simulator combat engine. This is a Priority 26 working document: matched items are evidence-based, while gaps are implementation targets.

## Version

- Main asset: main-B8xwsW5G.js
- Store asset: game-store-fxPIKm8H.js
- Captured: 2026-05-23
- Generated: 2026-05-24T10:47:19.238Z

## Summary

- Matched: 10
- Gaps: 0
- Partial: 0
- Needs real fight: 0

| Check | Status | Severity | Simulator evidence | Next action |
| --- | --- | --- | --- | --- |
| Status caps | matched | low | STATUS_CAPS contains the visible bundle caps. | Keep caps covered by tests when status handling changes. |
| Remedy and skip-status order | matched | low | `performAttack` calls `applyRemedy` before `shouldSkipTurn`. | Keep order locked with parity tests. |
| Electrocute before Frailty and Brittle | matched | medium | `performAttack` applies Electrocute before `applyDirectStatusDamageModifiers` handles Frailty/Brittle. | Keep the numeric trace fixture that locks this order. |
| Curse reflection | matched | medium | Simulator resolves `curse_reflection` outside direct-hit mitigation. | Verify Curse numbers against a traced real fight. |
| Hot Potato vs Multistrike order | matched | medium | Simulator shows MultiStrike before the Hot Potato branch. | Keep RNG-order coverage for Multistrike and Hot Potato. |
| Hypnotize self attack | matched | medium | Simulator does not use the raw-attack shortcut for Hypnotize. | Keep the mitigated self-attack regression test and add real-fight confirmation when available. |
| Energy Wave turn effect | matched | low | Simulator uses a tick model and no immediate hit damage was detected. | Confirm the exact periodic tick cadence against a real fight fixture. |
| Bleed, Curse and Lifesteal order | matched | medium | Simulator applies Bleed recoil, then Curse reflection, then Lifesteal. | Keep end-of-turn ordering covered by regression tests. |
| Varnish survival | matched | low | `applyDamageToSide` uses `VarnishTriggers` for both chance penalty and restore percent. | Keep Varnish fixtures around lethal direct and status damage. |
| Delayed Counter effect | matched | low | Simulator uses a pending effect queue, `COUNTER_DELAY_SECONDS`, `counter_scheduled` trace entries and `performCounterEffect` through the direct damage pipeline. | Confirm counter timing against a real fight fixture and check chained counter edge cases. |

## Details

### Status caps

- ID: `status-caps`
- Status: matched
- Severity: low
- Confidence: high
- Game reference: The bundle status-cap block defines Haste, EnergyWave, Leap, Inspiration, BlackFlame and skip-status caps.
- Simulator evidence: STATUS_CAPS contains the visible bundle caps.
- Next action: Keep caps covered by tests when status handling changes.

### Remedy and skip-status order

- ID: `remedy-turn-order`
- Status: matched
- Severity: low
- Confidence: high
- Game reference: Attack resolution applies Remedy before Hinder, BananaPeel and Hypnotize can skip or redirect the turn.
- Simulator evidence: `performAttack` calls `applyRemedy` before `shouldSkipTurn`.
- Next action: Keep order locked with parity tests.

### Electrocute before Frailty and Brittle

- ID: `electrocute-frailty-brittle-order`
- Status: matched
- Severity: medium
- Confidence: high
- Game reference: Direct damage resolves Armor/Absorb, then Electrocute, then adds Frailty and Brittle to the direct damage event.
- Simulator evidence: `performAttack` applies Electrocute before `applyDirectStatusDamageModifiers` handles Frailty/Brittle.
- Next action: Keep the numeric trace fixture that locks this order.

### Curse reflection

- ID: `curse-reflection`
- Status: matched
- Severity: medium
- Confidence: high
- Game reference: The bundle applies Curse near the end of the attacker turn as reflection based on attack, after Bleed recoil and before Lifesteal.
- Simulator evidence: Simulator resolves `curse_reflection` outside direct-hit mitigation.
- Next action: Verify Curse numbers against a traced real fight.

### Hot Potato vs Multistrike order

- ID: `hot-potato-multistrike-order`
- Status: matched
- Severity: medium
- Confidence: high
- Game reference: The bundle resolves MultiStrike count before the HotPotato branch, then loops over direct hits.
- Simulator evidence: Simulator shows MultiStrike before the Hot Potato branch.
- Next action: Keep RNG-order coverage for Multistrike and Hot Potato.

### Hypnotize self attack

- ID: `hypnotize-self-attack`
- Status: matched
- Severity: medium
- Confidence: high
- Game reference: Hypnotize redirects the turn into a full self attack path by swapping attacker and defender context, not by applying raw attack once.
- Simulator evidence: Simulator does not use the raw-attack shortcut for Hypnotize.
- Next action: Keep the mitigated self-attack regression test and add real-fight confirmation when available.

### Energy Wave turn effect

- ID: `energy-wave-turn-effect`
- Status: matched
- Severity: low
- Confidence: high
- Game reference: The bundle attack resolver grants EnergyWave stacks during the self-buff phase; damage is emitted by the periodic consumption block, not by the hit resolver.
- Simulator evidence: Simulator uses a tick model and no immediate hit damage was detected.
- Next action: Confirm the exact periodic tick cadence against a real fight fixture.

### Bleed, Curse and Lifesteal order

- ID: `lifesteal-turn-order`
- Status: matched
- Severity: medium
- Confidence: high
- Game reference: The bundle applies Bleed recoil, then Curse reflection, then Lifesteal at the end of the turn.
- Simulator evidence: Simulator applies Bleed recoil, then Curse reflection, then Lifesteal.
- Next action: Keep end-of-turn ordering covered by regression tests.

### Varnish survival

- ID: `varnish-survival`
- Status: matched
- Severity: low
- Confidence: high
- Game reference: Varnish checks chance minus previous triggers and restores max HP times max(0, 50 - previous triggers) percent.
- Simulator evidence: `applyDamageToSide` uses `VarnishTriggers` for both chance penalty and restore percent.
- Next action: Keep Varnish fixtures around lethal direct and status damage.

### Delayed Counter effect

- ID: `counter-delayed-effect`
- Status: matched
- Severity: low
- Confidence: high
- Game reference: The bundle schedules Counter in `pendingCombatEffects` about 200ms after the triggering hit, then resolves it through the direct hit pipeline.
- Simulator evidence: Simulator uses a pending effect queue, `COUNTER_DELAY_SECONDS`, `counter_scheduled` trace entries and `performCounterEffect` through the direct damage pipeline.
- Next action: Confirm counter timing against a real fight fixture and check chained counter edge cases.
- Detail: Counter is now observable as a scheduled attack event followed by a `pending_effect` trace event.
