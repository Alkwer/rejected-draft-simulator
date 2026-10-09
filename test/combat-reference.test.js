import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  extractCombatReference,
  renderCombatReferenceMarkdown,
  writeCombatReferenceDocument,
} from "../src/combat-reference.js";

const syntheticStoreSource = `
  const Fa={Haste:1e3,Inspiration:100,Leap:1e3,EnergyWave:1e3},Ha={hasteChance:"Haste"};
  const Zt=(t,s,e,n)=>{if(t.lte(0)&&e.minus(n).gt(Math.random()*100)){const r=Math.max(0,50-n);return{newHp:s.times(r/100),varnishTriggered:!0}}return{newHp:t,varnishTriggered:!1}},
  Va=(t,s,e,n,a,r,o,i,c,f=!1,u=!0)=>{let y=a;if((t.critChance||new l(0)).gt(Math.random()*100)){y=y.times(2)}if((s.dodge||new l(0)).gt(Math.random()*100)){return{isHit:!1}}const b=s.armor||new l(0);y=l.max(0,y.minus(b));const q=i.Electrocute||0;let Z=new l(0);q>0&&(Z=y.times(q/100).times(Math.random()));const B=i.Frailty||0;const ee=i.Brittle||0;let U=e.minus(y).minus(Z);const Ye=Zt(U,n,s.varnish||new l(0),i.VarnishTriggers||0);return{newHp:Ye.newHp,isHit:!0,varnishTriggered:Ye.varnishTriggered}},
  pt=(t,s,e,n,a,r,o,i,c,f,u,d=!1,m=!0)=>{let h=i,p=[],g=a,y=e,S=f,k=u;const $=t.remedy||new l(0);if($.gt(0)){Math.random()*100}const de=f.Hinder||0;if(de>0){Math.random()}const ye=f.BananaPeel||0;if(ye>0){Math.random()}const se=f.Hypnotize||0;if(se>0){Math.random()}const _=t.multiStrikeChance||new l(0);let G=1;if(_.gt(0)){Math.random()}const wt=t.hotPotatoChance||new l(0),ge=f.HotPotato||0;if(ge>0){const H=Math.random();if(H<.95){}else{delete S.HotPotato}}for(let H=0;H<G;H++){const I=Va(t,s,e,n,a,h,c,u,f,d,m);y=I.newHp}return{newDefenderHp:y,newAttackerHp:g,damageEvents:h,logEvents:p,newAttackerStatuses:S,newDefenderStatuses:k}},
  qn=(t,s,e,n=!0)=>{const X=s.statuses.player.EnergyWave||0;if(X>0){const _=Math.max(1,Math.floor(X*.1)),G=s.statuses.player.Inspiration||0}const $=t.playerStats.inspirationChance||new l(0);if($.gt(0)){Math.random()*100}const ye=s.statuses.player.Balloon||0;if(ye>0){Math.ceil(ye*.25)}},
  Qn=(t,s,e,n,a,r=!0)=>{const u=s.statuses.player.Freeze||0;if(n.gt(0)){if(u>100){}else{const p=1-u*.01}}else if(u>0){}};
  ({consolidateCombatTick:(e,n=!0)=>{const y=qt(a),S=1001/y,k=1002/y;if(e-o.lastRegenTick>=S){}if(e-o.lastStatusTick>=k){}},startTrainingDummy:()=>{}});`;

test("extractCombatReference names current minified combat blocks", () => {
  const reference = extractCombatReference({
    metadata: {
      gameVersion: "main-TestHash.js",
      saveVersion: 52,
      mainAsset: "main-TestHash.js",
      storeAsset: "game-store-TestHash.js",
      capturedAt: "2026-05-23",
    },
    sources: [
      { name: "game-store-TestHash.js", kind: "store", source: syntheticStoreSource },
    ],
  });

  assert.equal(reference.version.mainAsset, "main-TestHash.js");
  assert.ok(reference.sections.find((section) => section.id === "status-caps"));
  assert.ok(reference.sections.find((section) => section.id === "varnish-survival"));

  const damage = reference.sections.find((section) => section.id === "damage-resolution");
  assert.ok(damage);
  assert.equal(damage.minifiedName, "Va");
  assert.match(damage.snippet, /Electrocute/);
  assert.match(damage.notes.join("\n"), /crit/i);

  const attack = reference.sections.find((section) => section.id === "attack-resolution");
  assert.ok(attack);
  assert.equal(attack.minifiedName, "pt");
  assert.match(attack.snippet, /HotPotato/);
  assert.match(attack.notes.join("\n"), /Remedy/);

  const statusTick = reference.sections.find((section) => section.id === "status-tick");
  assert.ok(statusTick);
  assert.equal(statusTick.minifiedName, "qn");
  assert.match(statusTick.notes.join("\n"), /EnergyWave consumes/);

  const combatLoop = reference.sections.find((section) => section.id === "combat-loop");
  assert.ok(combatLoop);
  assert.match(combatLoop.snippet, /1001/);
});

test("renderCombatReferenceMarkdown produces a compact reference document", () => {
  const reference = {
    version: {
      gameVersion: "main-TestHash.js",
      saveVersion: 52,
      mainAsset: "main-TestHash.js",
      storeAsset: "game-store-TestHash.js",
      capturedAt: "2026-05-23",
    },
    generatedAt: "2026-05-23T12:00:00.000Z",
    sections: [
      {
        id: "damage-resolution",
        title: "Damage Resolution",
        sourceName: "game-store-TestHash.js",
        minifiedName: "Va",
        confidence: "high",
        notes: ["Resolves direct hit damage."],
        snippet: "Va=(t,s)=>{return t+s}",
      },
    ],
    missing: [],
  };

  const markdown = renderCombatReferenceMarkdown(reference);

  assert.match(markdown, /# Combat Engine Reference/);
  assert.match(markdown, /main-TestHash\.js/);
  assert.match(markdown, /## Damage Resolution/);
  assert.match(markdown, /Minified symbol: `Va`/);
  assert.match(markdown, /```js\nVa=/);
});

test("writeCombatReferenceDocument writes a reference markdown file from local assets", async (t) => {
  const dir = path.join(process.cwd(), "tmp", `combat-reference-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const assetDir = path.join(dir, "assets");
  const docsDir = path.join(dir, "docs");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(assetDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, "game-store-TestHash.js"), syntheticStoreSource);
  fs.writeFileSync(path.join(dir, "metadata.json"), `${JSON.stringify({
    gameVersion: "main-TestHash.js",
    saveVersion: 52,
    mainAsset: "main-TestHash.js",
    storeAsset: "game-store-TestHash.js",
    capturedAt: "2026-05-23",
  }, null, 2)}\n`);

  const result = await writeCombatReferenceDocument({
    metadataPath: path.join(dir, "metadata.json"),
    assetDir,
    outputPath: path.join(docsDir, "combat-engine-reference.md"),
    fetchImpl: null,
    now: () => "2026-05-23T12:00:00.000Z",
  });

  const markdown = fs.readFileSync(result.outputPath, "utf8");
  assert.match(markdown, /# Combat Engine Reference/);
  assert.match(markdown, /Damage Resolution/);
  assert.deepEqual(result.sourceNames, ["game-store-TestHash.js"]);
});
