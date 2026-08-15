/**
 * Personal Travel Map — TikTok share -> Google Sheet -> Google My Maps.
 *
 * Two entry points:
 *   doPost()       — Web App intake, called by the iOS Shortcut. Appends to Inbox.
 *   processInbox() — time-driven trigger, every 10-15 min. Does all the work.
 *
 * Run setup() once, then installTrigger() once. See README.md.
 */

var MODEL = 'claude-sonnet-5';
var BATCH = 15;              // Inbox rows per run (trigger hard-caps at 6 min)
var TIME_BUDGET_MS = 4.5 * 60 * 1000;
var DUPE_METERS = 60;

var INBOX = 'Inbox';
var PINS = 'Pins';
var PIN_HEADER = ['timestamp', 'first_url', 'seen_from', 'caption', 'place',
                  'description', 'lat', 'lng', 'city'];
var SEEN_COL = 3;            // seen_from, 1-based

// ---------------------------------------------------------------- intake

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  if (body.secret !== prop_('SHARED_SECRET')) return json_({ ok: false, error: 'bad secret' });
  var url = String(body.url || '').trim();
  if (!/^https?:\/\//.test(url)) return json_({ ok: false, error: 'no url' });

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { tab_(INBOX).appendRow([new Date(), url, '']); } finally { lock.releaseLock(); }
  return json_({ ok: true });
}

// ------------------------------------------------------------ processing

function processInbox() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;                 // previous run still going
  try {
    var started = Date.now();
    var inbox = tab_(INBOX);
    var rows = inbox.getDataRange().getValues();
    var pins = loadPins_();
    var added = [], empty = [], failed = [], done = 0;

    for (var r = 1; r < rows.length && done < BATCH; r++) {
      if (rows[r][2]) continue;                 // already processed
      if (Date.now() - started > TIME_BUDGET_MS) break;
      done++;
      var url = String(rows[r][1]).trim();
      try {
        var caption = caption_(url);
        var places = extractPlaces_(caption);
        if (!places.length) {
          empty.push(url);
          inbox.getRange(r + 1, 3).setValue('no-places');
          continue;
        }
        for (var p = 0; p < places.length; p++) {
          var name = savePlace_(places[p], caption, url, pins);
          if (name) added.push(name);
        }
        inbox.getRange(r + 1, 3).setValue('yes');
      } catch (err) {
        failed.push(url + ' — ' + err.message);
        inbox.getRange(r + 1, 3).setValue('error: ' + String(err.message).slice(0, 120));
      }
    }
    if (done) notify_(added, empty, failed);
  } finally {
    lock.releaseLock();
  }
}

/** Geocode, dedupe, describe, append. Returns the place name if a new pin was added. */
function savePlace_(place, caption, url, pins) {
  Utilities.sleep(1000);                        // Nominatim: 1 req/sec
  var g = geocode_(place);
  if (!g) return null;

  var hit = findDupe_(pins, g);
  if (hit) {
    appendSeen_(tab_(PINS), hit.row, url);
    var city = tabExists_(hit.city) ? tab_(hit.city) : null;
    if (city) {
      var rowInCity = findRow_(city, hit.lat, hit.lng);
      if (rowInCity) appendSeen_(city, rowInCity, url);
    }
    return null;
  }

  var desc = describe_(place, caption);
  var row = [new Date(), url, url, caption, place, desc, g.lat, g.lng, g.city];
  tab_(PINS).appendRow(row);
  cityTab_(g.city).appendRow(row);
  pins.push({ row: 0, addr: norm_(g.address), lat: g.lat, lng: g.lng, city: g.city });
  return place;
}

// ------------------------------------------------------------- the pieces

/** TikTok oEmbed — open, free, no token. Instagram needs a Meta token (see README). */
function caption_(url) {
  var res = UrlFetchApp.fetch(
    'https://www.tiktok.com/oembed?url=' + encodeURIComponent(url),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('oEmbed ' + res.getResponseCode());
  var j = JSON.parse(res.getContentText());
  return [j.title, j.author_name].filter(String).join(' — ');
}

function extractPlaces_(caption) {
  var out = claude_([{ role: 'user', content:
    'Caption from a short travel video:\n\n' + caption + '\n\n' +
    'List every distinct real-world place (restaurant, bar, museum, park, landmark, ' +
    'neighbourhood) that is named or clearly implied. Include the city or country in each ' +
    'entry so it can be geocoded. Do not merge separate places into one entry. If none, ' +
    'return an empty list. Reply with ONLY a JSON array of strings.' }], null, 512);
  return parseArray_(out);
}

function describe_(place, caption) {
  return claude_([{ role: 'user', content:
    'Search the web, then write 1-2 original sentences describing "' + place + '" — what it ' +
    'is and what it is known for. Context it was mentioned in: ' + caption + '\n\n' +
    'Reply with only the description, no preamble.' }],
    [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }], 1024);
}

function claude_(messages, tools, maxTokens) {
  var payload = { model: MODEL, max_tokens: maxTokens, messages: messages };
  if (tools) payload.tools = tools;
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': prop_('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Claude ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText()).content
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; }).join('').trim();
}

function geocode_(q) {
  var res = UrlFetchApp.fetch('https://nominatim.openstreetmap.org/search?format=jsonv2' +
    '&limit=1&addressdetails=1&email=' + encodeURIComponent(prop_('NOMINATIM_EMAIL')) +
    '&q=' + encodeURIComponent(q),
    { muteHttpExceptions: true, headers: { 'User-Agent': 'personal-travel-map/1.0' } });
  if (res.getResponseCode() !== 200) return null;
  var a = JSON.parse(res.getContentText());
  if (!a.length) return null;
  var r = a[0], ad = r.address || {};
  var city = ad.city || ad.town || ad.village || ad.municipality || ad.county || ad.state || '';
  return {
    lat: +r.lat, lng: +r.lon, address: r.display_name,
    city: cityName_(city, ad.country || '')
  };
}

// ------------------------------------------------------------ dedupe/util

function norm_(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

/**
 * ponytail: suffix-strip + country suffix is enough to stop "Kyoto"/"Kyoto-shi" fragmenting
 * tabs. If a geocoder starts returning shapes this misses, swap in a city alias map.
 */
function cityName_(city, country) {
  var c = String(city).split(',')[0].trim()
    .replace(/[-\s](shi|ku|si|cho|machi)$/i, '')
    .replace(/\s+(City|Municipality|Prefecture)$/i, '')
    .replace(/\s+/g, ' ');
  if (!c) c = 'Unknown';
  return country ? c + '-' + String(country).trim() : c;
}

function meters_(aLat, aLng, bLat, bLng) {
  var R = 6371000, t = Math.PI / 180;
  var dLat = (bLat - aLat) * t, dLng = (bLng - aLng) * t;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function findDupe_(pins, g) {
  var addr = norm_(g.address);
  for (var i = 0; i < pins.length; i++) {
    if (pins[i].addr && pins[i].addr === addr) return pins[i];
    if (meters_(pins[i].lat, pins[i].lng, g.lat, g.lng) <= DUPE_METERS) return pins[i];
  }
  return null;
}

function loadPins_() {
  var v = tab_(PINS).getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    if (!v[i][6] && !v[i][7]) continue;
    out.push({ row: i + 1, addr: norm_(v[i][4] + ' ' + v[i][8]), lat: +v[i][6], lng: +v[i][7], city: v[i][8] });
  }
  return out;
}

function findRow_(sheet, lat, lng) {
  var v = sheet.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (meters_(+v[i][6], +v[i][7], lat, lng) <= 1) return i + 1;
  }
  return 0;
}

function appendSeen_(sheet, row, url) {
  var cell = sheet.getRange(row, SEEN_COL);
  var seen = String(cell.getValue()).split(/\s*,\s*/).filter(String);
  if (seen.indexOf(url) === -1) cell.setValue(seen.concat(url).join(', '));
}

function parseArray_(text) {
  var m = String(text).match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    return JSON.parse(m[0]).map(function (s) { return String(s).trim(); }).filter(String);
  } catch (e) { return []; }
}

// -------------------------------------------------------------- plumbing

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tabExists_(name) { return !!ss_().getSheetByName(name); }
function tab_(name) { return ss_().getSheetByName(name) || ss_().insertSheet(name); }
function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing script property ' + k);
  return v;
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function cityTab_(city) {
  var existed = tabExists_(city), s = tab_(city);
  if (!existed) s.appendRow(PIN_HEADER);
  return s;
}

function notify_(added, empty, failed) {
  var body = 'Pins added (' + added.length + '):\n' + (added.join('\n') || '  none') +
    '\n\nNo place found (' + empty.length + '):\n' + (empty.join('\n') || '  none') +
    '\n\nErrors (' + failed.length + '):\n' + (failed.join('\n') || '  none') +
    '\n\n' + ss_().getUrl();
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
    'Travel map: ' + added.length + ' new pin(s)', body);
}

// ----------------------------------------------------------------- setup

function setup() {
  tab_(INBOX).getRange(1, 1, 1, 3).setValues([['timestamp', 'url', 'processed']]);
  tab_(PINS).getRange(1, 1, 1, PIN_HEADER.length).setValues([PIN_HEADER]);
  ss_().getSheetByName(INBOX).setFrozenRows(1);
  ss_().getSheetByName(PINS).setFrozenRows(1);
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processInbox') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(15).create();
}

/** Run from the editor; throws if the pure logic breaks. */
function runSelfCheck() {
  var eq = function (a, b, m) { if (String(a) !== String(b)) throw new Error(m + ': ' + a + ' != ' + b); };

  eq(norm_('  Rua  Da Prata,  LISBOA '), 'rua da prata, lisboa', 'norm');
  eq(cityName_('Kyoto-shi', 'Japan'), 'Kyoto-Japan', 'city suffix');
  eq(cityName_('Kyoto, Kyoto Prefecture', 'Japan'), 'Kyoto-Japan', 'city comma');
  eq(cityName_('Paris', 'France'), 'Paris-France', 'city plain');
  eq(cityName_('', ''), 'Unknown', 'city empty');

  eq(Math.round(meters_(38.7100, -9.1400, 38.7100, -9.1400)), 0, 'same point');
  if (meters_(38.7100, -9.1400, 38.7103, -9.1400) > DUPE_METERS) throw new Error('33m should dupe');
  if (meters_(38.7100, -9.1400, 38.7200, -9.1400) <= DUPE_METERS) throw new Error('1km should not dupe');

  eq(parseArray_('sure:\n["A","B"]').length, 2, 'array parse');
  eq(parseArray_('no places here').length, 0, 'array none');
  eq(parseArray_('[]').length, 0, 'array empty');

  var pins = [{ row: 2, addr: 'time out market, lisbon', lat: 38.7067, lng: -9.1459, city: 'Lisbon-Portugal' }];
  if (!findDupe_(pins, { address: ' Time Out  Market, Lisbon ', lat: 0, lng: 0 })) throw new Error('addr dupe');
  if (!findDupe_(pins, { address: 'x', lat: 38.7069, lng: -9.1459 })) throw new Error('coord dupe');
  if (findDupe_(pins, { address: 'x', lat: 38.72, lng: -9.15 })) throw new Error('false dupe');

  Logger.log('self-check OK');
}
