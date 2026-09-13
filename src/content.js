/* ============================================================
   src/content.js — the app's own configuration.

   Every word of rules PROSE comes from data/subsystems.generated.js and
   data/reference.generated.js, which are built from the open-source Foundry
   pf2e data so they can't drift from GM Core. This file is the other half:
   the machine-readable shape of each subsystem — its point pools, how a
   degree of success moves them, and the defaults a GM can override.

   engine.js only renders what's here. Adding a sixth subsystem means adding
   an entry to SUBSYSTEMS, not writing a new screen.
   ============================================================ */

/* The four outcomes, in the order they appear on every button row. */
const DEGREES = [
  { key: "critSuccess", label: "Critical success", short: "Crit succ", tone: "heal" },
  { key: "success",     label: "Success",          short: "Success",   tone: "ok" },
  { key: "failure",     label: "Failure",          short: "Failure",   tone: "warn" },
  { key: "critFailure", label: "Critical failure", short: "Crit fail", tone: "harm" },
];

/* Where the rules say "the GM decides", the app asks instead of choosing.
   These strings surface in the prep editor next to the field in question. */
const GM_CALLS = {
  obstacleCost:
    "How many points an obstacle needs is yours to set. The default follows " +
    "GM Core's rule of thumb; raise it for a particularly demanding obstacle.",
  awarenessFail:
    "When the infiltration fails is yours to set. The default is twice the " +
    "Infiltration Points the job needs, with a complication at each quarter.",
  roundLength:
    "A round is however long you say it is — the book gives a range, not a number.",
  thresholds:
    "Thresholds and what reaching one grants are entirely yours; the book " +
    "gives scales, not contents.",
  thresholdProgress:
    "Counted in obstacles cleared, not points — the points reset at every " +
    "obstacle, so they are not what measures progress across the whole run.",
  researchCap:
    "Each research check has a maximum RP. Past it the PCs learn nothing new " +
    "from that source and have to go looking elsewhere.",
};

const SUBSYSTEMS = {
  /* ---------------------------------------------------------- */
  chase: {
    key: "chase",
    name: "Chase",
    glyph: "»",
    rulesPage: "chases",
    blurb: "A run of obstacles, one action per PC per round. The group's " +
           "points clear the obstacle in front of them — and the extras " +
           "don't carry over.",
    pools: [{ key: "cp", name: "Chase Points", abbr: "CP", min: 0, role: "goal" }],
    scale: {
      critSuccess: { cp: 2 },
      success:     { cp: 1 },
      failure:     {},
      critFailure: { cp: -1 },
    },
    structure: "sequence",
    /* Chase Points reset at every obstacle, so a threshold counted in points
       would be meaningless. What advances across a chase is obstacles cleared. */
    thresholdBasis: "progress",
    /* GM Core: half the obstacles need one fewer point than the party size,
       half need two fewer, minimum 1. */
    obstacleCost: { base: "party", offsets: [1, 2], min: 1 },
    presets: [
      { key: "short",  label: "Short",  obstacles: 6,  note: "about 10–20 minutes of game time" },
      { key: "medium", label: "Medium", obstacles: 8,  note: "about 15–25 minutes" },
      { key: "long",   label: "Long",   obstacles: 10, note: "about 20–30 minutes" },
    ],
    extras: [
      { key: "cantAct", label: "Couldn't act", deltas: { cp: -1 },
        note: "A PC who passes their turn or can't act costs the group 1 CP." },
      { key: "bypass", label: "Bypassed it", deltas: { cp: 1 },
        note: "An action that gets past the obstacle without a check — a spell, " +
              "usually 1 CP, or 2 if it was exceptionally helpful." },
    ],
    obstacleLibrary: true,
    asks: ["obstacleCost", "thresholdProgress"],
  },

  /* ---------------------------------------------------------- */
  infiltration: {
    key: "infiltration",
    name: "Infiltration",
    glyph: "◑",
    rulesPage: "infiltration",
    blurb: "Two pools running against each other: points toward the job, and " +
           "the opposition slowly noticing you. A failed check costs you both.",
    pools: [
      { key: "ip", name: "Infiltration Points", abbr: "IP", min: 0, role: "goal" },
      { key: "ap", name: "Awareness Points",    abbr: "AP", min: 0, role: "hazard" },
    ],
    scale: {
      critSuccess: { ip: 2 },
      success:     { ip: 1 },
      failure:     { ap: 1 },
      critFailure: { ap: 2 },
    },
    /* The one everybody forgets at the table. */
    roundEnd: { ap: 1 },
    roundEndNote: "Each infiltration round that passes adds 1 Awareness Point.",
    structure: "sequence",
    /* As with a chase: progress is obstacles, not the points inside one. The
       ladder that matters here is Awareness, and that one is derived. */
    thresholdBasis: "progress",
    obstacleModes: [
      { key: "group", label: "Group", note: "The party pools its points; cleared once for everyone." },
      { key: "individual", label: "Individual", note: "Every PC has to earn the points separately." },
    ],
    /* Failure at twice the IP the job needs, with a complication each quarter. */
    awarenessRule: { multiplier: 2, steps: 4 },
    edge: {
      key: "ep", name: "Edge Points", abbr: "EP",
      note: "Earned by preparation activities beforehand. Spend 1 to turn a " +
            "failure or critical failure into a success — no points to the " +
            "opposition, 1 IP to you.",
    },
    prepActivities: [
      { slug: "bribe-contact",    name: "Bribe Contact" },
      { slug: "forge-documents",  name: "Forge Documents" },
      { slug: "gain-contact",     name: "Gain Contact" },
      { slug: "gossip",           name: "Gossip" },
      { slug: "scout-location",   name: "Scout Location" },
      { slug: "secure-disguises", name: "Secure Disguises" },
    ],
    extras: [
      { key: "helped", label: "Helped without a check", deltas: { ip: 1 },
        note: "A spell or action that just works — usually 1 IP, 2 if it was " +
              "particularly helpful." },
      { key: "noticed", label: "Something went wrong", deltas: { ap: 1 },
        note: "Anything disruptive the rules don't price. Your call." },
    ],
    asks: ["awarenessFail", "obstacleCost", "thresholdProgress"],
  },

  /* ---------------------------------------------------------- */
  influence: {
    key: "influence",
    name: "Influence",
    glyph: "◇",
    rulesPage: "influence",
    blurb: "A social encounter in rounds. Each PC either works on the NPC or " +
           "works out what the NPC actually responds to.",
    pools: [{ key: "ip", name: "Influence Points", abbr: "IP", min: 0, role: "goal" }],
    scale: {
      critSuccess: { ip: 2 },
      success:     { ip: 1 },
      failure:     {},
      critFailure: { ip: -1 },
    },
    structure: "single",
    roundLength: { low: "15 minutes", high: "an hour" },
    /* Each PC acts once per round, choosing one of these. */
    actions: [
      { key: "influence", name: "Influence", slug: "influence", scored: true },
      { key: "discover",  name: "Discover",  slug: "discover",  scored: false,
        /* How many facts a Discover reveals. -1 means the GM feeds them a
           plausible lie, which the app records but does not invent. */
        reveals: { critSuccess: 2, success: 1, failure: 0, critFailure: -1 } },
    ],
    discoverNote:
      "On a critical failure the PC learns something incorrect. The app marks " +
      "the round; what the lie is, is yours.",
    asks: ["roundLength", "thresholds"],
  },

  /* ---------------------------------------------------------- */
  research: {
    key: "research",
    name: "Research",
    glyph: "❖",
    rulesPage: "research",
    blurb: "Points against thresholds that hand over information — with each " +
           "source drying up once it has given all it has.",
    pools: [{ key: "rp", name: "Research Points", abbr: "RP", min: 0, role: "goal" }],
    scale: {
      critSuccess: { rp: 2 },
      success:     { rp: 1 },
      failure:     {},
      critFailure: { rp: -1 },
    },
    structure: "checks",
    roundLength: { low: "10 minutes", high: "a full day" },
    checkNote:
      "List the skills for a source lowest DC first — that's the order the " +
      "book uses, and it reads as a hint to the players.",
    asks: ["researchCap", "roundLength", "thresholds"],
  },

  /* ---------------------------------------------------------- */
  custom: {
    key: "custom",
    name: "Victory Points",
    glyph: "◆",
    rulesPage: "victory-points",
    blurb: "The bare framework the other four are built on. Name your points, " +
           "set your thresholds, and run anything — reputation, a duel, a " +
           "hexploration, a race against a rival crew.",
    pools: [{ key: "vp", name: "Victory Points", abbr: "VP", min: 0, role: "goal" }],
    structure: "single",
    renameable: true,
    /* The two structures GM Core defines. The scale comes from the mode. */
    modes: [
      { key: "accumulating", label: "Accumulating",
        note: "Start at nothing and climb toward the end point.",
        scale: {
          critSuccess: { vp: 2 },
          success:     { vp: 1 },
          failure:     {},
          critFailure: { vp: -1 },
        } },
      { key: "diminishing", label: "Diminishing",
        note: "Start at the end point and try not to lose it. On a critical " +
              "success the PCs gain a point only if regaining ground is " +
              "possible — otherwise treat it as a success.",
        startAtGoal: true,
        scale: {
          critSuccess: { vp: 1 },
          success:     {},
          failure:     { vp: -1 },
          critFailure: { vp: -2 },
        } },
    ],
    /* Presets come from the VP Scales table in the generated data. */
    scalePresets: true,
    asks: ["thresholds"],
  },
};

/* The order they appear in the "new encounter" picker. */
const SUBSYSTEM_ORDER = ["chase", "infiltration", "influence", "research", "custom"];
