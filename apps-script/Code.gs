const RELAY_SHEETS = Object.freeze({
  commands: 'Codex Commands',
  activity: 'Codex Activity',
  config: 'Codex Config',
});

const PLANNING_WORKBOOK_ID = '1DCtCrn5NAXCTNt5csmrjAOJvcCws7l9fdsnGQUCHFkM';

const COMMAND_HEADERS = Object.freeze([
  'command_id',
  'source_tab',
  'source_id',
  'thread_id',
  'command_type',
  'message',
  'requested_by',
  'requested_at',
  'status',
  'claimed_by',
  'claimed_at',
  'processed_at',
  'error',
]);

const ACTIVITY_HEADERS = Object.freeze([
  'activity_id',
  'command_id',
  'source_tab',
  'source_id',
  'thread_id',
  'actor',
  'event_type',
  'summary',
  'details',
  'created_at',
]);

const COMMAND_TYPES = Object.freeze([
  'CONTINUE',
  'MESSAGE',
  'REVIEW',
  'STOP',
  'APPROVAL',
]);

const SYSTEM_SHEETS = new Set(Object.values(RELAY_SHEETS));

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('VennuSign Workbench')
    .addItem('Open sidebar', 'showPlanningRelay')
    .addToUi();
}

function doGet(event) {
  if (event && event.parameter && event.parameter.relay === 'poll') {
    return relayJson_({ commands: getPendingRelayCommands_() });
  }
  if (event && event.parameter && event.parameter.relay === 'diagnostics') {
    return relayJson_({ activity: getRecentActivity_(getSpreadsheet_(), 10) });
  }
  return HtmlService.createHtmlOutputFromFile('WebApp')
    .setTitle('VennuSign Workbench')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function doPost(event) {
  try {
    const request = JSON.parse((event && event.postData && event.postData.contents) || '{}');
    if (request.action === 'heartbeat') {
      setRelayConfig_('relay_last_seen_at', new Date().toISOString());
      setRelayConfig_('relay_enabled', true);
      return relayJson_({ ok: true });
    }
    if (request.action === 'enqueue') return relayJson_(enqueueCommand(request.input || {}));
    if (request.action === 'clearActivity') return relayJson_(clearActivityHistory());
    if (request.action === 'claim') return relayJson_(claimRelayCommand_(request.commandId));
    if (request.action === 'progress') return relayJson_(recordRelayProgress_(request));
    if (request.action === 'finish') return relayJson_(finishRelayCommand_(request));
    throw new Error('Unsupported relay action.');
  } catch (error) {
    return relayJson_({ ok: false, error: String(error.message || error) });
  }
}

function getPendingRelayCommands_() {
  const sheet = requireSheet_(getSpreadsheet_(), RELAY_SHEETS.commands);
  assertHeaders_(sheet, COMMAND_HEADERS);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, COMMAND_HEADERS.length).getDisplayValues()
    .filter(function (row) { return row[8] === 'PENDING'; })
    .map(function (row) {
      return COMMAND_HEADERS.reduce(function (result, header, index) { result[header] = row[index] || ''; return result; }, {});
    });
}

function claimRelayCommand_(commandId) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);
  try {
    const sheet = requireSheet_(getSpreadsheet_(), RELAY_SHEETS.commands);
    const match = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).createTextFinder(String(commandId || '')).matchEntireCell(true).findNext();
    if (!match) throw new Error('Command not found.');
    const row = match.getRow();
    if (sheet.getRange(row, 9).getDisplayValue() !== 'PENDING') return { ok: false, claimed: false };
    sheet.getRange(row, 9, 1, 3).setValues([['PROCESSING', 'relay:vennusign-workbench', new Date().toISOString()]]);
    appendRelayActivity_(sheet.getRange(row, 1, 1, COMMAND_HEADERS.length).getDisplayValues()[0], '', 'WORKING', 'Codex is working on this command.', '');
    return { ok: true, claimed: true };
  } finally { lock.releaseLock(); }
}

function recordRelayProgress_(request) {
  const sheet = requireSheet_(getSpreadsheet_(), RELAY_SHEETS.commands);
  const match = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).createTextFinder(String(request.commandId || '')).matchEntireCell(true).findNext();
  if (!match) throw new Error('Command not found.');
  appendRelayActivity_(sheet.getRange(match.getRow(), 1, 1, COMMAND_HEADERS.length).getDisplayValues()[0], request.threadId, 'PROGRESS', request.summary || 'Codex is still working.', '');
  return { ok: true };
}

function appendRelayActivity_(command, threadId, eventType, summary, details) {
  requireSheet_(getSpreadsheet_(), RELAY_SHEETS.activity).appendRow([
    'ACT-' + Utilities.getUuid(), command[0], command[1], command[2], String(threadId || ''),
    'relay:vennusign-workbench', eventType, String(summary || '').slice(0, 45000), String(details || '').slice(0, 45000), new Date().toISOString(),
  ]);
}

function finishRelayCommand_(request) {
  const spreadsheet = getSpreadsheet_();
  const commandSheet = requireSheet_(spreadsheet, RELAY_SHEETS.commands);
  const match = commandSheet.getRange(2, 1, Math.max(commandSheet.getLastRow() - 1, 1), 1).createTextFinder(String(request.commandId || '')).matchEntireCell(true).findNext();
  if (!match) throw new Error('Command not found.');
  const status = request.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED';
  commandSheet.getRange(match.getRow(), 9).setValue(status);
  commandSheet.getRange(match.getRow(), 12, 1, 2).setValues([[new Date().toISOString(), String(request.error || '').slice(0, 4000)]]);
  const command = commandSheet.getRange(match.getRow(), 1, 1, COMMAND_HEADERS.length).getDisplayValues()[0];
  appendRelayActivity_(command, request.threadId, status === 'COMPLETED' ? 'RESULT' : 'ERROR', request.summary, request.details || request.error);
  if (request.threadId) setRelayConfig_('active_thread_id', request.threadId);
  return { ok: true };
}

function setRelayConfig_(key, value) {
  const sheet = requireSheet_(getSpreadsheet_(), RELAY_SHEETS.config);
  const match = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).createTextFinder(key).matchEntireCell(true).findNext();
  if (!match) throw new Error('Missing config key: ' + key);
  sheet.getRange(match.getRow(), 2).setValue(value);
}

function relayJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function showPlanningRelay() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('VennuSign Workbench');
  SpreadsheetApp.getUi().showSidebar(html);
}

function getSidebarState() {
  const spreadsheet = getSpreadsheet_();
  const config = getConfig_(spreadsheet);
  const sourceTabs = listSourceTabs_(spreadsheet);
  const activeSheet = spreadsheet.getActiveSheet();
  const activeTab = activeSheet && !SYSTEM_SHEETS.has(activeSheet.getName())
    ? activeSheet.getName()
    : (sourceTabs[0] || '');
  const activeRange = spreadsheet.getActiveRange();
  const activeRecordId = activeRange && activeSheet && activeSheet.getName() === activeTab
    ? String(activeSheet.getRange(activeRange.getRow(), 1).getDisplayValue()).trim()
    : '';

  return {
    workbookTitle: spreadsheet.getName(),
    sourceTabs,
    activeTab,
    activeRecordId,
    relay: getRelayState_(config),
    activity: getRecentActivity_(spreadsheet, 15),
  };
}

function getWebAppState() {
  const spreadsheet = getSpreadsheet_();
  const config = getConfig_(spreadsheet);
  return {
    workbookTitle: spreadsheet.getName(),
    relay: getRelayState_(config),
    activity: getRecentActivity_(spreadsheet, 30),
  };
}

function getSourceRecords(sheetName) {
  const spreadsheet = getSpreadsheet_();
  const sheet = requireSourceSheet_(spreadsheet, sheetName);
  const lastRow = Math.min(sheet.getLastRow(), 500);
  const lastColumn = Math.min(sheet.getLastColumn(), 12);

  if (lastRow < 2 || lastColumn < 1) {
    return [];
  }

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headers = values[0].map(normalizeHeader_);
  const idIndex = findIdColumn_(headers);
  const labelIndex = findLabelColumn_(headers, idIndex);

  return values.slice(1)
    .map(function (row) {
      const id = String(row[idIndex] || '').trim();
      const label = String(row[labelIndex] || '').trim();
      return id ? { id, label: label || id } : null;
    })
    .filter(Boolean);
}

function enqueueCommand(input) {
  const payload = input || {};
  const commandType = String(payload.commandType || '').trim().toUpperCase();
  const sourceTab = String(payload.sourceTab || '').trim();
  const sourceId = String(payload.sourceId || '').trim();
  const idempotencyKey = normalizeIdempotencyKey_(payload.idempotencyKey);

  if (COMMAND_TYPES.indexOf(commandType) === -1) {
    throw new Error('Unsupported command type.');
  }
  if (Boolean(sourceTab) !== Boolean(sourceId)) {
    throw new Error('Planning context must include both a tab and record ID.');
  }

  const spreadsheet = getSpreadsheet_();
  assertConfiguredWorkbook_(spreadsheet);
  if (sourceTab && sourceId) {
    requireRecord_(spreadsheet, sourceTab, sourceId);
  }

  const message = buildMessage_(commandType, sourceTab, sourceId, payload.message);
  const commandId = 'CMD-' + idempotencyKey;
  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);

  try {
    const commandSheet = requireSheet_(spreadsheet, RELAY_SHEETS.commands);
    assertHeaders_(commandSheet, COMMAND_HEADERS);
    const existing = findExactId_(commandSheet, commandId);
    if (existing) {
      return {
        commandId,
        status: String(existing[8] || 'PENDING'),
        duplicate: true,
      };
    }

    const config = getConfig_(spreadsheet);
    const threadId = String(payload.threadId || config.active_thread_id || '').trim();
    const actor = getActor_();
    const row = [
      commandId,
      sourceTab,
      sourceId,
      threadId,
      commandType,
      message,
      actor,
      new Date().toISOString(),
      'PENDING',
      '',
      '',
      '',
      '',
    ].map(escapeForSheet_);

    const targetRow = commandSheet.getLastRow() + 1;
    commandSheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
    SpreadsheetApp.flush();

    const written = commandSheet.getRange(targetRow, 1, 1, row.length).getDisplayValues()[0];
    if (written[0] !== commandId || written[8] !== 'PENDING') {
      throw new Error('Command verification failed after writing.');
    }

    requireSheet_(spreadsheet, RELAY_SHEETS.activity).appendRow([
      'ACT-' + Utilities.getUuid(), commandId, sourceTab, sourceId, threadId, actor,
      'MESSAGE', message, '', new Date().toISOString(),
    ]);

    return { commandId, status: 'PENDING', duplicate: false };
  } finally {
    lock.releaseLock();
  }
}

function getRecentActivity(limit) {
  return getRecentActivity_(getSpreadsheet_(), Math.min(Number(limit) || 15, 50));
}

function clearActivityHistory() {
  const spreadsheet = getSpreadsheet_();
  const sheet = requireSheet_(spreadsheet, RELAY_SHEETS.activity);
  assertHeaders_(sheet, ACTIVITY_HEADERS);
  const count = Math.max(sheet.getLastRow() - 1, 0);
  if (count) sheet.getRange(2, 1, count, ACTIVITY_HEADERS.length).clearContent();
  return { cleared: count };
}

function getSpreadsheet_() {
  const spreadsheet = SpreadsheetApp.openById(PLANNING_WORKBOOK_ID);
  if (!spreadsheet) {
    throw new Error('This script must be bound to the VennuSign Planning workbook.');
  }
  return spreadsheet;
}

function listSourceTabs_(spreadsheet) {
  return spreadsheet.getSheets()
    .map(function (sheet) { return sheet.getName(); })
    .filter(function (name) { return !SYSTEM_SHEETS.has(name); });
}

function requireSourceSheet_(spreadsheet, sheetName) {
  if (!sheetName || SYSTEM_SHEETS.has(sheetName)) {
    throw new Error('Invalid planning tab.');
  }
  return requireSheet_(spreadsheet, sheetName);
}

function requireSheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Required sheet not found: ' + sheetName);
  }
  return sheet;
}

function getConfig_(spreadsheet) {
  const sheet = requireSheet_(spreadsheet, RELAY_SHEETS.config);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return {};
  }

  return sheet.getRange(2, 1, lastRow - 1, 2).getValues()
    .reduce(function (config, row) {
      const key = String(row[0] || '').trim();
      if (key) {
        config[key] = row[1];
      }
      return config;
    }, {});
}

function assertConfiguredWorkbook_(spreadsheet) {
  const configuredId = String(getConfig_(spreadsheet).workbook_id || '').trim();
  if (!configuredId || configuredId !== spreadsheet.getId()) {
    throw new Error('Workbook configuration does not match this spreadsheet.');
  }
}

function getRelayState_(config) {
  const enabled = config.relay_enabled === true || String(config.relay_enabled).toUpperCase() === 'TRUE';
  const heartbeat = String(config.relay_last_seen_at || '').trim();
  const heartbeatTime = heartbeat ? Date.parse(heartbeat) : NaN;
  const intervalSeconds = Math.max(Number(config.poll_interval_seconds) || 30, 10);
  const online = enabled && Number.isFinite(heartbeatTime)
    && Date.now() - heartbeatTime <= intervalSeconds * 3000;

  return {
    enabled,
    online,
    heartbeat,
    threadConfigured: Boolean(String(config.active_thread_id || '').trim()),
    workspaceConfigured: Boolean(String(config.allowed_workspace_root || '').trim()),
  };
}

function getRecentActivity_(spreadsheet, limit) {
  const sheet = requireSheet_(spreadsheet, RELAY_SHEETS.activity);
  assertHeaders_(sheet, ACTIVITY_HEADERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  const count = Math.min(limit, lastRow - 1);
  const startRow = lastRow - count + 1;
  const rows = sheet.getRange(startRow, 1, count, ACTIVITY_HEADERS.length).getDisplayValues();

  return rows.reverse().map(function (row) {
    return ACTIVITY_HEADERS.reduce(function (event, header, index) {
      event[header] = row[index] || '';
      return event;
    }, {});
  });
}

function requireRecord_(spreadsheet, sheetName, sourceId) {
  const sheet = requireSourceSheet_(spreadsheet, sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    throw new Error('The selected planning tab has no records.');
  }

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  const found = ids.some(function (row) { return String(row[0]).trim() === sourceId; });
  if (!found) {
    throw new Error('Planning record no longer exists: ' + sourceId);
  }
}

function assertHeaders_(sheet, expected) {
  const actual = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0];
  if (actual.join('\u001f') !== expected.join('\u001f')) {
    throw new Error('Schema mismatch in ' + sheet.getName() + '.');
  }
}

function findExactId_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }
  const match = sheet.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(id)
    .matchEntireCell(true)
    .findNext();
  return match
    ? sheet.getRange(match.getRow(), 1, 1, COMMAND_HEADERS.length).getDisplayValues()[0]
    : null;
}

function findIdColumn_(headers) {
  const preferred = ['id', 'decision id', 'backlog id', 'question id', 'milestone', 'slice'];
  for (let i = 0; i < preferred.length; i += 1) {
    const exact = headers.indexOf(preferred[i]);
    if (exact >= 0) {
      return exact;
    }
  }
  const suffix = headers.findIndex(function (header) { return /(^| )id$/.test(header); });
  return suffix >= 0 ? suffix : 0;
}

function findLabelColumn_(headers, idIndex) {
  const preferred = [
    'name',
    'theme',
    'idea',
    'feature / behavior',
    'decision or question',
    'question',
    'area',
    'workstream',
  ];
  for (let i = 0; i < preferred.length; i += 1) {
    const exact = headers.indexOf(preferred[i]);
    if (exact >= 0 && exact !== idIndex) {
      return exact;
    }
  }
  return idIndex === 0 ? Math.min(1, headers.length - 1) : 0;
}

function normalizeHeader_(value) {
  return String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
}

function normalizeIdempotencyKey_(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9-]/g, '')
    .slice(0, 80);
  if (normalized.length < 12) {
    throw new Error('Invalid command idempotency key.');
  }
  return normalized;
}

function buildMessage_(commandType, sourceTab, sourceId, rawMessage) {
  const supplied = String(rawMessage || '').trim();
  if (commandType === 'MESSAGE') {
    if (!supplied) {
      throw new Error('Enter a follow-up message.');
    }
    return supplied;
  }
  if (supplied) {
    return supplied;
  }

  const reference = sourceTab && sourceId
    ? sourceTab + ' / ' + sourceId
    : 'the current plan';
  const defaults = {
    CONTINUE: reference + ' was explicitly approved. Continue with the authorized work.',
    REVIEW: 'Review the current work for ' + reference + ' and report findings before further changes.',
    STOP: 'Stop work associated with ' + reference + ' and report the current state.',
    APPROVAL: 'Apply the recorded approval decision for ' + reference + '.',
  };
  return defaults[commandType];
}

function getActor_() {
  const email = Session.getActiveUser().getEmail();
  return email ? 'human:' + email : 'human:unknown';
}

function escapeForSheet_(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}
