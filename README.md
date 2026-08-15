# Personal Travel Map

Share a TikTok → a pin shows up in Google My Maps, with a description.

No server. Intake is a Google Apps Script Web App (instant, free); processing is a
time-driven trigger on the same script that runs every 15 minutes.

```
iOS Shortcut ──POST──▶ Web App ──▶ Inbox tab
                                      │  (every 15 min)
                                      ▼
                       caption (TikTok oEmbed)
                       → Claude: extract places
                       → Nominatim: geocode each
                       → dedupe by location
                       → Claude + web_search: description
                       → Pins tab + per-city tab
                                      │  (manual tap)
                                      ▼
                       My Maps: Reimport and merge
```

## 1. Google Sheet

Create a new Sheet, name it whatever. Extensions → Apps Script, paste `Code.gs`
over the default file, save.

## 2. Script properties

Project Settings → Script Properties → add three:

| Property | Value |
|---|---|
| `ANTHROPIC_API_KEY` | key from console.anthropic.com |
| `SHARED_SECRET` | any long random string — the Shortcut sends this |
| `NOMINATIM_EMAIL` | your email; Nominatim's usage policy wants a contact |

## 3. Create the tabs

Run `setup()` once from the editor (authorize when prompted). It creates/headers
`Inbox` (timestamp, url, processed) and `Pins` (timestamp, first_url, seen_from,
caption, place, description, lat, lng, city).

City tabs are created automatically the first time a city appears, with the same
columns. They're named `City-Country` (`Lisbon-Portugal`, `Paris-Texas` vs
`Paris-France`) so same-named cities never collide.

Sanity check the pure logic any time with `runSelfCheck()` — it throws on failure,
logs `self-check OK` otherwise. It makes no network calls.

## 4. Install the trigger

Run `installTrigger()` once. That's a 15-minute time-driven trigger on
`processInbox`. It replaces any existing one, so it's safe to re-run.

Each run handles at most 15 Inbox rows and stops at 4.5 minutes (the trigger's hard
cap is 6). Leftovers wait for the next run. A run that's still going blocks the next
one from starting, so batches never overlap.

## 5. Deploy the Web App

> Click-by-click version of steps 5 and 6: [SETUP-PHONE.md](SETUP-PHONE.md).

Deploy → New deployment → type **Web app**:

- Execute as: **Me**
- Who has access: **Anyone**

Copy the `/exec` URL. "Anyone" is required (the Shortcut isn't logged in) — the
`SHARED_SECRET` check is what actually guards it.

## 6. The iOS Shortcut

Shortcuts app → new shortcut → ⓘ → **Show in Share Sheet**, accept types
**URLs** and **Text**.

1. **Get Contents of URL**
   - URL: your `/exec` URL
   - Method: `POST`
   - Request Body: `JSON`
     - `url` (Text) → `Shortcut Input`
     - `secret` (Text) → your `SHARED_SECRET`
2. **Get Dictionary Value** → `ok` from the previous result
3. **If** it *has any value* → **Show Notification** "Saved"
   **Otherwise** → **Show Notification** "Failed"

Name it something like "Save Place". Now sharing a TikTok → Save Place drops it in
the Inbox.

## 7. Google My Maps

1. mymaps.google.com → Create a new map.
2. Add layer → Import → Google Drive → pick your Sheet → pick a **city tab**.
3. Columns: `lat` + `lng` for position, `place` for the title. It'll offer
   `description` for the info window — take it.
4. Repeat per city (one layer per city; My Maps caps at 10 layers per map).
5. When new pins land, open the layer's ⋮ menu → **Reimport and merge**.

The map lives in Google Maps app → Saved → Maps. Reimport is a manual tap — there's
no public API for writing into My Maps or native Saved Places, and that tap is the
price of it being real Google Maps instead of a custom web page.

## Dedupe

By location, never by URL:

- The same video naming three restaurants gets three pins.
- The same place shared from five different videos gets one pin, with all five URLs
  in `seen_from`.

A place matches an existing pin if its normalized Nominatim address is identical, or
its coordinates are within 60m. On a match nothing new is written — the source URL is
appended to `seen_from` on the existing row (in both `Pins` and the city tab).

The Inbox `processed` column is separate: it only records whether a URL has been run
at all. Values are `yes`, `no-places` (nothing geocodable in the caption), or
`error: …`. Filter for the latter two to see what needs a look.

## Notifications

Every run that processed at least one row emails you: pins added, rows where
extraction found nothing, and errors with their messages.

## Bulk backfill

Paste TikTok URLs straight into `Inbox` column B, leave `processed` blank. The next
run picks them up, 15 at a time. Column A can be blank too.

## Known limitations

- **Instagram Reels won't work on the Apps Script version.** Instagram's oEmbed needs
  a Meta developer token now, so there's no free caption fetch. Those rows fail with an
  oEmbed error rather than silently doing nothing. The GitHub Actions version below
  uses `yt-dlp` and handles both platforms.
- **My Maps reimport is manual**, not a live sync.
- **Web search costs a little.** Geocoding and captions are free; the description
  call runs one web search per *extracted place*, not per video. Trivial at personal
  volume, not zero.
- **Caption-only extraction.** If a video shows a place without naming it in the
  caption, nothing gets extracted — it lands in `no-places`.

## Alternative: run processing on GitHub Actions

`process.js` + `.github/workflows/process.yml` are the same pipeline, run from GitHub
Actions instead of the Apps Script trigger. **Pick one, not both** — two schedulers on
one Inbox will race.

Why bother: it gets the caption from `yt-dlp` instead of oEmbed, which reads the real
description and **works on Instagram Reels too**. It also drops the 6-minute cap, so it
clears the whole backlog in one run instead of 15 rows at a time — handy for a bulk
backfill of a few hundred likes.

Intake doesn't change: keep the Apps Script Web App and the Shortcut exactly as above.
Steps 1–3 and 5–7 of the setup still apply; you skip step 4 (`installTrigger()`).

### Setup

1. **Service account.** Google Cloud console → new project → enable the *Google Sheets
   API* → create a service account → create a JSON key. Then **share the Sheet with the
   service account's email** (`…@….iam.gserviceaccount.com`) as Editor — without this
   every call 404s.
2. **Push this folder to a private GitHub repo.**
3. **Repo secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | same key as the Apps Script property |
   | `GOOGLE_SA_JSON` | the whole service-account JSON file, pasted |
   | `SHEET_ID` | the `/d/<this>/edit` chunk of the Sheet URL |
   | `NOMINATIM_EMAIL` | your email |

   Click-by-click instructions for getting each of these: [SECRETS.md](SECRETS.md).

4. **Delete the Apps Script trigger** (Triggers → bin icon) so only one runs.
5. Actions tab → *process inbox* → **Run workflow** to try it now. It also runs every
   15 minutes on its own.

Scheduled runs on a repo with no pushes get disabled after 60 days of inactivity —
GitHub emails you first, and one click re-enables them.

### Differences from the Apps Script version

- **Notification is the job status**, not an email: the run summary (pins added /
  no-places / errors) lands in the Actions run summary, and the job exits non-zero if
  anything errored, which triggers GitHub's own failure email. Want the per-run "3 pins
  added" email regardless, add a `send-mail` step or POST to ntfy in the workflow.
- No batch cap, no 4.5-minute budget — it processes every unprocessed row.
- `concurrency: process-inbox` in the workflow is what stops two runs overlapping (the
  Apps Script version uses `LockService` for the same thing).

### Working on it locally

```bash
npm install
npm test          # node process.js --selfcheck — pure logic, no network
node process.js   # needs the four env vars above
```

The pure helpers (`norm`, `cityName`, `meters`, `findDupe`, `parseArray`) are
deliberately duplicated between `Code.gs` and `process.js` — `Code.gs` has to stay a
single paste-into-the-editor file, so there's nothing to import from. If you change
dedupe or city-naming behavior, change it in both.

### Going further: analyzing the actual video

If a caption never names the place, `yt-dlp` can already hand you the media —
`yt-dlp -o - <url> | ffmpeg -i - -vf fps=1/3 frame_%03d.jpg` — and those frames can go
to Claude as image blocks in the extraction call. That's the reason this variant exists;
nothing else in the pipeline has to change to add it.
