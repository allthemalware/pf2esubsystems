/* Exercise real form controls, labels and event handlers in jsdom. Device
   layout, file-provider dialogs and native window flags need Android checks. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
function page({ native = false, tips = [] } = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error.message));
  const dom = new JSDOM(html, { url: 'https://example.org/', runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: console,
    beforeParse(window) {
      if (native) {
        window.PF2E_ANDROID = true;
        window.PF2ENative = { setBackEnabled() {}, setKeepAwake() {}, showTips: () => tips.push(true) };
      }
      window.scrollTo = () => {};
      window.confirm = () => true;
      window.prompt = () => { throw new Error('Setup must use a form, not a text prompt'); };
      window.TextEncoder = TextEncoder;
      window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    } });
  const w = dom.window, d = w.document;
  assert.equal(d.getElementById('views').textContent.includes('Failed to start'), false);
  return { dom, w, d, errors, ev: (source) => w.eval(source) };
}
function submit(w, form) { form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); }
function assertLabeled(document, scope = document) {
  for (const control of scope.querySelectorAll('input:not([type="hidden"]), textarea, select')) {
    if (control.hidden) continue;
    const label = control.getAttribute('aria-label') || Array.from(control.labels || []).map((item) => item.textContent).join(' ').trim();
    assert.ok(label, 'Missing accessible name: ' + control.outerHTML);
  }
  for (const button of scope.querySelectorAll('button')) {
    assert.ok(button.getAttribute('aria-label') || button.textContent.trim(), 'Missing button name');
    if (button.textContent.trim() === '×') assert.match(button.getAttribute('aria-label') || '', /Remove/);
  }
}

test('the Settings tip button opens native billing only after an explicit tap', () => {
  const tips = [];
  const { dom, d, ev, errors } = page({ native: true, tips });
  try {
    ev('openMenu()');
    const button = Array.from(d.querySelectorAll('button')).find((item) => item.textContent === 'Leave a tip through Google Play');
    assert.ok(button);
    assert.deepEqual(tips, [], 'opening Settings cannot start a purchase');
    assertLabeled(d);
    button.click();
    assert.deepEqual(tips, [true]);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
  const browser = page();
  try {
    browser.ev('openMenu()');
    assert.doesNotMatch(browser.d.getElementById('views').textContent, /Leave a tip/);
    assert.deepEqual(browser.errors, []);
  } finally { browser.dom.window.close(); }
});

test('chase form submits the selected length and derives costs from named participants', () => {
  const { dom, w, d, ev, errors } = page();
  try {
    ev("startNew('chase')");
    assert.equal(d.activeElement.id, 'newName');
    d.getElementById('newName').value = 'Across the rooftops';
    d.querySelector('input[name="chaseLength"][value="long"]').checked = true;
    d.getElementById('newParticipants').value = 'Mari\nSable';
    submit(w, d.getElementById('encounterForm'));
    assert.equal(ev('activeEnc().name'), 'Across the rooftops');
    assert.equal(ev('activeEnc().def.obstacles.length'), 10);
    assert.equal(ev('activeEnc().def.obstacles[0].cost'), 1);
    assert.equal(d.getElementById('appDialog').open, false);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('party editor and preset selector reuse names through actual form events', () => {
  const { dom, w, d, ev, errors } = page();
  try {
    ev('editParty()');
    d.getElementById('partyName').value = 'Friday group';
    d.getElementById('partyNames').value = "D'Artagnan\nSable";
    submit(w, d.querySelector('#appDialog form'));
    ev("startNew('influence')");
    assert.equal(d.getElementById('newParty').selectedOptions[0].textContent, 'Friday group (2)');
    assert.equal(d.getElementById('newParticipants').value, "D'Artagnan\nSable");
    d.getElementById('newNpc').value = 'Bel';
    submit(w, d.getElementById('encounterForm'));
    assert.equal(ev('activeEnc().def.npc.name'), 'Bel');
    assert.equal(ev('activeEnc().def.participants[0]'), "D'Artagnan");
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('invalid participant names display an inline form error without creating an encounter', () => {
  const { dom, w, d, ev } = page();
  try {
    ev("startNew('research')");
    d.getElementById('newParticipants').value = 'Mari\nMari';
    submit(w, d.getElementById('encounterForm'));
    assert.equal(ev('library.encounters.length'), 0);
    assert.match(d.getElementById('dialogError').textContent, /duplicates/);
    assert.equal(d.getElementById('appDialog').open, true);
  } finally { dom.window.close(); }
});

test('obstacle search keeps focus and exposes all matching cards', () => {
  const { dom, w, d, ev, errors } = page();
  try {
    const id = ev("createFromSetup('chase', {partySize:4,participants:'',preset:'short'})");
    ev(`pickObstacle(${JSON.stringify(id)})`);
    const search = d.getElementById('obstacleSearch');
    search.value = 'urban'; search.focus();
    search.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.equal(d.activeElement, search);
    assert.equal(d.querySelectorAll('.obstaclechoice').length, ev("obstacleMatches('urban').length"));
    d.querySelector('.obstaclechoice').click();
    assert.equal(ev('activeEnc().def.obstacles.length'), 7);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('all subsystem editors, Run controls, Settings and dialogs have accessible form names', () => {
  const { dom, d, ev, errors } = page();
  try {
    for (const key of ['chase', 'infiltration', 'influence', 'research', 'custom']) {
      ev(`createFromSetup(${JSON.stringify(key)}, {partySize:4,participants:'Mari,Sable',preset:'short',pointName:'Renown',scaleIndex:1})`);
      ev("go('prep')");
      assertLabeled(d);
      ev("go('run')");
      assertLabeled(d);
      ev('openMenu()');
      assertLabeled(d);
      ev('closeMenu()');
      ev(`startNew(${JSON.stringify(key)})`);
      assertLabeled(d, d.getElementById('appDialog'));
      ev('closeDialog()');
    }
    ev("go('reference')");
    assertLabeled(d);
    assert.equal(d.getElementById('nav-reference').getAttribute('aria-current'), 'page');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('quoted participant names score through parsed DOM handlers', () => {
  const { dom, d, ev, errors } = page();
  try {
    ev(`createFromSetup('infiltration', {partySize:2,participants: ${JSON.stringify(`D'Artagnan "Sun" <Fox>,Sable`)}}); go('run')`);
    d.querySelector('.pcrow .deg').focus();
    const name = d.activeElement.getAttribute('aria-label');
    d.querySelector('.pcrow .deg').click();
    assert.equal(ev('activeEnc().run.log[0].actor'), `D'Artagnan "Sun" <Fox>`);
    assert.equal(ev('activeEnc().run.log[0].degree'), 'critSuccess');
    assert.equal(d.activeElement.getAttribute('aria-label'), name, 'keyboard focus survives scoring');
    assert.match(d.getElementById('runStatus').textContent, /Critical success/);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});
