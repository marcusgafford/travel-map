# Setting up the phone half (the easy version)

The robot half is done and running every 15 minutes. But right now the only way to
give it a video is to paste a link into the spreadsheet by hand. Boring.

This page builds the fun part: **you tap Share on a TikTok, and it just lands in the
spreadsheet.**

There are two pieces, and they're both quick:

| Part | What it is | How long |
|---|---|---|
| A | A tiny doorbell attached to your spreadsheet | 10 minutes |
| B | A button on your iPhone that rings the doorbell | 10 minutes |

**How it fits together:** your iPhone can't write into a Google Sheet directly. So we
glue a tiny web address onto the spreadsheet — a *doorbell*. Your phone rings it and
says "here's a link." The doorbell writes it into the Inbox tab. Then the robot you
already built picks it up on its next 15-minute sweep.

You need a password so strangers can't ring your doorbell. **Make one up right now** —
mash the keyboard, something long like `k7Qp2mXvR9tLzW4nB6`. Write it on paper or in a
note. You'll type it in twice, in Part A step 5 and Part B step 6, and **the two have to
match exactly.**

---

# Part A — the doorbell (Apps Script)

## A1. Open the code editor

1. Open your travel map Google Sheet.
2. In the top menu: **Extensions** → **Apps Script**.
3. A new tab opens with a code editor. There's a file called `Code.gs` with a few boring
   lines in it like `function myFunction() {`.
4. Click anywhere in that code, press **Ctrl+A** (select all), then **Delete**. Empty page.

## A2. Paste in the real code

1. Go to **https://github.com/marcusgafford/travel-map/blob/main/Code.gs**
2. Near the top right of the code box there's a **copy** icon (two overlapping squares).
   Click it. That copies the whole file.
3. Back in the Apps Script tab, click in the empty editor and press **Ctrl+V**.
4. Press **Ctrl+S** to save. The tab name might ask you to name the project — call it
   `travel-map`.

> You just pasted the whole program, including a processing job you're **not** going to
> use — the GitHub robot already does that part. It'll sit there harmlessly, asleep,
> because you're never going to set its alarm clock. (See A6.)

## A3. Give it your password

1. In the left sidebar, click the **gear icon** (⚙️ Project Settings).
2. Scroll to the bottom: **Script Properties** → **Add script property**.
3. Property: `SHARED_SECRET`
   Value: the password you made up at the top of this page.
4. Click **Save script properties**.

That's the only one you need. (The code mentions `ANTHROPIC_API_KEY` and
`NOMINATIM_EMAIL` too, but only the sleeping half uses those — you already gave those to
GitHub.)

## A4. Put it on the internet

1. Top right: the blue **Deploy** button → **New deployment**.
2. Click the **gear icon** next to "Select type" → choose **Web app**.
3. Fill in:
   - Description: `intake` (doesn't matter)
   - **Execute as: Me** (your email)
   - **Who has access: Anyone**
4. Click **Deploy**.

> **"Anyone"?! Isn't that dangerous?** It has to be — your phone isn't logged into your
> Google account when the Shortcut runs, so Google has to let a stranger knock. The
> password from A3 is the actual lock. Someone would have to guess both a random web
> address *and* your password.

## A5. The scary permission screen

The first deploy asks you to authorize. This part looks alarming and is completely normal
— it's *your own* code you just pasted, and Google doesn't know that.

1. Click **Authorize access** → pick your Google account.
2. You'll see **"Google hasn't verified this app."** Click the small **Advanced** link at
   the bottom left.
3. Click **Go to travel-map (unsafe)**. It's your code. It's fine.
4. It lists what the script wants (see your spreadsheets, connect to an external service,
   send email as you). Click **Allow**.

Now you get a box with a **Web app URL** ending in `/exec`. It looks like:

```
https://script.google.com/macros/s/AKfycbx...long...jumble.../exec
```

**Copy it and put it somewhere you can get at it from your phone** — text it to yourself,
put it in a note, whatever. You need to type it into your phone in Part B. It's not
secret on its own (the password is what matters), so texting it to yourself is fine.

## A6. Do NOT set the alarm clock

In the left sidebar there's a **Triggers** (⏰) section, and the code has a function
called `installTrigger`. **Don't run it, don't add a trigger.**

If you do, the sleeping half of the script wakes up and starts processing the Inbox at
the same time as the GitHub robot. They'd fight over the same rows and you'd get double
pins. One worker, not two.

Same for `setup()` — the GitHub robot already made your `Inbox` and `Pins` tabs. Nothing
to do.

---

# Part B — the button (iOS Shortcut)

## B1. New shortcut

1. Open the **Shortcuts** app on your iPhone.
2. Tap **+** in the top right.
3. Tap the name at the top (it says "New Shortcut") → **Rename** → call it
   **Save Place**.

## B2. Turn on the share sheet

1. Tap the **ⓘ** (info) icon at the bottom of the editor — on newer iOS it's the
   **Shortcut Details** icon near the top.
2. Turn ON **Show in Share Sheet**.
3. Under it, tap where it lists what it accepts. Turn **off** everything except
   **URLs** and **Text**.
4. Go back.

That switch is what makes "Save Place" appear in the list when you tap Share on a TikTok.

## B3. Grab the link out of whatever gets shared

1. Tap **Add Action** (or the search bar at the bottom).
2. Search **URLs** → tap **Get URLs from Input**.

Sometimes TikTok shares a clean link, sometimes it shares a sentence with a link buried
in it. This action pulls the link out either way.

## B4. The main action

1. Tap **+** to add another action, search **Get Contents of URL**, tap it.
2. In the box, where it says `URL`, paste your **`/exec` web app URL** from step A5.
3. Tap **Show More** (small arrow) to expand the options.
4. **Method:** tap it and change `GET` → **POST**.
5. **Request Body:** make sure it's set to **JSON**.

## B5. Add the two fields

Under Request Body there's **Add new field**. You're adding two.

1. Tap **Add new field** → choose **Text**.
   - Key: `url`
   - Value: tap the value box, then tap the **variable** suggestion **URLs** (the output
     of step B3). It should show as a blue bubble, *not* typed-out letters.
2. Tap **Add new field** again → **Text**.
   - Key: `secret`
   - Value: type your password from the top of this page. Actual letters this time.

⚠️ The keys are lowercase: `url` and `secret`. Not `URL`, not `Secret`. The doorbell is
picky.

## B6. Tell yourself whether it worked

Without this the shortcut does its thing silently and you never know if it landed.

1. Add action → search **Get Dictionary Value**. It'll say "Get *Value* for *key* in
   *Contents of URL*". Type `error` in the key box.
2. Add action → search **If**. It'll say "If *Dictionary Value*". Set the condition to
   **has any value**.
3. *Inside* the If (between "If" and "Otherwise"): add **Show Notification**, text:
   `❌ Not saved`
4. *Under* Otherwise: add another **Show Notification**, text: `✅ Saved`
5. Tap **Done** to save the shortcut.

The doorbell only sends back an `error` when something went wrong, so "no error" means
it landed.

Your finished shortcut is 5 actions, in this order:

```
Get URLs from Input
Get Contents of URL          (POST, JSON, url + secret)
Get Dictionary Value  error
If  has any value
     Show Notification  ❌ Not saved
Otherwise
     Show Notification  ✅ Saved
End If
```

---

# Test the whole thing

1. Open **TikTok**, find any video that mentions a real place.
2. Tap **Share** → scroll the bottom row of icons → tap **Save Place**.
   (If you don't see it: tap **More** / the **…** at the end of the row, and turn it on
   in the list.)
3. First run only: iOS asks permission to send data to `script.google.com`. Tap **Allow**.
4. You should get **✅ Saved**.
5. Open your Google Sheet → **Inbox** tab. There's a new row with today's date and the
   link. 🎉
6. Don't want to wait 15 minutes? Go to
   **https://github.com/marcusgafford/travel-map/actions** → *process inbox* →
   **Run workflow**. A minute later the `Pins` tab has your first pin, with a
   description, and a new city tab appeared next to it.

---

# When it goes wrong

| What you see | What it means | Fix |
|---|---|---|
| ❌ Not saved, every time | Passwords don't match | A3 and B5 must be *identical* — retype both, watch for a trailing space |
| Shortcut error about "not allowed" | iOS blocked the request | Rerun and tap **Allow** on the permission popup |
| ❌ and you changed the code since | Editing the code doesn't republish it | Deploy → **Manage deployments** → pencil ✏️ → Version: **New version** → Deploy |
| "Save Place" isn't in the share sheet | B2 got skipped | Turn on *Show in Share Sheet*, accept **URLs** and **Text** |
| Row lands in Inbox but no pin ever | The robot's not running | Actions tab → check the last run is green, not red |
| Sheet says `no-places` in column C | Robot read it, found no real place named | Normal — some captions genuinely name nothing |
| Two identical pins | Both workers are running | You installed the trigger. Apps Script → Triggers ⏰ → delete it (A6) |

---

# What you'll have when this is done

- Tap Share on any TikTok → it's in the Inbox within a second.
- Every 15 minutes the robot reads captions, finds the places, looks each one up, writes
  a short description, and files it under the right city.
- The same place shared from five different videos stays **one** pin — it just records
  all five links.
- Whenever you feel like it: open **My Maps**, hit **Reimport and merge** on a city
  layer, and the new pins show up in the real Google Maps app under Saved → Maps.
  (README step 7 — that's the last manual tap, and there's no way around it.)
