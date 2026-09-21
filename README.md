# Outreach Tracker — Team 7419

Internal tool for tracking outreach hours. Members clock in and out of events with a photo, admins approve the hours, and everyone can see where they stand against the nine-hour semester requirement. Works as a website and installs to the iPhone home screen as an app.

## What it does

**Members** (`index.html`)
- Sign up / sign in with email and password.
- Home page shows approved hours against the requirement as a progress bar. Hours waiting on review show as a striped segment.
- **Clock in**: type what event you're at, take a photo that includes the object a admin specified for that event (admins set it in Settings and can change it per event). The photo gets a visible timestamp strip and is sent along with a server-side timestamp.
- **Clock out**: same thing. The session goes to the review queue.
- History of every session with both photos, times, hours and status (Waiting on review, Approved, Sent back with the admin's note).

**Admins** (`admin.html`, separate sign-in)
- **Review**: each session with the clock-in and clock-out photos side by side, time on the clock, an editable hours field, and Approve / Send back (a note is required to send back). Decisions can be changed later.
- **Live**: who's clocked in right now, with elapsed time. Close a session if someone forgot to clock out.
- **Members**: roster with progress bars, sorting, search, CSV downloads, and per-member actions: excuse someone from the hours requirement (with an optional reason they see on their page) or remove them from the roster (deletes the account, sessions and photos).
- **Settings**: semester name and dates, required hours, what has to be in every photo, and (with Supabase) who else is a admin.

## Run it locally

```bash
cd /Users/azaanraza/Documents/outreach-hours
npm run dev
```

Then open http://localhost:4419 (admin page at /admin.html). There's no build step and no dependencies to install; `npm run dev` starts a small static server from `serve.mjs`. No Node? `python3 serve.py` does the same thing (that's what the `outreach-hours` entry in `.claude/launch.json` uses). Add `?demo` to the URL to play with sample data in this browser only; `?live` switches back to the real database.

## Go live

The camera and home-screen install both need HTTPS, so put the folder on any static host (Vercel, Netlify, GitHub Pages). There's no build step.

The project is `nhcxgakyygneuahbhcvv` at supabase.com. Two ways to wire it up:

**One command.** Make a personal access token at https://supabase.com/dashboard/account/tokens, then:

```bash
SUPABASE_ACCESS_TOKEN=sbp_paste_it_here node supabase/setup.mjs --auto-confirm
```

That runs `supabase/schema.sql` on the project, fetches the anon key into `config.js`, and turns off "Confirm email" so members can sign in the moment they sign up. Leave off `--auto-confirm` if you'd rather members confirm their email (note: Supabase's built-in mailer only sends a few emails an hour unless you add your own SMTP).

**By hand.** SQL editor → paste `supabase/schema.sql` → Run. Project Settings → API → copy the anon key into `config.js`.

The project is already set up this way (schema applied, anon key in `config.js`, email confirmation off). Re-run the command only if you change `schema.sql`. `node supabase/sql.mjs "select ..."` runs any SQL against the project from the terminal with the same token. Personal access tokens are never stored in this folder; make a new one when you need one and revoke it after.

Either way: the **first account that signs up becomes a admin**, so sign up before you share the link. Admins add other admins from Settings in `admin.html`. The schema is safe to run again.

## Put it on a phone

iPhone: open the site in Safari → Share → **Add to Home Screen**. It opens full screen with the team icon, and the camera works the same. Android: Chrome offers "Install app" from the menu.

## How the timestamps work

- The clock-in time is set by the database (`now()` inside the `clock_in` RPC) when the photo has finished uploading. Same for clock out. Members can't pick a time.
- The photo itself gets a strip burned in with the team name, member name, date and time, and whether it's a clock in or clock out, so a admin can read it at a glance.
- Photos are downscaled to 1280 px on the long edge before upload (roughly 150–300 KB each) and stored in a private bucket. Members can only read their own; admins can read all of them through signed URLs.
- A member can only have one open session at a time.

## Excel

The `excel/` folder has a spreadsheet version of the tracker (roster, sessions, progress bars), an Office Script for Excel on the web, and VBA macros for desktop Excel. See `excel/README.md`. The admin app's "Download all sessions" CSV matches the Sessions sheet.

## Files

```
index.html          member app          admin.html          admin app
serve.mjs           local dev server     serve.py            same, for Python
package.json        npm run dev
css/app.css         styles              js/app.js           member UI
js/admin.js         admin UI             js/db.js            data layer (demo + Supabase)
js/photo.js         camera + stamp      js/photos-ui.js     photo thumbnails
js/ui.js            helpers             js/icons.js         Octicons
css/primer.css      Primer CSS build    config.js           Supabase keys / demo passcode
sw.js               offline shell       manifest.webmanifest
icons/              app icons from the team logo
supabase/schema.sql database, storage, security
supabase/setup.mjs  one-command project setup
supabase/sql.mjs    run SQL against the project from the terminal
excel/              spreadsheet tracker + scripts
```

## Design

The UI is GitHub's Primer design system (`css/primer.css`, the official v21.5.1 build, MIT) with its color tokens re-pointed to the team's palette in `css/app.css`: navy `#11224e` for the header, text and accents, gold `#ffc14a` for primary buttons, progress and approved states, `#dc2626` for send-backs. Components are Primer's own: Header, Box, UnderlineNav, Label, Progress, Overlay dialog, Toast, blankslate, flash. Icons are Octicons inlined in `js/icons.js`. Type is the system font stack at 14px, as on GitHub.
