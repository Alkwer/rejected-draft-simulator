# Combat Engine Parity Map

Static checks against the reference assets listed below. Each match covers its named code path for that edition.

## Version

- Edition: web
- Save version: 52
- Main asset: main-B8xwsW5G.js
- Store asset: game-store-fxPIKm8H.js
- Captured: 2026-05-23
- Generated: 2026-11-26T07:36:03.800Z

## Summary

- Matched: 14
- Gaps: 0
- Partial: 0
- Unverified: 0
- Needs real fight: 0

| Check | Status | Severity | Simulator evidence | Next action |
| --- | --- | --- | --- | --- |
| Base status cap constants | matched | low | STATUS_CAPS contains the base constants used for web player buffs and capped debuffs. | Keep caps covered by tests when status handling changes. |
| Remedy and skip-status order | matched | low | `performAttack` calls `applyRemedy` before `shouldSkipTurn`. | Keep order locked with parity tests. |
| Electrocute before Frailty and Brittle | matched | medium | `performAttack` applies Electrocute before `applyDirectStatusDamageModifiers` handles Frailty/Brittle. | Keep the numeric trace fixture that locks this order. |
| Curse reflection | matched | medium | Simulator resolves `curse_reflection` outside direct-hit mitigation. | Verify Curse numbers against a traced real fight. |
| Hot Potato vs Multistrike order | matched | medium | Simulator shows MultiStrike before the Hot Potato branch. | Keep RNG-order coverage for Multistrike and Hot Potato. |
| Hypnotize self attack | matched | medium | `performAttack` redirects the normal hit path by assigning the attacker as target. | Keep the mitigated self-attack regression test and add real-fight confirmation when available. |
| Energy Wave turn effect | matched | low | Periodic tick damage consumes Energy Wave stacks. The attack path grants self buffs. | Confirm the exact periodic tick cadence against a real fight fixture. |
| Bleed, Curse and Lifesteal order | matched | medium | Simulator applies Bleed recoil, then Curse reflection, then Lifesteal. | Keep end-of-turn ordering covered by regression tests. |
| Varnish survival | matched | low | `applyDamageToSide` uses `VarnishTriggers` for both chance penalty and restore percent. | Keep Varnish fixtures around lethal direct and status damage. |
| Delayed Counter scheduling and attack turn | matched | low | The speed-scaled queue dispatches a flagged attack turn. That turn resolves effects and cannot queue another Counter. | Keep the traced Counter, Multistrike and skip checks. Compare dispatch timing with observed web fights. |
| Periodic tick intervals | matched | medium | The simulator starts and advances the web regen and status deadlines at the extracted intervals. | Compare wall-clock catch-up and simultaneous events with observed web fights. |
| Inspiration tick eligibility and caps | matched | medium | The simulator checks for active status maps and applies separate player and enemy cap rules. | Keep the traced empty-status and cap regression test. |
| Periodic status effect order | matched | medium | Each web tick effect runs for the player and then the enemy before the next effect. | Keep the two-sided trace regression and compare lethal interactions with observed web fights. |
| BananaSlip next attack delay | matched | medium | The delay formula and both attack branches apply and clear BananaSlip. | Keep the traced skip and next attack timestamps covered. |

## Details

### Base status cap constants

- ID: `status-caps`
- Status: matched
- Severity: low
- Confidence: high
- Game reference: The bundle status-cap block defines Haste, EnergyWave, Leap, Inspiration, BlackFlame and skip-status caps.
- Simulator evidence: STATUS_CAPS contains the base constants used for web player buffs and capped debuffs.
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
- Simulator evidence: `performAttack` redirects the normal hit path by assigning the attacker as target.
- Next action: Keep the mitigated self-attack regression test and add real-fight confirmation when available.

### Energy Wave turn effect

- ID: `energy-wave-turn-effect`
- Status: matched
- Severity: low
- Confidence: high
- Game reference: The bundle attack resolver grants EnergyWave stacks during the self-buff phase; damage is emitted by the periodic consumption block, not by the hit resolver.
- Simulator evidence: Periodic tick damage consumes Energy Wave stacks. The attack path grants self buffs.
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

### Delayed Counter scheduling and attack turn

- ID: `counter-delayed-effect`
- Status: matched
- Severity: low
- Confidence: high
- Game reference: The bundle queues Counter 200ms divided by combat speed after the triggering attack and runs the attack resolver with its Counter flag.
- Simulator evidence: The speed-scaled queue dispatches a flagged attack turn. That turn resolves effects and cannot queue another Counter.
- Next action: Keep the traced Counter, Multistrike and skip checks. Compare dispatch timing with observed web fights.

### Periodic tick intervals

- ID: `periodic-tick-cadence`
- Status: matched
- Severity: medium
- Confidence: high
- Game reference: The bundle uses 1001ms for regen and 1002ms for status ticks, each divided by combat speed.
- Simulator evidence: The simulator starts and advances the web regen and status deadlines at the extracted intervals.
- Next action: Compare wall-clock catch-up and simultaneous events with observed web fights.

### Inspiration tick eligibility and caps

- ID: `inspiration-tick-caps`
- Status: matched
- Severity: medium
- Confidence: high
- Game reference: The web status tick returns when both status maps are empty. It caps player Inspiration at 100 plus the fundamentals bonus and leaves enemy Inspiration uncapped.
- Simulator evidence: The simulator checks for active status maps and applies separate player and enemy cap rules.
- Next action: Keep the traced empty-status and cap regression test.

### Periodic status effect order

- ID: `periodic-status-order`
- Status: matched
- Severity: medium
- Confidence: high
- Game reference: The web status tick processes both sides per effect: Burn, Plague, Poison, BlackFlame, EnergyWave, Inspiration, Balloon and Irradiate.
- Simulator evidence: Each web tick effect runs for the player and then the enemy before the next effect.
- Next action: Keep the two-sided trace regression and compare lethal interactions with observed web fights.

### BananaSlip next attack delay

- ID: `banana-slip-delay`
- Status: matched
- Severity: medium
- Confidence: high
- Game reference: BananaPeel skips a turn. BananaSlip doubles the following attack interval and is cleared when that attack is processed.
- Simulator evidence: The delay formula and both attack branches apply and clear BananaSlip.
- Next action: Keep the traced skip and next attack timestamps covered.
