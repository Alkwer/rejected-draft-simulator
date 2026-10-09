# Rejected Draft Simulator

Monte Carlo simulator for Rejected Draft combat checks.

This is a local approximation of the combat engine. It is useful for comparing builds and target difficulty, but it is not a byte-for-byte clone of the game.

## Requirements

- Node.js 20 or newer.

## Examples

Run the local web UI on Windows by double-clicking:

```text
Start Simulator.cmd
```

The launcher starts the local server and opens the browser automatically. Keep the console window open while using the UI.

Or run it manually:

```powershell
npm.cmd run dev
```

To open the browser automatically from the command line:

```powershell
npm.cmd run dev:open
```

Open the printed local URL, usually `http://127.0.0.1:5173`. The UI accepts a pasted save export or a `.txt` save file, supports active-run checkboxes for assumed pre-target victories, target selection, result panels, build comparison, local history and one-click local bundle import.

## Game Companion Overlay

For a read-only integration with the live game page, install the Tampermonkey script:

```text
companion/rejected-draft-companion.user.js
```

Start the local simulator first, then open `https://kuzzigames.com/rejected_draft/`. The overlay reads `localStorage["unnamed-battler-save"]`, sends it to the local endpoint `/api/companion/analyze`, and shows a short recommendation directly on the game page.

Enable `Combat Logging` in the game options before collecting parity data. After a fight, `Capture fight fixture` sends the current save, read-only combat-log candidates, and a short in-memory save history to `/api/companion/fight-fixture`. The local simulator builds a downloadable JSON fixture and immediately compares it with the deterministic fight trace used by `--fight-fixture`. If no observed fight is found, the downloaded fixture includes `captureDiagnostics` so the missing source can be inspected.

The companion is intentionally read-only: it does not write to game storage, does not click game buttons and does not mutate the save.

List Masterpiece ids:

```powershell
npm.cmd run simulate -- --list-targets --rarity masterpiece
```

Simulate Duct-Taped Banana from a save:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target duct_taped_banana --trials 10000 --seed duct-test
```

Short target aliases are accepted: `duct`, `rose`, `mobius`, `tp`.

Inspect a save without running combat:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --inspect-save --target duct_taped_banana
npm.cmd run simulate -- --save latest --inspect-save
```

Simulate Rose Window:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target rose_window --trials 10000 --seed rose-test
```

Stats source defaults to `auto`; omitted `--trials` also defaults to `auto`. Override either one when needed:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target duct_taped_banana --stats playerStats
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target duct_taped_banana --stats battleStats
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target duct_taped_banana --stats runStats
npm.cmd run simulate -- --save latest --target duct --trials auto
```

JSON output:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target rose_window --json
```

Apply rewards from sketches before the target:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target duct_taped_banana --apply "hyena_hulk,varmint_vanguard,franklyn" --boosted "franklyn"
```

Simulate a whole pre-target route with tools:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target duct_taped_banana --route "vinchy,mariline" --boosted "vinchy" --erase duct_taped_banana --trials 5000
```

Compare route options for the same target:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target rose_window --compare-routes "empty:~farm:vinchy,mariline~burst:franklyn,vinchy" --trials 5000
```

`~` is the recommended separator on Windows because `|` can be treated as a shell pipe by batch commands. Direct `node src/cli.js` usage still accepts `|`.

Route mode can also simulate pivot/swap, meditation, Secret Stash and upgrade purchases:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target mobius_strip --route "vinchy,mariline" --swap "mariline:replacement_id" --meditate replacement_id --meditation-stats "armor,regen" --meditation-zone gold --buy-upgrades --buy-upgrade-ids upgrade_secret_burn_damage_graphite
```

Plan Targeted Redraw settings for a Masterpiece:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target duct_taped_banana --plan-redraw --redraw-minimums 38/15/7/1 --redraw-candidates "38/15/7/1~39/18/10/0~32/11/11/0" --trials 5000
```

Estimate Find New Sketches mode:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target duct_taped_banana --plan-redraw --find-new-sketches --trials 5000
```

Useful redraw planner options:

- `--redraw-minimums 38/15/7/1` means Rough/Framed/Opus/Masterpiece minimums.
- `--redraw-candidates "target:38/15/7/1~farm:39/18/10/0"` compares settings.
- `--guaranteed <ids>` forces guaranteed sketch ids into the estimate.
- `--unscrambled <ids>` models Unscrambled Guarantee.
- `--include-star-masterpieces` includes `(*)` Masterpieces with a very low default weight.
- `--find-new-sketches` is separate from Targeted Redraw minimums. `--search-new` is kept as an alias for this mode.

Get build advice for a target from the current save:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target duct_taped_banana --build-advice
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target mobius_strip --recommend
```

Build advisor output includes target-specific stat priorities, biggest build problems, guarantee/booster/eraser/meditation suggestions, active-run finish/hide/avoid lists, and best next rewards. It currently has dedicated profiles for Duct-Taped Banana, Rose Window, Mobius Strip and Transcendent Paragon.

Generate a broader strategic plan:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target duct_taped_banana --strategy-plan --goal-q 1e230 --goal-currency "Photon=1e230" --softcap-seconds 600 --booster-candidates "old:franklyn,vinchy~new:new_tone,mariline" --trials 500 --export json
```

`--strategy-plan` combines target readiness, missing Q/currency, wait-vs-redraw at softcap, farm plan, Opus currency-vs-stat value, run EV over `--farm-seconds`, economy planning, booster set comparison by route simulation, Masterpiece keep/redraw and finish-run/redraw decisions. Use `--goal-q`, `--goal-currency`, `--softcap-seconds`, `--farm-seconds`, `--booster-candidates`, `--masterpiece-targets` and `--strategy-trials` to make the assumptions explicit.

The strategy output also includes an economy section: shop upgrade ROI, buy-now vs delay recommendations, softcap wait EV, generator income split by currency, Secret Stash EV, Photon/Gold Leaf forecasts, wasted rewards and current currency bottlenecks.

Explain target mechanics and thresholds without running Monte Carlo:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target rose_window --explain
```

Export a combat report:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target duct_taped_banana --trials 10000 --markdown
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target duct_taped_banana --trials 10000 --export json
```

Compare route/build plans in one table:

```powershell
npm.cmd run simulate -- --save "C:\path\to\save.txt" --target rose_window --compare "empty:~farm:vinchy,mariline~burst:franklyn,vinchy" --trials 5000
```

Check patch data and calibration:

```powershell
npm.cmd run update-data
npm.cmd run update-data -- --check
npm.cmd run simulate -- --patch-sanity
npm.cmd run simulate -- --save "C:\path\to\save.txt" --calibrate --target mobius_strip --trials 1000
npm.cmd run simulate -- --save "C:\path\to\save.txt" --calibrate --combat-log "C:\path\to\combat-log.json" --export json
```

`npm run update-data` downloads the current Rejected Draft page, finds the current `main-*.js` and `artistLinks-*.js` assets, refreshes `data/artistLinks.js`, and updates local metadata/version history. If the game page is unavailable, it falls back to the last local data unless `--no-offline` is passed.

`--calibrate` imports `combatLog` from the save when available, can also include an external JSON/base64 log file, compares observed outcomes to simulated outcomes, reports deviations, and suggests status tick / Thorns-Counter / duration tuning multipliers. Current tested saves have `combatLog: []` with combat logging disabled, so calibration reports that no real fight samples are available instead of inventing evidence.

Quality and performance checks:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run benchmark -- --trials 1000
npm.cmd run benchmark -- --trials 1000 --json
```

`npm run lint` syntax-checks JavaScript files in `src`, `test` and `web`. `npm run benchmark` runs a fixed combat benchmark and reports simulations per second so engine changes can be compared.

Current-run convenience commands:

```powershell
npm.cmd run simulate -- --save latest --remaining --trials 200
npm.cmd run simulate -- --save latest --current-run --trials auto
npm.cmd run simulate -- --save latest --recommend --target mobius --trials 500
```

`--remaining` lists unbeaten visible sketches in the active run with win chance, CI, p90 fight time and likely problem. `--current-run` adds a one-line decision on top of that list. `--recommend` now prints one concrete action such as `fight_target`, `finish_first`, `farm_current_run` or `redraw`; use `--build-advice` when you want the longer stat/tool advice report.

## Current Scope

Implemented:

- Save export decoding.
- Sketch data parsing from the current game bundle.
- Monte Carlo fight simulation.
- Optional pre-target reward application with `--apply` and `--boosted`.
- Dodge, parry, crit, golden luck, glancing blow, execute, varnish, armor, block, absorb, regen, lifesteal, remedy, leap, vulnerability and immunities.
- Bleed, burn, burnDamage, poison, black flame, electrocute, plague, irradiate, hot potato, balloon, curse, brittle, frailty, freeze, hinder, slow, banana peel and hypnotize.
- Haste, inspiration, multi strike, energy wave, thorns, counter, parry damage and surrealism.
- Damage breakdowns by source: direct, status, reflect, parry, self and energy wave.
- Timeout diagnoses for common walls: regen, armor, absorb, opacity/remedy and leap/status blocking.
- Save inspection with `--inspect-save`: recommended stat source, player-vs-battle stat differences, active run sketches, target, hidden/defeated/remaining groups, auto tools, meditation buffs, reward progress and stale data warnings.
- Route simulation with `--route`: ordered sketch rewards, reward decay, Beyond Max Victories, Reward Booster including retroactive rewards, Precise Eraser, Sketch Swapper/Pivot, meditation, Secret Stash hidden upgrades, currency multipliers, passive generator income and stat upgrade purchases.
- Route comparison with `--compare-routes` for checking "what if I beat X/Y/Z before target?" decisions.
- Targeted Redraw planner with `--plan-redraw`: rarity minimum estimates, target Masterpiece hit rate, Paragon weighting, Unscrambled Guarantee, `(*)` Masterpiece low-weight handling, settings recommendations and keep/redraw current-run decisions.
- Find New Sketches planner with `--find-new-sketches`: separate estimate for finding any unseen Rough+ sketch within the mode's redraw limit.
- Build advisor with `--build-advice`: target-specific priorities, build bottlenecks, tool suggestions and active-run reward recommendations for Duct, Rose, Mobius and Transcendent Paragon.
- Strategic planner with `--strategy-plan`: target resource gaps, softcap/redraw advice, goal farm planning, Opus value ranking, run EV, economy planning, booster route comparisons and keep/redraw decisions for Masterpiece rolls and active Opus runs.
- Combat reports: 95% win-rate confidence interval, p10/p90 fight times, timeout rate, victory/failure breakdowns, target interactions, stat thresholds, `--explain`, `--compare`, JSON and Markdown report export.
- Calibration tools: `--calibrate` combat-log import/comparison, deviation reports, tuning suggestions, known regression scenarios and versioned patch sanity checks for Duct/Rose/Mobius.
- CLI convenience: target aliases, `--save latest`, `--trials auto`, `--current-run`, `--remaining`, concrete `--recommend` decisions and compact number formatting.
- Local web UI with `npm run dev`: paste/file save input, active sketch assumptions, target dropdown, result panel, build comparison, local simulation history and one-click local bundle import.
- Automatic game data refresh with `npm run update-data`: fetches current game assets, updates `data/artistLinks.js`, records `main-*.js` patch metadata, checks for stale local assets and keeps an offline fallback.
- Quality tooling: combat helpers split into small modules, fixture saves/snapshots, CLI regression tests, `npm run lint` and `npm run benchmark`.

Known approximations:

- Some game mechanics are still approximate until enough real combat-log samples are available. The calibration layer now reports missing logs and suggests tuning only from observed samples.
- Route mode simulates a declared plan. It does not yet choose the optimal route automatically.
- Redraw planning is a Monte Carlo estimate. Exact game redraw weights are still inferred from observed mechanics and local bundle parsing.
- Build advisor is heuristic. Use route simulation or combat simulation to verify close calls.

For build comparison, run the same target with the same save and different stat source or edited save snapshots.

## License

The original simulator code is available under the [MIT License](LICENSE).
Game data and source excerpts from Rejected Draft are excluded from that license;
see [Third-party notices](THIRD_PARTY_NOTICES.md) for their provenance and scope.
