# How to get the secrets (the easy version)

The robot that makes your map needs 4 passwords to do its job. This page tells you
exactly where to get each one and where to paste it.

**A "secret" is just a password you paste into GitHub once.** GitHub locks it in a box.
The robot can use it, but nobody — including you, later — can read it back out. So if
you lose one, you don't "find" it, you just make a new one. That's normal.

Here's the whole list, easiest first:

| # | Secret name | What it actually is | How long |
|---|---|---|---|
| 1 | `NOMINATIM_EMAIL` | your email address | 5 seconds |
| 2 | `SHEET_ID` | part of your spreadsheet's web address | 1 minute |
| 3 | `ANTHROPIC_API_KEY` | a key that lets the robot talk to Claude | 5 minutes |
| 4 | `GOOGLE_SA_JSON` | a robot account that can write in your spreadsheet | 10 minutes |

Do them in order. Keep a blank Notes / Notepad file open and paste each one there as you
go — you'll put them all into GitHub at the end, in Step 5.

⚠️ **That notes file now has real passwords in it. Delete it when you're done.** Don't
email it, don't put it in the spreadsheet, don't paste it into a chat.

---

## 1. `NOMINATIM_EMAIL` — your email

This one's free. The free map-address service (OpenStreetMap) just wants to know who's
asking, in case something goes wrong.

Write down your email address. That's it. Example: `you@example.com`

---

## 2. `SHEET_ID` — the name tag on your spreadsheet

Every Google Sheet has a long random ID hidden in its web address. That's how the robot
knows *which* spreadsheet is yours.

1. Open your travel map Google Sheet.
2. Look at the address bar at the top of the browser. It looks like this:

   ```
   https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_ABCD/edit#gid=0
                                        └── this long part right here ──┘
   ```

3. Copy **only** the long jumble between `/d/` and `/edit`. Not the `https://` part, not
   the `/edit` part.

That's your `SHEET_ID`. Paste it in your notes.

---

## 3. `ANTHROPIC_API_KEY` — the robot's Claude key

This is what lets your robot ask Claude "what places are in this video?" It costs a tiny
bit of money per use (pennies), so you have to put a card on file.

1. Go to **https://console.anthropic.com** and sign in (make an account if you don't
   have one).
2. Click **Billing** in the left sidebar → add a payment method → put in a small amount
   like $5. Without this the key exists but every request gets refused.
3. Now click **API Keys** in the left sidebar.
4. Click **Create Key**. Name it something like `travel-map`.
5. A long code appears starting with `sk-ant-`. **Copy it right now.** The moment you
   close that little window it's gone forever and you'd have to make a new one.

Paste it in your notes. It looks like `sk-ant-api03-xxxxxxxxxxxxxxxxxxxx…`

> $5 lasts a long time here. Each new pin costs roughly a penny or two, mostly from the
> web search that writes the description.

---

## 4. `GOOGLE_SA_JSON` — a robot account for your spreadsheet

This is the fiddly one. Take it slow, it's just a lot of clicking.

**What's going on:** GitHub can't log into your Google account (you're not there to type
the password). So instead you create a *fake employee* — Google calls it a "service
account" — that has its own email address and its own password file. Then you share your
spreadsheet with that fake employee, exactly like sharing with a friend. Now the robot
can edit your sheet, and *only* that sheet — it can't see the rest of your Drive.

### 4a. Make a project

1. Go to **https://console.cloud.google.com** and sign in with the same Google account
   that owns the spreadsheet.
2. At the very top, next to the "Google Cloud" logo, there's a project dropdown. Click
   it → **New Project**.
3. Name it `travel-map` → **Create**. Wait a few seconds.
4. Click the dropdown again and **make sure `travel-map` is the selected project.**
   Everything below happens inside it. (This is the #1 thing people get wrong — they set
   stuff up in the wrong project and nothing works.)

### 4b. Turn on the Sheets ability

1. In the search bar at the top, type **Google Sheets API** and click the result.
2. Click the big blue **Enable** button. Wait for it.

If you skip this, everything later fails with a confusing "API not enabled" error.

### 4c. Create the fake employee

1. Search bar → type **Service Accounts** → click it. (Or: left menu ☰ → *IAM & Admin* →
   *Service Accounts*.)
2. Click **+ Create Service Account** at the top.
3. Name: `travel-map-bot`. It auto-fills an ID below. Click **Create and Continue**.
4. It asks about "roles" / granting access. **Skip it** — click **Continue**, then
   **Done**. You don't need any roles; sharing the sheet in step 4e is what gives access.
5. You're back at the list. You'll see a new email like
   `travel-map-bot@travel-map-123456.iam.gserviceaccount.com`.
   **Copy that email into your notes** — you need it in step 4e.

### 4d. Get its password file

1. Click on the service account you just made.
2. Go to the **Keys** tab at the top.
3. **Add Key** → **Create new key** → choose **JSON** → **Create**.
4. A `.json` file downloads to your computer. **This file is the password.** Anyone who
   has it can edit that spreadsheet, so don't put it anywhere public.
5. Open it in Notepad (right-click → Open with → Notepad). You'll see something like:

   ```json
   {
     "type": "service_account",
     "project_id": "travel-map-123456",
     "private_key_id": "abc123...",
     "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEv...
     ...
   }
   ```

6. Select **all of it** (Ctrl+A) and copy (Ctrl+C). The whole thing — from the very
   first `{` to the very last `}`. Not a piece of it, not just the private key line.

That entire blob is your `GOOGLE_SA_JSON`.

### 4e. Share the spreadsheet with the fake employee

**Do not skip this step.** Without it the robot has a valid ID badge but no key to the
building, and every run fails with "not found."

1. Open your travel map Google Sheet.
2. Click the green **Share** button, top right.
3. Paste the `travel-map-bot@…iam.gserviceaccount.com` email from step 4c.
4. Set it to **Editor** (not Viewer — the robot has to write new rows).
5. Untick "Notify people" if it offers (nobody's reading that email).
6. **Send** / **Share**.

---

## 5. Put all 4 into GitHub

Now you've got all four in your notes. Time to lock them in the box.

1. Go to **https://github.com/marcusgafford/travel-map**
2. Click **Settings** (the tab along the top of the repo, far right — *not* your account
   settings).
3. In the left sidebar: **Secrets and variables** → **Actions**.
4. Click the green **New repository secret**.
5. Fill in the two fields and click **Add secret**:
   - **Name:** `NOMINATIM_EMAIL`
   - **Secret:** your email
6. Repeat step 4 and 5 three more times, for:
   - `SHEET_ID` → the long jumble from step 2
   - `ANTHROPIC_API_KEY` → the `sk-ant-…` code from step 3
   - `GOOGLE_SA_JSON` → the entire `{ … }` blob from step 4d

**The names have to match EXACTLY** — all capitals, underscores not spaces, no typos, no
extra blank space at the start or end. `GOOGLE_SA_JSON` works; `Google_SA_Json` does not.

When you're done the page lists exactly four secrets. You can't see their values anymore,
just their names and when you added them. That's correct, that's the whole point.

**Now go delete that notes file.**

---

## 6. Test it

1. In the repo, click the **Actions** tab at the top.
2. Click **process inbox** in the left sidebar.
3. Click **Run workflow** → the green **Run workflow** button.
4. Wait about a minute, then refresh. You'll see a run appear with either:
   - ✅ a green check — it worked. Click it to see the summary of pins added.
   - ❌ a red X — click into it to read what broke. See the table below.

It'll also run by itself every hour from now on.

---

## When it goes wrong

| The error says | What it actually means | Fix |
|---|---|---|
| `Requested entity was not found` | The bot can't see your sheet | Step 4e — you didn't share it, or shared it as Viewer |
| `Google Sheets API has not been used` | Forgot to turn the ability on | Step 4b |
| `Unexpected token in JSON` | The `GOOGLE_SA_JSON` paste is incomplete | Re-copy the *whole* file, `{` to `}` |
| `Claude 401` | The Claude key is wrong or was deleted | Make a fresh one, step 3 |
| `Claude 400 credit balance` | Out of money at Anthropic | Add credit, step 3.2 |
| `Missing script property …` | That's the *Apps Script* half, not this one | See below |
| Nothing happens at all | Secret name is misspelled | Step 5 — check spelling exactly |

---

## Wait, what about `SHARED_SECRET`?

That one's different — it belongs to the **other half** of this project (the Apps Script
Web App that your iPhone talks to), not to GitHub. It doesn't go in the GitHub secrets
list.

`SHARED_SECRET` is a password *you invent yourself*. Make up something long and random —
mash the keyboard, like `k7Qp2mXvR9tLzW4nB6` — and put the exact same text in two places:

1. The Apps Script **Script Properties** (see the main README, step 2)
2. The iOS Shortcut, in the `secret` field of the request (README step 6)

It exists so that if a stranger somehow guesses your Web App's web address, they still
can't dump junk into your spreadsheet. They'd need this password too.

If those two copies don't match *exactly*, your Shortcut will say "Failed" every time.
That's the #1 cause of a Shortcut that won't save.
