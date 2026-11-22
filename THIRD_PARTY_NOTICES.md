# Third-party notices

The MIT license in `LICENSE` applies to the original code and documentation
authored for Rejected Draft Simulator. It does not relicense third-party game
content included in or referenced by this repository.

## Rejected Draft

The full game is distributed through [Steam](https://store.steampowered.com/app/4574820/Rejected_Draft/). The legacy browser edition is available on the [developer's site](https://kuzzigames.com/rejected_draft/).

The following materials derive from the game:

- `data/steam-catalog.json` contains normalized sketch statistics, rewards and the installed Steam build metadata.
- `src/combat/steam-universes.js` contains game-derived universe modifiers and stat groups.
- `data/artistLinks.js`: downloaded game data, including sketch records, text,
  artist references, and links.
- `fixtures/sketch-snapshots.json`: selected game-data snapshots used by tests.
- `docs/combat-engine-reference.md`: extracted game source-code excerpts and
  their recorded asset identifiers.
- Any game-derived excerpts or records within test fixtures and reference
  documentation.

The Steam catalog includes its capture date, Steam app/build IDs and renderer asset names. Legacy web asset URLs and capture metadata are recorded in `data/metadata.json`, `data/game-versions.json` and the generated reference document.

Rights in these materials remain with their respective rights holders. This
repository does not establish an upstream license for them or grant additional
permissions to reuse them. The simulator's MIT license does not apply to those
materials, the original game, or third-party artwork and branding.
