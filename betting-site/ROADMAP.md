# TurboPlay — Development Roadmap
**Generated:** April 20, 2026  
**Current Completion:** ~85%  
**Stack:** Next.js 16 + Python Telegram Bot + Supabase + ngrok

---

## 🟢 SERVICES RUNNING RIGHT NOW

| Service | Location | URL |
|---------|----------|-----|
| **Frontend** (Next.js) | `betting-site/frontend` | http://localhost:3000 |
| **Backend** (Telegram Bot) | `betting-site/backend/bot.py` | Polling Telegram API |
| **ngrok tunnel** | port 3000 | Check ngrok window for public URL |

> ⚠️ **After ngrok starts**, copy the `https://xxxx.ngrok-free.app` URL and update:
> - `backend/.env` → `MINI_APP_URL=https://xxxx.ngrok-free.app/bingo`
> - Then restart `bot.py` so the Telegram "Play Now" button uses the new URL

---

## 🔴 SPRINT 1 — Critical Fixes (Do These First)
*Estimated: 1–2 hours*

### 1. Update ngrok URL in .env
- Copy the new ngrok URL from the ngrok terminal window
- Update `backend/.env`: `MINI_APP_URL=https://NEW-URL.ngrok-free.app/bingo`
- Restart `bot.py`

### 2. Fix Bingo Number Drawing — Nothing Calls the Draw RPC
**Problem:** `bingo_draw_number` RPC exists in Supabase but nothing triggers it.  
**Fix:** The `bingo_caller.py` file exists in backend — wire it up:
```bash
# In a 4th terminal:
cd C:\Users\Henok\betting-site\backend
python bingo_caller.py
```
Or add a `/draw` admin command to `bot.py` that calls the RPC.

### 3. Fix Betslip Currency Symbol
**File:** `frontend/app/betting/page.tsx`  
**Problem:** Payout shows `$` but stake label is `ETB`  
**Fix:** Change `$` → `ETB` in the potential payout display line

### 4. Fix Sportsmonks API Key Mismatch
**Problem:** `sync_worker.py` uses `SPORTMONKS_API_KEY` but `frontend/.env.local` uses `SPORTSMONKS_API_KEY` (extra S)  
**Fix:**
- In `frontend/.env.local`: uncomment and add `SPORTSMONKS_API_KEY=7cuEq7O1bnNwmXkHW8e6x9wEcqbd3zUwplCmYSjCAU4Zp995NjlyruECHPTG`
- Standardize both files to use the same key name

---

## 🟠 SPRINT 2 — Core Game Completion
*Estimated: 1 day*

### 5. Bingo Room Auto-Creation
**Problem:** Only 1 hardcoded room UUID exists. No UI to create new rooms.  
**Plan:**
- Add `POST /api/bingo/create` route that inserts a new `bingo_rooms` row
- Add admin command `/newroom <bet_amount>` to `bot.py`
- Auto-create a new room when the current one finishes

### 6. Bingo Game Loop — Full Automation
**Problem:** Game has no automated lifecycle.  
**Plan:**
```
waiting → countdown (30s) → playing (draw every 5s) → finished → reset
```
- `bingo_caller.py` should:
  1. Watch for rooms with `status = 'countdown'`
  2. After countdown, set `status = 'playing'`
  3. Call `bingo_draw_number` RPC every 5 seconds
  4. Detect winner via `bingo_claim_win` RPC
  5. Set `status = 'finished'`, wait 10s, create new room

### 7. Win Detection & Payout
**Problem:** Win claims go through `bingo_claim_win` RPC but payout logic needs verification  
**Plan:**
- Verify `bingo_claim_win` RPC correctly:
  1. Validates the winning card against drawn numbers
  2. Credits the prize pool to winner's `tg_users.balance`
  3. Notifies the winner via bot message

### 8. Bet Settlement System
**Problem:** All sports bets stay `pending` forever — no settlement trigger  
**Plan:**
- Add `POST /api/admin/settle-bets` route (admin-only)
- Or add `/settle <fixture_id> <home_score> <away_score>` command to `bot.py`
- Calls `betting_settle_bet` RPC for each pending bet on that fixture

---

## 🟡 SPRINT 3 — UX & Polish
*Estimated: 2–3 days*

### 9. Bingo Lobby — Real Room List
**Problem:** Bingo page hardcodes one room UUID  
**Plan:**
- `GET /api/bingo/rooms` — returns list of `waiting` rooms with player count + bet amount
- Lobby page shows room cards with "Join" buttons
- Auto-redirect to game when room starts

### 10. Deposit Flow — Telebirr Integration
**Problem:** Deposit is manual (user sends SMS screenshot)  
**Plan (Phase 1 — Manual with Admin Approval):**
- User sends deposit amount → bot stores pending deposit in `bingo_transactions`
- Admin uses `/credit <amount> <tg_id>` to approve (already implemented ✅)
- Bot notifies user when credited

**Plan (Phase 2 — Automated):**
- Integrate Telebirr API or use a payment webhook
- Auto-credit on confirmed payment

### 11. Withdraw Flow
**Problem:** Withdraw is acknowledged but never actually processed  
**Plan:**
- Store withdrawal request in a `withdrawal_requests` table
- Admin reviews via `/withdrawals` command
- Admin approves with `/approve_withdraw <request_id>`
- Bot notifies user

### 12. Player Stats & History
- Add `/history` command to bot — shows last 10 bingo games + wins
- Add `/stats` command — total games, win rate, total winnings
- Add transaction history page in the Mini App

---

## 🔵 SPRINT 4 — Production Readiness
*Estimated: 3–5 days*

### 13. Replace ngrok with Permanent Hosting
**Options (cheapest first):**
| Option | Cost | Notes |
|--------|------|-------|
| **Railway.app** | Free tier / $5/mo | Deploy Next.js + Python bot together |
| **Vercel** (frontend) + **Railway** (bot) | Free + $5/mo | Best separation |
| **Render.com** | Free tier | Good for Python bot |
| **VPS (DigitalOcean/Hetzner)** | $4–6/mo | Full control |

**Steps:**
1. Deploy frontend to Vercel: `vercel --prod` from `frontend/`
2. Deploy bot to Railway: connect GitHub repo, set env vars
3. Update `MINI_APP_URL` in bot env to Vercel URL
4. Register Telegram Mini App URL in @BotFather

### 14. Security Hardening
- [ ] Add rate limiting to all `/api/bingo/*` routes
- [ ] Validate Telegram `initData` HMAC on every Mini App request
- [ ] Add RLS policies to all Supabase tables
- [ ] Rotate `TELEGRAM_BOT_SECRET` before production
- [ ] Never expose `SUPABASE_SERVICE_ROLE_KEY` to client

### 15. Error Monitoring
- Add Sentry to Next.js frontend: `npm install @sentry/nextjs`
- Add error logging to `bot.py` (write to file or use Telegram admin alerts)
- Set up Supabase alerts for failed RPCs

### 16. Database Cleanup
- Consolidate all SQL migrations into numbered files (001–015)
- Write a single `schema_final.sql` that represents the current state
- Add `README.md` to `supabase/` folder with migration order

---

## 🟣 SPRINT 5 — Growth Features
*Estimated: 1–2 weeks*

### 17. Multiple Bingo Room Types
- **Speed Bingo** — draw every 2 seconds, small bet (10 ETB)
- **Classic Bingo** — draw every 8 seconds, medium bet (50 ETB)  
- **High Stakes** — draw every 10 seconds, large bet (200 ETB)
- **Free Room** — no bet, for new user onboarding

### 18. Referral System
- Each user gets a referral code
- `/refer` command shows their code + link
- Referred user gets 20 ETB bonus on first deposit
- Referrer gets 10% of referred user's first deposit

### 19. Leaderboard
- Weekly top 10 winners displayed in Mini App
- `/leaderboard` bot command
- Prize for #1 weekly winner (bonus ETB)

### 20. Sports Betting Enhancements
- Live odds updates via Sportmonks webhook
- In-play betting (bet while match is live)
- Bet history with settlement status
- Push notifications via Telegram when bet settles

---

## 📊 CURRENT STATUS SUMMARY

```
✅ DONE (85%)
├── Telegram bot registration flow (contact sharing)
├── Supabase schema (bingo + betting tables)
├── Bingo card generation (100 seeded cards)
├── Realtime presence via Supabase Realtime
├── Bingo game board UI (GameBoard.tsx)
├── Sports betting UI (fixtures, betslip, accumulator)
├── Wallet API (deposit/withdraw/stake/win)
├── Admin commands (/credit, /inspect, /sys, /resetroom)
└── ngrok tunnel for local testing

❌ MISSING (15%)
├── 🔴 Bingo draw automation (bingo_caller.py not running)
├── 🔴 Bet settlement (bets stay pending forever)
├── 🟠 Room auto-creation (only 1 hardcoded room)
├── 🟠 Telebirr payment integration
├── 🟡 Permanent hosting (still using ngrok)
└── 🟡 Production security hardening
```

---

## 🎯 RECOMMENDED NEXT ACTION

**Right now (next 30 minutes):**
1. Check the ngrok window — copy the public URL
2. Update `backend/.env` → `MINI_APP_URL`
3. Restart `bot.py`
4. Open Telegram → send `/start` to your bot → tap "Play Now"
5. Verify the bingo page loads inside Telegram

**This week:**
- Run `bingo_caller.py` to enable automated number drawing
- Fix the currency symbol (`$` → `ETB`) in betting page
- Add the Sportsmonks API key to `frontend/.env.local`
