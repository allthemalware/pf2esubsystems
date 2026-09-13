/* ============================================================
   src/engine.js — data-driven runner for the GM Core subsystems.

   One Victory Point core (apply deltas, clamp, log, fire thresholds, advance
   the round) with three structural layers on top of it: a sequence of
   obstacles, a single open pool, or a set of capped research checks. Which
   layer a subsystem uses, and what its numbers are, is declared in
   content.js — nothing below hard-codes a subsystem's arithmetic.
   ============================================================ */

const KEY = "pf2eSubsystems.v1";
const LOG_CAP = 200;

let library = null;

/* ============================================================
   SMALL HELPERS
   ============================================================ */
const byId = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64decode(str) { return decodeURIComponent(escape(atob(str))); }

function toast(msg) {
  const t = byId("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 1800);
}
function titleCase(s) {
  return String(s || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function plural(n, one, many) { return n === 1 ? one : (many || one + "s"); }

/* ============================================================
   PERSISTENCE
   ============================================================ */
function blankLibrary() {
  return { v: 1, settings: { themeMode: "auto", custom: null }, encounters: [], activeId: null };
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    library = raw ? JSON.parse(raw) : blankLibrary();
  } catch (e) {
    library = blankLibrary();
  }
  if (!library || typeof library !== "object") library = blankLibrary();
  library.settings = library.settings || { themeMode: "auto", custom: null };
  library.encounters = Array.isArray(library.encounters) ? library.encounters : [];
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(library));
  } catch (e) {
    toast("Couldn't save — this browser's storage is full or blocked.");
  }
}

/* ============================================================
   THEME
   ============================================================ */
function applyTheme() {
  const s = library.settings;
  let mode = s.themeMode || "auto";
  if (mode !== "light" && mode !== "dark") {
    mode = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }
  document.documentElement.dataset.theme = mode;
  if (s.custom && s.custom.accent) {
    document.documentElement.style.setProperty("--accent", s.custom.accent);
  } else {
    document.documentElement.style.removeProperty("--accent");
  }
}
function setThemeMode(m) { library.settings.themeMode = m; save(); applyTheme(); renderMenu(); }
function setAccent(v) {
  library.settings.custom = library.settings.custom || {};
  library.settings.custom.accent = v;
  save(); applyTheme();
}
function resetTheme() { library.settings.custom = null; save(); applyTheme(); renderMenu(); }

/* ============================================================
   GENERATED DATA LOOKUPS
   ============================================================ */
const SUB_PAGES = {};
(GENERATED_SUBSYSTEMS || []).forEach((p) => { SUB_PAGES[p.slug] = p; });

const ACTIONS_BY_SLUG = {};
(typeof GENERATED_ACTIONS !== "undefined" ? GENERATED_ACTIONS : []).forEach((a) => {
  ACTIONS_BY_SLUG[a.slug] = a;
});
const CONDITIONS = typeof GENERATED_CONDITIONS !== "undefined" ? GENERATED_CONDITIONS : [];
const ACTIONS = typeof GENERATED_ACTIONS !== "undefined" ? GENERATED_ACTIONS : [];

/* ============================================================
   THE ENCOUNTER MODEL

   `def` is the prep: what you build before the session and what an export
   code carries. `run` is the live state: pools, round, progress, log.
   Keeping them apart is what lets "Reset run" hand you the same prepped
   chase back, and what keeps a shared code free of last week's dice.
   ============================================================ */
function subOf(enc) { return SUBSYSTEMS[enc.subsystem]; }

/* The custom subsystem lets the GM rename its pool, so pools are read from
   the encounter rather than straight off the definition. */
function poolsOf(enc) {
  const sub = subOf(enc);
  if (sub.renameable && enc.def.pointName) {
    return [Object.assign({}, sub.pools[0], {
      name: enc.def.pointName,
      abbr: enc.def.pointAbbr || sub.pools[0].abbr,
    })];
  }
  return sub.pools;
}
function scaleOf(enc) {
  const sub = subOf(enc);
  if (sub.modes) {
    const m = sub.modes.find((x) => x.key === enc.def.mode) || sub.modes[0];
    return m.scale;
  }
  return sub.scale;
}
function modeOf(enc) {
  const sub = subOf(enc);
  if (!sub.modes) return null;
  return sub.modes.find((x) => x.key === enc.def.mode) || sub.modes[0];
}

function newObstacle(name, cost, opts) {
  return Object.assign({
    id: uid(), name: name || "", note: "", cost: cost || 1, mode: "group", options: [],
  }, opts || {});
}

/* GM Core's rule of thumb: half the obstacles need one fewer point than the
   party size, half need two fewer, minimum 1. */
function suggestedCost(rule, partySize, index) {
  if (!rule) return 1;
  const offset = rule.offsets[index % rule.offsets.length];
  return Math.max(rule.min, partySize - offset);
}

function newEncounter(subKey, opts) {
  opts = opts || {};
  const sub = SUBSYSTEMS[subKey];
  const partySize = opts.partySize || 4;
  const def = {
    participants: opts.participants
      || Array.from({ length: partySize }, (_, i) => "PC " + (i + 1)),
    thresholds: [],
    note: "",
  };

  if (subKey === "chase") {
    const preset = sub.presets.find((p) => p.key === (opts.preset || "medium"));
    def.obstacles = Array.from({ length: preset.obstacles }, (_, i) =>
      newObstacle("Obstacle " + (i + 1),
        suggestedCost(sub.obstacleCost, partySize, i)));
    def.presetKey = preset.key;
  } else if (subKey === "infiltration") {
    def.obstacles = [newObstacle("First obstacle", 2), newObstacle("Second obstacle", 2)];
    def.edgeStart = 0;
    def.apFail = null;   // null = follow awarenessRule
  } else if (subKey === "influence") {
    def.npc = {
      name: opts.npcName || "The NPC",
      discoveryDC: 15,
      skills: [{ skill: "Diplomacy", dc: 18 }],
      resistances: [],
      weaknesses: [],
    };
    def.roundMinutes = "30 minutes";
  } else if (subKey === "research") {
    def.checks = [{ id: uid(), name: "First source", skill: "Society", dc: 15, cap: 3 }];
    def.roundLabel = "1 hour";
  } else if (subKey === "custom") {
    const preset = opts.scale || null;
    def.mode = opts.mode || "accumulating";
    def.pointName = opts.pointName || "Victory Points";
    def.pointAbbr = opts.pointAbbr || "VP";
    def.goal = preset ? goalFromScale(preset) : 10;
    if (preset) {
      def.thresholds = preset.thresholds.map((at) => ({ at, label: "", effect: "" }));
      def.scaleLabel = preset.duration;
    }
  }

  const enc = {
    id: uid(),
    subsystem: subKey,
    name: opts.name || sub.name,
    createdAt: new Date().toISOString(),
    def,
    run: null,
  };
  enc.run = freshRun(enc);
  return enc;
}

/* "3-5" / "25-50" -> a number to aim at. The book gives a range; take the top
   of it and let the GM change it. */
function goalFromScale(preset) {
  const nums = String(preset.endPoint).match(/\d+/g) || ["10"];
  return parseInt(nums[nums.length - 1], 10);
}

function freshRun(enc) {
  const run = { pools: {}, round: 1, obstacleIndex: 0, perPC: {}, checks: {}, revealed: [], fired: [], log: [] };
  poolsOf(enc).forEach((p) => { run.pools[p.key] = 0; });
  const mode = modeOf(enc);
  if (mode && mode.startAtGoal) run.pools[poolsOf(enc)[0].key] = enc.def.goal || 0;
  if (subOf(enc).edge) run.pools.ep = enc.def.edgeStart || 0;
  return run;
}

function activeEnc() {
  if (!library.activeId) return null;
  return library.encounters.find((e) => e.id === library.activeId) || null;
}

/* ============================================================
   THE VICTORY POINT CORE

   Every mutation goes through act(). It snapshots the run first, so undo is
   an exact restore rather than an attempt to re-derive the inverse — which
   matters most at an obstacle boundary, where advancing discards points and
   no arithmetic could put them back.
   ============================================================ */
function act(enc, entry, mutate) {
  const before = clone(enc.run);
  delete before.log;
  mutate();
  enc.run.log.push(Object.assign({
    id: uid(),
    at: new Date().toISOString(),
    round: enc.run.round,
    before,
  }, entry));
  if (enc.run.log.length > LOG_CAP) enc.run.log.splice(0, enc.run.log.length - LOG_CAP);
  save();
}

function addDeltas(enc, deltas) {
  const pools = poolsOf(enc);
  Object.keys(deltas || {}).forEach((k) => {
    const pool = pools.find((p) => p.key === k);
    const min = pool ? (pool.min != null ? pool.min : 0) : 0;
    const next = (enc.run.pools[k] || 0) + deltas[k];
    enc.run.pools[k] = Math.max(min, next);
  });
}

/* What a threshold is counted against. In a sequence the points reset at every
   obstacle, so progress is the obstacle count; everywhere else it is the pool. */
function thresholdValue(enc) {
  return subOf(enc).thresholdBasis === "progress"
    ? enc.run.obstacleIndex
    : (enc.run.pools[poolsOf(enc)[0].key] || 0);
}
function thresholdUnit(enc) {
  return subOf(enc).thresholdBasis === "progress" ? "obstacles cleared" : poolsOf(enc)[0].name;
}

/* Thresholds fire once, in order, the first time the count reaches them. */
function checkThresholds(enc) {
  const value = thresholdValue(enc);
  const hits = [];
  (enc.def.thresholds || []).slice()
    .sort((a, b) => a.at - b.at)
    .forEach((t, i) => {
      const id = "t" + i + ":" + t.at;
      if (value >= t.at && enc.run.fired.indexOf(id) === -1) {
        enc.run.fired.push(id);
        hits.push(t);
      }
    });
  return hits;
}

/* Awareness thresholds are derived, not stored: a complication at each
   quarter of the failure point, which itself defaults to twice the IP goal. */
function awarenessLadder(enc) {
  const sub = subOf(enc);
  if (!sub.awarenessRule) return null;
  const goal = ipGoal(enc);
  const fail = enc.def.apFail || goal * sub.awarenessRule.multiplier;
  const step = Math.max(1, Math.round(fail / sub.awarenessRule.steps));
  const marks = [];
  for (let v = step; v < fail; v += step) marks.push(v);
  return { fail, step, marks };
}
/* A resistance raises the DC of the approach it names; a weakness lowers it.
   Which approach maps to which skill is the table's call, so the app shows the
   arithmetic beside the base DC rather than guessing at it. */
function adjustedDC(baseDC, mods) {
  return (mods || []).reduce((dc, m) => dc + (m.dc || 0), baseDC);
}

function ipGoal(enc) {
  return (enc.def.obstacles || []).reduce((sum, o) => sum + (o.cost || 0)
    * (o.mode === "individual" ? (enc.def.participants || []).length : 1), 0);
}

/* ---- the actions a GM takes at the table ---- */

function score(encId, actor, degree, opts) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  opts = opts || {};
  const scale = scaleOf(enc);
  let deltas = scale[degree] || {};
  let label = (DEGREES.find((d) => d.key === degree) || {}).label || degree;

  /* An Edge Point turns a failure into a success: the success line of the
     scale, and nothing to the opposition. */
  if (opts.edge) {
    if ((enc.run.pools.ep || 0) < 1) { toast("No Edge Points left."); return; }
    deltas = Object.assign({}, scale.success, { ep: -1 });
    label = "Edge Point spent — counts as a success";
  }

  act(enc, { kind: "score", actor, degree, label }, () => {
    addDeltas(enc, deltas);
    if (opts.edge) enc.run.pools.ep = Math.max(0, (enc.run.pools.ep || 0) - 1);
    if (enc.def.checks && opts.checkId) bumpCheck(enc, opts.checkId, deltas);
    if (subOf(enc).structure === "sequence") creditObstacle(enc, actor, deltas);
    checkThresholds(enc);
  });
  renderAll();
}

/* Research: a source stops paying out once it has given its maximum. */
function bumpCheck(enc, checkId, deltas) {
  const check = (enc.def.checks || []).find((c) => c.id === checkId);
  if (!check) return;
  const poolKey = poolsOf(enc)[0].key;
  const gained = deltas[poolKey] || 0;
  const already = enc.run.checks[checkId] || 0;
  if (gained <= 0) { enc.run.checks[checkId] = Math.max(0, already + gained); return; }
  const room = Math.max(0, (check.cap || 0) - already);
  const allowed = Math.min(gained, room);
  /* addDeltas already credited the full amount; take back what the cap
     wouldn't allow. */
  if (allowed < gained) {
    enc.run.pools[poolKey] = Math.max(0, (enc.run.pools[poolKey] || 0) - (gained - allowed));
  }
  enc.run.checks[checkId] = already + allowed;
}

/* Infiltration's individual obstacles are earned per PC; group ones pool. */
function creditObstacle(enc, actor, deltas) {
  const ob = currentObstacle(enc);
  if (!ob) return;
  const poolKey = poolsOf(enc)[0].key;
  const gained = deltas[poolKey] || 0;
  if (ob.mode === "individual" && actor) {
    enc.run.perPC[ob.id] = enc.run.perPC[ob.id] || {};
    enc.run.perPC[ob.id][actor] = Math.max(0, (enc.run.perPC[ob.id][actor] || 0) + gained);
  }
  maybeAdvance(enc);
}

function currentObstacle(enc) {
  const list = enc.def.obstacles || [];
  return list[enc.run.obstacleIndex] || null;
}

function obstacleCleared(enc) {
  const ob = currentObstacle(enc);
  if (!ob) return false;
  if (ob.mode === "individual") {
    const names = (enc.def.participants || []).filter(Boolean);
    const got = enc.run.perPC[ob.id] || {};
    return names.length > 0 && names.every((n) => (got[n] || 0) >= ob.cost);
  }
  return (enc.run.pools[poolsOf(enc)[0].key] || 0) >= ob.cost;
}

/* Clearing an obstacle resets the pool to zero — extra points do NOT carry
   over to the next one. This is the rule hands get wrong most often, and it
   is why undo is snapshot-based. */
function maybeAdvance(enc) {
  const ob = currentObstacle(enc);
  if (!ob || !obstacleCleared(enc)) return;
  const poolKey = poolsOf(enc)[0].key;
  if (ob.mode !== "individual") enc.run.pools[poolKey] = 0;
  enc.run.obstacleIndex += 1;
  enc.run._justCleared = ob.name || "that obstacle";
  checkThresholds(enc);
}

function extra(encId, key) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  const ex = (subOf(enc).extras || []).find((x) => x.key === key);
  if (!ex) return;
  act(enc, { kind: "extra", label: ex.label }, () => {
    addDeltas(enc, ex.deltas);
    if (subOf(enc).structure === "sequence") creditObstacle(enc, null, ex.deltas);
    checkThresholds(enc);
  });
  renderAll();
}

function discover(encId, actor, degree) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  const action = subOf(enc).actions.find((a) => a.key === "discover");
  const n = action.reveals[degree];
  const label = n < 0 ? "Discover — learned something false"
    : n === 0 ? "Discover — learned nothing"
      : "Discover — " + n + " " + plural(n, "fact");
  act(enc, { kind: "discover", actor, degree, label, reveals: n }, () => {
    enc.run.revealHint = n;
  });
  renderAll();
}

function revealFact(encId, kind, index) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  const id = kind + ":" + index;
  if (enc.run.revealed.indexOf(id) !== -1) return;
  act(enc, { kind: "reveal", label: "Revealed a " + kind }, () => {
    enc.run.revealed.push(id);
  });
  renderAll();
}

function advanceRound(encId) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  const sub = subOf(enc);
  act(enc, { kind: "round", label: "Round " + (enc.run.round + 1) + " begins" }, () => {
    enc.run.round += 1;
    if (sub.roundEnd) addDeltas(enc, sub.roundEnd);
    checkThresholds(enc);
  });
  renderAll();
}

function adjustPool(encId, poolKey, delta) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  const d = {}; d[poolKey] = delta;
  act(enc, { kind: "manual", label: (delta > 0 ? "+" : "") + delta + " " + poolKey.toUpperCase() }, () => {
    if (poolKey === "ep") enc.run.pools.ep = Math.max(0, (enc.run.pools.ep || 0) + delta);
    else addDeltas(enc, d);
    if (subOf(enc).structure === "sequence") maybeAdvance(enc);
    checkThresholds(enc);
  });
  renderAll();
}

function undoLast() {
  const enc = activeEnc();
  if (!enc || !enc.run.log.length) { toast("Nothing to undo."); return; }
  const last = enc.run.log.pop();
  const log = enc.run.log;
  enc.run = Object.assign(clone(last.before), { log });
  save();
  toast("Undid: " + last.label);
  renderAll();
}

function resetRun(encId) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  if (!confirm("Reset the live run? The prep — obstacles, thresholds, the NPC — is kept.")) return;
  enc.run = freshRun(enc);
  save();
  toast("Run reset.");
  renderAll();
}

/* ============================================================
   LIBRARY ACTIONS
   ============================================================ */
function openEncounter(id) { library.activeId = id; save(); go("run"); }

function createEncounter(subKey, opts) {
  const enc = newEncounter(subKey, opts);
  library.encounters.unshift(enc);
  library.activeId = enc.id;
  save();
  go("prep");
}

function duplicateEncounter(id) {
  const src = library.encounters.find((e) => e.id === id);
  if (!src) return;
  const copy = clone(src);
  copy.id = uid();
  copy.name = src.name + " (copy)";
  copy.createdAt = new Date().toISOString();
  copy.run = freshRun(copy);
  library.encounters.unshift(copy);
  save();
  toast("Duplicated.");
  renderAll();
}

function deleteEncounter(id) {
  const enc = library.encounters.find((e) => e.id === id);
  if (!enc) return;
  if (!confirm('Delete "' + enc.name + '"? This cannot be undone.')) return;
  library.encounters = library.encounters.filter((e) => e.id !== id);
  if (library.activeId === id) library.activeId = (library.encounters[0] || {}).id || null;
  save();
  renderAll();
}

function renameEncounter(id, name) {
  const enc = library.encounters.find((e) => e.id === id);
  if (!enc) return;
  enc.name = name || enc.name;
  save();
}

/* Export carries the prep only — never the run. */
function exportEncounter(id) {
  const enc = library.encounters.find((e) => e.id === id);
  if (!enc) return;
  const payload = { t: "pf2e-subsystem", v: 1, subsystem: enc.subsystem, name: enc.name, def: enc.def };
  const code = b64encode(JSON.stringify(payload));
  navigator.clipboard && navigator.clipboard.writeText(code)
    .then(() => toast("Code copied to the clipboard."))
    .catch(() => prompt("Copy this code:", code));
  if (!navigator.clipboard) prompt("Copy this code:", code);
}

function importEncounter(code) {
  let payload;
  try {
    payload = JSON.parse(b64decode(String(code || "").trim()));
  } catch (e) {
    toast("That doesn't look like an encounter code.");
    return false;
  }
  if (!payload || payload.t !== "pf2e-subsystem" || !SUBSYSTEMS[payload.subsystem]) {
    toast("That code isn't from this app.");
    return false;
  }
  const enc = {
    id: uid(),
    subsystem: payload.subsystem,
    name: payload.name || SUBSYSTEMS[payload.subsystem].name,
    createdAt: new Date().toISOString(),
    def: payload.def,
    run: null,
  };
  enc.run = freshRun(enc);
  library.encounters.unshift(enc);
  library.activeId = enc.id;
  save();
  toast("Imported.");
  renderAll();
  return true;
}

/* ============================================================
   NAVIGATION
   ============================================================ */
const VIEWS = [
  { key: "run", label: "Run" },
  { key: "prep", label: "Prep" },
  { key: "reference", label: "Reference" },
];
let current = "prep";
let menuOpen = false;

function go(view) {
  current = view;
  menuOpen = false;
  renderAll();
  window.scrollTo(0, 0);
}
function openMenu() { menuOpen = true; renderAll(); }
function closeMenu() { menuOpen = false; renderAll(); }

function renderAll() {
  renderHeader();
  renderTabs();
  const views = byId("views");
  if (menuOpen) { views.innerHTML = menuHtml(); return; }
  if (current === "run") views.innerHTML = runHtml();
  else if (current === "prep") views.innerHTML = prepHtml();
  else views.innerHTML = referenceHtml();
  wireInputs();
}
function renderMenu() { if (menuOpen) renderAll(); }

function renderHeader() {
  const enc = activeEnc();
  const sub = enc ? subOf(enc) : null;
  byId("headSub").innerHTML = enc
    ? '<span class="glyph">' + esc(sub.glyph) + "</span> " + esc(enc.name)
      + ' <span class="dim">· ' + esc(sub.name) + "</span>"
    : '<span class="dim">Nothing open — start one in Prep.</span>';
  const undo = byId("undoBtn");
  const can = enc && enc.run.log.length;
  undo.disabled = !can;
  undo.classList.toggle("off", !can);
}

function renderTabs() {
  byId("tabs").innerHTML = VIEWS.map((v) =>
    '<button id="nav-' + v.key + '" class="tab' + (current === v.key && !menuOpen ? " on" : "")
    + '" onclick="go(\'' + v.key + '\')">' + esc(v.label) + "</button>").join("");
}

/* ============================================================
   THE RUN BOARD
   ============================================================ */
function runHtml() {
  const enc = activeEnc();
  if (!enc) return empty("No encounter open", "Open or build one in <b>Prep</b>.");
  const sub = subOf(enc);
  const parts = [];

  parts.push(roundBarHtml(enc, sub));
  parts.push(metersHtml(enc, sub));

  if (sub.structure === "sequence") parts.push(obstacleHtml(enc, sub));
  if (sub.structure === "checks") parts.push(checksHtml(enc, sub));
  if (enc.subsystem === "influence") parts.push(npcHtml(enc, sub));

  parts.push(participantsHtml(enc, sub));
  parts.push(thresholdStateHtml(enc));
  parts.push(logHtml(enc));
  return parts.join("");
}

function roundBarHtml(enc, sub) {
  const len = sub.roundLength
    ? ' <span class="dim">· a round is ' + esc(enc.def.roundMinutes || enc.def.roundLabel
      || (sub.roundLength.low + " to " + sub.roundLength.high)) + "</span>"
    : "";
  const note = sub.roundEnd
    ? '<div class="note warn">' + esc(sub.roundEndNote) + "</div>" : "";
  return '<section class="card">'
    + '<div class="row spread">'
    + "<h2>Round " + enc.run.round + len + "</h2>"
    + '<div class="rowbtns">'
    + '<button class="btn" onclick="advanceRound(\'' + enc.id + '\')">Advance round →</button>'
    + '<button class="btn ghost" onclick="resetRun(\'' + enc.id + '\')">Reset run</button>'
    + "</div></div>" + note + "</section>";
}

function metersHtml(enc, sub) {
  const pools = poolsOf(enc);
  const cells = pools.map((p) => {
    const v = enc.run.pools[p.key] || 0;
    const target = meterTarget(enc, p);
    return '<div class="meter ' + (p.role === "hazard" ? "hazard" : "goal") + '">'
      + '<div class="meterhead"><span>' + esc(p.name) + "</span>"
      + '<span class="mval">' + v + (target ? ' <span class="dim">/ ' + target + "</span>" : "") + "</span></div>"
      + meterPips(enc, p, v, target)
      + '<div class="rowbtns tight">'
      + '<button class="chipbtn" onclick="adjustPool(\'' + enc.id + "','" + p.key + "',-1)\">−1</button>"
      + '<button class="chipbtn" onclick="adjustPool(\'' + enc.id + "','" + p.key + "',1)\">+1</button>"
      + "</div></div>";
  });
  if (sub.edge) {
    const ep = enc.run.pools.ep || 0;
    cells.push('<div class="meter edge"><div class="meterhead"><span>'
      + esc(sub.edge.name) + '</span><span class="mval">' + ep + "</span></div>"
      + '<div class="note">' + esc(sub.edge.note) + "</div>"
      + '<div class="rowbtns tight">'
      + '<button class="chipbtn" onclick="adjustPool(\'' + enc.id + "',\'ep\',-1)\">−1</button>"
      + '<button class="chipbtn" onclick="adjustPool(\'' + enc.id + "',\'ep\',1)\">+1</button>"
      + "</div></div>");
  }
  return '<section class="meters">' + cells.join("") + "</section>";
}

function meterTarget(enc, pool) {
  if (pool.role === "hazard") {
    const lad = awarenessLadder(enc);
    return lad ? lad.fail : null;
  }
  if (subOf(enc).structure === "sequence") {
    const ob = currentObstacle(enc);
    return ob ? ob.cost : null;
  }
  return enc.def.goal || null;
}

function meterPips(enc, pool, value, target) {
  if (!target) return "";
  const marks = pool.role === "hazard"
    ? ((awarenessLadder(enc) || {}).marks || [])
    : (subOf(enc).thresholdBasis === "progress"
      ? [] : (enc.def.thresholds || []).map((t) => t.at));
  const width = Math.min(100, target ? (value / target) * 100 : 0);
  const ticks = marks.filter((m) => m > 0 && m < target).map((m) =>
    '<span class="tick" style="left:' + ((m / target) * 100) + '%" title="'
    + esc(m) + '"></span>').join("");
  return '<div class="bar"><span class="fill" style="width:' + width + '%"></span>'
    + ticks + "</div>";
}

function obstacleHtml(enc, sub) {
  const list = enc.def.obstacles || [];
  const ob = currentObstacle(enc);
  if (!ob) {
    return '<section class="card done"><h2>All obstacles cleared</h2>'
      + '<p class="dim">' + list.length + " of " + list.length
      + " done. Whatever they were chasing, they caught it.</p></section>";
  }
  const cleared = enc.run._justCleared;
  delete enc.run._justCleared;
  const banner = cleared
    ? '<div class="note heal">Cleared <b>' + esc(cleared) + "</b> — leftover points don't carry over.</div>"
    : "";
  const opts = (ob.options || []).map((o) =>
    '<span class="chk">' + esc(titleCase(o.skill)) + " DC " + o.dc
    + (o.how ? ' <span class="dim">to ' + esc(o.how) + "</span>" : "") + "</span>").join("");
  let progress;
  if (ob.mode === "individual") {
    const got = enc.run.perPC[ob.id] || {};
    progress = '<div class="perpc">' + (enc.def.participants || []).filter(Boolean).map((n) =>
      '<span class="pcchip' + ((got[n] || 0) >= ob.cost ? " on" : "") + '">'
      + esc(n) + " " + (got[n] || 0) + "/" + ob.cost + "</span>").join("") + "</div>";
  } else {
    progress = '<p class="dim">' + (enc.run.pools[poolsOf(enc)[0].key] || 0)
      + " of " + ob.cost + " " + esc(poolsOf(enc)[0].abbr) + "</p>";
  }
  return '<section class="card">' + banner
    + '<div class="row spread"><h2>' + esc(ob.name || "Obstacle") + "</h2>"
    + '<span class="pill">' + (enc.run.obstacleIndex + 1) + " of " + list.length + "</span></div>"
    + (ob.note ? "<p>" + esc(ob.note) + "</p>" : "")
    + (opts ? '<div class="chks">' + opts + "</div>" : "")
    + '<div class="pill mode">' + esc(ob.mode === "individual" ? "Individual" : "Group") + "</div>"
    + progress + "</section>";
}

function checksHtml(enc, sub) {
  const checks = enc.def.checks || [];
  if (!checks.length) return "";
  return '<section class="card"><h2>Sources</h2>'
    + '<p class="dim">' + esc(GM_CALLS.researchCap) + "</p>"
    + checks.map((c) => {
      const got = enc.run.checks[c.id] || 0;
      const dry = got >= (c.cap || 0);
      return '<div class="srcrow' + (dry ? " dry" : "") + '">'
        + '<span class="srcname">' + esc(c.name) + "</span>"
        + '<span class="chk">' + esc(c.skill) + " DC " + c.dc + "</span>"
        + '<span class="pill">' + got + "/" + (c.cap || 0) + " RP"
        + (dry ? " · spent" : "") + "</span></div>";
    }).join("") + "</section>";
}

function npcHtml(enc, sub) {
  const npc = enc.def.npc || {};
  const shown = (kind, list) => (list || []).map((r, i) => {
    const id = kind + ":" + i;
    const open = enc.run.revealed.indexOf(id) !== -1;
    if (!open) {
      return '<button class="hidden-fact" onclick="revealFact(\'' + enc.id + "','"
        + kind + "'," + i + ')">Reveal a ' + kind + "</button>";
    }
    const base = (npc.skills || []).map((s) => s.dc).sort((a, b) => a - b)[0];
    const shift = base != null
      ? ' <span class="dim">(' + base + " \u2192 " + adjustedDC(base, [r]) + ")</span>"
      : "";
    return '<span class="chk ' + kind + '">' + esc(r.label)
      + " " + (r.dc > 0 ? "+" : "") + r.dc + " DC" + shift + "</span>";
  }).join("");
  return '<section class="card"><div class="row spread"><h2>' + esc(npc.name || "The NPC")
    + '</h2><span class="pill">Discovery DC ' + (npc.discoveryDC || "—") + "</span></div>"
    + '<div class="chks">' + (npc.skills || []).map((s) =>
      '<span class="chk">' + esc(s.skill) + " DC " + s.dc + "</span>").join("") + "</div>"
    + ((npc.resistances || []).length
      ? '<div class="factrow"><span class="flabel">Resistances</span>' + shown("resistance", npc.resistances) + "</div>" : "")
    + ((npc.weaknesses || []).length
      ? '<div class="factrow"><span class="flabel">Weaknesses</span>' + shown("weakness", npc.weaknesses) + "</div>" : "")
    + '<div class="note">' + esc(sub.discoverNote) + "</div></section>";
}

function participantsHtml(enc, sub) {
  const names = (enc.def.participants || []).filter(Boolean);
  if (!names.length) {
    return empty("No participants yet", "Add their names in <b>Prep</b> so the rows have labels.");
  }
  const isInfluence = enc.subsystem === "influence";
  const checks = enc.def.checks || [];
  const rows = names.map((n) => {
    const degBtns = DEGREES.map((d) =>
      '<button class="deg ' + d.tone + '" onclick="scoreFrom(\'' + enc.id + "','"
      + esc(n).replace(/'/g, "\\'") + "','" + d.key + '\')">' + esc(d.short) + "</button>").join("");
    const discBtns = isInfluence ? DEGREES.map((d) =>
      '<button class="deg ghost" onclick="discover(\'' + enc.id + "','"
      + esc(n).replace(/'/g, "\\'") + "','" + d.key + '\')">' + esc(d.short) + "</button>").join("") : "";
    const edgeBtn = sub.edge
      ? '<button class="deg edge" onclick="scoreFrom(\'' + enc.id + "','"
        + esc(n).replace(/'/g, "\\'") + '\',\'failure\',true)" title="'
        + esc(sub.edge.note) + '">Spend EP</button>'
      : "";
    return '<div class="pcrow"><div class="pcname">' + esc(n) + "</div>"
      + '<div class="degs">' + (isInfluence ? '<span class="deglabel">Influence</span>' : "")
      + degBtns + edgeBtn + "</div>"
      + (isInfluence ? '<div class="degs"><span class="deglabel">Discover</span>' + discBtns + "</div>" : "")
      + "</div>";
  }).join("");
  const picker = checks.length > 1
    ? '<div class="row"><label class="flabel" for="srcPick">Reading</label>'
      + '<select id="srcPick" class="inp">' + checks.map((c) =>
        '<option value="' + c.id + '">' + esc(c.name) + " · " + esc(c.skill)
        + " DC " + c.dc + "</option>").join("") + "</select></div>"
    : "";
  const extras = (sub.extras || []).map((x) =>
    '<button class="btn ghost" title="' + esc(x.note) + '" onclick="extra(\''
    + enc.id + "','" + x.key + '\')">' + esc(x.label) + "</button>").join("");
  return '<section class="card"><h2>This round</h2>' + picker + rows
    + (extras ? '<div class="rowbtns wrap">' + extras + "</div>" : "") + "</section>";
}

/* The source picker is read at click time, so it survives a re-render. */
function scoreFrom(encId, actor, degree, edge) {
  const pick = byId("srcPick");
  const enc = library.encounters.find((e) => e.id === encId);
  const only = enc && (enc.def.checks || []).length === 1 ? enc.def.checks[0].id : null;
  score(encId, actor, degree, { edge: !!edge, checkId: pick ? pick.value : only });
}

function thresholdStateHtml(enc) {
  const list = (enc.def.thresholds || []).slice().sort((a, b) => a.at - b.at);
  if (!list.length) return "";
  const v = thresholdValue(enc);
  return '<section class="card"><h2>Thresholds</h2>'
    + '<p class="dim">Counted in ' + esc(thresholdUnit(enc)) + " — at " + v + " now.</p>"
    + list.map((t, i) => {
    const hit = v >= t.at;
    return '<div class="throw' + (hit ? " hit" : "") + '">'
      + '<span class="pill">' + t.at + "</span>"
      + "<span><b>" + esc(t.label || "Threshold " + (i + 1)) + "</b>"
      + (t.effect ? '<br><span class="dim">' + esc(t.effect) + "</span>" : "") + "</span></div>";
  }).join("") + "</section>";
}

function logHtml(enc) {
  const log = enc.run.log.slice(-12).reverse();
  if (!log.length) return "";
  return '<section class="card log"><h2>What happened</h2>' + log.map((e) =>
    '<div class="logrow"><span class="pill">R' + e.round + "</span>"
    + (e.actor ? "<b>" + esc(e.actor) + "</b> " : "") + esc(e.label) + "</div>").join("")
    + "</section>";
}

/* ============================================================
   PREP
   ============================================================ */
function prepHtml() {
  const enc = activeEnc();
  return newEncounterHtml() + libraryHtml() + (enc ? editorHtml(enc) : "");
}

function newEncounterHtml() {
  return '<section class="card"><h2>Start something</h2><div class="picker">'
    + SUBSYSTEM_ORDER.map((k) => {
      const s = SUBSYSTEMS[k];
      return '<button class="pick" onclick="startNew(\'' + k + '\')">'
        + '<span class="glyph">' + esc(s.glyph) + "</span>"
        + "<b>" + esc(s.name) + "</b>"
        + '<span class="dim">' + esc(s.blurb) + "</span></button>";
    }).join("") + "</div>"
    + '<div class="row"><input id="impCode" class="inp" placeholder="…or paste an encounter code">'
    + '<button class="btn" onclick="importEncounter(byId(\'impCode\').value)">Import</button></div>'
    + "</section>";
}

function startNew(subKey) {
  const opts = {};
  if (subKey === "chase") {
    const p = prompt("Short, medium or long? (6, 8 or 10 obstacles)", "medium");
    if (p === null) return;
    opts.preset = /^s/i.test(p) ? "short" : /^l/i.test(p) ? "long" : "medium";
    const n = parseInt(prompt("How many PCs?", "4"), 10);
    if (n > 0) opts.partySize = n;
  } else if (subKey === "custom") {
    const scales = GENERATED_VP_SCALES || [];
    const list = scales.map((s, i) => (i + 1) + ") " + s.duration + " — " + s.endPoint + " VP").join("\n");
    const pick = prompt("How long is this challenge?\n\n" + list + "\n\nNumber:", "2");
    if (pick === null) return;
    const idx = parseInt(pick, 10) - 1;
    if (scales[idx]) opts.scale = scales[idx];
    const nm = prompt("What are the points called?", "Victory Points");
    if (nm) { opts.pointName = nm; opts.pointAbbr = nm.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 3); }
  } else if (subKey === "influence") {
    const nm = prompt("Who are they working on?", "The NPC");
    if (nm === null) return;
    opts.npcName = nm;
  }
  createEncounter(subKey, opts);
}

function libraryHtml() {
  if (!library.encounters.length) return "";
  return '<section class="card"><h2>Saved</h2>' + library.encounters.map((e) => {
    const s = subOf(e);
    const on = e.id === library.activeId;
    return '<div class="encrow' + (on ? " on" : "") + '">'
      + '<button class="encopen" onclick="openEncounter(\'' + e.id + '\')">'
      + '<span class="glyph">' + esc(s.glyph) + "</span><b>" + esc(e.name) + "</b>"
      + '<span class="dim">' + esc(s.name) + " · round " + e.run.round + "</span></button>"
      + '<div class="rowbtns tight">'
      + '<button class="chipbtn" onclick="exportEncounter(\'' + e.id + '\')">Code</button>'
      + '<button class="chipbtn" onclick="duplicateEncounter(\'' + e.id + '\')">Copy</button>'
      + '<button class="chipbtn danger" onclick="deleteEncounter(\'' + e.id + '\')">Delete</button>'
      + "</div></div>";
  }).join("") + "</section>";
}

function editorHtml(enc) {
  const sub = subOf(enc);
  const asks = (sub.asks || []).map((k) =>
    '<div class="note">' + esc(GM_CALLS[k]) + "</div>").join("");
  return '<section class="card"><h2>Editing: ' + esc(enc.name) + "</h2>"
    + field("Name", '<input class="inp" value="' + esc(enc.name)
      + '" oninput="renameEncounter(\'' + enc.id + '\', this.value); renderHeader()">')
    + field("Participants", '<input class="inp" value="'
      + esc((enc.def.participants || []).join(", "))
      + '" oninput="setParticipants(\'' + enc.id + '\', this.value)">'
      + '<span class="hint">Comma separated. These label the rows on the run board.</span>')
    + (sub.structure === "sequence" ? obstacleEditorHtml(enc) : "")
    + (sub.structure === "checks" ? checkEditorHtml(enc) : "")
    + (enc.subsystem === "influence" ? npcEditorHtml(enc) : "")
    + (sub.modes ? modeEditorHtml(enc, sub) : "")
    + thresholdEditorHtml(enc)
    + asks
    + "</section>";
}

function field(label, inner) {
  return '<div class="fld"><label class="flabel">' + esc(label) + "</label>" + inner + "</div>";
}

function setParticipants(id, value) {
  const enc = library.encounters.find((e) => e.id === id);
  if (!enc) return;
  enc.def.participants = value.split(",").map((s) => s.trim()).filter(Boolean);
  save();
}

function obstacleEditorHtml(enc) {
  const list = enc.def.obstacles || [];
  return '<div class="fld"><label class="flabel">Obstacles</label>'
    + list.map((o, i) =>
      '<div class="obrow">'
      + '<input class="inp" value="' + esc(o.name) + '" oninput="setObstacle(\''
      + enc.id + "','" + o.id + '\',\'name\',this.value)">'
      + '<input class="inp num" type="number" min="1" value="' + o.cost
      + '" oninput="setObstacle(\'' + enc.id + "','" + o.id + '\',\'cost\',this.value)">'
      + (enc.subsystem === "infiltration"
        ? '<select class="inp" onchange="setObstacle(\'' + enc.id + "','" + o.id
          + '\',\'mode\',this.value)">'
          + subOf(enc).obstacleModes.map((m) => '<option value="' + m.key + '"'
            + (o.mode === m.key ? " selected" : "") + ">" + esc(m.label) + "</option>").join("")
          + "</select>" : "")
      + '<button class="chipbtn danger" onclick="removeObstacle(\'' + enc.id + "','"
      + o.id + '\')">×</button></div>').join("")
    + '<div class="rowbtns wrap"><button class="btn ghost" onclick="addObstacle(\''
    + enc.id + '\')">Add obstacle</button>'
    + (subOf(enc).obstacleLibrary
      ? '<button class="btn ghost" onclick="pickObstacle(\'' + enc.id
        + '\')">Pick from GM Core (' + (GENERATED_CHASE_OBSTACLES || []).length + ")</button>" : "")
    + "</div></div>";
}

function setObstacle(encId, obId, key, value) {
  const enc = library.encounters.find((e) => e.id === encId);
  const ob = enc && (enc.def.obstacles || []).find((o) => o.id === obId);
  if (!ob) return;
  ob[key] = key === "cost" ? Math.max(1, parseInt(value, 10) || 1) : value;
  save();
}
function addObstacle(encId) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  const n = (enc.def.obstacles || []).length;
  enc.def.obstacles.push(newObstacle("Obstacle " + (n + 1),
    suggestedCost(subOf(enc).obstacleCost, (enc.def.participants || []).length || 4, n)));
  save(); renderAll();
}
function removeObstacle(encId, obId) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  enc.def.obstacles = enc.def.obstacles.filter((o) => o.id !== obId);
  if (enc.run.obstacleIndex >= enc.def.obstacles.length) {
    enc.run.obstacleIndex = Math.max(0, enc.def.obstacles.length - 1);
  }
  save(); renderAll();
}

function pickObstacle(encId) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  const lib = GENERATED_CHASE_OBSTACLES || [];
  const term = prompt("Search GM Core's sample obstacles by name, terrain or level\n"
    + "(e.g. \"urban\", \"rooftops\", \"5\"):", "");
  if (term === null) return;
  const t = term.trim().toLowerCase();
  const hits = lib.filter((o) => !t
    || o.name.toLowerCase().indexOf(t) !== -1
    || o.table.toLowerCase().indexOf(t) !== -1
    || String(o.level) === t);
  if (!hits.length) { toast("Nothing matched."); return; }
  const list = hits.slice(0, 20).map((o, i) =>
    (i + 1) + ") " + o.name + " (" + o.table + ", level " + o.level + ") — "
    + o.options.map((x) => titleCase(x.skill) + " DC " + x.dc).join(", ")).join("\n");
  const pick = parseInt(prompt(list + "\n\nNumber:", "1"), 10) - 1;
  const chosen = hits[pick];
  if (!chosen) return;
  const n = (enc.def.obstacles || []).length;
  enc.def.obstacles.push(newObstacle(chosen.name,
    suggestedCost(subOf(enc).obstacleCost, (enc.def.participants || []).length || 4, n),
    { options: chosen.options.map((o) => ({ skill: o.skill, dc: o.dc, how: o.how })) }));
  save(); renderAll();
  toast("Added " + chosen.name + ".");
}

function checkEditorHtml(enc) {
  return '<div class="fld"><label class="flabel">Research checks</label>'
    + (enc.def.checks || []).map((c) =>
      '<div class="obrow">'
      + '<input class="inp" value="' + esc(c.name) + '" oninput="setCheck(\'' + enc.id + "','" + c.id + '\',\'name\',this.value)">'
      + '<input class="inp" value="' + esc(c.skill) + '" oninput="setCheck(\'' + enc.id + "','" + c.id + '\',\'skill\',this.value)">'
      + '<input class="inp num" type="number" value="' + c.dc + '" oninput="setCheck(\'' + enc.id + "','" + c.id + '\',\'dc\',this.value)">'
      + '<input class="inp num" type="number" min="1" value="' + c.cap + '" oninput="setCheck(\'' + enc.id + "','" + c.id + '\',\'cap\',this.value)">'
      + '<button class="chipbtn danger" onclick="removeCheck(\'' + enc.id + "','" + c.id + '\')">×</button></div>').join("")
    + '<span class="hint">Name · skill · DC · maximum RP. ' + esc(subOf(enc).checkNote) + "</span>"
    + '<div class="rowbtns"><button class="btn ghost" onclick="addCheck(\'' + enc.id + '\')">Add a source</button></div></div>';
}
function setCheck(encId, cid, key, value) {
  const enc = library.encounters.find((e) => e.id === encId);
  const c = enc && (enc.def.checks || []).find((x) => x.id === cid);
  if (!c) return;
  c[key] = (key === "dc" || key === "cap") ? (parseInt(value, 10) || 0) : value;
  save();
}
function addCheck(encId) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  enc.def.checks.push({ id: uid(), name: "Another source", skill: "Society", dc: 18, cap: 2 });
  save(); renderAll();
}
function removeCheck(encId, cid) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  enc.def.checks = enc.def.checks.filter((c) => c.id !== cid);
  save(); renderAll();
}

function npcEditorHtml(enc) {
  const npc = enc.def.npc;
  const rows = (kind) => (npc[kind] || []).map((r, i) =>
    '<div class="obrow"><input class="inp" value="' + esc(r.label)
    + '" oninput="setFact(\'' + enc.id + "','" + kind + "'," + i + ',\'label\',this.value)">'
    + '<input class="inp num" type="number" value="' + r.dc + '" oninput="setFact(\''
    + enc.id + "','" + kind + "'," + i + ',\'dc\',this.value)">'
    + '<button class="chipbtn danger" onclick="removeFact(\'' + enc.id + "','" + kind
    + "'," + i + ')">×</button></div>').join("")
    + '<div class="rowbtns"><button class="btn ghost" onclick="addFact(\'' + enc.id
    + "','" + kind + '\')">Add a ' + kind + "</button></div>";
  return field("NPC", '<input class="inp" value="' + esc(npc.name)
    + '" oninput="setNpc(\'' + enc.id + '\',\'name\',this.value)">')
    + field("Discovery DC", '<input class="inp num" type="number" value="' + npc.discoveryDC
      + '" oninput="setNpc(\'' + enc.id + '\',\'discoveryDC\',this.value)">')
    + '<div class="fld"><label class="flabel">Influence skills</label>'
    + (npc.skills || []).map((s, i) =>
      '<div class="obrow"><input class="inp" value="' + esc(s.skill)
      + '" oninput="setSkill(\'' + enc.id + "'," + i + ',\'skill\',this.value)">'
      + '<input class="inp num" type="number" value="' + s.dc + '" oninput="setSkill(\''
      + enc.id + "'," + i + ',\'dc\',this.value)">'
      + '<button class="chipbtn danger" onclick="removeSkill(\'' + enc.id + "'," + i
      + ')">×</button></div>').join("")
    + '<span class="hint">Lowest DC first — that is the order the book uses.</span>'
    + '<div class="rowbtns"><button class="btn ghost" onclick="addSkill(\'' + enc.id
    + '\')">Add a skill</button></div></div>'
    + '<div class="fld"><label class="flabel">Resistances (raise a DC)</label>' + rows("resistance") + "</div>"
    + '<div class="fld"><label class="flabel">Weaknesses (lower a DC)</label>' + rows("weakness") + "</div>";
}
function setNpc(encId, key, value) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  enc.def.npc[key] = key === "discoveryDC" ? (parseInt(value, 10) || 0) : value;
  save();
}
function setSkill(encId, i, key, value) {
  const enc = library.encounters.find((e) => e.id === encId);
  if (!enc) return;
  enc.def.npc.skills[i][key] = key === "dc" ? (parseInt(value, 10) || 0) : value;
  save();
}
function addSkill(encId) {
  const enc = library.encounters.find((e) => e.id === encId);
  enc.def.npc.skills.push({ skill: "Deception", dc: 20 });
  save(); renderAll();
}
function removeSkill(encId, i) {
  const enc = library.encounters.find((e) => e.id === encId);
  enc.def.npc.skills.splice(i, 1);
  save(); renderAll();
}
function factList(enc, kind) {
  return kind === "resistance" ? enc.def.npc.resistances : enc.def.npc.weaknesses;
}
function setFact(encId, kind, i, key, value) {
  const enc = library.encounters.find((e) => e.id === encId);
  factList(enc, kind)[i][key] = key === "dc" ? (parseInt(value, 10) || 0) : value;
  save();
}
function addFact(encId, kind) {
  const enc = library.encounters.find((e) => e.id === encId);
  factList(enc, kind).push({ label: kind === "resistance" ? "Flattery" : "Honesty",
    dc: kind === "resistance" ? 3 : -3 });
  save(); renderAll();
}
function removeFact(encId, kind, i) {
  const enc = library.encounters.find((e) => e.id === encId);
  factList(enc, kind).splice(i, 1);
  save(); renderAll();
}

function modeEditorHtml(enc, sub) {
  return field("Structure", sub.modes.map((m) =>
    '<label class="radio"><input type="radio" name="mode" value="' + m.key + '"'
    + (enc.def.mode === m.key ? " checked" : "")
    + ' onchange="setMode(\'' + enc.id + "','" + m.key + '\')"> <b>' + esc(m.label)
    + '</b> <span class="dim">' + esc(m.note) + "</span></label>").join(""))
    + field("End point", '<input class="inp num" type="number" value="' + (enc.def.goal || 0)
      + '" oninput="setGoal(\'' + enc.id + '\', this.value)">'
      + (enc.def.scaleLabel ? '<span class="hint">GM Core scale: ' + esc(enc.def.scaleLabel) + "</span>" : ""));
}
function setMode(encId, mode) {
  const enc = library.encounters.find((e) => e.id === encId);
  enc.def.mode = mode;
  enc.run = freshRun(enc);
  save(); renderAll();
  toast("Structure changed — the run was reset.");
}
function setGoal(encId, value) {
  const enc = library.encounters.find((e) => e.id === encId);
  enc.def.goal = Math.max(1, parseInt(value, 10) || 1);
  save();
}

function thresholdEditorHtml(enc) {
  return '<div class="fld"><label class="flabel">Thresholds ('
    + esc(thresholdUnit(enc)) + ')</label>'
    + (enc.def.thresholds || []).map((t, i) =>
      '<div class="obrow"><input class="inp num" type="number" value="' + t.at
      + '" oninput="setThreshold(\'' + enc.id + "'," + i + ',\'at\',this.value)">'
      + '<input class="inp" placeholder="What it is" value="' + esc(t.label)
      + '" oninput="setThreshold(\'' + enc.id + "'," + i + ',\'label\',this.value)">'
      + '<input class="inp" placeholder="What it grants" value="' + esc(t.effect)
      + '" oninput="setThreshold(\'' + enc.id + "'," + i + ',\'effect\',this.value)">'
      + '<button class="chipbtn danger" onclick="removeThreshold(\'' + enc.id + "'," + i
      + ')">×</button></div>').join("")
    + '<div class="rowbtns"><button class="btn ghost" onclick="addThreshold(\'' + enc.id
    + '\')">Add a threshold</button></div></div>';
}
function setThreshold(encId, i, key, value) {
  const enc = library.encounters.find((e) => e.id === encId);
  enc.def.thresholds[i][key] = key === "at" ? (parseInt(value, 10) || 0) : value;
  save();
}
function addThreshold(encId) {
  const enc = library.encounters.find((e) => e.id === encId);
  enc.def.thresholds.push({ at: 5, label: "", effect: "" });
  save(); renderAll();
}
function removeThreshold(encId, i) {
  const enc = library.encounters.find((e) => e.id === encId);
  enc.def.thresholds.splice(i, 1);
  save(); renderAll();
}

/* ============================================================
   REFERENCE
   ============================================================ */
let refFilter = "";

function referenceHtml() {
  const meta = GENERATED_SUB_META;
  return '<section class="card"><h2>How these work</h2>'
    + '<p class="dim">Paizo\'s own text, generated from the open Foundry pf2e data '
    + "(" + esc(meta.source) + " " + esc(meta.sourceCommit || meta.sourceBranch)
    + ", " + esc(meta.generated) + "), so it can't drift from the book.</p>"
    + SUBSYSTEM_ORDER.concat(["reputation", "duels", "leadership", "hexploration"])
      .map((k) => {
        const sub = SUBSYSTEMS[k];
        const page = SUB_PAGES[sub ? sub.rulesPage : k];
        if (!page) return "";
        return '<details class="ref"><summary>' + esc(page.name)
          + (sub ? "" : ' <span class="dim">· reference only</span>')
          + '<span class="cite">' + esc(page.book) + " pg. " + esc(page.pages) + "</span></summary>"
          + '<div class="refbody">' + inlineActions(page.html) + "</div></details>";
      }).join("")
    + "</section>" + lookupHtml();
}

/* The subsystem pages name actions rather than repeating them; splice the
   action's own text in where the marker sits. */
function inlineActions(html) {
  return html.replace(/<span class="actref" data-action="([^"]+)">([^<]*)<\/span>/g,
    (m, slug, name) => {
      const a = ACTIONS_BY_SLUG[slug];
      if (!a) return "<b>" + esc(name) + "</b>";
      return "<b>" + esc(a.name) + "</b>" + actionMeta(a)
        + '<div class="actbody">' + esc(a.description).replace(/\n+/g, "<br>") + "</div>";
    });
}
function actionMeta(a) {
  const bits = [];
  if (a.actions) bits.push(a.actions + " " + plural(a.actions, "action"));
  if (a.actionType && a.actionType !== "action") bits.push(a.actionType);
  (a.traits || []).forEach((t) => bits.push(t));
  return bits.length ? ' <span class="dim">(' + esc(bits.join(", ")) + ")</span>" : "";
}

function lookupHtml() {
  const t = refFilter.trim().toLowerCase();
  const match = (x) => !t || x.name.toLowerCase().indexOf(t) !== -1;
  const conds = CONDITIONS.filter(match);
  const acts = ACTIONS.filter(match);
  const card = (x, kind) => '<details class="ref"><summary>' + esc(x.name)
    + '<span class="cite">' + kind + "</span></summary>"
    + '<div class="refbody">' + esc(x.description || "").replace(/\n+/g, "<br>")
    + "</div></details>";
  return '<section class="card"><h2>Conditions and actions</h2>'
    + '<input id="refFilter" class="inp" placeholder="Search ' + CONDITIONS.length
    + " conditions and " + ACTIONS.length + ' actions" value="' + esc(refFilter) + '">'
    + (t ? conds.map((c) => card(c, "condition")).join("")
      + acts.map((a) => card(a, "action")).join("")
      : '<p class="dim">Type to search.</p>')
    + "</section>";
}

/* ============================================================
   MENU
   ============================================================ */
function menuHtml() {
  const s = library.settings;
  const meta = GENERATED_SUB_META;
  return '<section class="card"><div class="row spread"><h2>Settings</h2>'
    + '<button class="btn ghost" onclick="closeMenu()">Done</button></div>'
    + field("Theme", ["auto", "light", "dark"].map((m) =>
      '<label class="radio"><input type="radio" name="theme" value="' + m + '"'
      + ((s.themeMode || "auto") === m ? " checked" : "")
      + ' onchange="setThemeMode(\'' + m + '\')"> ' + m + "</label>").join(""))
    + field("Accent", '<input class="inp" type="color" value="'
      + esc((s.custom && s.custom.accent) || "#a87c4a")
      + '" oninput="setAccent(this.value)"> '
      + '<button class="btn ghost" onclick="resetTheme()">Reset</button>')
    + '<div class="note">Everything you type stays in this browser, on this device. '
    + "There is no account and no server. Use an encounter's <b>Code</b> button to "
    + "move prep to another device.</div>"
    + '<div class="note dim">Rules text: ' + esc(meta.source) + " @ "
    + esc(meta.sourceCommit || "?") + " (" + esc(meta.sourceBranch) + "), built "
    + esc(meta.generated) + ". " + esc(meta.pages) + " subsystem pages, "
    + esc(meta.obstacles) + " sample obstacles. "
    + meta.sources.map((x) => esc(x.title) + " (" + esc(x.license) + ")").join(", ")
    + ".</div></section>";
}

/* ============================================================
   BOOT
   ============================================================ */
function empty(title, body) {
  return '<section class="card empty"><h2>' + esc(title) + "</h2><p>" + body + "</p></section>";
}

/* Re-renders blow away focus, so the two free-typing inputs are rewired by
   hand rather than re-rendered on every keystroke. */
function wireInputs() {
  const f = byId("refFilter");
  if (f) {
    f.oninput = () => {
      refFilter = f.value;
      const pos = f.selectionStart;
      byId("views").innerHTML = referenceHtml();
      wireInputs();
      const again = byId("refFilter");
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    };
  }
}

function boot() {
  load();
  applyTheme();
  const icon = byId("titleIcon");
  if (icon) {
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M3 20h18"/><path d="M6 20v-4"/><path d="M11 20v-8"/>'
      + '<path d="M16 20v-12"/><path d="M3 7h18" stroke-dasharray="2.5 2.5"/></svg>';
  }
  current = library.encounters.length ? "run" : "prep";
  renderAll();
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
