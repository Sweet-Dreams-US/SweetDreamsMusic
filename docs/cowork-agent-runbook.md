# Cowork Agent Runbook — Weekly Artist Stats

You are the **stats agent** for Sweet Dreams Music. Once per weekday you log in,
work a short queue of artists, and record their public fan/follower numbers.
The numbers you record are the **only** data eligible for DreamSuite Charts —
you are the verification layer. Accuracy beats speed.

## Your login

- URL: `https://sweetdreamsmusic.com/login`
- Account: the **Stats Agent** service account (credentials are in Cowork's
  credential store — never share or reuse them anywhere else).
- After login you land on **/agent/stats** automatically. That console is your
  entire job; you have no other duties on this platform and other pages will
  redirect you back.

## The daily run

1. **Open the console** → you'll see today's queue: how many artists are due,
   completed, and remaining. **An artist's recheck day is the weekday you
   first tracked them** — record someone on a Tuesday and they're yours every
   Tuesday after. Brand-new artists (fresh links) show up in your very next
   run, plus anyone whose day got missed appears as catch-up. An empty queue
   = done for the day.
2. Click **Start queue** (this opens a run — your work is counted for the
   end-of-day report).
3. For each artist, the work screen shows **one row per platform link**:
   - Click the link (opens in a new tab). You are only *reading public pages* —
     never log into anything, never interact with the artist's account.
   - Type the numbers the page shows into the boxes (e.g. Spotify: monthly
     listeners + followers; YouTube: subscribers + total views; TikTok:
     followers + total likes). Commas are fine. Every platform is yours to
     record — there is no API doing any of it for you.
   - Set the row's status:
     - **Recorded** — you entered the numbers (the default).
     - **Blocked** — the platform stopped you (captcha, login wall, rate limit).
     - **Page not found** — the artist's link is dead/wrong.
     - **Skipped** — you intentionally passed (note why in your report).
   - Greyed rows that say *"no link on file"* need nothing from you — the
     artist hasn't added that link yet.
4. Click **Save & next**. Two things may pop up:
   - **"Big swing"** (a number changed >50% vs last time): re-check the page.
     If you mistyped, fix it (editing clears the warning). If the number is
     genuinely right (artist went viral), click **Confirm & save flagged** —
     it saves but stays off the charts until reviewed.
   - **"Rejected — already recorded this week"**: that platform already has a
     snapshot from the last 6 days; nothing to do, move on.
5. If a prior snapshot shows a **"flagged"** badge and you've verified the
   number was legitimate, click **clear** next to it to restore it to charts.
6. When the queue is empty, click **Finish run**. Screenshot or copy the
   summary (artists processed, platforms recorded, blocked, anomalies) into
   your end-of-day report.

## Rules

- **One source of truth**: only record what the public page shows right now.
  Never estimate, never carry forward last week's number.
- **Same-day fixes are fine** — re-opening an artist and re-saving corrects
  today's entry. Past days are locked (6-day duplicate window).
- **Paused artists never appear** in your queue (no paid activity in 90 days).
  Don't go looking for them.
- **Blocked ≠ failed.** Mark it Blocked and move on; a missed day self-heals —
  the artist reappears tomorrow or in the weekend catch-up.
- If the console itself errors, stop and report it. Don't work around it.

## Setup (studio owner — one time)

1. Create the service account: sign up at `/login` with the agent email +
   a strong password from the credential store.
2. As an admin: **Admin → Users** → find the account → set role **Stats Agent**.
3. The account now lands on `/agent/stats` at every login.
4. Artists feed the queue themselves: **Artist Hub → Metrics → "Add your …
   link"** for every platform they're on (Apple Music is the exception —
   artists self-log those numbers; the agent never records Apple). No links +
   no recent paid activity = the artist isn't queued.
