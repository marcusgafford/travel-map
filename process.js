/**
 * Travel map — processing job, GitHub Actions edition.
 *
 * Same pipeline as Code.gs's processInbox(), except the caption comes from yt-dlp
 * (works on Instagram too, and reads the real description) instead of TikTok oEmbed.
 * Intake stays the Apps Script Web App — this only reads/writes the Sheet.
 *
 *   node process.js             process every unprocessed Inbox row
 *   node process.js --selfcheck run the pure-logic assertions, no network
 */

const { spawnSync } = require('node:child_process');
const assert = require('node:assert');

const MODEL = 'claude-sonnet-5';
const DUPE_METERS = 60;
const PIN_HEADER = ['timestamp', 'first_url', 'seen_from', 'caption', 'place',
  'description', 'lat', 'lng', 'city'];

// ---------------------------------------------------------------- pure bits
// Mirrors Code.gs. Kept duplicated on purpose: Code.gs has to stay a single
// paste-into-the-editor file, so there is nothing to import from.

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// ponytail: suffix-strip + country suffix stops "Kyoto"/"Kyoto-shi" fragmenting tabs.
// Swap in a city alias map if a geocoder shape slips through.
function cityName(city, country) {
  let c = String(city).split(',')[0].trim()
    .replace(/[-\s](shi|ku|si|cho|machi)$/i, '')
    .replace(/\s+(City|Municipality|Prefecture)$/i, '')
    .replace(/\s+/g, ' ');
  if (!c) c = 'Unknown';
  return country ? `${c}-${String(country).trim()}` : c;
}

function meters(aLat, aLng, bLat, bLng) {
  const R = 6371000, t = Math.PI / 180;
  const dLat = (bLat - aLat) * t, dLng = (bLng - aLng) * t;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function findDupe(pins, g) {
  const addr = norm(g.address);
  return pins.find((p) => (p.addr && p.addr === addr) ||
    meters(p.lat, p.lng, g.lat, g.lng) <= DUPE_METERS) || null;
}

function parseArray(text) {
  const m = String(text).match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    return JSON.parse(m[0]).map((s) => String(s).trim()).filter(Boolean);
  } catch { return []; }
}

// ------------------------------------------------------------------ sheets

let api = null;
async function sheets() {
  if (api) return api;
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SA_JSON),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  api = google.sheets({ version: 'v4', auth: await auth.getClient() });
  return api;
}

const ID = () => process.env.SHEET_ID;
const A1 = (title, range) => `'${title.replace(/'/g, "''")}'!${range}`;

async function get(title, range = 'A:I') {
  const s = await sheets();
  const r = await s.spreadsheets.values.get({ spreadsheetId: ID(), range: A1(title, range) });
  return r.data.values || [];
}

async function append(title, row) {
  const s = await sheets();
  await s.spreadsheets.values.append({
    spreadsheetId: ID(), range: A1(title, 'A:I'),
    valueInputOption: 'RAW', requestBody: { values: [row] },
  });
}

async function put(title, range, value) {
  const s = await sheets();
  await s.spreadsheets.values.update({
    spreadsheetId: ID(), range: A1(title, range),
    valueInputOption: 'RAW', requestBody: { values: [[value]] },
  });
}

async function titles() {
  const s = await sheets();
  const r = await s.spreadsheets.get({ spreadsheetId: ID(), fields: 'sheets.properties.title' });
  return r.data.sheets.map((x) => x.properties.title);
}

async function cityTab(city) {
  if ((await titles()).includes(city)) return city;
  const s = await sheets();
  await s.spreadsheets.batchUpdate({
    spreadsheetId: ID(),
    requestBody: { requests: [{ addSheet: { properties: { title: city } } }] },
  });
  await append(city, PIN_HEADER);
  return city;
}

async function appendSeen(title, row, url) {
  const cell = (await get(title, `C${row}:C${row}`))[0]?.[0] || '';
  const seen = String(cell).split(/\s*,\s*/).filter(Boolean);
  if (!seen.includes(url)) await put(title, `C${row}`, seen.concat(url).join(', '));
}

// ------------------------------------------------------------- the pieces

/** yt-dlp reads the real description — this is why the job moved off Apps Script. */
function caption(url) {
  const r = spawnSync('yt-dlp', ['--dump-json', '--no-warnings', '--skip-download', url],
    { encoding: 'utf8', maxBuffer: 1 << 27 });
  if (r.status !== 0) throw new Error('yt-dlp: ' + String(r.stderr || '').trim().slice(0, 200));
  const j = JSON.parse(r.stdout.split('\n')[0]);
  return [j.description || j.title, j.uploader].filter(Boolean).join(' — ');
}

async function claude(content, tools, max_tokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens, messages: [{ role: 'user', content }], ...(tools && { tools }) }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

const extractPlaces = async (cap) => parseArray(await claude(
  `Caption from a short travel video:\n\n${cap}\n\n` +
  'List every distinct real-world place (restaurant, bar, museum, park, landmark, ' +
  'neighbourhood) that is named or clearly implied. Include the city or country in each ' +
  'entry so it can be geocoded. Do not merge separate places into one entry. If none, ' +
  'return an empty list. Reply with ONLY a JSON array of strings.', null, 512));

const describe = (place, cap) => claude(
  `Search the web, then write 1-2 original sentences describing "${place}" — what it is ` +
  `and what it is known for. Context it was mentioned in: ${cap}\n\n` +
  'Reply with only the description, no preamble.',
  [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }], 1024);

async function geocode(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1' +
    `&email=${encodeURIComponent(process.env.NOMINATIM_EMAIL || '')}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'user-agent': 'personal-travel-map/1.0' } });
  if (!res.ok) return null;
  const [r] = await res.json();
  if (!r) return null;
  const ad = r.address || {};
  return {
    lat: +r.lat, lng: +r.lon, address: r.display_name,
    city: cityName(ad.city || ad.town || ad.village || ad.municipality || ad.county || ad.state || '',
      ad.country || ''),
  };
}

// ---------------------------------------------------------------- pipeline

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function savePlace(place, cap, url, pins) {
  await sleep(1000);                              // Nominatim: 1 req/sec
  const g = await geocode(place);
  if (!g) return null;

  const hit = findDupe(pins, g);
  if (hit) {
    await appendSeen('Pins', hit.row, url);
    if ((await titles()).includes(hit.city)) {
      const rows = await get(hit.city);
      const i = rows.findIndex((r, n) => n > 0 && meters(+r[6], +r[7], hit.lat, hit.lng) <= 1);
      if (i > 0) await appendSeen(hit.city, i + 1, url);
    }
    return null;
  }

  const row = [new Date().toISOString(), url, url, cap, place, await describe(place, cap),
    g.lat, g.lng, g.city];
  await append('Pins', row);
  await append(await cityTab(g.city), row);
  pins.push({ row: 0, addr: norm(g.address), lat: g.lat, lng: g.lng, city: g.city });
  return place;
}

async function main() {
  const inbox = await get('Inbox', 'A:C');
  const pins = (await get('Pins')).slice(1)
    .filter((r) => r[6] || r[7])
    .map((r, i) => ({ row: i + 2, addr: norm(`${r[4]} ${r[8]}`), lat: +r[6], lng: +r[7], city: r[8] }));

  const added = [], empty = [], failed = [];
  for (let n = 1; n < inbox.length; n++) {
    if (inbox[n][2]) continue;                    // already processed
    const url = String(inbox[n][1] || '').trim();
    if (!url) continue;
    try {
      const cap = caption(url);
      const places = await extractPlaces(cap);
      if (!places.length) {
        empty.push(url);
        await put('Inbox', `C${n + 1}`, 'no-places');
        continue;
      }
      for (const p of places) {
        const name = await savePlace(p, cap, url, pins);
        if (name) added.push(name);
      }
      await put('Inbox', `C${n + 1}`, 'yes');
    } catch (e) {
      failed.push(`${url} — ${e.message}`);
      await put('Inbox', `C${n + 1}`, `error: ${e.message.slice(0, 120)}`);
    }
  }

  const summary = [
    `## Travel map: ${added.length} new pin(s)`, '',
    `**Added (${added.length}):** ${added.join(', ') || 'none'}`,
    `**No place found (${empty.length}):** ${empty.join(', ') || 'none'}`,
    `**Errors (${failed.length}):**`, ...failed.map((f) => `- ${f}`),
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
  // ponytail: failing the job is the notification — GitHub already emails on failure.
  if (failed.length) process.exit(1);
}

// ------------------------------------------------------------- self-check

function selfcheck() {
  assert.equal(norm('  Rua  Da Prata,  LISBOA '), 'rua da prata, lisboa');
  assert.equal(cityName('Kyoto-shi', 'Japan'), 'Kyoto-Japan');
  assert.equal(cityName('Kyoto, Kyoto Prefecture', 'Japan'), 'Kyoto-Japan');
  assert.equal(cityName('Paris', 'France'), 'Paris-France');
  assert.equal(cityName('', ''), 'Unknown');

  assert.equal(Math.round(meters(38.71, -9.14, 38.71, -9.14)), 0);
  assert.ok(meters(38.71, -9.14, 38.7103, -9.14) <= DUPE_METERS, '33m should dupe');
  assert.ok(meters(38.71, -9.14, 38.72, -9.14) > DUPE_METERS, '1km should not dupe');

  assert.equal(parseArray('sure:\n["A","B"]').length, 2);
  assert.equal(parseArray('no places here').length, 0);
  assert.equal(parseArray('[]').length, 0);

  const pins = [{ row: 2, addr: 'time out market, lisbon', lat: 38.7067, lng: -9.1459, city: 'Lisbon-Portugal' }];
  assert.ok(findDupe(pins, { address: ' Time Out  Market, Lisbon ', lat: 0, lng: 0 }), 'addr dupe');
  assert.ok(findDupe(pins, { address: 'x', lat: 38.7069, lng: -9.1459 }), 'coord dupe');
  assert.equal(findDupe(pins, { address: 'x', lat: 38.72, lng: -9.15 }), null);

  assert.equal(A1("Paris-France", 'A:I'), "'Paris-France'!A:I");
  console.log('self-check OK');
}

if (process.argv.includes('--selfcheck')) selfcheck();
else main().catch((e) => { console.error(e); process.exit(1); });
