/* Mobile forms, party presets, full-library files and session screen behavior.
   Shared by the browser app and its Android host. */
let dialogState = null;
let dialogReturnFocus = null;
let screenLock = null;
let screenLockPending = false;
let lastNativeAwake = null;

function storeLibrary(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); }
  catch (error) {
    const message = "Couldn't save. Your previous saved library was kept.";
    if (dialogState) dialogError(message); else toast(message);
    return false;
  }
  library = next;
  return true;
}

function formField(label, id, control, hint = "") {
  return '<div class="fld"><label class="flabel" for="' + id + '">' + esc(label)
    + '</label>' + control + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
}
function dialogError(message) {
  const node = byId("dialogError");
  if (node) { node.textContent = message; node.focus(); }
  else toast(message);
}
function openDialog(title, body, state) {
  const dialog = byId("appDialog");
  if (!dialogState) dialogReturnFocus = document.activeElement;
  dialogState = state;
  byId("dialogBody").innerHTML = '<div class="row spread dialoghead"><h2 id="dialogTitle">'
    + esc(title) + '</h2><button class="btn ghost" type="button" onclick="closeDialog()" aria-label="Close '
    + esc(title) + '">Close</button></div><p id="dialogError" class="formerror" role="alert" tabindex="-1"></p>' + body;
  if (!dialog.open) dialog.showModal();
  const focus = byId('dialogBody').querySelector('input:not([type="radio"]), textarea, select');
  if (focus) focus.focus();
  syncDeviceState();
}
function closeDialog() {
  dialogState = null;
  const dialog = byId("appDialog");
  if (dialog.open) dialog.close();
  syncDeviceState();
  if (dialogReturnFocus && dialogReturnFocus.isConnected) dialogReturnFocus.focus();
  dialogReturnFocus = null;
}

function partyOptions(selected) {
  return '<option value="">Custom party</option>' + library.parties.map((party) =>
    '<option value="' + party.id + '"' + (party.id === selected ? ' selected' : '') + '>'
    + esc(party.name) + ' (' + party.participants.length + ')</option>').join('');
}
function openEncounterForm(subKey) {
  if (!own(SUBSYSTEMS, subKey)) return;
  const sub = SUBSYSTEMS[subKey];
  const party = library.parties.find((item) => item.id === library.settings.lastPartyId);
  let body = '<form id="encounterForm" onsubmit="submitEncounterForm(event)">';
  body += formField('Encounter name', 'newName', '<input id="newName" class="inp" maxlength="2000" value="' + esc(sub.name) + '">');
  if (subKey === 'chase') {
    body += '<fieldset class="fld"><legend class="flabel">Chase length</legend><div class="lengthchoices">'
      + sub.presets.map((preset) => '<label class="choice"><input type="radio" name="chaseLength" value="'
        + preset.key + '"' + (preset.key === 'medium' ? ' checked' : '') + '><span><b>' + esc(preset.label)
        + '</b><small>' + preset.obstacles + ' obstacles</small></span></label>').join('') + '</div></fieldset>';
  }
  if (subKey === 'influence') {
    body += formField('NPC name', 'newNpc', '<input id="newNpc" class="inp" maxlength="2000" value="The NPC">');
  }
  if (subKey === 'custom') {
    body += formField('Challenge length', 'newScale', '<select id="newScale" class="inp">'
      + GENERATED_VP_SCALES.map((scale, index) => '<option value="' + index + '"' + (index === 1 ? ' selected' : '')
        + '>' + esc(scale.duration) + ' · ' + esc(scale.endPoint) + ' VP</option>').join('') + '</select>');
    body += formField('Point name', 'newPointName', '<input id="newPointName" class="inp" maxlength="120" value="Victory Points" required>');
  }
  body += formField('Party preset', 'newParty', '<select id="newParty" class="inp" onchange="fillSetupParty(this.value)">'
    + partyOptions(party ? party.id : '') + '</select>');
  body += formField('Participants', 'newParticipants', '<textarea id="newParticipants" class="inp" rows="4" maxlength="3000" placeholder="Mari&#10;Sable">'
    + esc(party ? party.participants.join('\n') : '') + '</textarea>', 'One name per line, or separate names with commas. Leave empty to use numbered PCs.');
  body += formField('Party size for numbered PCs', 'newPartySize', '<input id="newPartySize" class="inp num" type="number" inputmode="numeric" min="1" max="24" value="'
    + (party ? party.participants.length : 4) + '" required>');
  body += '<div class="formactions"><button type="button" class="btn ghost" onclick="closeDialog()">Cancel</button>'
    + '<button type="submit" class="btn">Create encounter</button></div></form>';
  openDialog('New ' + sub.name, body, { kind: 'create', subKey });
}
function fillSetupParty(id) {
  const party = library.parties.find((item) => item.id === id);
  byId('newParticipants').value = party ? party.participants.join('\n') : '';
  byId('newPartySize').value = party ? party.participants.length : 4;
}
function parseParticipantNames(value) {
  return names(String(value || '').split(/[,\n]+/).map((name) => name.trim()).filter(Boolean));
}
function createFromSetup(subKey, setup) {
  if (!own(SUBSYSTEMS, subKey)) invalid('Unknown subsystem.');
  const participants = parseParticipantNames(setup.participants);
  const partySize = participants.length || integer(Number(setup.partySize), 'Party size', 1, MAX_PARTICIPANTS);
  const opts = { name: String(setup.name || SUBSYSTEMS[subKey].name), partySize,
    participants: participants.length ? participants : Array.from({ length: partySize }, (_, index) => 'PC ' + (index + 1)) };
  if (subKey === 'chase') {
    if (!SUBSYSTEMS.chase.presets.some((item) => item.key === setup.preset)) invalid('Choose a chase length.');
    opts.preset = setup.preset;
  }
  if (subKey === 'influence') opts.npcName = String(setup.npcName || 'The NPC');
  if (subKey === 'custom') {
    opts.pointName = text(setup.pointName, 'Point name', 120).trim();
    if (!opts.pointName) invalid('Give the points a name.');
    opts.pointAbbr = opts.pointName.split(/\s+/).map((word) => word[0]).join('').toUpperCase().slice(0, 3);
    opts.scale = GENERATED_VP_SCALES[integer(Number(setup.scaleIndex), 'Challenge length', 0, GENERATED_VP_SCALES.length - 1)];
  }
  const enc = newEncounter(subKey, opts);
  enc.def = validateDefinition(subKey, enc.def);
  const next = clone(library);
  next.encounters.unshift(enc);
  next.activeId = enc.id;
  if (setup.partyId && next.parties.some((item) => item.id === setup.partyId)) next.settings.lastPartyId = setup.partyId;
  else delete next.settings.lastPartyId;
  if (!storeLibrary(next)) return false;
  return enc.id;
}
function submitEncounterForm(event) {
  event.preventDefault();
  if (!dialogState || dialogState.kind !== 'create') return;
  const choice = document.querySelector('input[name="chaseLength"]:checked');
  try {
    const created = createFromSetup(dialogState.subKey, { name: byId('newName').value,
      participants: byId('newParticipants').value, partySize: byId('newPartySize').value,
      partyId: byId('newParty').value, preset: choice ? choice.value : null,
      npcName: byId('newNpc') ? byId('newNpc').value : null,
      pointName: byId('newPointName') ? byId('newPointName').value : null,
      scaleIndex: byId('newScale') ? byId('newScale').value : null });
    if (created) { closeDialog(); go('prep'); toast('Encounter created.'); }
  } catch (error) { dialogError(error.message); }
}

function openObstaclePicker(encId) {
  const enc = library.encounters.find((item) => item.id === encId);
  if (!enc || !subOf(enc).obstacleLibrary) return;
  openDialog('Choose an obstacle', formField('Search obstacles', 'obstacleSearch',
    '<input id="obstacleSearch" class="inp" type="search" placeholder="Name, terrain or level" oninput="filterObstaclePicker(this.value)">')
    + '<p class="hint" id="obstacleCount" role="status" aria-live="polite"></p><div id="obstacleResults" class="obstaclechoices"></div>',
  { kind: 'obstacles', encId });
  filterObstaclePicker('');
}
function obstacleMatches(term) {
  const query = String(term || '').trim().toLowerCase();
  return GENERATED_CHASE_OBSTACLES.map((item, index) => ({ item, index })).filter(({ item }) =>
    !query || item.name.toLowerCase().includes(query) || item.table.toLowerCase().includes(query) || String(item.level) === query);
}
function filterObstaclePicker(term) {
  if (!dialogState || dialogState.kind !== 'obstacles') return;
  const matches = obstacleMatches(term);
  byId('obstacleCount').textContent = matches.length + ' ' + plural(matches.length, 'obstacle');
  byId('obstacleResults').innerHTML = matches.length ? matches.map(({ item, index }) =>
    '<button class="obstaclechoice" type="button" onclick="chooseObstacle(' + index + ')"><b>' + esc(item.name)
    + '</b><span>' + esc(item.table) + ' · level ' + item.level + '</span><small>'
    + item.options.map((option) => esc(titleCase(option.skill)) + ' DC ' + option.dc).join(' · ')
    + '</small></button>').join('') : '<p class="empty">No matching obstacles.</p>';
}
function chooseObstacle(index) {
  if (!dialogState || dialogState.kind !== 'obstacles') return false;
  const enc = library.encounters.find((item) => item.id === dialogState.encId);
  const chosen = GENERATED_CHASE_OBSTACLES[index];
  if (!enc || !chosen || !subOf(enc).obstacleLibrary) return false;
  if (enc.def.obstacles.length >= 1000) { dialogError('This encounter already has 1,000 obstacles.'); return false; }
  const next = clone(library);
  const target = next.encounters.find((item) => item.id === enc.id);
  target.def.obstacles.push(newObstacle(chosen.name,
    suggestedCost(subOf(enc).obstacleCost, enc.def.participants.length || 4, enc.def.obstacles.length),
    { options: chosen.options.map((option) => ({ skill: option.skill, dc: option.dc, how: option.how })) }));
  if (!storeLibrary(next)) return false;
  closeDialog(); renderAll(); toast('Added ' + chosen.name + '.');
  return true;
}

function editParty(partyId = null, encId = null) {
  const party = library.parties.find((item) => item.id === partyId);
  const enc = library.encounters.find((item) => item.id === encId);
  const participants = party ? party.participants : enc ? enc.def.participants : [];
  const body = '<form onsubmit="submitPartyForm(event)">'
    + formField('Party name', 'partyName', '<input id="partyName" class="inp" maxlength="120" required value="' + esc(party ? party.name : '') + '">')
    + formField('Participants', 'partyNames', '<textarea id="partyNames" class="inp" rows="6" maxlength="3000" required>'
      + esc(participants.join('\n')) + '</textarea>', 'One name per line, or separate names with commas. Up to 24 participants.')
    + '<div class="formactions"><button type="button" class="btn ghost" onclick="closeDialog()">Cancel</button>'
    + '<button class="btn" type="submit">Save party</button></div></form>';
  openDialog(party ? 'Edit party' : 'Save a party', body, { kind: 'party', partyId: party ? party.id : null });
}
function savePartyPreset(partyId, name, participants) {
  const party = validateParty({ id: partyId || uid(), name: name.trim(), participants: parseParticipantNames(participants) });
  const next = clone(library);
  const index = next.parties.findIndex((item) => item.id === party.id);
  if (index === -1) {
    if (next.parties.length >= 100) invalid('You already have 100 party presets.');
    next.parties.push(party);
  } else next.parties[index] = party;
  next.settings.lastPartyId = party.id;
  return storeLibrary(next) ? party.id : false;
}
function submitPartyForm(event) {
  event.preventDefault();
  if (!dialogState || dialogState.kind !== 'party') return;
  try {
    if (savePartyPreset(dialogState.partyId, byId('partyName').value, byId('partyNames').value)) {
      closeDialog(); renderAll(); toast('Party saved for new encounters.');
    }
  } catch (error) { dialogError(error.message); }
}
function deletePartyPreset(id) {
  const party = library.parties.find((item) => item.id === id);
  if (!party || !confirm('Delete the party preset "' + party.name + '"? Existing encounters keep their participants.')) return false;
  const next = clone(library);
  next.parties = next.parties.filter((item) => item.id !== id);
  if (next.settings.lastPartyId === id) delete next.settings.lastPartyId;
  if (!storeLibrary(next)) return false;
  renderAll(); return true;
}

function makeBackupText() {
  const payload = { t: 'pf2e-subsystems-backup', v: 1, createdAt: new Date().toISOString(), library: validateLibrary(library) };
  const result = JSON.stringify(payload);
  if (new TextEncoder().encode(result).length > MAX_BACKUP_BYTES) invalid('This library is too large for a 5 MB backup.');
  return result;
}
function downloadBackup() {
  try {
    const contents = makeBackupText();
    const host = androidHost();
    if (host) { host.saveBackup(contents); return; }
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pf2e-subsystems-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { toast('Could not create backup: ' + error.message); }
}
function chooseBackupFile() {
  const host = androidHost();
  if (host) host.openBackup();
  else { byId('backupFile').value = ''; byId('backupFile').click(); }
}
async function readBackupFile(file) {
  if (!file) return false;
  if (file.size > MAX_BACKUP_BYTES) { toast('Choose a backup smaller than 5 MB.'); return false; }
  try { return receiveBackupFile(await file.text()); }
  catch (error) { toast('Could not read that backup file.'); return false; }
}
function receiveBackupFile(contents) {
  let candidate;
  try { candidate = parseBackupFile(contents); }
  catch (error) { toast(error.message); return false; }
  const incoming = candidate.library;
  const body = '<p>This backup contains <b>' + incoming.encounters.length + ' ' + plural(incoming.encounters.length, 'encounter')
    + '</b> and <b>' + incoming.parties.length + ' ' + plural(incoming.parties.length, 'party preset') + '</b>, including live progress, undo history and settings.</p>'
    + '<p>Saved: ' + esc(candidate.createdAt) + '</p><p>Restoring will replace your current library of '
    + library.encounters.length + ' ' + plural(library.encounters.length, 'encounter') + '. Save a backup first if you want to keep it.</p>'
    + '<div class="formactions"><button class="btn ghost" onclick="closeDialog()">Cancel</button>'
    + '<button class="btn" onclick="restoreBackupCandidate()">Replace library</button></div>';
  openDialog('Restore library', body, { kind: 'restore', candidate: incoming });
  return true;
}
function restoreBackupCandidate() {
  if (!dialogState || dialogState.kind !== 'restore') return false;
  if (!storeLibrary(dialogState.candidate)) return false;
  closeDialog(); menuOpen = false; current = activeEnc() ? 'run' : 'prep';
  applyTheme(); renderAll(); toast('Library restored.'); return true;
}

function mobileSettingsHtml() {
  const awakeSupported = !!androidHost() || !!navigator.wakeLock;
  return '<section class="settingssection"><h3>During play</h3><label class="checklabel">'
    + '<input type="checkbox"' + (library.settings.keepAwake ? ' checked' : '') + (awakeSupported ? '' : ' disabled') + ' onchange="setKeepAwake(this.checked)">'
    + '<span>Keep the screen awake on Run<small>' + (awakeSupported ? 'Only while an encounter is visible. Leaving Run or switching apps lets the screen sleep.'
      : 'This browser does not support keeping the screen awake.') + '</small></span></label></section>'
    + '<section class="settingssection"><h3>Backup and restore</h3>'
    + '<p class="dim">A backup includes every encounter, live progress, undo history, party preset and setting. Encounter sharing sends preparation only.</p>'
    + '<div class="rowbtns wrap"><button class="btn" onclick="downloadBackup()">Save backup file</button>'
    + '<button class="btn ghost" onclick="chooseBackupFile()">Restore backup file</button></div></section>'
    + '<section class="settingssection"><div class="row spread"><h3>Party presets</h3>'
    + '<button class="btn ghost" onclick="editParty()">New party</button></div>'
    + (library.parties.length ? library.parties.map((party) => '<div class="partyrow"><div><b>' + esc(party.name)
      + '</b><small>' + esc(party.participants.join(', ')) + '</small></div><div class="rowbtns">'
      + '<button class="chipbtn" aria-label="Edit ' + esc(party.name) + ' party" onclick="editParty(\'' + party.id + '\')">Edit</button>'
      + '<button class="chipbtn danger" aria-label="Delete ' + esc(party.name) + ' party preset" onclick="deletePartyPreset(\'' + party.id + '\')">Delete</button></div></div>').join('')
      : '<p class="dim">Save participant names here and reuse them when creating any encounter.</p>') + '</section>'
    + (androidHost() && typeof androidHost().showTips === 'function'
      ? '<section class="settingssection"><h3>Support development</h3>'
        + '<p class="dim">Enjoying PF2e Subsystems? Leave an optional, one-time tip. All features are free. '
        + 'Choose an amount and confirm the price in Google Play.</p>'
        + '<button class="btn ghost" onclick="showPlayTips()">Leave a tip through Google Play</button></section>' : '');
}

function showPlayTips() {
  const host = androidHost();
  if (host && typeof host.showTips === 'function') host.showTips();
}

function shouldKeepAwake() {
  return library.settings.keepAwake === true && current === 'run' && !!activeEnc()
    && !menuOpen && !dialogState && !document.hidden;
}
function setKeepAwake(enabled) {
  library.settings.keepAwake = enabled === true; save(); syncAwake();
}
async function syncAwake() {
  const enabled = shouldKeepAwake();
  const host = androidHost();
  if (host) {
    if (lastNativeAwake !== enabled) { host.setKeepAwake(enabled); lastNativeAwake = enabled; }
    return;
  }
  if (!enabled) {
    if (screenLock) {
      const lock = screenLock; screenLock = null;
      try { await lock.release(); } catch (error) { /* It may already have been released by the browser. */ }
    }
    return;
  }
  if (!navigator.wakeLock || screenLock || screenLockPending) return;
  screenLockPending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!shouldKeepAwake()) await lock.release();
    else {
      screenLock = lock;
      lock.addEventListener('release', () => { if (screenLock === lock) screenLock = null; });
    }
  } catch (error) {
    // Power settings or the browser can decline a screen lock; play still works.
  } finally { screenLockPending = false; }
}
function syncDeviceState() { syncAndroidBack(); syncAwake(); }
function enhanceAccessibility() {
  for (const row of byId('views').querySelectorAll('[data-fields]')) {
    const labels = row.dataset.fields.split('|');
    row.querySelectorAll('input, select, textarea').forEach((control, index) => {
      const label = labels[index] || labels[0];
      control.setAttribute('aria-label', label);
      if (control.type === 'number' && !label.includes('adjustment')) control.setAttribute('inputmode', 'numeric');
      if (control.type === 'text') control.maxLength = /skill/i.test(label) ? 120 : /effect/i.test(label) ? 20000 : 2000;
    });
    const remove = row.querySelector('button');
    if (remove) remove.setAttribute('aria-label', row.dataset.remove);
  }
  for (const meter of byId('views').querySelectorAll('.meter')) {
    const name = meter.querySelector('.meterhead span').textContent;
    meter.querySelectorAll('button').forEach((button) => button.setAttribute('aria-label', name + ': ' + button.textContent.trim()));
  }
}
function wireMobile() {
  byId('appDialog').addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  byId('backupFile').addEventListener('change', (event) => readBackupFile(event.target.files[0]));
  document.addEventListener('visibilitychange', syncAwake);
}
