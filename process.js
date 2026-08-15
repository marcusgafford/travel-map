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
const BROAD = new Set(['city', 'town', 'village', 'municipality', 'county', 'state',
  'province', 'region', 'country', 'continent', 'administrative', 'postcode']);
// Order for tabs this job creates. Existing tabs are read by header NAME, so columns
// can be rearranged in the sheet without touching any of this.
const PIN_HEADER = ['place', 'description', 'lat', 'lng', 'city', 'label',
  'timestamp', 'first_url', 'seen_from'];

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

/** "Coffee shop" + "Clima comedor, Madrid, Spain" -> "Coffee shop - Clima comedor" */
function label(category, place) {
  const name = String(place).split(',')[0].trim();
  const cat = String(category).replace(/[.\s]+$/, '').trim();
  return cat ? `${cat} - ${name}` : name;
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
const colOf = (i) => String.fromCharCode(65 + i);
const ixOf = (header) => Object.fromEntries((header || []).map((h, i) => [String(h).trim(), i]));
const rowFor = (ix, o) => Object.keys(ix).reduce(
  (r, k) => { r[ix[k]] = o[k] ?? ''; return r; }, new Array(Object.keys(ix).length).fill(''));
const headerOf = async (title) => ixOf((await get(title, '1:1'))[0]);

async function get(title, range = 'A:Z') {
  const s = await sheets();
  const r = await s.spreadsheets.values.get({ spreadsheetId: ID(), range: A1(title, range) });
  return r.data.values || [];
}

async function append(title, row) {
  const s = await sheets();
  await s.spreadsheets.values.append({
    spreadsheetId: ID(), range: A1(title, 'A:Z'),
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

async function ensureTab(title, header) {
  if ((await titles()).includes(title)) return title;
  const s = await sheets();
  await s.spreadsheets.batchUpdate({
    spreadsheetId: ID(),
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  await append(title, header);
  return title;
}

const cityTab = (city) => ensureTab(city, PIN_HEADER);

async function appendSeen(title, ix, row, url) {
  const c = colOf(ix.seen_from);
  const cell = (await get(title, `${c}${row}:${c}${row}`))[0]?.[0] || '';
  const seen = String(cell).split(/\s*,\s*/).filter(Boolean);
  if (!seen.includes(url)) await put(title, `${c}${row}`, seen.concat(url).join(', '));
}

// ------------------------------------------------------------- the pieces

/** yt-dlp reads the real description — this is why the job moved off Apps Script. */
async function caption(url) {
  const r = spawnSync('yt-dlp', ['--dump-json', '--no-warnings', '--skip-download', url],
    { encoding: 'utf8', maxBuffer: 1 << 27 });
  if (r.status === 0) {
    const j = JSON.parse(r.stdout.split('\n')[0]);
    return [j.description || j.title, j.uploader].filter(Boolean).join(' — ');
  }
  // yt-dlp can't read TikTok photo/slideshow posts, and oEmbed 400s on both the
  // short link and the /photo/ path — but it answers for the /video/ path of the
  // same id. So: follow the redirect, swap the path, ask oEmbed.
  const real = (await fetch(url, { method: 'HEAD', redirect: 'follow' })).url
    .split('?')[0].replace('/photo/', '/video/');
  const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(real)}`);
  if (!res.ok) throw new Error('yt-dlp: ' + String(r.stderr || '').trim().slice(0, 160));
  const j = await res.json();
  return [j.title, j.author_name].filter(Boolean).join(' — ');
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
  'List the specific places worth pinning on a personal travel map: somewhere you can ' +
  'actually walk into or stand in front of — a restaurant, bar, cafe, shop, hotel, ' +
  'museum, park, viewpoint, beach, trail or named landmark. Include the city and ' +
  'country in each entry so it can be geocoded, and do not merge separate places into ' +
  'one entry.\n\nUse judgement about what is worth a pin. Skip anything a traveller ' +
  'would not need marked: whole cities, regions, countries, districts and ' +
  'neighbourhoods; generic mentions like "the airport" or "a rooftop bar" with no ' +
  'name; and the obvious context of the trip rather than a destination in it. ' +
  'If nothing qualifies, return an empty list. Reply with ONLY a JSON array of ' +
  'strings.', null, 512));

// Deliberately does NOT see the video caption — the description must come from
// searching for the place itself, not from rewording someone's post.
const describe = (place) => claude(
  `Search the web for "${place}", then write 1-2 original sentences describing what it ` +
  'is and what it is known for. Use only what you find about the place itself. ' +
  'Reply with only the description, no preamble.',
  [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }], 1024);

const categoryOf = (place) => claude(
  `What kind of place is "${place}"? Reply with 1-3 words only, e.g. "Coffee shop", ` +
  '"Tapas bar", "Museum", "Park". No punctuation, no sentence.', null, 32);

async function geocode(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1' +
    `&email=${encodeURIComponent(process.env.NOMINATIM_EMAIL || '')}&q=${encodeURIComponent(q)}`;
  // accept-language pins country/city names to English — without it Nominatim answers
  // in the local language and you get Madrid-España next to Paris-France.
  const res = await fetch(url, {
    headers: { 'user-agent': 'personal-travel-map/1.0', 'accept-language': 'en' },
  });
  // Don't swallow this — a blocked or rate-limited geocoder used to look identical
  // to "place not found", so rows silently completed with zero pins.
  if (!res.ok) throw new Error(`Nominatim ${res.status} for "${q}"`);
  const [r] = await res.json();
  if (!r) return null;
  // Backstop for the extraction prompt: never pin a whole city/region/country, even
  // if one slips through. OSM tags those as boundaries or admin place types.
  if (r.category === 'boundary' || BROAD.has(r.addresstype)) {
    console.log(`skipping "${q}" — too broad (${r.addresstype})`);
    return null;
  }
  const ad = r.address || {};
  return {
    lat: +r.lat, lng: +r.lon, address: r.display_name,
    city: cityName(ad.city || ad.town || ad.village || ad.municipality || ad.county || ad.state || '',
      ad.country || ''),
  };
}

// ---------------------------------------------------------------- pipeline

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function savePlace(place, cap, url, pins, missed, ix) {
  await sleep(1000);                              // Nominatim: 1 req/sec
  let g = await geocode(place);
  if (!g) {
    // OSM rarely knows small cafés/bars by name. Have Claude look up the street
    // address, then geocode that — coordinates still come from Nominatim, never
    // from the model.
    const addr = await claude(`Search the web for "${place}". Reply with ONLY its full ` +
      'street address: street and number, postal code, city, country. Nothing else. ' +
      'If you cannot find it, reply exactly NONE.',
      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }], 512);
    if (!/^NONE/i.test(addr)) {
      await sleep(1000);
      g = await geocode(addr.replace(/\s+/g, ' ').trim());
    }
  }
  if (!g) { missed.push(place); return null; }

  const hit = findDupe(pins, g);
  if (hit) {
    await appendSeen('Pins', ix, hit.row, url);
    if ((await titles()).includes(hit.city)) {
      const cix = await headerOf(hit.city);
      const rows = await get(hit.city);
      const i = rows.findIndex((r, n) => n > 0 &&
        meters(+r[cix.lat], +r[cix.lng], hit.lat, hit.lng) <= 1);
      if (i > 0) await appendSeen(hit.city, cix, i + 1, url);
    }
    return null;
  }

  // Line breaks inside a cell break My Maps' sheet importer, so flatten them.
  const flat = (s) => String(s).replace(/\s*\n+\s*/g, ' ').trim();
  const values = {
    timestamp: new Date().toISOString(), first_url: url, seen_from: url, place,
    description: flat(await describe(place)), lat: g.lat, lng: g.lng, city: g.city,
    label: label(await categoryOf(place), place),
  };
  await append('Pins', rowFor(ix, values));
  const city = await cityTab(g.city);
  await append(city, rowFor(await headerOf(city), values));
  pins.push({ row: 0, addr: norm(g.address), lat: g.lat, lng: g.lng, city: g.city });
  return place;
}

async function main() {
  await ensureTab('Inbox', ['timestamp', 'url', 'processed']);
  await ensureTab('Pins', PIN_HEADER);

  const meta = await (await sheets()).spreadsheets.get({ spreadsheetId: ID(), fields: 'properties.title' });
  const inbox = await get('Inbox', 'A:C');
  console.log(`reading "${meta.data.properties.title}" — ${Math.max(inbox.length - 1, 0)} inbox row(s)`);
  const pinsIx = await headerOf('Pins');
  const pins = (await get('Pins')).slice(1)
    .filter((r) => r[pinsIx.lat] || r[pinsIx.lng])
    .map((r, i) => ({ row: i + 2, addr: norm(`${r[pinsIx.place]} ${r[pinsIx.city]}`),
      lat: +r[pinsIx.lat], lng: +r[pinsIx.lng], city: r[pinsIx.city] }));

  const added = [], empty = [], failed = [], missed = [];
  for (let n = 1; n < inbox.length; n++) {
    // `error:` rows retry themselves next run — a broken URL just re-errors and stays
    // visible in the summary, which beats making you clear the cell by hand.
    // FORCE=1 (workflow_dispatch input) reruns everything, ignoring the flags.
    if (!process.env.FORCE && inbox[n][2] && !String(inbox[n][2]).startsWith('error:')) continue;
    const url = String(inbox[n][1] || '').trim();
    if (!url) continue;
    try {
      const cap = await caption(url);
      const places = await extractPlaces(cap);
      if (!places.length) {
        empty.push(url);
        await put('Inbox', `C${n + 1}`, 'no-places');
        continue;
      }
      for (const p of places) {
        const name = await savePlace(p, cap, url, pins, missed, pinsIx);
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
    `**Not pinned — too broad or not found (${missed.length}):** ${missed.join(', ') || 'none'}`,
    `**Errors (${failed.length}):**`, ...failed.map((f) => `- ${f}`),
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
  // ponytail: failing the job is the notification — GitHub already emails on failure.
  if (failed.length) process.exit(1);
}

/** Rewrite every description from a fresh web search, ignoring the video caption. */
async function redescribe() {
  for (const t of await titles()) {
    const rows = await get(t);
    const ix = ixOf(rows[0]);
    if (ix.place === undefined) continue;                        // Pins / city tabs only
    for (let n = 1; n < rows.length; n++) {
      if (!rows[n][ix.place]) continue;
      const text = String(await describe(rows[n][ix.place])).replace(/\s*\n+\s*/g, ' ').trim();
      await put(t, `${colOf(ix.description)}${n + 1}`, text);
      console.log(`${t} row ${n + 1}: ${text.slice(0, 90)}`);
    }
  }
}

/** Fill the label column on rows written before it existed. Idempotent. */
async function relabel() {
  for (const t of await titles()) {
    const rows = await get(t);
    const ix = ixOf(rows[0]);
    if (ix.place === undefined || ix.label === undefined) continue;
    for (let n = 1; n < rows.length; n++) {
      if (rows[n][ix.label] || !rows[n][ix.place]) continue;     // has one, or empty row
      const text = label(await categoryOf(rows[n][ix.place]), rows[n][ix.place]);
      await put(t, `${colOf(ix.label)}${n + 1}`, text);
      console.log(`${t} row ${n + 1}: ${text}`);
    }
  }
}

/** One-shot repair: strip line breaks out of already-written rows. Idempotent. */
async function flattenExisting() {
  const flat = (v) => (typeof v === 'string' ? v.replace(/\s*\n+\s*/g, ' ').trim() : v);
  for (const t of await titles()) {
    const rows = await get(t);
    if (!rows.length || rows[0][0] !== 'timestamp') continue;      // not one of ours
    const width = rows[0].length;
    const out = rows.map((r) => Array.from({ length: width }, (_, i) => flat(r[i] ?? '')));
    if (JSON.stringify(out) === JSON.stringify(rows)) { console.log(`${t}: already clean`); continue; }
    const s = await sheets();
    await s.spreadsheets.values.update({
      spreadsheetId: ID(), range: A1(t, `A1:${String.fromCharCode(64 + width)}${out.length}`),
      valueInputOption: 'RAW', requestBody: { values: out },
    });
    console.log(`${t}: rewrote ${out.length} row(s)`);
  }
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
  const ix = ixOf(['place', 'lat', 'lng', 'seen_from']);
  assert.equal(colOf(ix.seen_from), 'D');
  assert.deepEqual(rowFor(ix, { place: 'X', lat: 1, lng: 2, seen_from: 'u', city: 'skip' }),
    ['X', 1, 2, 'u']);
  assert.deepEqual(rowFor(ixOf(['lat', 'place']), { place: 'X', lat: 1 }), [1, 'X']);
  assert.equal(label('Coffee shop', 'Clima comedor, Madrid, Spain'), 'Coffee shop - Clima comedor');
  assert.equal(label('', 'Retiro Park, Madrid'), 'Retiro Park');
  console.log('self-check OK');
}

const fail = (e) => { console.error(e); process.exit(1); };
if (process.argv.includes('--selfcheck')) selfcheck();
else if (process.argv.includes('--flatten')) flattenExisting().catch(fail);
else if (process.argv.includes('--relabel')) relabel().catch(fail);
else if (process.argv.includes('--redescribe')) redescribe().catch(fail);
else main().catch(fail);
