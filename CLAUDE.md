# Health & Wealth client dashboard

One shared web app for Howe Wu's coaching clients. Hosted free on GitHub Pages from this repo's `main` branch:
`https://howewu18.github.io/hw_coaching_clients/`. This repo is **public**: never commit client names, links,
device tokens or keys, and never print them in workflow logs (counts only).

## What is where

| File | What it is |
|---|---|
| `index.html` | The whole v2 app (vanilla JS, one file, hand-drawn SVG charts). Every v2 client uses it via `?c=<name>-<random>`. |
| `marximus.html` | The old v1 page for one client. Leave it alone; don't add features to it. |
| `firebase-messaging-sw.js` | Background worker that shows reminder notifications. Must stay self-contained (no `importScripts`, no outside URLs). |
| `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png` | Home Screen install. |
| `reminders/send.js` | Sends reminder notifications. Run by `.github/workflows/reminders.yml` with the `FIREBASE_SERVICE_ACCOUNT` secret. |
| `tests/` | All checks. See "Testing". |

Data is in Firebase project `hw-coaching` (Firestore), not in this repo:

- `clients_v2/<clientId>`: one document per client. Append-only lists the client writes (`bodyweight`, `sessions`,
  `liftLog`, `food`, `checkins`, `photos`), coach fields the weekly update replaces (`profile`, `goal`, `targets`,
  `program`, `featured`, `holidays`, `notes`, `reminders`), and `push` (device tokens, time zone, last-sent dates).
- `photos_v2/<clientId>_<random>`: one document per photo (image as a data URL, status pending/drafted/approved/rejected/removed).
- `clients/…`: v1 data for `marximus.html` only.
- The Firestore rules live in the Firebase console (a copy is kept in the claude.ai Project, `templates/firestore.rules`).
  Access is "whoever has the exact link"; nobody can list or delete documents. There is no sign-in. `#coach` on a link
  shows the coach panel on that device; it is a convenience, not security.

## Rules that must not be broken

1. **Never change the link format** (`?c=<id>`), move the app files, or rename the repo. Clients have these links on their Home Screens.
2. **Never add `start_url` to the manifest.** Each client installs their own link; a start_url would send them all to one page.
3. **Never merge or migrate `clients` and `clients_v2`.**
4. **Client logs are append-only** (`arrayUnion` / `arrayRemove` of whole entries). Coach updates only replace coach fields, so a client logging mid-update is never overwritten.
5. **The notification worker loads nothing from other websites.** The earlier version imported the Firebase SDK from gstatic.com; browsers refused it and nobody could turn reminders on.
6. **Only Howe approves food-photo estimates.** Scheduled Claude checks draft; nothing reaches a client's food log unapproved.
7. `TODAY` is fixed at page load and the page reloads itself after midnight. Keep that when touching date logic.

## Testing

```
node tests/run.js        # quick: page-script syntax, reminder sender, notification worker (no installs needed)
node tests/run.js all    # also drives the real app in a browser against a pretend Firebase (needs Playwright)
```

- `tests/fakes/` are stand-ins for the three Firebase modules; `tests/app.test.js` swaps them in, so tests never touch live data.
- `.github/workflows/tests.yml` runs everything on every push and pull request.
- Add a check for every behaviour you change. Real push delivery can only be proven on a real phone
  (Actions → Client reminders → Run workflow → mode `test`).

## Releasing

Branch → make the change → `node tests/run.js all` → push the branch → wait for the Tests workflow to go green →
merge to `main`. GitHub Pages publishes in 1–2 minutes. Phones pick the new version up on next open.

## Reminder timing (known weakness)

`reminders.yml` asks GitHub to run every 10 minutes, but GitHub's free timer fired only about 4 times a day
(gaps of 3–10 hours) in the week of 8–14 Nov 2026. `send.js` therefore keeps each nudge valid for a long stretch:
morning and midday nudges until their evening partner's time, evening nudges until 10:30pm. Replaying that week,
morning and midday nudges would have gone out 5 days in 5, evening ones only 2–3 days in 5.

For on-time nudges, trigger the workflow from an outside scheduler every 10 minutes instead:

1. GitHub → Settings → Developer settings → Fine-grained tokens → new token limited to this repo with
   **Actions: Read and write** (nothing else).
2. In a free scheduler (for example cron-job.org), create a job every 10 minutes:
   `POST https://api.github.com/repos/howewu18/hw_coaching_clients/actions/workflows/reminders.yml/dispatches`
   with headers `Authorization: Bearer <token>` and `Accept: application/vnd.github+json`, and body
   `{"ref":"main","inputs":{"mode":"normal"}}`. A `204` reply means it worked.
3. Keep the built-in schedule as a backstop. Sending twice is prevented by the per-day `push.sent` marks.

GitHub also pauses scheduled workflows after 60 days without a commit to the repo; any commit, or the outside
scheduler above, keeps it alive.

## Other things to know

- Logging a set marks that day's session automatically (entry has `auto: true`); the session button still works and can undo it.
- Reminder settings are per client (`reminders`: `on`, `foodMid`, `food`, `trainAM`, `train`, `trainDays`); pasting a new
  set replaces the old one. A client must also tap **Turn on reminders** on their own phone (iPhone: from the Home Screen icon).
- Two scheduled Claude tasks ("Food photo check") draft calorie estimates through Firestore's REST API. Their client list
  is typed into the task prompt, so a new client must be added there by hand.
