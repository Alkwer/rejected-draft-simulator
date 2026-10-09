# Simulator Improvement Ideas

This file collects development directions for the Rejected Draft simulator. The first priority should be improving combat fidelity against the game, followed by full-run planning and UI work.

## Priority 1: More Accurate Combat Engine

- DONE in combat engine v2: DoT statuses, Remedy, Opacity, Leap, immunities, vulnerability, Thorns, Counter, Parry damage, Glancing Blow, Execute, Varnish, Haste, Slow, Freeze, Hinder, Banana Peel, MinDamage/MaxDamage, Crit, Golden Luck, Inspiration, MultiStrike, Energy Wave and Surrealism.
- DONE: the damage breakdown separates direct, status, reflect, parry, self and energy wave damage.
- DONE: timeout diagnostics cover regen walls, armor walls, absorb walls, opacity/remedy walls and leap/status walls.
- Precise calibration against real combat logs is moved to Priority 7 because it requires comparing observed fights after patches.

## Priority 2: Better Save Reading

- DONE: automatically detects the `auto` stat source: `runStats`, `battleStats` or `playerStats`.
- DONE: shows differences between `playerStats` and `battleStats`.
- DONE: reads active sketches in the run and splits them into defeated, hidden, remaining and target.
- DONE: reads auto-booster, auto-eraser, auto-swapper, boosted/erased/swapped sketches, meditation and active buffs.
- DONE: shows reward progress in the run: collected rewards, run victories and remaining to max victories.
- DONE: detects the save phase: `before_redraw`, `after_redraw`, `in_run`, `cleared_run`.
- DONE: validates sketch data metadata and warns when the data is older than the save.

## Priority 3: Reward and Run Progress Simulation

- DONE: `--route` mode simulates defeating a list of sketches in the provided order.
- DONE: reward decay uses the game formula `1 / (1 + victories * rewardDecay)` and respects Beyond Max Victories.
- DONE: Reward Booster supports positive and negative rewards, retroactive booster and use limits.
- DONE: Precise Eraser lowers target HP without removing rewards from the route.
- DONE: Sketch Swapper/Pivot can replace a sketch in a route and reports uses/limits.
- DONE: meditation supports a chosen sketch, eligible stats, forced or deterministically rolled stats, zone multipliers and cooldown.
- DONE: Secret Stash reports cost/progress and unlocks hidden shop upgrades.
- DONE: routes can buy stat upgrades after gaining currency during the run.
- DONE: currency rewards include reward multipliers, medal multipliers, refinement/resonance/degen multipliers, reward exponent and passive generator income.
- DONE: `--route` answers "what if I defeat X, Y, Z first, then the target?".
- DONE: `--compare-routes` compares routes for the same target.

## Priority 4: Targeted Redraw Planner

- DONE: `--plan-redraw` calculates odds for requested rarity minimums.
- DONE: calculates the chance that a run contains a specific Masterpiece, such as Duct or Rose.
- DONE: accounts for guaranteed sketch IDs, Rough/Framed/Opus/Masterpiece minimums, Paragon weights and Unscrambled Guarantee.
- DONE: models Find New Sketches as a separate mode, not as an add-on to Targeted Redraw; `--search-new` is an alias for that mode.
- DONE: proposes Targeted Redraw settings for a goal, such as `38/15/7/1`, `39/18/10/0`, `32/11/11/0` or custom candidates.
- DONE: evaluates the tradeoff between more Opuses for farming and a higher Masterpiece chance.
- DONE: produces a `keep`, `keep_farm` or `redraw` decision after importing a save.

## Priority 5: Build Advisor

- DONE: `--build-advice` and alias `--recommend` run a heuristic build advisor for the selected target.
- DONE: for `Duct-Taped Banana`, prioritizes Bleed, Leap, sustain, accuracy and anti-banana.
- DONE: for `Rose Window`, prioritizes Freeze, regen/armor breakthrough, remedy/opacity and sustain.
- DONE: for `Mobius Strip`, prioritizes Burn, anti-burn sustain, Leap/Remedy and sustain.
- DONE: for `Transcendent Paragon`, prioritizes armor penetration, execute, sustain and anti-regen/armor.
- DONE: recommends sketches for guarantee, booster, eraser and meditation.
- DONE: recommends active sketches to finish, hide or skip.
- DONE: shows the biggest build problems: damage, armor penetration, sustain, accuracy and target-specific status thresholds.
- DONE: shows the best next rewards in the active run.

## Priority 6: Reports and Explanations

- DONE: the win-rate report shows a 95% confidence interval, for example `62.3% +/- 1.1%`.
- DONE: the report shows average/median fight time, p10/p90 and timeout rate.
- DONE: the loss-cause breakdown covers raw attack, status damage, stall, dodge/accuracy, regen wall and armor wall.
- DONE: the win-cause breakdown covers bleed/status, freeze chain, execute, raw damage and thorns/counter.
- DONE: for a target, the report shows the most important stat thresholds, including maxHp, damagePerSecond, armorPen and target-specific profiles.
- DONE: `--explain` prints the most important target interactions and thresholds.
- DONE: `--compare` is an alias for `--compare-routes` and compares routes/builds in one table with CI, timeout and p90.
- DONE: reports can be exported to JSON (`--json` or `--export json`) and Markdown (`--markdown` or `--export markdown`).

## Priority 7: Accuracy Through Calibration

- DONE: `--calibrate` imports `combatLog` from the save when available; the checked saves currently have empty logs and `combatLoggingEnabled=false`, which the report states explicitly.
- DONE: `--calibrate` compares real log outcomes with a Monte Carlo simulation for the same target/stats.
- DONE: the calibration report logs deviations such as outcome mismatch, duration mismatch and cause mismatch.
- DONE: the report suggests tuning multipliers for status ticks, Thorns/Counter and fight duration based on real samples.
- DONE: added regression tests for save-like Duct/Rose/Mobius edge cases.
- DONE: `--patch-sanity` checks whether Duct/Rose/Mobius have expected stats in the patch data.
- DONE: game data has `v0.874` versioning in `metadata.json`, `game-versions.json` and sanity-check snapshots.

## Priority 8: CLI Convenience

- DONE: target aliases: `duct`, `rose`, `mobius`, `tp`.
- DONE: `--save latest` takes the newest `rejected-draft-save-*.txt` export from Downloads; `--downloads-dir` can point to another folder.
- DONE: `--current-run` automatically simulates remaining visible unbeaten sketches from the active run.
- DONE: `--remaining` shows the list of unbeaten sketches and each one's chance with CI, p90 and main problem.
- DONE: `--recommend` prints a concrete decision: fight target / finish first / farm current run / redraw, plus hide candidates.
- DONE: `--trials auto` increases the number of trials until the win-rate CI is stable or the cap is reached.
- DONE: numbers and stats in the CLI use compact formatting such as `140.26B`, `1.16e228`, `15.32K`.

## Priority 9: Local UI

- DONE: simple web UI launched through `npm run dev`.
- DONE: field for pasting an export string and selecting a `.txt` save file.
- DONE: the active-sketch list has "assume I defeat before target" checkboxes and passes them into the simulation.
- DONE: the target dropdown includes Duct, Rose, Mobius, Transcendent Paragon and the remaining Opus/Masterpiece sketches.
- DONE: the results panel shows win rate, CI, timeout, p90, loss causes, thresholds and recommendations.
- DONE: the build comparison shows Farm vs Duct vs Rose.
- DONE: the recent simulation history is stored locally in the browser.
- DONE: the game-bundle import button refreshes the current local bundle and metadata.

## Priority 10: Automatic Game Data Download

- DONE: `npm run update-data` downloads the current game HTML and detects the `artistLinks-*.js` asset.
- DONE: saves data to `data/artistLinks.js`.
- DONE: saves patch version from `main-*.js`.
- DONE: warns when local data is older than the game page.
- DONE: offline option: if the internet is unavailable, use the last data.

## Priority 11: Tests and Quality

- DONE: the combat engine was split into `combat/damage`, `combat/statuses`, `combat/timing`, `combat/math`, `combat/stats` and `combat/vulnerability`; rewards, save parser and planner were already separate modules.
- DONE: added unit tests for DoT statuses, turn control, self-buffs, Leap/Haste/Slow, Bleed, Curse/Frailty/Brittle, Electrocute, Hypnotize, Balloon and status caps.
- DONE: added Duct/Rose/Mobius data snapshots for `v0.881`, and `--patch-sanity` passes on the current bundle.
- DONE: added CLI tests against the synthetic save in `fixtures/synthetic-save.txt`.
- DONE: added `npm run lint`, which syntax-checks JS files in `src`, `test` and `web`.
- DONE: added `fixtures/` with a small synthetic save and a Duct/Rose/Mobius snapshot.
- DONE: added `npm run benchmark`, which reports simulations per second.

## Priority 12: More Strategic Features

- DONE: estimator for "how much Q/currency is missing for a sensible target attempt" in `--strategy-plan`.
- DONE: estimator for "wait for softcap or redraw" through `--softcap-seconds`.
- DONE: farm planner for a specific goal, such as `1e230` for Photon Overclock, through `--goal-q`, `--goal-currency` and `--farm-seconds`.
- DONE: Opus value analysis for currency vs stat rewards.
- DONE: run EV estimate: expected Q/currency over time.
- DONE: "boost Franklyn/Vinchy or New Tone/Mariline" decision calculated with route simulation through `--booster-candidates`.
- DONE: "is this Masterpiece roll a keep" decision.
- DONE: "finish the run or redraw after seeing active Opuses" decision.

## Priority 13: Better UI Planner

- DONE: changing the target in the dropdown automatically runs a simulation if a save is already loaded.
- DONE: automatic simulation after changing trial count, fight limit, strategy parameters and assumed kill counts has debounce so it does not spam the API.
- DONE: the "Compare all targets" button calculates Duct/Rose/Mobius/Paragon and active Opuses in one view.
- DONE: strategy presets in the UI: `Q farm`, `currency farm`, `Masterpiece approach`, `Paragon approach`, `finish run`.
- DONE: the UI route planner can add several sketches and shows expected final stats, currency and target win rate after each step.
- DONE: the "what changes after selecting this sketch" view shows stat delta, win-rate delta and fight-time delta.
- DONE: quick actions on active sketches: `hide`, `assume 1 kill`, `max reward`, `add to route`, `simulate as target`.
- DONE: the "best next click" panel chooses between fight, farm current run, wait softcap, redraw and approach target.
- DONE: target dropdown search/filter works by name, rarity and reward type.
- DONE: compact mobile mode shows result and active sketches first, while planner/comparisons are hidden in tabs.

## Priority 14: Diagnostics for Wrong or Suspicious Results

- DONE: the "why this result?" panel explains the main win-rate causes: raw attack, status damage, regen wall, armor wall, dodge/accuracy, sustain and thresholds.
- DONE: sanity checks for 0% and 100% results separate real hard walls/dominance from suspicious results.
- DONE: warnings show target-specific mechanics with lower model confidence: status scaling, self-buff scaling, immunities, vulnerability, opacity/remedy and missing patch metadata.
- DONE: the UI has a "simulation vs expected practice result" comparison through `I win`, `I lose` or `timeout/stall`.
- DONE: extreme sketch data values, such as `plagueChance: 9000`, `freezeChance: 60000`, `thornsChance: 6000000000`, show how the model interprets exported enemy chance.
- DONE: debug fight timeline for one sample shows the first seconds of the fight with HP, statuses, actions and main damage.
- DONE: `--trace-fight` exports one deterministic fight to JSON or Markdown; `--trace-seconds` sets the trace window.
- DONE: the confidence badge has high/medium/low levels based on trial count, CI, suspicious 0%/100% and known mechanics.
- DONE: result comparison across model assumptions includes baseline, enemy status chance x1, DoT tick x0.5 and enemy self-buff chance x1.
- DONE: added regression tests for Kahlo/Joan false 0%, Duct false 100% and Vinchy false high/borderline win-rate cases.

## Priority 15: Strategy Profiles

- DONE: added goal profiles: `farm Q`, `farm Photon`, `farm Gold Leaf`, `farm Acrylic`, `3 Masterpiece`, `4 Masterpiece`, `Transcendent Paragon`.
- DONE: each profile has separate reward weights, such as currency-heavy for farming, combat-heavy for a target and Opus-heavy for long farming.
- DONE: added a planner for "average runs/redraws to goal" for the selected profile.
- DONE: added separate guarantee/booster/eraser/meditation recommendations for the selected profile.
- DONE: added `safe farm` mode, which prefers high-win-rate, low-p90 sketches even when EV is slightly lower.
- DONE: added `greedy farm` mode, which takes the highest currency/stat EV without heavily penalizing risk.
- DONE: added `boss approach` mode, which ignores weak currency and prioritizes stats for the chosen target.
- DONE: added `redraw fishing` mode, which evaluates whether a run makes sense for finding a specific Opus/Masterpiece.
- DONE: added "when to stop farming and go for the target" recommendations based on the win-rate curve after subsequent rewards.
- DONE: added side-by-side profile comparison, for example the same save as `farm Q` vs `3 Masterpiece` vs `Paragon approach`.

## Priority 16: Save and Build Snapshot Comparison

Deferred for now at the user's request.

- Add a local save snapshot library in the UI: name, date, Q, game version, active target and description.
- Add a diff of two saves: stats, currency, fundamentals, shop levels, sketch victories and active run.
- Add comparison of two builds on the same targets with a win-rate table and the biggest stat differences.
- Add multi-save import and automatically indicate which save is better for the selected goal.
- Add progress trends: Q/currency/stats over time based on imported save history.
- Add a decision log: what the simulator recommended, what the user chose and what the later save looked like.
- Add save report export to Markdown so it can be pasted into a conversation easily.
- Add save labels such as `farm`, `boss attempt`, `archive`, `before redraw`, `after redraw`.
- Add duplicate-save detection and group versions from the same day/run.
- Add quick UI history undo without mixing it with the real game save.

## Priority 17: More Accurate Game Economy

- DONE: expanded the shop-upgrade model with next-level cost, current currency, affordability, marginal stat effect, score and ROI for the selected profile.
- DONE: added a purchase planner that separates upgrades into buy now, delay until currency, Secret Stash locked and capped groups.
- DONE: added softcap EV with passive Quintessence, passive currency gains and wait-vs-run value.
- DONE: added generator-income EV split by currency with global and currency-specific generator multipliers.
- DONE: added Secret Stash EV with cost, missing Quintessence, unlock status, payback time and material hidden upgrades.
- DONE: added separate Photon and Gold Leaf models with current amount, goal, missing amount, run income, generator income, ETA and runs to goal.
- DONE: added currency-goal forecasting for explicit goals such as `Photon=1e230`, `Gold Leaf=777` and profile-driven special currencies.
- DONE: added a wasted-reward detector for zero/negative rewards and low-marginal reward signals.
- DONE: added a currency-bottleneck detector for goal currencies, blocked shop upgrades and Quintessence goals.
- DONE: added economy regression tests around Secret Stash, softcaps, generator multipliers, shop ROI, wasted rewards and bottlenecks.

## Priority 18: Debugging and Calibration from Manual Observations

Deferred for now at the user's request.

- Add a fight-observation form in the UI: target, result, fight time, main loss cause and subjective note.
- Add manual-observation import from JSON/CSV and connect it to the current save.
- Add `--add-observation`, which appends an observation to the local calibration database.
- Add a "model mismatch" report: the simulator said 80% but the user lost 20 times, so point to likely causes.
- Add ranking of mechanics with the highest uncertainty based on mismatches: status scaling, armor, block, remedy, attack speed, burn/poison/plague.
- Add automatic tuning-multiplier suggestions from manual observations, without overwriting the global model without confirmation.
- Add separate calibration profiles per patch version so observations are not mixed across nerfs/buffs.
- Add experimental flags in the UI/CLI, such as `enemyStatusScale`, `dotScale`, `blockMode`, `remedyMode`.
- Add outlier detection: one unusual fight should not immediately change the model.
- Add a "more data needed" recommendation: how many real attempts are enough to distinguish model error from bad luck.

## Priority 19: UI Polish and Theme Completeness

- DONE: Audit every UI surface for the dark Rejected Draft design system: page background, panels, popups, dropdowns, file inputs, native controls, scrollbars and disabled states.
- DONE: Add explicit dark styles for browser-native surfaces that can ignore normal CSS, especially `select`, `option`, `dialog`, `[popover]`, file inputs and validation messages.
- DONE: Add visual regression screenshots for desktop and mobile so light-background regressions are easy to catch.
- DONE: Add keyboard focus states that match the sketchbook style and remain visible on dark panels.
- DONE: Add consistent tooltip styling for icon-only controls, planner actions and warning badges.
- DONE: Add compact/dense display modes for large active-run lists and comparison tables.
- DONE: Add a theme token checklist so future UI work uses the same paper, ink, panel and accent variables.
- DONE: Add a "UI diagnostics" page or CLI command that lists missing IDs, missing labels, overflow risks and known browser-native styling gaps.

## Priority 20: Sketch Knowledge Base and Mechanics Encyclopedia

- Add a searchable sketch encyclopedia generated from the current game data bundle.
- Show one page per sketch with rarity, rewards, enemy stats, vulnerabilities, statuses, self-buffs, immunities and patch metadata.
- Add aliases and renamed-sketch mapping so old names, new names and shorthand names resolve to the same sketch.
- Add strategy tags such as `currency`, `sustain`, `burn`, `freeze`, `armor wall`, `remedy`, `opacity`, `execute`, `accuracy check` and `boss prep`.
- Add a countermeasure matrix: what stats or rewards are usually needed against each dangerous mechanic.
- Add "why this sketch matters" notes for important Opus and Masterpiece targets.
- Add a patch-history view for key targets so nerfs/buffs are visible without manually comparing bundles.
- Add a glossary for mechanics the game does not explain clearly, such as vulnerability, remedy, opacity, thorns, leap and reward decay.

## Priority 21: What-If Lab and Batch Planner

- Add a batch simulation mode that tests many guarantee, booster, eraser and meditation combinations for the same save.
- Add "best two boosters" search within current booster limits, including Opus/Masterpiece restrictions.
- Add guarantee-minimum grid search for Targeted Redraw, ranking settings by farm EV, target odds and risk.
- Add a meditation planner that compares every eligible meditation target and stat outcome.
- Add sensitivity analysis: how much win rate changes after +10% ATK, +10% HP, +10% armor penetration, +10% status damage or a specific shop upgrade.
- Add "attempt budget" estimates: how many attempts are worth taking before redraw is better.
- Add CSV/Markdown export for batch tables so results can be shared or pasted into chat.
- Add presets for common questions: `farm Q`, `fish Duct`, `fish Rose`, `4th Masterpiece`, `Paragon prep`, `finish current run`.

## Priority 22: Performance, Caching and Determinism

- Cache decoded save data, parsed sketch data and target option lists so UI interactions do not repeat expensive parsing.
- Move long UI simulations into a Web Worker so the page stays responsive during large batch comparisons.
- Add deterministic seed controls in the UI for reproducing surprising simulation results.
- Add parallelized batch execution where it is safe, with a clear cap to avoid freezing the machine.
- Add benchmark thresholds to tests so major slowdowns are caught during development.
- Profile hot simulation paths and optimize the biggest bottlenecks without changing combat behavior.
- Add result caching keyed by save hash, target, assumptions, route, trials, seed and patch version.
- Add cancellation for long-running UI simulations when the user changes the target or save.

## Priority 23: Confidence, Risk and Decision Quality

- Add a decision-confidence score separate from win rate, based on CI width, known uncertain mechanics, patch freshness, timeout rate and route assumptions.
- Add "bad luck vs likely model issue" math for streaks, such as losing many times against a reported 48% target.
- Add clear risk labels: `safe`, `reasonable`, `greedy`, `coin flip`, `model uncertain`, `do not trust yet`.
- Add recommendations based on risk appetite, not only expected value.
- Add a "minimum evidence" indicator showing when the trial count is too low for a confident recommendation.
- Add side-by-side explanations for why two strategies with similar win rate can have very different risk.
- Add stop rules such as "after N failed attempts, farm X first" or "after one timeout, redraw".
- Add a conservative fallback recommendation when mechanics have low model confidence.

## Priority 24: Patch Diff and Data Freshness Tools

- Store previous game-data bundles locally so the simulator can compare the current patch with older patches.
- Add a patch diff report for sketch stat changes, reward changes, rarity changes and renamed sketches.
- Highlight material target changes, for example Duct/Rose/Mobius/Paragon nerfs or buffs.
- Add automatic warnings when a save is newer than the local game-data bundle.
- Add generated patch-sanity snapshots for important targets instead of maintaining only a small hand-picked set.
- Add a "changed mechanics" section when exported fields appear, disappear or change scale.
- Add a UI badge showing whether the current recommendation is based on fresh, stale or unknown patch data.
- Add a safe rollback option to simulate against the previous data bundle for comparison.

## Priority 25: Packaging and Local App Experience

- Turn the UI launcher into a cleaner one-click experience, such as a desktop shortcut or small `.exe` wrapper.
- Add a local launcher status window that shows the server URL, selected port, logs and restart button.
- Add automatic port selection with a clear message when the default port is already busy.
- Add a "copy diagnostics" button that collects app version, data version, last error and environment details.
- Add portable packaging instructions so the simulator can be moved without breaking paths.
- Add safe local backups before updating game data or replacing generated files.
- Add a lightweight update check for simulator files and game-data freshness.
- Add a troubleshooting page for common local app issues: blocked port, stale data, browser cache, missing Node and Windows permissions.

## Priority 26: Combat Engine Accuracy Backlog

These are the remaining engine-parity points to investigate, implement and test against the current game bundle. The goal is not only a higher win-rate accuracy, but also better explanations when the model is uncertain.

Started on 2026-05-23 with the observability slice: status deltas, ordered RNG trace output, RNG decision metadata, status stack roll metadata, mechanic trace entries, defensive pipeline trace entries, offensive pipeline trace entries, direct damage modifier trace entries, detailed damage event trace entries, Markdown damage event output, Markdown regen/status before-after output, post-hit mechanic trace entries, survival/reactive mechanic trace entries, post-hit status mutation trace entries, tick mechanic trace entries, generated combat reference extraction from the current game bundle, generated combat parity mapping against the simulator, current patch metadata refresh, single-fight parity fixture comparison, live companion fight-fixture capture, delayed Counter pending-effect resolution, and parity fixes for Hypnotize, Curse, Hot Potato order, Electrocute/Frailty/Brittle order, Energy Wave immediate damage, fixed regen/status tick cadence, Haste/Slow stack scaling and Inspiration tick timing. Details: `docs/combat-engine-accuracy-backlog.md` and `docs/combat-engine-parity-map.md`.

### Current Parity Map Findings

- Matched so far: all currently checked static attack-resolution items, including status caps, Remedy before skip-status checks, Hypnotize self-attack, Curse reflection, Hot Potato after Multistrike, Electrocute before Frailty/Brittle, Energy Wave as tick-only damage, Bleed/Curse/Lifesteal order, Varnish trigger/restore math and delayed Counter scheduling.
- Confirmed static gaps in the current parity map: none.
- Needs real-fight confirmation: none in the current static parity map; the simulator now has a `--fight-fixture` comparator, but it still needs real captured game fixtures for full timing and RNG-order parity.

### Core Battle Loop and Timing

- Reconstruct the exact combat loop from the current minified game bundle into a readable reference document.
- DONE: replace elapsed-time status growth approximations with fixed regen/status ticks from the bundle: regen every 1001ms, status every 1002ms.
- Confirm real-fight drift for fixed game ticks vs simulator timestamps under long fights and browser throttling.
- Model simultaneous attack timing exactly when both sides are ready on the same timestamp.
- Verify whether skipped turns from Freeze, Hinder, Banana Peel and Hypnotize consume the full attack delay or reschedule differently.
- DONE: align Haste and Slow attack-delay scaling to 0.1% per stack.
- Verify attack-speed clamps against game behavior for extreme values.
- DONE for Counter: add a pending-effect queue for delayed Counter instead of resolving it immediately inside one attack.
- Add broader event-queue support for other delayed or chained actions if the bundle exposes more pending effect types.
- Track current fight time with the same rounding/step behavior as the game to reduce long-fight drift.
- Add tests for very fast attack speed, very slow attack speed and simultaneous attack edge cases.

### RNG Order and Monte Carlo Fidelity

- Document the exact random-roll order used by the game for one attack.
- Align simulator RNG order for crit, glancing blow, dodge, parry, block, status application, Leap blocking, Balloon pop and self-buffs.
- Split RNG streams or trace RNG calls so a fight can explain why a result happened.
- DONE: add a deterministic "single fight parity" test fixture comparator with expected intermediate event support, not only final win/loss.
- DONE: add a debug mode that prints every RNG decision in order for one fight.
- Add confidence penalties when a target depends on mechanics whose RNG order is not yet proven.

### Damage Pipeline

- Verify exact order of direct damage modifiers: Inspiration, min/max roll, execute, crit, golden luck, block, armor, absorb, Electrocute, Frailty, Brittle and vulnerabilities.
- Confirm whether Electrocute amplifies pre-mitigation or post-mitigation damage in every case.
- Confirm whether Frailty multiplies base hit damage only or total damage after other modifiers.
- Confirm Brittle growth order: after direct damage only, after Electrocute, after Energy Wave, or after all hit damage.
- Model glancing blow exactly, including whether it cancels crit or reduces crit damage.
- Verify Surrealism behavior for block, armor, absorb, dodge, parry, counter and status blocking.
- Add separate breakdown sources for direct, crit, execute, electrocute, frailty, brittle and overkill instead of merging too much into direct damage.
- Add regression tests for armor wall, absorb wall, execute threshold and high-crit fights.

### Status Application and Status Damage

- Verify every status application formula against the current game code, especially exported enemy chance scaling above 100.
- Confirm whether vulnerability affects status application, status damage, both, or only selected mechanics per target.
- Replace generic vulnerability mapping with bundle-derived per-sketch/per-stat effect metadata if possible.
- Verify Leap blocking order for all debuffs, including multistrike and Surrealism cases.
- Confirm Opacity behavior: whether it reduces every debuff, only incoming enemy debuffs, or selected statuses.
- Verify Immunity keys for every status and mechanic, including cases where the game checks the chance key vs the status name.
- Add a status-state diff trace that shows previous stacks, added stacks, blocked stacks and final stacks for every event.
- Add exact caps for every status, including caps modified by talents or fundamentals.
- Add tests for high-stack status application, fractional chance, guaranteed stacks and status caps.

### Remedy, Cleanse and Status Removal

- Keep Remedy weighted chunk clearing covered by tests, but verify edge cases with one status, very high stacks and fractional Remedy.
- Confirm whether Remedy can clear auxiliary fields such as `BurnDamage` proportionally or only when Burn reaches zero.
- Verify whether Remedy runs before every attack, before skipped-turn checks, after skipped-turn checks, or on a separate tick.
- Model any other cleanse/removal tools or enemy mechanics that remove statuses outside Remedy.
- Add trace output for Remedy: clear budget, selected statuses, removed stacks and remaining stacks.

### Hot Potato

- Verify all Hot Potato branches and thresholds against the current patch.
- Confirm exact explosion damage source, vulnerability key and whether armor/absorb can reduce it.
- Confirm pass behavior when the holder misses, is frozen, is hindered, slips, gets hypnotized or dies before landing a hit.
- Confirm whether Hot Potato can be blocked by Leap or Opacity when it is passed.
- Add tests for every Hot Potato branch: +1, +5, +10, x2, x3, x4, explode and pass.
- Add trace labels for Hot Potato branch and holder transitions.

### Balloon

- Verify Balloon pop timing: after every successful hit, after status application, after multistrike hit, or after the whole attack.
- Confirm Balloon growth timing and whether growth happens once per fixed tick or scales with elapsed time.
- Confirm Balloon pop damage source, vulnerability key and whether armor/absorb can reduce it.
- Confirm behavior when Balloon grows and pops in the same second or same attack.
- Add tests for Balloon growth, pop, no-pop, multistrike pop and vulnerability scaling.

### Plague, Poison, Burn, Black Flame and Irradiate

- Confirm Plague growth timing, isolation interaction and whether growth happens if the target dies from the tick.
- Confirm Poison damage uses max HP in all cases and whether vulnerability can modify damage only.
- Confirm Burn damage ownership: current attacker burnDamage, original applier burnDamage, stored per-stack damage, or target-side field.
- Improve Burn so partial Remedy clearing reduces stored BurnDamage proportionally if the game does that.
- Confirm Black Flame uses current HP, max HP or remaining HP after prior same-tick statuses.
- Confirm Irradiate damage formula for vulnerable vs non-vulnerable targets and exact growth chance.
- DONE from bundle extraction: status tick order is Burn, Plague, Poison, Black Flame, Energy Wave, Inspiration, Balloon, Irradiate.
- Verify the same status tick order against a real logged fight.
- Add separate tests for every periodic status with current HP and stack-growth assertions.

### Energy Wave, Inspiration, Haste, Leap and Thorns

- DONE: Energy Wave hits grant stacks only; periodic status ticks consume `max(1, floor(stacks * 0.1))` and deal attack-based damage.
- DONE: Inspiration rolls on the status tick, not as an on-hit self-buff.
- Confirm whether Inspiration applies to counters and self-damage exactly like direct hits.
- Confirm Haste and Slow affect the next already-scheduled attack or only future scheduling.
- Confirm Leap stack caps and talent bonuses.
- Verify Thorns damage timing and whether it can apply secondary statuses as in the game bundle.
- Confirm whether self-buffs roll once per successful hit, once per attack, or differently for enemy sketches.
- Add tests for self-buff caps, multistrike self-buffs and Energy Wave consumption.

### Counter, Parry, Thorns and Reflected Damage

- DONE: replace immediate Counter damage with a delayed pending-effect Counter scheduled 0.2s after the triggering hit.
- DONE from bundle extraction and simulator trace: delayed Counter uses the direct damage pipeline for roll, crit, evasion, mitigation, direct modifiers and Varnish.
- Confirm Parry damage order and vulnerability key.
- Confirm whether reflected damage can trigger lifesteal, thorns, counter, varnish or death effects.
- Add separate breakdown sources for counter, parry and thorns so deaths are explained correctly.
- Add tests for counter chains, parry kills and thorns kills.

### Healing, Lifesteal, Regen and Varnish

- Verify Regen tick cadence and whether it happens before or after status damage.
- Verify Lifesteal source: direct damage only, status damage, Energy Wave, counter, parry, or all outgoing damage.
- Confirm healing caps and whether over-healing is discarded exactly like the game.
- Verify Varnish trigger order for direct damage, status damage, Hot Potato, Balloon, reflected damage and simultaneous lethal damage.
- Add trace output for healing sources and Varnish triggers.
- Add tests for lifesteal sustain, regen wall, varnish survival and repeated Varnish triggers.

### Enemy Exported Stats and Save Parsing

- Audit every stat name from the game bundle against simulator stat aliases.
- Confirm player `battleStats`, `playerStats`, active meditation buffs, shop levels, glossary multipliers and fundamentals are all applied in the same order as the game.
- Confirm enemy exported chance values above 100 are scaled only where appropriate, not globally.
- Detect renamed sketches and stale IDs automatically from the current data bundle.
- Add parser warnings when a save contains unknown stats, unknown statuses, unknown sketch fields or new mechanics.
- Add a bundle-derived schema snapshot test so new game fields are visible after each patch.

### Tool, Reward and Route Interaction With Combat

- Confirm route simulation applies kills, max victories, reward decay, boosters, erasers and meditation in the same order as the game.
- Verify Precise Eraser eligibility from talents and rarity restrictions, especially Opus/Masterpiece rules.
- Verify booster restrictions and whether boosted rewards affect already-earned route rewards or only future rewards.
- Confirm meditation stat selection, duration, cooldown and active buff application.
- Verify active-run kill counts in checked sketches, not only beaten/unbeaten state.
- Add combat re-simulation after each route step with exact stat deltas in the trace.

### Patch Parity and Automated Extraction

- Build a small extractor that converts the minified game combat functions into readable snapshots or structured mechanic tables.
- Store patch-specific mechanic snapshots next to data snapshots.
- Add a patch diff for mechanics, not only sketch stats and rewards.
- Warn when the combat bundle changed in functions that touch damage, statuses, RNG or save parsing.
- Generate tests from extracted constants such as status caps, Hot Potato branch thresholds and tick formulas.
- Add a manual review checklist after every patch import: changed stats, changed mechanics, changed save version and changed target snapshots.

### Calibration Against Real Fights

- Add a local observation database for real fight attempts: save hash, target, result, duration, observed main cause and notes.
- DONE for companion overlay: add a read-only `Capture fight fixture` flow that builds a downloadable fixture and immediately compares it with the simulator parity trace.
- Add a UI form for "simulator predicted X, real result was Y" when no real log is available.
- Compare real attempt streaks against simulated probability and label likely bad luck vs likely model mismatch.
- Fit conservative calibration multipliers per patch version without silently changing the base model.
- Keep separate calibration profiles for Duct, Rose, Mobius, Paragon and generic fights.
- Add a report ranking which mechanics most likely caused a mismatch for one target.

### Trace, Debugging and Explainability

- Expand fight traces with per-event fields: RNG roll, threshold, status deltas, damage before/after mitigation, healing and scheduler changes.
- Add a "why I died" chain that shows the last important events before death or timeout.
- Add a timeout trace summary for regen wall, armor wall, status wall, accuracy wall and sustain wall.
- Add per-mechanic confidence tags in the trace: exact, approximate, unverified or calibrated.
- Add an exportable Markdown trace that is short enough to paste into chat but detailed enough to debug.
- Add a side-by-side trace comparison for two assumptions or two builds.

### Performance Without Losing Accuracy

- Profile the new status tick and event queue paths before optimizing them.
- Add a fast mode and an accuracy mode, with clear UI labels and different mechanic coverage if needed.
- Cache normalized combatants and parsed stat maps between trials.
- Avoid repeated object allocation in hot loops after engine parity stabilizes.
- Add benchmark fixtures for simple direct fights, status-heavy fights, long regen walls and batch planner runs.
- Add a performance regression threshold for simulations per second.

### Testing Standards for Engine Work

- Every mechanic change needs a failing regression test before implementation.
- Every mechanic with current-game constants needs at least one test generated from the current bundle.
- Add fixture fights for Duct, Rose, Mobius, Abe Linkin, Vinchy, Joan of Art, Kahlo and Transcendent Paragon.
- Add tests for suspicious historical cases: false 0%, false 48%, false 100% and long practical losses.
- Add tests that compare CLI, UI API and route planner results for the same save and target.
- Keep old patch fixtures so changes do not accidentally erase knowledge of previous patch behavior.

### Open Research Questions

- Does the game run status ticks exactly once per second, per animation frame, or per combat update?
- Does the game use one shared RNG stream or separate random calls hidden in UI/logging code?
- Which vulnerabilities are source-specific, target-specific or mechanic-specific?
- Are enemy sketch chances exported as percentages, percent times 100, or mixed depending on stat?
- Does partial Burn cleansing reduce future Burn damage proportionally?
- Can delayed Counter, Hot Potato pass, Balloon pop, Thorns and Varnish create ordering differences that change wins?
- Which mechanics are affected by Isolation, Opacity, Leap, Surrealism and immunities in the current patch?
- What minimum real observation sample is needed before tuning a target-specific calibration profile?

## Best Work Order

1. Refine the combat engine: Leap, Lifesteal, Remedy, Opacity, Freeze, Bleed, Burn, Banana Peel, Execute.
2. Add `--current-run` so it automatically analyzes remaining active sketches.
3. Add route simulation with rewards and boosters.
4. Add build advisor for Duct/Rose/Mobius.
5. Add automatic current game-data download.
6. Build the web UI after that.

## Notes

The most practical value will not come from a perfect win-rate percentage, but from comparisons:

- build A vs build B,
- Duct target vs Rose target,
- finish New Tone now or redraw,
- booster Franklyn/Vinchy vs New Tone/Vinchy,
- whether the current roll makes sense for the 3rd or 4th Masterpiece.

Therefore every new mechanic should have a test and at least one CLI example showing how it changes the strategic decision.
