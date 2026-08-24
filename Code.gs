/**
 * Smart Online Attendance System — Google Apps Script backend
 *
 * This version preserves the existing Attendance event log and stores each
 * visit as one complete row in a new Sessions sheet.
 *
 * Deployment:
 * 1. Open Extensions > Apps Script from the supplied Google Sheet.
 * 2. Replace the editor contents with this file and save.
 * 3. Run setupAttendanceSystem() once and approve the permissions.
 * 4. Deploy as a Web App, executing as the owner and allowing the required users.
 */

const SHEET_EVENTS = 'Attendance';
const SHEET_SESSIONS = 'Sessions';
const SHEET_SETTINGS = 'Settings';
const SHEET_COUNTERS = 'Counters';
const SHEET_LOGS = 'Logs';

const VALID_ROLES = ['Teacher', 'User', 'Guest'];
const ROLE_PREFIX = { Teacher: 'T', User: 'U', Guest: 'G' };

const SESSION_HEADERS = [
  'Attendance ID', 'Full Name', 'Phone', 'Role', 'Date', 'Sign In', 'Sign Out',
  'Duration (minutes)', 'Sign In Latitude', 'Sign In Longitude',
  'Sign In Accuracy (m)', 'Sign In Location Status', 'Sign Out Latitude',
  'Sign Out Longitude', 'Sign Out Accuracy (m)', 'Sign Out Location Status',
  'Status', 'Created At', 'Updated At', 'Notes'
];

const SETTINGS_HEADERS = [
  'OrgName', 'AttendanceLat', 'AttendanceLng', 'AllowedRadiusMeters',
  'OpeningTime', 'ClosingTime', 'LocationPolicy', 'SystemStatus'
];

const COUNTER_HEADERS = ['Counter Key', 'Next Number'];
const LOG_HEADERS = ['Log ID', 'Admin', 'Action', 'Date', 'Time', 'Description'];

// ---------- Web app entry points ----------

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'getSession') {
      return jsonResponse(handleGetSession(e.parameter.phone));
    }
    return jsonResponse({ success: false, message: 'Unknown or missing action.' });
  } catch (err) {
    return jsonResponse({ success: false, message: safeErrorMessage(err) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, message: 'Request body is required.' });
    }

    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === 'signin') return jsonResponse(handleSignIn(body));
    if (action === 'signout') return jsonResponse(handleSignOut(body));

    return jsonResponse({ success: false, message: 'Unknown or missing action.' });
  } catch (err) {
    return jsonResponse({ success: false, message: safeErrorMessage(err) });
  }
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeErrorMessage(err) {
  return 'Server error: ' + ((err && err.message) || 'Please try again.');
}

// ---------- Sign in ----------

function handleSignIn(body) {
  const fullName = String(body.full_name || '').trim();
  const phone = normalizePhone(body.phone);
  const role = String(body.role || '').trim();
  const lat = validCoordinate(body.lat, -90, 90);
  const lng = validCoordinate(body.lng, -180, 180);
  const accuracy = validPositiveNumber(body.accuracy);

  if (fullName.length < 2) {
    return { success: false, message: 'Full name is required.' };
  }
  if (!phone || phone.replace(/\D/g, '').length < 7) {
    return { success: false, message: 'A valid phone number is required.' };
  }
  if (VALID_ROLES.indexOf(role) === -1) {
    return { success: false, message: 'Invalid role selected.' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    ensureBaseSheets();
    const settings = getSettings();
    if (settings.systemStatus !== 'ACTIVE') {
      return { success: false, message: 'Attendance is currently closed.' };
    }

    const sessionsSheet = getSheet(SHEET_SESSIONS);
    const existing = findActiveSessionByPhone(sessionsSheet, phone);
    if (existing) {
      return {
        success: false,
        message: 'You already have an active session (' + existing.attendanceId + '). Please sign out first.'
      };
    }

    const location = evaluateLocation(lat, lng, accuracy, settings);
    if (location.status === 'OUT_OF_RANGE' && settings.locationPolicy === 'STRICT') {
      return {
        success: false,
        message: 'You are outside the allowed attendance location. Sign-in rejected.'
      };
    }

    const now = new Date();
    const attendanceId = generateAttendanceId(role);
    sessionsSheet.appendRow([
      attendanceId, fullName, phone, role, now, now, '', '',
      lat, lng, accuracy, location.status, '', '', '', '',
      'ACTIVE', now, now, ''
    ]);

    appendEventLog({
      timestamp: now,
      attendanceId: attendanceId,
      name: fullName,
      role: role,
      phone: phone,
      action: 'Sign In',
      latitude: lat,
      longitude: lng,
      accuracy: accuracy,
      locationStatus: location.status
    });

    return {
      success: true,
      attendanceId: attendanceId,
      status: 'ACTIVE',
      locationStatus: location.status,
      message: 'Signed in successfully.'
    };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Active-session lookup ----------

function handleGetSession(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { success: false, message: 'Phone number is required.' };

  ensureBaseSheets();
  const session = findActiveSessionByPhone(getSheet(SHEET_SESSIONS), phone);
  if (!session) {
    return { success: false, message: 'No active session found for this phone number.' };
  }

  return {
    success: true,
    session: {
      attendanceId: session.attendanceId,
      fullName: session.fullName,
      role: session.role,
      signInTime: formatDate(session.signInTime)
    }
  };
}

// ---------- Sign out ----------

function handleSignOut(body) {
  const attendanceId = String(body.attendanceId || '').trim();
  const phone = normalizePhone(body.phone);
  const lat = validCoordinate(body.lat, -90, 90);
  const lng = validCoordinate(body.lng, -180, 180);
  const accuracy = validPositiveNumber(body.accuracy);

  if (!attendanceId) return { success: false, message: 'Attendance ID is required.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    ensureBaseSheets();
    const sessionsSheet = getSheet(SHEET_SESSIONS);
    const rowNumber = findSessionRow(sessionsSheet, attendanceId);
    if (!rowNumber) return { success: false, message: 'Attendance ID not found.' };

    const row = sessionsSheet.getRange(rowNumber, 1, 1, SESSION_HEADERS.length).getValues()[0];
    const session = rowToSession(row);

    if (phone && normalizePhone(session.phone) !== phone) {
      return { success: false, message: 'This session does not belong to that phone number.' };
    }
    if (session.status !== 'ACTIVE') {
      return { success: false, message: 'This session is not active and cannot be signed out.' };
    }

    const settings = getSettings();
    const location = evaluateLocation(lat, lng, accuracy, settings);
    if (location.status === 'OUT_OF_RANGE' && settings.locationPolicy === 'STRICT') {
      return {
        success: false,
        message: 'You are outside the allowed attendance location. Sign-out rejected.'
      };
    }

    const now = new Date();
    const durationMinutes = Math.max(0, Math.round((now - new Date(session.signInTime)) / 60000));

    // Update only the sign-out fields and lifecycle fields in the Sessions row.
    sessionsSheet.getRange(rowNumber, 7).setValue(now);                 // Sign Out
    sessionsSheet.getRange(rowNumber, 8).setValue(durationMinutes);     // Duration
    sessionsSheet.getRange(rowNumber, 13).setValue(lat);               // Sign Out Latitude
    sessionsSheet.getRange(rowNumber, 14).setValue(lng);               // Sign Out Longitude
    sessionsSheet.getRange(rowNumber, 15).setValue(accuracy);          // Sign Out Accuracy
    sessionsSheet.getRange(rowNumber, 16).setValue(location.status);   // Sign Out Location Status
    sessionsSheet.getRange(rowNumber, 17).setValue('COMPLETED');        // Status
    sessionsSheet.getRange(rowNumber, 19).setValue(now);               // Updated At

    appendEventLog({
      timestamp: now,
      attendanceId: session.attendanceId,
      name: session.fullName,
      role: session.role,
      phone: session.phone,
      action: 'Sign Out',
      latitude: lat,
      longitude: lng,
      accuracy: accuracy,
      locationStatus: location.status
    });

    return {
      success: true,
      attendanceId: attendanceId,
      durationMinutes: durationMinutes,
      locationStatus: location.status,
      message: 'Signed out successfully.'
    };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Sheet setup and event logging ----------

function setupAttendanceSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetWithHeaders(ss, SHEET_EVENTS, [
    'Server Timestamp', 'Attendance ID', 'Date', 'Time', 'Name', 'Role', 'Phone',
    'Action', 'Latitude', 'Longitude', 'Accuracy (m)', 'Location Status'
  ], false);
  ensureSheetWithHeaders(ss, SHEET_SESSIONS, SESSION_HEADERS, true);
  ensureSheetWithHeaders(ss, SHEET_SETTINGS, SETTINGS_HEADERS, true);
  ensureSheetWithHeaders(ss, SHEET_COUNTERS, COUNTER_HEADERS, true);
  ensureSheetWithHeaders(ss, SHEET_LOGS, LOG_HEADERS, true);

  const settingsSheet = ss.getSheetByName(SHEET_SETTINGS);
  if (settingsSheet.getLastRow() < 2) {
    settingsSheet.getRange(2, 1, 1, SETTINGS_HEADERS.length).setValues([[
      'ZSSF Event Registration', '', '', 100, '08:00', '18:00', 'FLEXIBLE', 'ACTIVE'
    ]]);
  }

  return 'Attendance system sheets are ready. Existing event records were preserved.';
}

function ensureBaseSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetWithHeaders(ss, SHEET_EVENTS, [
    'Server Timestamp', 'Attendance ID', 'Date', 'Time', 'Name', 'Role', 'Phone',
    'Action', 'Latitude', 'Longitude', 'Accuracy (m)', 'Location Status'
  ], false);
  ensureSheetWithHeaders(ss, SHEET_SESSIONS, SESSION_HEADERS, true);
  ensureSheetWithHeaders(ss, SHEET_SETTINGS, SETTINGS_HEADERS, true);
  ensureSheetWithHeaders(ss, SHEET_COUNTERS, COUNTER_HEADERS, true);
  ensureSheetWithHeaders(ss, SHEET_LOGS, LOG_HEADERS, true);
}

function ensureSheetWithHeaders(ss, name, headers, freezeHeader) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (freezeHeader) sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendEventLog(event) {
  const sheet = getSheet(SHEET_EVENTS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const timestamp = event.timestamp || new Date();
  const values = headers.map(function(header) {
    switch (normalizeHeader(header)) {
      case 'servertimestamp': return timestamp;
      case 'attendanceid': return event.attendanceId || '';
      case 'date': return timestamp;
      case 'time': return timestamp;
      case 'name': return event.name || '';
      case 'role': return event.role || '';
      case 'phone': return event.phone || '';
      case 'action': return event.action || '';
      case 'latitude': return event.latitude === null ? '' : event.latitude;
      case 'longitude': return event.longitude === null ? '' : event.longitude;
      case 'accuracym': return event.accuracy === null ? '' : event.accuracy;
      case 'locationstatus': return event.locationStatus || '';
      default: return '';
    }
  });
  sheet.appendRow(values);
}

// ---------- Session and settings helpers ----------

function findActiveSessionByPhone(sheet, phone) {
  const rows = getDataRows(sheet);
  for (let i = rows.length - 1; i >= 0; i--) {
    const session = rowToSession(rows[i]);
    if (normalizePhone(session.phone) === phone && session.status === 'ACTIVE') {
      return session;
    }
  }
  return null;
}

function findSessionRow(sheet, attendanceId) {
  const rows = getDataRows(sheet);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() === attendanceId) return i + 2;
  }
  return 0;
}

function getDataRows(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, SESSION_HEADERS.length).getValues();
}

function rowToSession(row) {
  return {
    attendanceId: row[0], fullName: row[1], phone: row[2], role: row[3], date: row[4],
    signInTime: row[5], signOutTime: row[6], durationMinutes: row[7],
    signInLat: row[8], signInLng: row[9], signInAccuracy: row[10], signInLocationStatus: row[11],
    signOutLat: row[12], signOutLng: row[13], signOutAccuracy: row[14], signOutLocationStatus: row[15],
    status: row[16], createdAt: row[17], updatedAt: row[18], notes: row[19]
  };
}

function generateAttendanceId(role) {
  const prefix = ROLE_PREFIX[role];
  const year = new Date().getFullYear();
  const key = prefix + '_' + year;
  const sheet = getSheet(SHEET_COUNTERS);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === key) {
      const nextNumber = Number(rows[i][1] || 0) + 1;
      sheet.getRange(i + 1, 2).setValue(nextNumber);
      return prefix + '-' + year + '-' + padNumber(nextNumber, 4);
    }
  }

  sheet.appendRow([key, 1]);
  return prefix + '-' + year + '-0001';
}

function getSettings() {
  const sheet = getSheet(SHEET_SETTINGS);
  if (sheet.getLastRow() < 2) return defaultSettings();

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const values = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const settings = {};
  headers.forEach(function(header, index) { settings[header] = values[index]; });

  const attendanceLat = parseFloat(settings.AttendanceLat);
  const attendanceLng = parseFloat(settings.AttendanceLng);
  const radius = parseFloat(settings.AllowedRadiusMeters);
  return {
    orgName: settings.OrgName || 'ZSSF Event Registration',
    attendanceLat: isFinite(attendanceLat) ? attendanceLat : null,
    attendanceLng: isFinite(attendanceLng) ? attendanceLng : null,
    allowedRadiusMeters: isFinite(radius) && radius > 0 ? radius : 100,
    locationPolicy: String(settings.LocationPolicy || 'FLEXIBLE').toUpperCase(),
    openingTime: settings.OpeningTime || '08:00',
    closingTime: settings.ClosingTime || '18:00',
    systemStatus: String(settings.SystemStatus || 'ACTIVE').toUpperCase(),
    hasLocation: isFinite(attendanceLat) && isFinite(attendanceLng)
  };
}

function defaultSettings() {
  return {
    orgName: 'ZSSF Event Registration', attendanceLat: null, attendanceLng: null,
    allowedRadiusMeters: 100, locationPolicy: 'FLEXIBLE', openingTime: '08:00',
    closingTime: '18:00', systemStatus: 'ACTIVE', hasLocation: false
  };
}

function evaluateLocation(lat, lng, accuracy, settings) {
  if (lat === null || lng === null) return { status: 'UNAVAILABLE' };
  if (!settings.hasLocation) return { status: 'NOT_CONFIGURED' };
  const distance = haversineDistance(lat, lng, settings.attendanceLat, settings.attendanceLng);
  return { status: distance <= settings.allowedRadiusMeters ? 'VALID' : 'OUT_OF_RANGE' };
}

// ---------- General helpers ----------

function getSheet(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Required sheet is missing: ' + name + '. Run setupAttendanceSystem() first.');
  return sheet;
}

function validCoordinate(value, min, max) {
  const number = Number(value);
  return isFinite(number) && number >= min && number <= max ? number : null;
}

function validPositiveNumber(value) {
  const number = Number(value);
  return isFinite(number) && number >= 0 ? number : null;
}

function padNumber(value, size) {
  let result = String(value);
  while (result.length < size) result = '0' + result;
  return result;
}

function normalizePhone(phone) {
  return phone ? String(phone).replace(/[\s\-()]/g, '') : '';
}

function normalizeHeader(header) {
  return String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatDate(value) {
  return Utilities.formatDate(new Date(value), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const radius = 6371000;
  const toRad = function(degrees) { return degrees * Math.PI / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
