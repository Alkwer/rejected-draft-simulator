import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildCombatParityMap,
  renderCombatParityMapMarkdown,
  writeCombatParityMapDocument,
} from "../src/combat-parity-map.js";

const syntheticReferenceMarkdown = `# Combat Engine Reference

## Version

- Main asset: main-TestHash.js
- Store asset: game-store-TestHash.js

## Damage Resolution

Notes:
- Order visible in this bundle: Inspiration, Surrealism, min/max roll, Execute, Crit, Glancing Blow, Golden Luck, Dodge, Parry, Block, Armor and ArmorPen, Absorb, Electrocute, Frailty, Brittle, Varnish, Counter.

\`\`\`js
Va=(t,s,e,n,a,r,o,i,c)=>{const q=i.Electrocute||0;const B=i.Frailty||0;const ee=i.Brittle||0;const Ye=Zt(U,n,s.varnish||new l(0),i.VarnishTriggers||0);return{newHp:Ye.newHp}}
\`\`\`

## Attack Resolution

Notes:
- Order visible in this bundle: Remedy, Hinder, BananaPeel, Hypnotize, MultiStrike, HotPotato branch, repeated direct hits, on-hit harmful statuses, self buffs, EnergyWave, Bleed self-damage, Curse reflection, Lifesteal.

\`\`\`js
pt=(t,s,e,n,a,r,o,i,c,f,u)=>{const $=t.remedy||new l(0);const de=f.Hinder||0;const ye=f.BananaPeel||0;const se=f.Hypnotize||0;if(se>0){j=t;re=r;b=a;oe=I}const _=t.multiStrikeChance||new l(0);let G=1;const ge=f.HotPotato||0;for(let H=0;H<G;H++){const I=Va(t,j,b,re,o,h,oe,v,x,d,m)}const At=f.Bleed||0;const P=f.Curse||0;h=Y(h,"curse",mt,O);const me=t.lifesteal||new l(0)}
\`\`\`
`;

const simulatorSources = [
  {
    path: "src/combat.js",
    source: `
      function performAttack() {
        applyRemedy();
        shouldSkipTurn();
        let hotPotatoPassStacks = applyHotPotatoBeforeAttack();
        const hitCount = rollMultistrikeHitCount();
        for (let index = 0; index < hitCount; index += 1) {
          let damage = applyDefensiveMitigation();
          const electrocute = defenderStatuses.Electrocute ?? 0;
          const waveDamage = energyWaveDamage();
          applyReactiveDamage();
          applyStatuses();
          applySelfBuffs();
        }
        const lifesteal = stat(attacker, "lifesteal");
        const bleedStacks = attackerStatuses.Bleed ?? 0;
      }
      function applyDefensiveMitigation() {
        const frailty = defenderStatuses.Frailty ?? 0;
        const brittle = defenderStatuses.Brittle ?? 0;
        const curse = defenderStatuses.Curse ?? 0;
        trace.curse = curse;
      }
      function applyDamageToSide() {
        const triggersBefore = statuses.VarnishTriggers ?? 0;
        const chance = stat(combatant, "varnish") - triggersBefore;
        statuses.VarnishTriggers = triggersBefore + 1;
        const restorePercent = Math.max(0, 50 - (statuses.VarnishTriggers - 1));
      }
    `,
  },
  {
    path: "src/combat/statuses.js",
    source: `
      const STATUS_CAPS = {
        Haste: 1000,
        Inspiration: 100,
        Leap: 1000,
        EnergyWave: 1000,
        BlackFlame: 99,
        Hinder: 1000,
        Hypnotize: 1000,
        BananaPeel: 1000,
      };
      export function shouldSkipTurn() {
        if ((statuses.Hypnotize ?? 0) > 0) {
          delete statuses.Hypnotize;
          return { skipped: true, reason: "Hypnotize", damage: stat(attacker, "attack") };
        }
      }
    `,
  },
];

test("buildCombatParityMap classifies current combat parity gaps", () => {
  const map = buildCombatParityMap({
    referenceMarkdown: syntheticReferenceMarkdown,
    simulatorSources,
    generatedAt: "2026-05-23T12:00:00.000Z",
  });
  const byId = Object.fromEntries(map.checks.map((check) => [check.id, check]));

  assert.equal(map.version.mainAsset, "main-TestHash.js");
  assert.equal(byId["status-caps"].status, "matched");
  assert.equal(byId["remedy-turn-order"].status, "matched");
  assert.equal(byId["electrocute-frailty-brittle-order"].status, "gap");
  assert.equal(byId["curse-reflection"].status, "gap");
  assert.equal(byId["hot-potato-multistrike-order"].status, "gap");
  assert.equal(byId["hypnotize-self-attack"].status, "gap");
  assert.equal(byId["energy-wave-turn-effect"].status, "gap");
  assert.equal(byId["lifesteal-turn-order"].status, "gap");
  assert.equal(byId["varnish-survival"].status, "matched");
  assert.equal(byId["counter-delayed-effect"].status, "gap");
});

test("renderCombatParityMapMarkdown includes summary and concrete next actions", () => {
  const map = buildCombatParityMap({
    referenceMarkdown: syntheticReferenceMarkdown,
    simulatorSources,
    generatedAt: "2026-05-23T12:00:00.000Z",
  });

  const markdown = renderCombatParityMapMarkdown(map);

  assert.match(markdown, /# Combat Engine Parity Map/);
  assert.match(markdown, /Matched: 3/);
  assert.match(markdown, /Gaps: 7/);
  assert.match(markdown, /Curse reflection/);
  assert.match(markdown, /Move Curse out of direct-hit mitigation/);
});

test("buildCombatParityMap marks delayed Counter effects as matched", () => {
  const delayedCounterSources = simulatorSources.map((source) => source.path === "src/combat.js"
    ? {
      ...source,
      source: `${source.source}
        const COUNTER_DELAY_SECONDS = 0.2;
        function performAttack() {
          combat.pendingEffects.push({ type: "counter", time: combat.time + COUNTER_DELAY_SECONDS });
          recordMechanic(combat, { type: "counter_scheduled" });
        }
        function processPendingEffect() {
          performCounterEffect();
        }
        function performCounterEffect() {
          baseAttackDamage();
          applyOffensiveMultipliers();
          resolveEvasion();
          applyDefensiveMitigation();
          applyDamageToSide();
        }`,
    }
    : source);

  const map = buildCombatParityMap({
    referenceMarkdown: syntheticReferenceMarkdown,
    simulatorSources: delayedCounterSources,
    generatedAt: "2026-05-23T12:00:00.000Z",
  });
  const counter = map.checks.find((check) => check.id === "counter-delayed-effect");

  assert.equal(counter.status, "matched");
  assert.match(counter.simulatorEvidence, /pending effect queue/);
});

test("buildCombatParityMap marks Energy Wave matched when only the tick model remains", () => {
  const tickOnlySources = simulatorSources.map((source) => source.path === "src/combat.js"
    ? {
      ...source,
      source: `${source.source.replace("const waveDamage = energyWaveDamage();", "")}
        function applyEnergyWaveTick() {}`,
    }
    : source);

  const map = buildCombatParityMap({
    referenceMarkdown: syntheticReferenceMarkdown,
    simulatorSources: tickOnlySources,
    generatedAt: "2026-05-23T12:00:00.000Z",
  });
  const energyWave = map.checks.find((check) => check.id === "energy-wave-turn-effect");

  assert.equal(energyWave.status, "matched");
  assert.match(energyWave.simulatorEvidence, /tick model/);
  assert.match(energyWave.nextAction, /tick cadence/);
});

test("buildCombatParityMap detects electrocute ordering after status variable renames", () => {
  const renamedSources = simulatorSources.map((source) => source.path === "src/combat.js"
    ? {
      ...source,
      source: source.source
        .replace("const electrocute = defenderStatuses.Electrocute ?? 0;", "const electrocute = targetStatuses.Electrocute ?? 0;"),
    }
    : source);

  const map = buildCombatParityMap({
    referenceMarkdown: syntheticReferenceMarkdown,
    simulatorSources: renamedSources,
    generatedAt: "2026-05-23T12:00:00.000Z",
  });
  const electrocute = map.checks.find((check) => check.id === "electrocute-frailty-brittle-order");

  assert.equal(electrocute.status, "gap");
});

test("writeCombatParityMapDocument writes parity markdown from local files", async (t) => {
  const dir = path.join(process.cwd(), "tmp", `combat-parity-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const docsDir = path.join(dir, "docs");
  const srcDir = path.join(dir, "src", "combat");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "combat-engine-reference.md"), syntheticReferenceMarkdown);
  fs.writeFileSync(path.join(dir, "src", "combat.js"), simulatorSources[0].source);
  fs.writeFileSync(path.join(srcDir, "statuses.js"), simulatorSources[1].source);

  const result = await writeCombatParityMapDocument({
    referencePath: path.join(docsDir, "combat-engine-reference.md"),
    simulatorPaths: [
      path.join(dir, "src", "combat.js"),
      path.join(srcDir, "statuses.js"),
    ],
    outputPath: path.join(docsDir, "combat-engine-parity-map.md"),
    now: () => "2026-05-23T12:00:00.000Z",
  });

  const markdown = fs.readFileSync(result.outputPath, "utf8");
  assert.equal(result.map.checks.length > 0, true);
  assert.match(markdown, /# Combat Engine Parity Map/);
  assert.match(markdown, /Hot Potato vs Multistrike order/);
});
