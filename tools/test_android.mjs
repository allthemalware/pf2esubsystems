/* Dependency-free checks of the bundled app's bridge, persistence and Back
   behavior. A small document fixture holds generated HTML; visual layout and
   Android framework behavior still require a browser/device. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const args of [[], ["--android"]]) {
  const build = spawnSync("python3", ["tools/build.py", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
}
const nativeHtml = readFileSync(new URL("../android/app/build/generated/pf2eAssets/www/index.html", import.meta.url), "utf8");
const webHtml = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");

function fixture({ native = true, storage = new Map() } = {}) {
  const nodes = new Map();
  function makeNode(id) {
    let html = '';
    const node = { textContent: '', value: '', open: false, isConnected: true, dataset: {},
      classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, focus() {},
      addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
      showModal() { this.open = true; }, close() { this.open = false; } };
    Object.defineProperty(node, 'innerHTML', {
      get: () => html,
      set: (value) => {
        html = value;
        for (const match of value.matchAll(/\bid="([^"]+)"/g)) if (!nodes.has(match[1])) makeNode(match[1]);
      },
    });
    nodes.set(id, node);
    return node;
  }
  for (const id of ["views", "tabs", "headSub", "undoBtn", "titleIcon", "toast", "runStatus", "appDialog", "dialogBody", "backupFile"]) makeNode(id);
  const shared = [], copied = [], back = [], registrations = [], awake = [], backups = [], tips = [];
  const context = vm.createContext({
    document: {
      getElementById: (id) => nodes.get(id) || null,
      querySelector: () => null,
      addEventListener() {},
      hidden: false,
      documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } },
    },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    navigator: {
      clipboard: { writeText: (code) => { copied.push(code); return Promise.resolve(); } },
      serviceWorker: { register: (path) => { registrations.push(path); return Promise.resolve(); } },
    },
    location: { protocol: "https:" },
    PF2ENative: {
      shareEncounter: (code, name) => shared.push({ code, name }),
      setBackEnabled: (enabled) => back.push(enabled),
      setKeepAwake: (enabled) => awake.push(enabled),
      saveBackup: (contents) => backups.push(contents),
      openBackup() {},
      showTips: () => tips.push(true),
    },
    matchMedia: () => ({ matches: true }),
    scrollTo() {},
    setTimeout: () => 0,
    clearTimeout() {},
    confirm: () => true,
    prompt: () => null,
    btoa: (value) => Buffer.from(value, "latin1").toString("base64"),
    atob: (value) => Buffer.from(value, "base64").toString("latin1"),
    console,
    TextEncoder,
  });
  context.window = context;
  const html = native ? nativeHtml : webHtml;
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(script, context, { timeout: 5000 });
  }
  assert.equal(nodes.get("views").textContent, "", "bundled app booted without the fallback error");
  const ev = (source) => vm.runInContext(source, context, { timeout: 5000 });
  const addEncounter = () => ev(`(() => {
    const e = newEncounter('chase', { preset: 'short', partySize: 4 });
    e.name = 'Passage — épreuve';
    library.encounters.push(e); library.activeId = e.id; save(); renderAll();
    return e.id;
  })()`);
  return { ev, nodes, shared, copied, back, registrations, storage, addEncounter, awake, backups, tips };
}

test("Android boots offline with Run, Prep and Reference, and no Primer view", () => {
  const app = fixture();
  assert.equal(app.ev("VIEWS.map(v => v.label).join(',')"), "Run,Prep,Reference");
  assert.match(app.nodes.get("views").innerHTML, /Start something/);
  assert.deepEqual(app.registrations, []);
  app.ev("go('reference')");
  assert.match(app.nodes.get("views").innerHTML, /Pathfinder GM Core/);
  assert.match(app.nodes.get("views").innerHTML, /Conditions and actions/);
});

test("Settings include complete offline application, rules and Android library notices", () => {
  const app = fixture();
  const notices = JSON.parse(app.ev("JSON.stringify(APP_NOTICES)"));
  assert.equal(notices[0].text, readFileSync(new URL("../LICENSE", import.meta.url), "utf8"));
  assert.equal(notices[1].text, readFileSync(new URL("../notice.md", import.meta.url), "utf8"));
  assert.match(notices[2].text, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
  app.ev("openMenu()");
  assert.match(app.nodes.get("views").innerHTML, /not affiliated with Paizo/);
  assert.match(app.nodes.get("views").innerHTML, /Android libraries/);
});

test("tips use only the Android billing bridge and never change the encounter library", () => {
  const app = fixture();
  app.addEncounter();
  const before = app.ev('JSON.stringify(library)');
  app.ev('openMenu()');
  assert.match(app.nodes.get('views').innerHTML, /Leave a tip through Google Play/);
  assert.match(app.nodes.get('views').innerHTML, /optional, one-time tip/);
  assert.match(app.nodes.get('views').innerHTML, /All features are free/);
  app.ev('showPlayTips()');
  assert.equal(app.tips.length, 1);
  assert.equal(app.ev('JSON.stringify(library)'), before);

  const browser = fixture({ native: false });
  browser.ev('openMenu(); showPlayTips()');
  assert.doesNotMatch(browser.nodes.get('views').innerHTML, /Leave a tip|Support development/);
  assert.equal(browser.tips.length, 0, 'a browser cannot launch native checkout');

  app.ev('delete window.PF2ENative.showTips; renderAll(); showPlayTips()');
  assert.doesNotMatch(app.nodes.get('views').innerHTML, /Leave a tip/);
  assert.equal(app.tips.length, 1, 'older native hosts remain compatible');
});

test("Android sharing sends Unicode prep through the native bridge, without live dice", () => {
  const app = fixture();
  const id = app.addEncounter();
  app.ev(`score(${JSON.stringify(id)}, 'Mari', 'success')`);
  app.ev(`exportEncounter(${JSON.stringify(id)})`);
  assert.equal(app.shared.length, 1);
  assert.equal(app.shared[0].name, "Passage — épreuve");
  const payload = JSON.parse(Buffer.from(app.shared[0].code, "base64").toString("utf8"));
  assert.equal(payload.name, "Passage — épreuve");
  assert.equal(payload.subsystem, "chase");
  assert.equal(payload.def.obstacles.length, 6);
  assert.equal(payload.run, undefined);
  assert.equal(payload.id, undefined);
  assert.deepEqual(app.copied, []);
  assert.match(app.ev("libraryHtml()"), />Share<\/button>/);
});

test("a shared Android encounter imports into the browser app with a fresh run", () => {
  const app = fixture();
  const id = app.addEncounter();
  app.ev(`score(${JSON.stringify(id)}, 'Mari', 'success'); exportEncounter(${JSON.stringify(id)})`);
  const browser = fixture({ native: false });
  assert.equal(browser.ev(`importEncounter(${JSON.stringify(app.shared[0].code)})`), true);
  assert.equal(browser.ev("activeEnc().name"), "Passage — épreuve");
  assert.equal(browser.ev("activeEnc().run.pools.cp"), 0);
  assert.equal(browser.ev("activeEnc().run.log.length"), 0);
});

test("browser export keeps the clipboard action even when a native-looking object exists", async () => {
  const app = fixture({ native: false });
  const id = app.addEncounter();
  app.ev(`exportEncounter(${JSON.stringify(id)})`);
  await Promise.resolve();
  assert.equal(app.shared.length, 0);
  assert.equal(app.copied.length, 1);
  assert.match(app.ev("libraryHtml()"), />Code<\/button>/);
  assert.deepEqual(app.registrations, ["sw.js"]);
});

test("Back closes Settings, then returns from Reference to Run, then yields to Android", () => {
  const app = fixture();
  app.addEncounter();
  app.ev("go('reference'); openMenu()");
  assert.equal(app.back.at(-1), true);
  assert.equal(app.ev("handleAndroidBack()"), true);
  assert.equal(app.ev("menuOpen"), false);
  assert.equal(app.ev("current"), "reference");
  assert.equal(app.ev("handleAndroidBack()"), true);
  assert.equal(app.ev("current"), "run");
  assert.equal(app.back.at(-1), false);
  assert.equal(app.ev("handleAndroidBack()"), false);
});

test("Back returns an empty library to Prep without trapping users in the app", () => {
  const app = fixture();
  assert.equal(app.back.at(-1), false);
  app.ev("go('reference')");
  assert.equal(app.back.at(-1), true);
  assert.equal(app.ev("handleAndroidBack()"), true);
  assert.equal(app.ev("current"), "prep");
  assert.equal(app.ev("handleAndroidBack()"), false);
});

test("encounter state and undo survive a fresh app process", () => {
  const app = fixture();
  const id = app.addEncounter();
  app.ev(`score(${JSON.stringify(id)}, 'Mari', 'success')`);
  const before = app.ev("JSON.stringify(activeEnc().run)");
  const restarted = fixture({ storage: app.storage });
  assert.equal(restarted.ev("current"), "run");
  assert.equal(restarted.ev("JSON.stringify(activeEnc().run)"), before);
  restarted.ev("undoLast()");
  assert.equal(restarted.ev("activeEnc().run.pools.cp"), 0);
  assert.equal(restarted.ev("activeEnc().run.log.length"), 0);
});

function setupFor(subKey, overrides = {}) {
  return { name: 'Evening session', participants: "D'Artagnan\nSable", partySize: 2,
    preset: 'short', npcName: 'Quartermaster', pointName: 'Reputation', scaleIndex: 1, ...overrides };
}
function jsonAt(app, source) { return JSON.parse(app.ev('JSON.stringify(' + source + ')')); }

test('all five mobile setup forms open without text prompts and cancel with Back', () => {
  const app = fixture();
  app.ev('prompt = () => { throw new Error("Unexpected prompt"); }');
  for (const key of ['chase', 'infiltration', 'influence', 'research', 'custom']) {
    app.ev(`startNew(${JSON.stringify(key)})`);
    assert.equal(app.ev('dialogState.kind'), 'create');
    assert.equal(app.back.at(-1), true);
    assert.match(app.nodes.get('dialogBody').innerHTML, /encounterForm/);
    assert.equal(app.ev('handleAndroidBack()'), true);
    assert.equal(app.ev('dialogState'), null);
    assert.equal(app.ev('library.encounters.length'), 0);
  }
});

test('mobile setup creates every subsystem with the requested participants', () => {
  const app = fixture();
  for (const key of ['chase', 'infiltration', 'influence', 'research', 'custom']) {
    const id = app.ev(`createFromSetup(${JSON.stringify(key)}, ${JSON.stringify(setupFor(key))})`);
    assert.equal(typeof id, 'string');
    assert.deepEqual(jsonAt(app, 'activeEnc().def.participants'), ["D'Artagnan", 'Sable']);
    app.ev(`validateDefinition(${JSON.stringify(key)}, activeEnc().def)`);
  }
  assert.equal(app.ev('library.encounters.length'), 5);
});

test('invalid setup leaves saved data untouched', () => {
  const app = fixture();
  app.addEncounter();
  const before = app.ev('JSON.stringify(library)');
  for (const changes of [{ partySize: 0, participants: '' }, { partySize: 10000, participants: '' }, { participants: 'Mari,Mari' }, { preset: 'invalid' }]) {
    assert.throws(() => app.ev(`createFromSetup('chase', ${JSON.stringify(setupFor('chase', changes))})`));
    assert.equal(app.ev('JSON.stringify(library)'), before);
  }
});

test('obstacle picker searches the entire library and selects beyond the old 20-row limit', () => {
  const app = fixture();
  const id = app.addEncounter();
  const size = app.ev('GENERATED_CHASE_OBSTACLES.length');
  app.ev(`pickObstacle(${JSON.stringify(id)})`);
  assert.equal(app.ev('dialogState.kind'), 'obstacles');
  assert.equal(app.ev("obstacleMatches('').length"), size);
  assert.equal(app.ev(`chooseObstacle(${size - 1})`), true);
  assert.equal(app.ev('activeEnc().def.obstacles.length'), 7);
  assert.equal(app.ev('activeEnc().def.obstacles[6].name'), app.ev(`GENERATED_CHASE_OBSTACLES[${size - 1}].name`));
});

test('party presets survive reload and editing a preset leaves existing encounters unchanged', () => {
  const app = fixture();
  const id = app.ev(`savePartyPreset(null, 'Friday group', "Mari,Sable")`);
  app.ev(`createFromSetup('research', ${JSON.stringify(setupFor('research', { partyId: id, participants: 'Mari,Sable' }))})`);
  assert.equal(app.ev('library.settings.lastPartyId'), id);
  app.ev(`savePartyPreset(${JSON.stringify(id)}, 'Friday group', 'Mari,Sable,Bel')`);
  assert.deepEqual(jsonAt(app, 'activeEnc().def.participants'), ['Mari', 'Sable']);
  const restarted = fixture({ storage: app.storage });
  assert.deepEqual(jsonAt(restarted, 'library.parties[0].participants'), ['Mari', 'Sable', 'Bel']);
  restarted.ev(`deletePartyPreset(${JSON.stringify(id)})`);
  assert.equal(restarted.ev('library.parties.length'), 0);
  assert.deepEqual(jsonAt(restarted, 'activeEnc().def.participants'), ['Mari', 'Sable']);
});

test('malformed encounter codes, future versions and unsafe IDs never change the library', () => {
  const app = fixture();
  const id = app.addEncounter();
  const def = jsonAt(app, 'activeEnc().def');
  const original = app.ev('JSON.stringify(library)');
  const base = { t: 'pf2e-subsystem', v: 1, name: 'Imported', subsystem: 'chase', def };
  const badInputs = [
    { ...base, v: 2 }, { ...base, subsystem: '__proto__' }, { ...base, subsystem: ['chase'] },
    { ...base, def: null }, { ...base, def: { ...def, participants: 'Mari' } },
    { ...base, def: { ...def, participants: ['toString'] } },
    { ...base, def: { ...def, obstacles: [{ ...def.obstacles[0], cost: -1 }] } },
    { ...base, def: { ...def, obstacles: [{ ...def.obstacles[0], id: "');alert(1)//" }] } },
    { ...base, def: { ...def, obstacles: [{ ...def.obstacles[0], options: {} }] } },
  ];
  for (const value of badInputs) {
    const code = Buffer.from(JSON.stringify(value)).toString('base64');
    assert.equal(app.ev(`importEncounter(${JSON.stringify(code)})`), false);
    assert.equal(app.ev('JSON.stringify(library)'), original);
    assert.equal(app.ev('activeEnc().id'), id);
  }
});

test('all subsystem preparations share and import successfully with strict validation', () => {
  const app = fixture();
  const browser = fixture({ native: false });
  for (const key of ['chase', 'infiltration', 'influence', 'research', 'custom']) {
    const id = app.ev(`createFromSetup(${JSON.stringify(key)}, ${JSON.stringify(setupFor(key))})`);
    app.ev(`exportEncounter(${JSON.stringify(id)})`);
    const code = app.shared.at(-1).code;
    assert.equal(browser.ev(`importEncounter(${JSON.stringify(code)})`), true);
    assert.deepEqual(jsonAt(browser, 'activeEnc().def'), jsonAt(app, 'activeEnc().def'));
    assert.equal(browser.ev('activeEnc().run.log.length'), 0);
  }
});

test('full backup and restore preserve all five run types, history, settings and party presets', () => {
  const app = fixture();
  app.ev("savePartyPreset(null, 'Friday group', 'Mari,Sable'); library.settings.themeMode='light'; library.settings.custom={accent:'#238b74'}; library.settings.keepAwake=true");
  for (const key of ['chase', 'infiltration', 'influence', 'research', 'custom']) {
    const id = app.ev(`createFromSetup(${JSON.stringify(key)}, ${JSON.stringify(setupFor(key))})`);
    app.ev(`score(${JSON.stringify(id)}, "D'Artagnan", 'success'); advanceRound(${JSON.stringify(id)})`);
  }
  const expected = jsonAt(app, 'validateLibrary(library)');
  const file = app.ev('makeBackupText()');
  app.ev('downloadBackup()');
  assert.equal(app.backups.length, 1);
  const restored = fixture();
  assert.equal(restored.ev(`receiveBackupFile(${JSON.stringify(file)})`), true);
  assert.equal(restored.ev('library.encounters.length'), 0, 'choosing a backup stages it without replacing anything');
  assert.equal(restored.ev('restoreBackupCandidate()'), true);
  assert.deepEqual(jsonAt(restored, 'library'), expected);
  restored.ev('undoLast()');
  assert.equal(restored.ev('activeEnc().run.round'), 1);
  assert.equal(restored.ev('activeEnc().run.pools.vp'), 1);
});

test('cancelled, malformed or unsupported backups preserve existing saved progress', () => {
  const app = fixture();
  app.addEncounter();
  const before = app.ev('JSON.stringify(library)');
  const saved = app.storage.get('pf2eSubsystems.v1');
  const valid = app.ev('makeBackupText()');
  app.ev(`receiveBackupFile(${JSON.stringify(valid)}); closeDialog()`);
  assert.equal(app.ev('JSON.stringify(library)'), before);
  for (const input of ['not json', '{}', valid.replace('"v":1', '"v":99')]) {
    assert.equal(app.ev(`receiveBackupFile(${JSON.stringify(input)})`), false);
    assert.equal(app.ev('JSON.stringify(library)'), before);
    assert.equal(app.storage.get('pf2eSubsystems.v1'), saved);
  }
});

test('a full-storage error during restore or import does not replace the current library', () => {
  const app = fixture();
  const id = app.addEncounter();
  const file = app.ev('makeBackupText()');
  app.ev(`exportEncounter(${JSON.stringify(id)})`);
  app.ev(`receiveBackupFile(${JSON.stringify(file)})`);
  const before = app.ev('JSON.stringify(library)');
  app.ev('localStorage.setItem = () => { throw new Error("full"); }');
  assert.equal(app.ev('restoreBackupCandidate()'), false);
  assert.equal(app.ev(`importEncounter(${JSON.stringify(app.shared[0].code)})`), false);
  assert.equal(app.ev('JSON.stringify(library)'), before);
});

test('backup validation rejects a broken undo snapshot and oversized files', () => {
  const app = fixture();
  const id = app.addEncounter();
  app.ev(`score(${JSON.stringify(id)}, 'Mari', 'success')`);
  const payload = JSON.parse(app.ev('makeBackupText()'));
  payload.library.encounters[0].run.log[0].before.pools.cp = -1;
  assert.equal(app.ev(`receiveBackupFile(${JSON.stringify(JSON.stringify(payload))})`), false);
  assert.equal(app.ev(`receiveBackupFile(' '.repeat(MAX_BACKUP_BYTES + 1))`), false);
});

test('keep-awake is opt-in and applies only to a visible encounter on Run', () => {
  const app = fixture();
  app.addEncounter();
  app.ev("go('run')");
  assert.equal(app.awake.at(-1), false);
  app.ev('setKeepAwake(true)');
  assert.equal(app.awake.at(-1), true);
  app.ev('openMenu()');
  assert.equal(app.awake.at(-1), false);
  app.ev('closeMenu()');
  assert.equal(app.awake.at(-1), true);
  app.ev("go('prep')");
  assert.equal(app.awake.at(-1), false);
  app.ev("go('run'); document.hidden = true; syncAwake()");
  assert.equal(app.awake.at(-1), false);
  app.ev('document.hidden = false; syncAwake()');
  assert.equal(app.awake.at(-1), true);
  app.ev("startNew('chase')");
  assert.equal(app.awake.at(-1), false);
  app.ev('closeDialog(); setKeepAwake(false)');
  assert.equal(app.awake.at(-1), false);
});

test('quoted participant names produce working scoring handlers rather than executable markup', () => {
  const app = fixture();
  const actor = `D'Artagnan "Sun" <Fox>`;
  const id = app.ev(`createFromSetup('chase', ${JSON.stringify(setupFor('chase', { participants: actor }))})`);
  const html = app.ev('participantsHtml(activeEnc(), subOf(activeEnc()))');
  const encoded = html.match(/onclick="([^"]+)"/)[1];
  const decoded = encoded.replace(/&(quot|#39|lt|gt|amp);/g, (_, entity) => ({ quot: '"', '#39': "'", lt: '<', gt: '>', amp: '&' })[entity]);
  app.ev(decoded);
  assert.equal(app.ev(`activeEnc().run.log[0].actor`), actor);
  assert.equal(app.ev('activeEnc().run.pools.cp'), 0);
  assert.equal(app.ev('activeEnc().run.obstacleIndex'), 1, 'the successful handler clears a one-point obstacle');
  assert.equal(app.ev('activeEnc().id'), id);
});

test('accent text and buttons stay readable for bright and dark custom colors', () => {
  const app = fixture();
  for (const accent of ['#000000', '#ffffff', '#ffff00', '#ff0000', '#00ff00', '#0000ff', '#777777', '#a87c4a']) {
    for (const mode of ['light', 'dark']) {
      const result = jsonAt(app, `accessibleAccent(${JSON.stringify(accent)}, ${JSON.stringify(mode)})`);
      const background = mode === 'light' ? '#eef0f4' : '#262a33';
      assert.ok(app.ev(`contrastRatio(${JSON.stringify(result.text)}, ${JSON.stringify(background)})`) >= 4.5);
      assert.ok(app.ev(`contrastRatio(${JSON.stringify(result.ink)}, ${JSON.stringify(accent)})`) >= 4.5);
    }
  }
});

test('browser wake locks are acquired on Run and released when leaving it', async () => {
  const app = fixture({ native: false });
  app.addEncounter();
  app.ev(`let requested = 0, released = 0;
    navigator.wakeLock = { request: async () => {
      requested++; return { release: async () => { released++; }, addEventListener() {} };
    } };
    library.settings.keepAwake = true; current = 'run';`);
  await app.ev('syncAwake()');
  assert.equal(app.ev('requested'), 1);
  await app.ev("current = 'reference'; syncAwake()");
  assert.equal(app.ev('released'), 1);
  assert.equal(app.ev('screenLock'), null);
});

test('a delayed browser wake-lock request releases immediately if Run is no longer visible', async () => {
  const app = fixture({ native: false });
  app.addEncounter();
  app.ev(`let grant, released = 0;
    navigator.wakeLock = { request: () => new Promise(resolve => { grant = resolve; }) };
    library.settings.keepAwake = true; current = 'run';
    const pendingLock = syncAwake();`);
  await app.ev("current = 'prep'; syncAwake()");
  app.ev('grant({ release: async () => { released++; }, addEventListener() {} })');
  await app.ev('pendingLock');
  assert.equal(app.ev('released'), 1);
  assert.equal(app.ev('screenLock'), null);
});
