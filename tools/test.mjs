/* tools/test.mjs — loads the built dist/index.html in jsdom and drives the real
   UI. These assert the rules ARITHMETIC, not that something rendered: the
   degree-of-success scales, the discard at an obstacle boundary, awareness
   ticking at end of round, research caps, and that undo restores exactly.

   Run:  node tools/test.mjs   (after python3 tools/build.py) */
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");

let pass = 0, fail = 0;
function ok(cond, msg) { (cond ? pass++ : fail++); console.log((cond ? "  ✓ " : "  ✗ FAIL ") + msg); }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function has(hay, needle, msg) { ok(String(hay).indexOf(needle) !== -1, `${msg} — expected to find ${JSON.stringify(needle)}`); }
function group(name) { console.log("\n" + name); }

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(e.message));

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  virtualConsole: vc,
  url: "https://example.org/",
  beforeParse(window) {
    window.scrollTo = () => {};
    window.alert = () => {};
    window.confirm = () => true;
    window.prompt = () => null;
  },
});
const w = dom.window;
const d = w.document;
const ev = (expr) => w.eval(expr);

/* Build an encounter straight into the library and return its id. */
function mk(subKey, opts) {
  return ev(`(function(){
    const e = newEncounter(${JSON.stringify(subKey)}, ${JSON.stringify(opts || {})});
    library.encounters.unshift(e); library.activeId = e.id; save(); return e.id;
  })()`);
}
const enc = (id) => ev(`library.encounters.find(e => e.id === ${JSON.stringify(id)})`);
const pools = (id) => enc(id).run.pools;
const run = (id) => enc(id).run;
function scoreAs(id, actor, degree, opts) {
  ev(`score(${JSON.stringify(id)}, ${JSON.stringify(actor)}, ${JSON.stringify(degree)}, ${JSON.stringify(opts || {})})`);
}

/* ============================================================ */
group("Boot");
ok(errors.length === 0, "no script errors while loading" + (errors.length ? ": " + errors[0] : ""));
ok(!/<script[^>]+src=/.test(html), "no external scripts — the file is self-contained");
ok(!/<link[^>]+stylesheet/.test(html), "no external stylesheets");
eq(d.querySelectorAll("nav.tabs button").length, 3, "three tabs");
eq(ev("SUBSYSTEM_ORDER.length"), 5, "five subsystems in the picker");

/* ============================================================ */
group("Chase — the group's points, and the ones that don't carry");
{
  const id = mk("chase", { preset: "medium", partySize: 4 });
  eq(enc(id).def.obstacles.length, 8, "a medium chase is 8 obstacles");
  eq(ev("SUBSYSTEMS.chase.presets.map(p => p.obstacles)"), [6, 8, 10], "short/medium/long are 6/8/10");

  /* GM Core's rule of thumb, straight off the declared rule. */
  eq(ev("suggestedCost(SUBSYSTEMS.chase.obstacleCost, 4, 0)"), 3, "a party of 4: half the obstacles need 3 CP");
  eq(ev("suggestedCost(SUBSYSTEMS.chase.obstacleCost, 4, 1)"), 2, "…and half need 2 CP");
  eq(ev("suggestedCost(SUBSYSTEMS.chase.obstacleCost, 2, 1)"), 1, "a party of 2 floors at 1 CP, never 0");

  ev(`library.encounters.find(e=>e.id===${JSON.stringify(id)}).def.obstacles[0].cost = 5`);
  scoreAs(id, "Mari", "success");
  eq(pools(id).cp, 1, "a success is +1 Chase Point");
  scoreAs(id, "Sable", "critSuccess");
  eq(pools(id).cp, 3, "a critical success is +2");
  scoreAs(id, "Mari", "failure");
  eq(pools(id).cp, 3, "a plain failure costs nothing");
  scoreAs(id, "Sable", "critFailure");
  eq(pools(id).cp, 2, "a critical failure is −1");

  ev(`extra(${JSON.stringify(id)}, "cantAct")`);
  eq(pools(id).cp, 1, "a PC who couldn't act costs the group 1 CP");

  /* Floor at zero. */
  scoreAs(id, "Mari", "critFailure");
  scoreAs(id, "Mari", "critFailure");
  eq(pools(id).cp, 0, "the group's total never falls below 0");
}
{
  const id = mk("chase", { preset: "short", partySize: 4 });
  ev(`library.encounters.find(e=>e.id===${JSON.stringify(id)}).def.obstacles[0].cost = 3`);
  scoreAs(id, "Mari", "success");           // 1
  eq(pools(id).cp, 1, "one point banked against a 3-point obstacle");
  scoreAs(id, "Sable", "critSuccess");      // 1 + 2 = 3 -> clears
  eq(run(id).obstacleIndex, 1, "reaching the requirement advances to the next obstacle");
  eq(pools(id).cp, 0, "and the excess does NOT carry over");
}

/* ============================================================ */
group("Infiltration — two pools, and the one that moves on its own");
{
  const id = mk("infiltration", { partySize: 4 });
  eq(ev("SUBSYSTEMS.infiltration.scale.failure"), { ap: 1 }, "a failure is 0 IP and 1 Awareness Point");
  eq(ev("SUBSYSTEMS.infiltration.scale.critFailure"), { ap: 2 }, "a critical failure is 2 Awareness Points");

  scoreAs(id, "Mari", "failure");
  eq(pools(id).ip, 0, "a failure earns no Infiltration Points");
  eq(pools(id).ap, 1, "…and hands the opposition one");
  scoreAs(id, "Sable", "critFailure");
  eq(pools(id).ap, 3, "a critical failure hands over two more");

  const before = pools(id).ap;
  ev(`advanceRound(${JSON.stringify(id)})`);
  eq(pools(id).ap, before + 1, "every round that passes adds 1 Awareness Point");
  eq(run(id).round, 2, "and the round counter moves");

  /* Failure threshold = twice the IP the job needs; complications at quarters. */
  const lad = ev(`awarenessLadder(library.encounters.find(e=>e.id===${JSON.stringify(id)}))`);
  eq(ev(`ipGoal(library.encounters.find(e=>e.id===${JSON.stringify(id)}))`), 4, "the default job needs 4 IP");
  eq(lad.fail, 8, "so it fails at 8 AP — twice the goal");
  eq(lad.marks, [2, 4, 6], "with a complication at each quarter");
}
{
  /* Edge Points turn a failure into a success, and cost the opposition nothing. */
  const id = mk("infiltration", {});
  ev(`library.encounters.find(e=>e.id===${JSON.stringify(id)}).run.pools.ep = 1`);
  scoreAs(id, "Mari", "failure", { edge: true });
  eq(pools(id).ip, 1, "spending an Edge Point scores the success line — 1 IP");
  eq(pools(id).ap, 0, "and raises no suspicion at all");
  eq(pools(id).ep, 0, "the Edge Point is spent");
  scoreAs(id, "Mari", "failure", { edge: true });
  eq(pools(id).ip, 1, "with none left, an Edge spend does nothing");
}
{
  /* Individual obstacles are earned per PC; group ones pool. */
  const id = mk("infiltration", {});
  ev(`(function(){ const e = library.encounters.find(x=>x.id===${JSON.stringify(id)});
      e.def.participants = ["Mari","Sable"];
      e.def.obstacles = [ { id:"o1", name:"Guard post", note:"", cost:1, mode:"individual", options:[] } ];
      e.run = freshRun(e); save(); })()`);
  scoreAs(id, "Mari", "success");
  eq(run(id).obstacleIndex, 0, "one PC past an individual obstacle is not the party past it");
  scoreAs(id, "Sable", "success");
  eq(run(id).obstacleIndex, 1, "an individual obstacle clears only when every PC has earned it");
}

/* ============================================================ */
group("Influence — points, and what the party has actually worked out");
{
  const id = mk("influence", { npcName: "Quartermaster Bel" });
  eq(ev("SUBSYSTEMS.influence.scale.critSuccess"), { ip: 2 }, "a critical success is 2 Influence Points");
  eq(ev("SUBSYSTEMS.influence.scale.critFailure"), { ip: -1 }, "a critical failure costs one");

  scoreAs(id, "Mari", "critSuccess");
  eq(pools(id).ip, 2, "two banked");
  scoreAs(id, "Mari", "critFailure");
  eq(pools(id).ip, 1, "and one lost again");

  const r = ev("SUBSYSTEMS.influence.actions.find(a => a.key === 'discover').reveals");
  eq(r.success, 1, "a successful Discover learns one thing");
  eq(r.critSuccess, 2, "a critical Discover learns two");
  eq(r.critFailure, -1, "a critical failure learns something false");

  /* Resistances raise the DC of the approach they name; weaknesses lower it. */
  eq(ev("adjustedDC(18, [{label:'Flattery', dc:3}])"), 21, "a resistance raises the DC by its value");
  eq(ev("adjustedDC(18, [{label:'Honesty', dc:-3}])"), 15, "a weakness lowers it");

  ev(`revealFact(${JSON.stringify(id)}, "resistance", 0)`);
  ev(`revealFact(${JSON.stringify(id)}, "resistance", 0)`);
  eq(run(id).revealed.length, 1, "revealing the same fact twice reveals it once");
}
{
  /* Thresholds fire once, in order. */
  const id = mk("influence", {});
  ev(`(function(){ const e = library.encounters.find(x=>x.id===${JSON.stringify(id)});
      e.def.thresholds = [{at:2,label:"Warms up",effect:""},{at:5,label:"Helps",effect:""}]; save(); })()`);
  scoreAs(id, "Mari", "critSuccess");                 // 2
  eq(run(id).fired.length, 1, "reaching the first threshold fires it");
  scoreAs(id, "Mari", "success");                     // 3
  eq(run(id).fired.length, 1, "staying above it does not fire it again");
  scoreAs(id, "Mari", "critSuccess");                 // 5
  eq(run(id).fired.length, 2, "reaching the second fires the second");
}

/* ============================================================ */
group("Research — sources that run dry");
{
  const id = mk("research", {});
  const cid = enc(id).def.checks[0].id;
  ev(`(function(){ const e = library.encounters.find(x=>x.id===${JSON.stringify(id)});
      e.def.checks[0].cap = 2; save(); })()`);
  scoreAs(id, "Mari", "critSuccess", { checkId: cid });
  eq(pools(id).rp, 2, "a critical success is 2 Research Points");
  eq(run(id).checks[cid], 2, "all of it from that source");
  scoreAs(id, "Mari", "critSuccess", { checkId: cid });
  eq(pools(id).rp, 2, "past its maximum the source gives nothing more");
  eq(run(id).checks[cid], 2, "and its tally stops there");

  ev(`(function(){ const e = library.encounters.find(x=>x.id===${JSON.stringify(id)});
      e.def.checks.push({id:"c2", name:"Another", skill:"Occultism", dc:20, cap:5}); save(); })()`);
  scoreAs(id, "Sable", "success", { checkId: "c2" });
  eq(pools(id).rp, 3, "a fresh source still pays out");
}

/* ============================================================ */
group("Victory Points — the framework underneath");
{
  const scales = ev("GENERATED_VP_SCALES");
  ok(scales.length >= 5, `the VP Scales table came through (${scales.length} rows)`);
  eq(scales.find((s) => /Long encounter/.test(s.duration)).thresholds, [4], "a long encounter has one threshold, at 4");
  eq(scales.find((s) => /Most of a session/.test(s.duration)).thresholds, [5, 10, 15], "most of a session has 5/10/15");

  const acc = mk("custom", { mode: "accumulating" });
  scoreAs(acc, "Party", "critSuccess");
  eq(pools(acc).vp, 2, "accumulating: a critical success is +2");
  scoreAs(acc, "Party", "failure");
  eq(pools(acc).vp, 2, "accumulating: a plain failure costs nothing");

  const dim = mk("custom", { mode: "diminishing" });
  ev(`(function(){ const e = library.encounters.find(x=>x.id===${JSON.stringify(dim)});
      e.def.goal = 5; e.run = freshRun(e); save(); })()`);
  eq(pools(dim).vp, 5, "diminishing: you start at the end point");
  scoreAs(dim, "Party", "success");
  eq(pools(dim).vp, 5, "diminishing: a success loses nothing");
  scoreAs(dim, "Party", "failure");
  eq(pools(dim).vp, 4, "diminishing: a failure loses one");
  scoreAs(dim, "Party", "critFailure");
  eq(pools(dim).vp, 2, "diminishing: a critical failure loses two");
  scoreAs(dim, "Party", "critSuccess");
  eq(pools(dim).vp, 3, "diminishing: a critical success regains one");
}

/* ============================================================ */
group("Undo — including across an obstacle boundary");
{
  const id = mk("chase", { preset: "short", partySize: 4 });
  ev(`library.encounters.find(e=>e.id===${JSON.stringify(id)}).def.obstacles[0].cost = 3`);
  scoreAs(id, "Mari", "success");        // cp 1
  scoreAs(id, "Sable", "critSuccess");   // cp 3 -> clears, cp 0, index 1
  eq([pools(id).cp, run(id).obstacleIndex], [0, 1], "the obstacle cleared and the pool reset");
  ev("undoLast()");
  eq(pools(id).cp, 1, "undo puts the discarded points back");
  eq(run(id).obstacleIndex, 0, "and steps back to the obstacle they were on");
  ev("undoLast()");
  eq(pools(id).cp, 0, "undoing again unwinds the first success too");
  const len = run(id).log.length;
  ev("undoLast()");
  eq(run(id).log.length, len, "undo on an empty log is a no-op, not a crash");
}
{
  /* Awareness is on the same undo stack as everything else. */
  const id = mk("infiltration", {});
  scoreAs(id, "Mari", "critFailure");
  eq(pools(id).ap, 2, "two Awareness Points");
  ev(`advanceRound(${JSON.stringify(id)})`);
  eq(pools(id).ap, 3, "and a third for the round");
  ev("undoLast()");
  eq([pools(id).ap, run(id).round], [2, 1], "undo takes back the round and its Awareness Point");
}

/* ============================================================ */
group("Prep survives the round");
{
  const id = mk("chase", { preset: "medium", partySize: 4 });
  ev(`library.encounters.find(e=>e.id===${JSON.stringify(id)}).def.obstacles[0].name = "Fruit cart"`);
  scoreAs(id, "Mari", "success");
  ev(`resetRun(${JSON.stringify(id)})`);
  eq(pools(id).cp, 0, "reset clears the live pools");
  eq(run(id).log.length, 0, "and the log");
  eq(enc(id).def.obstacles[0].name, "Fruit cart", "but the prep is untouched");
  eq(enc(id).def.obstacles.length, 8, "every obstacle still there");
}
{
  /* An export code carries the prep and none of the run. */
  const id = mk("influence", { npcName: "Quartermaster Bel" });
  scoreAs(id, "Mari", "critSuccess");
  const code = ev(`b64encode(JSON.stringify({t:"pf2e-subsystem", v:1,
    subsystem: "influence", name: "Bel",
    def: library.encounters.find(e=>e.id===${JSON.stringify(id)}).def }))`);
  const okImport = ev(`importEncounter(${JSON.stringify(code)})`);
  ok(okImport === true, "a code imports");
  const fresh = ev("library.encounters[0]");
  eq(fresh.def.npc.name, "Quartermaster Bel", "the NPC came across intact");
  eq(fresh.run.pools.ip, 0, "and the import starts at zero — no dice came with it");
  ok(ev(`importEncounter("not-a-code")`) === false, "junk is refused, not thrown");
}
{
  /* The whole library round-trips through localStorage. */
  ev("save()");
  const before = ev("JSON.stringify(library)");
  ev("load()");
  eq(ev("JSON.stringify(library)"), before, "the library survives a reload");
}

/* ============================================================ */
group("Data integrity — the generated halves line up");
{
  const pages = ev("GENERATED_SUBSYSTEMS.map(p => p.slug)");
  ev("SUBSYSTEM_ORDER").forEach((k) => {
    const slug = ev(`SUBSYSTEMS[${JSON.stringify(k)}].rulesPage`);
    ok(pages.indexOf(slug) !== -1, `${k} points at a rules page that exists (${slug})`);
  });
  ok(ev("GENERATED_SUBSYSTEMS.every(p => p.book && p.pages)"),
    "every page of rules text carries its Paizo citation");

  const obs = ev("GENERATED_CHASE_OBSTACLES");
  ok(obs.length >= 40, `GM Core's sample obstacles came through (${obs.length})`);
  ok(obs.every((o) => o.name && o.level != null && o.options.length > 0),
    "every obstacle has a name, a level and at least one skill+DC");
  ok(obs.every((o) => o.options.every((x) => x.skill && x.dc > 0)),
    "every option parsed to a real skill and DC");
  eq([...new Set(obs.map((o) => o.table))].sort(), ["Underground", "Urban", "Wilderness"],
    "all three terrain tables");

  /* The Influence page is nothing but pointers to these two actions, so a
     reference build without actions/subsystems renders it as bare headings. */
  const slugs = ev(`[...new Set(GENERATED_SUBSYSTEMS.flatMap(s =>
    [...s.html.matchAll(/data-action="([^"]+)"/g)].map(m => m[1])))]`);
  const missing = slugs.filter((s) => !ev(`!!ACTIONS_BY_SLUG[${JSON.stringify(s)}]`));
  eq(missing, [], `all ${slugs.length} actions the rules text points at resolve`);
  has(ev("inlineActions('<span class=\"actref\" data-action=\"influence\">Influence</span>')"),
    "Influence Point", "the Influence action's own text is spliced in where it is named");
}

/* ============================================================ */
group("It renders");
{
  const id = mk("chase", { preset: "medium", partySize: 4 });
  ev(`openEncounter(${JSON.stringify(id)})`);
  ev("go('run')");
  const v = d.getElementById("views").innerHTML;
  has(v, "Round 1", "the run board shows the round");
  has(v, "Chase Points", "and the pool");
  eq(d.querySelectorAll(".pcrow").length, 4, "one row per PC");
  ev("go('prep')");
  has(d.getElementById("views").innerHTML, "Start something", "prep offers a new encounter");
  ev("go('reference')");
  has(d.getElementById("views").innerHTML, "Pathfinder GM Core", "reference cites the book");
  ok(errors.length === 0, "still no script errors after driving every view");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
