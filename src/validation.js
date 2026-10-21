/* File and encounter-code boundaries. Build a fresh, known shape before any
   imported value reaches storage, the run engine or an HTML event handler. */
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_PARTICIPANTS = 24;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const reservedKey = (key) => key === 'prototype' || key in Object.prototype;

function invalid(message) { throw new Error(message); }
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label + " must be an object.");
  if (Object.keys(value).some(reservedKey)) invalid(label + " contains an unsupported field.");
  return value;
}
function text(value, label, max = 2000) {
  if (typeof value !== "string" || value.length > max) invalid(label + " is missing or too long.");
  return value;
}
function integer(value, label, min = 0, max = 1000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(label + " is outside its allowed range.");
  return value;
}
function identifier(value, label) {
  text(value, label, 80);
  if (!/^[A-Za-z0-9_-]+$/.test(value) || reservedKey(value)) invalid(label + " is invalid.");
  return value;
}
function list(value, label, max, convert) {
  if (!Array.isArray(value) || value.length > max) invalid(label + " is missing or too large.");
  return value.map(convert);
}
function unique(values, label) {
  if (new Set(values).size !== values.length) invalid(label + " contains duplicates.");
  return values;
}
function names(value) {
  return unique(list(value, "Participants", MAX_PARTICIPANTS, (name) => {
    text(name, "Participant name", 120);
    if (!name.trim() || reservedKey(name)) invalid("A participant name is invalid.");
    return name;
  }), "Participants");
}

function validateDefinition(subKey, value) {
  const source = record(value, "Encounter preparation");
  const sub = SUBSYSTEMS[subKey];
  const def = {
    participants: names(source.participants),
    thresholds: list(source.thresholds, "Thresholds", 200, (row) => {
      record(row, "Threshold");
      return { at: integer(row.at, "Threshold", 0), label: text(row.label, "Threshold label"),
        effect: text(row.effect, "Threshold effect", 20000) };
    }),
    note: text(source.note == null ? "" : source.note, "Encounter note", 20000),
  };
  if (sub.structure === "sequence") {
    def.obstacles = list(source.obstacles, "Obstacles", 1000, (row) => {
      record(row, "Obstacle");
      if (!["group", "individual"].includes(row.mode)) invalid("Unknown obstacle mode.");
      return { id: identifier(row.id, "Obstacle ID"), name: text(row.name, "Obstacle name"),
        note: text(row.note == null ? "" : row.note, "Obstacle note", 20000),
        cost: integer(row.cost, "Obstacle cost", 1), mode: row.mode,
        options: list(row.options, "Obstacle checks", 100, (option) => {
          record(option, "Obstacle check");
          const item = { skill: text(option.skill, "Skill", 120), dc: integer(option.dc, "DC") };
          if (option.how != null) item.how = text(option.how, "Check description", 20000);
          return item;
        }) };
    });
    unique(def.obstacles.map((row) => row.id), "Obstacle IDs");
  }
  if (subKey === "chase" && source.presetKey != null) {
    if (!sub.presets.some((preset) => preset.key === source.presetKey)) invalid("Unknown chase length.");
    def.presetKey = source.presetKey;
  }
  if (subKey === "infiltration") {
    def.edgeStart = integer(source.edgeStart, "Starting Edge Points");
    def.apFail = source.apFail == null ? null : integer(source.apFail, "Awareness limit", 1);
  }
  if (subKey === "research") {
    def.checks = list(source.checks, "Research sources", 1000, (row) => {
      record(row, "Research source");
      return { id: identifier(row.id, "Source ID"), name: text(row.name, "Source name"),
        skill: text(row.skill, "Skill", 120), dc: integer(row.dc, "DC"), cap: integer(row.cap, "Source limit") };
    });
    unique(def.checks.map((row) => row.id), "Source IDs");
  }
  if (subKey === "influence") {
    const npc = record(source.npc, "NPC");
    def.npc = { name: text(npc.name, "NPC name"), discoveryDC: integer(npc.discoveryDC, "Discovery DC"),
      skills: list(npc.skills, "Influence skills", 100, (row) => {
        record(row, "Influence skill");
        return { skill: text(row.skill, "Skill", 120), dc: integer(row.dc, "DC") };
      }) };
    for (const key of ["resistances", "weaknesses"]) {
      def.npc[key] = list(npc[key], key, 100, (row) => {
        record(row, "NPC fact");
        return { label: text(row.label, "NPC fact"), dc: integer(row.dc, "DC adjustment", -1000000) };
      });
    }
  }
  if (subKey === "custom") {
    if (!sub.modes.some((mode) => mode.key === source.mode)) invalid("Unknown Victory Point structure.");
    def.mode = source.mode;
    def.pointName = text(source.pointName, "Point name", 120);
    def.pointAbbr = text(source.pointAbbr, "Point abbreviation", 8);
    def.goal = integer(source.goal, "Victory Point goal");
  }
  for (const key of ["roundMinutes", "roundLabel", "scaleLabel"]) {
    if (source[key] != null) def[key] = text(source[key], key, 2000);
  }
  return def;
}

function validateRun(value, subKey, includeLog = true) {
  const source = record(value, "Live run");
  const numberMap = (input, label) => {
    record(input, label);
    if (Object.keys(input).length > 1000) invalid(label + " is too large.");
    const result = {};
    for (const key of Object.keys(input)) {
      text(key, label + " key", 120);
      result[key] = integer(input[key], label + " value", 0, Number.MAX_SAFE_INTEGER);
    }
    return result;
  };
  const run = { pools: numberMap(source.pools, "Point pools"), round: integer(source.round, "Round", 1),
    obstacleIndex: integer(source.obstacleIndex, "Obstacle progress"), perPC: {},
    checks: numberMap(source.checks, "Research progress"),
    revealed: list(source.revealed, "Revealed facts", 200, (item) => text(item, "Fact", 120)),
    fired: list(source.fired, "Triggered thresholds", 200, (item) => text(item, "Threshold", 120)) };
  for (const pool of SUBSYSTEMS[subKey].pools) {
    if (!own(run.pools, pool.key)) invalid("A point pool is missing.");
  }
  if (SUBSYSTEMS[subKey].edge && !own(run.pools, "ep")) invalid("Edge Points are missing.");
  const progress = record(source.perPC, "Participant progress");
  if (Object.keys(progress).length > 1000) invalid("Participant progress is too large.");
  for (const key of Object.keys(progress)) {
    identifier(key, "Obstacle progress ID");
    run.perPC[key] = numberMap(progress[key], "Participant progress");
  }
  if (source.revealHint != null) run.revealHint = integer(source.revealHint, "Discovery result", -1, 2);
  if (source._justCleared != null) run._justCleared = text(source._justCleared, "Last obstacle");
  if (includeLog) {
    run.log = list(source.log, "Undo history", 200, (entry) => {
      record(entry, "History entry");
      const result = { id: identifier(entry.id, "History ID"), at: text(entry.at, "History date", 80),
        round: integer(entry.round, "History round", 1), kind: text(entry.kind, "History kind", 80),
        label: text(entry.label, "History label", 20000), before: validateRun(entry.before, subKey, false) };
      if (entry.actor != null) result.actor = text(entry.actor, "History actor", 120);
      if (entry.degree != null) result.degree = text(entry.degree, "History result", 80);
      if (entry.reveals != null) result.reveals = integer(entry.reveals, "History discovery", -1, 2);
      return result;
    });
  }
  return run;
}

function validateParty(value) {
  const source = record(value, "Party preset");
  const participants = names(source.participants);
  const name = text(source.name, "Party name", 120).trim();
  if (!name || !participants.length) invalid("Give the party a name and at least one participant.");
  return { id: identifier(source.id, "Party ID"), name, participants };
}

function validateLibrary(value) {
  const source = record(value, "Library");
  if (source.v !== 1) invalid("This library version is not supported.");
  const settings = source.settings == null ? {} : record(source.settings, "Settings");
  const mode = settings.themeMode || "auto";
  if (!["auto", "light", "dark"].includes(mode)) invalid("Unknown theme setting.");
  const result = { v: 1, settings: { themeMode: mode, custom: null, keepAwake: false },
    parties: list(source.parties || [], "Party presets", 100, validateParty),
    encounters: [], activeId: null };
  if (settings.keepAwake != null) {
    if (typeof settings.keepAwake !== "boolean") invalid("Invalid keep-awake setting.");
    result.settings.keepAwake = settings.keepAwake;
  }
  if (settings.custom != null) {
    record(settings.custom, "Theme colors");
    const accent = text(settings.custom.accent, "Accent", 7);
    if (!/^#[a-fA-F0-9]{6}$/.test(accent)) invalid("Invalid accent color.");
    result.settings.custom = { accent };
  }
  unique(result.parties.map((party) => party.id), "Party IDs");
  if (settings.lastPartyId != null && result.parties.some((party) => party.id === settings.lastPartyId)) {
    result.settings.lastPartyId = settings.lastPartyId;
  }
  result.encounters = list(source.encounters, "Encounters", 1000, (entry) => {
    record(entry, "Encounter");
    if (typeof entry.subsystem !== 'string' || !own(SUBSYSTEMS, entry.subsystem)) invalid("Unknown subsystem.");
    return { id: identifier(entry.id, "Encounter ID"), subsystem: entry.subsystem,
      name: text(entry.name, "Encounter name"), createdAt: text(entry.createdAt, "Encounter date", 80),
      def: validateDefinition(entry.subsystem, entry.def), run: validateRun(entry.run, entry.subsystem) };
  });
  unique(result.encounters.map((encounter) => encounter.id), "Encounter IDs");
  if (source.activeId != null) {
    identifier(source.activeId, "Active encounter ID");
    if (!result.encounters.some((entry) => entry.id === source.activeId)) invalid("The active encounter is missing.");
    result.activeId = source.activeId;
  }
  return result;
}

function parseEncounterCode(code) {
  if (typeof code !== "string" || code.length > 1000000) invalid("That encounter code is too large.");
  const input = code.trim();
  if (!input || !/^[A-Za-z0-9+/]+={0,2}$/.test(input)) invalid("That doesn't look like an encounter code.");
  let source;
  try { source = JSON.parse(b64decode(input)); }
  catch (error) { invalid("That doesn't look like an encounter code."); }
  record(source, "Encounter code");
  if (source.t !== "pf2e-subsystem" || source.v !== 1) invalid("That encounter-code version is not supported.");
  if (typeof source.subsystem !== 'string' || !own(SUBSYSTEMS, source.subsystem)) invalid("Unknown subsystem.");
  return { subsystem: source.subsystem,
    name: source.name == null ? SUBSYSTEMS[source.subsystem].name : text(source.name, "Encounter name"),
    def: validateDefinition(source.subsystem, source.def) };
}

function parseBackupFile(input) {
  if (typeof input !== "string" || new TextEncoder().encode(input).length > MAX_BACKUP_BYTES) {
    invalid("Choose a backup smaller than 5 MB.");
  }
  let source;
  try { source = JSON.parse(input.replace(/^\uFEFF/, "")); }
  catch (error) { invalid("This file isn't a readable backup."); }
  record(source, "Backup");
  if (source.t !== "pf2e-subsystems-backup" || source.v !== 1) invalid("That backup version is not supported.");
  return { createdAt: text(source.createdAt, "Backup date", 80), library: validateLibrary(source.library) };
}
