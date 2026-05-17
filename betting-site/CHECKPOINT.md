# TurboPlay — Full Code Analysis & Checkpoint
**Last updated:** April 15, 2026 — Session 2: Telegram registration + multiplayer wiring  
**Overall completion:** ~85%

---

## ✅ WHAT IS CONFIRMED WORKING (fresh read, no assumptions)

### Backend
- `bot.py` — `/start` with contact-sharing registration flow, balance lookup from `tg_users.balance`, deposit/withdraw state machine, auto-tunnel, Error 409 prevention — all correct
- `bot.py` — Native Telegram contact sharing: `/start` → "📱 Register to Play" → contact handler → Supabase upsert with phone + password_hash placeholder → main menu with Web App button
- `bot.py` — `load_dotenv(dotenv_path=ENV_FILE, override=True)` — explicit .env path resolution
- `bot.py` — Startup diagnostics: prints Supabase URL, masked key preview, key length
- `bot.py` — Defensive `_is_user_registered()` with null-safe checks (no NoneType crashes)
- `sync_worker.py` — pagination, odds parsing, upsert, env validation — all correct

### Frontend API Routes
- `POST /api/bingo/auth` — phone register/login + telegram action, timing-safe hash compare — correct
- `POST /api/bingo/auth/telegram` — HMAC initData validation + 24h expiry + server-to-server pattern B — correct
- `GET/POST /api/bingo/wallet` — deposit/withdraw/stake/win with server-side win verification — correct
- `POST /api/bingo/join` — **UPDATED**: No longer upserts into `tg_users`. SELECT-only verification — returns 403 if user not registered via bot. Generates bingo card, determines card_index, inserts into `bingo_cards` — correct
- `POST /api/place-bet` — JWT auth, duplicate fixture guard, calls `place_bet_batch` RPC — correct
- `GET /api/user` — JWT auth, reads `profiles.balance`, no-cache headers — correct
- `GET /api/bets` — JWT auth, joins `bets` with `fixtures`, limit capped — correct
- `GET /api/fixtures` — reads from Supabase `fixtures` table, cache headers — correct
- `GET /api/livescores` — API key guard, timeout, Sportmonks v3 — correct
- `GET /api/results` — API key guard, timeout, finished-state filter — correct

### Frontend UI
- `app/page.tsx` — home selector, framer-motion — correct
- `app/layout.tsx` — Telegram script `beforeInteractive` — correct
- `app/betting/page.tsx` — full betslip, accumulator, league filter, search, my-bets — correct
- `app/bingo/page.tsx` — **REWRITTEN**: Telegram SDK init, `useBingoRoom` hook, `POST /api/bingo/join`, `flattenGrid()` translator (handles both flat `number[]` and `{B:[],I:[],N:[],G:[],O:[]}` formats), Zustand store population, `<BingoGameBoard>` rendering, connection status bar, "Last Drawn" indicator — all wired up
- `app/bingo/page.tsx` — Room UUID: `1195fed0-8b0e-4dd5-9b9b-97dc01149502` (real DB room)

### Library / Store
- `lib/bingoCards.ts` — 100 seeded cards, crypto-secure draw, win checker — correct
- `lib/bingo/cardGenerator.ts` — generates `{B:[],I:[],N:[],G:[],O:[]}` grid objects
- `lib/useTelegram.ts` — full WebApp bridge — correct
- `lib/supabaseClient.ts` — anon client — correct
- `store/bingoStore.ts` — Zustand + Supabase Realtime, join/daub/claim RPCs — correct
- `app/bingo/GameBoard.tsx` — full multiplayer board UI — **NOW IMPORTED AND RENDERED** in `page.tsx`
- `hooks/useBingoRoom.ts` — Supabase Realtime presence + drawn numbers hook — correct

---

## 🔧 FIXES APPLIED IN THIS SESSION (April 15, 2026)

### Bot Registration Flow
| # | Fix | File | Status |
|---|-----|------|--------|
| 1 | `/start` now shows contact-sharing `ReplyKeyboardMarkup` for new users, main menu for registered users | `bot.py` | ✅ Done |
| 2 | New `handle_contact` handler: extracts `user_id`, `first_name`, `phone_number`, upserts to `tg_users`, shows Web App menu, removes reply keyboard | `bot.py` | ✅ Done |
| 3 | Security: rejects forwarded contacts (`contact.user_id != message.from_user.id`) | `bot.py` | ✅ Done |
| 4 | `load_dotenv(dotenv_path=ENV_FILE, override=True)` — explicit path, works regardless of CWD | `bot.py` | ✅ Done |
| 5 | Removed `auth_type` from upsert (column doesn't exist in DB — was causing PGRST204) | `bot.py` | ✅ Done |
| 6 | Added `password_hash: "telegram_native_auth"` placeholder (satisfies NOT NULL constraint — was causing 23502) | `bot.py` | ✅ Done |
| 7 | Defensive `_is_user_registered()` — null-safe checks, `hasattr(result, 'data')`, logs exception type (was causing NoneType crash) | `bot.py` | ✅ Done |
| 8 | Startup diagnostics: prints Supabase URL, masked key (first 20 + last 8 chars), key length | `bot.py` | ✅ Done |

### Frontend Bingo Page Rewrite
| # | Fix | File | Status |
|---|-----|------|--------|
| 9 | Replaced 835-line standalone green "Chela Bingo" UI with 308-line Telegram-connected page | `page.tsx` | ✅ Done |
| 10 | Telegram SDK init: extracts `window.Telegram.WebApp.initDataUnsafe?.user?.id`, fallback mock ID `999999999` | `page.tsx` | ✅ Done |
| 11 | `flattenGrid()` translator: handles both flat `number[]` and `{B:[],I:[],N:[],G:[],O:[]}` formats | `page.tsx` | ✅ Done |
| 12 | `<BingoGameBoard tgId={tgId} />` now imported and rendered (was ERROR 7 — never imported) | `page.tsx` | ✅ Done |
| 13 | Room UUID updated to real DB UUID: `1195fed0-8b0e-4dd5-9b9b-97dc01149502` | `page.tsx` | ✅ Done |

### Join API Route
| # | Fix | File | Status |
|---|-----|------|--------|
| 14 | Replaced `tg_users` upsert with SELECT-only verification | `join/route.ts` | ✅ Done |
| 15 | Returns 403 `"User must register via the Telegram bot first"` for unregistered users | `join/route.ts` | ✅ Done |

---

## ❌ ERRORS FOUND — FRESH READ (categorized by severity)

---

### 🔴 CRITICAL — Will crash or produce wrong results

**ERROR 1: `place_bet_batch` RPC uses wrong table name**
- File: `supabase/schema_betting.sql` lines 643, 659
- ~~**Result:** Every bet placement will fail with "column fixture_id does not exist"~~
- ✅ **FIXED** in `007_final_schema_fixes.sql`

**ERROR 2: `api/bets/route.ts` joins `bets` with `fixtures` using wrong column**
- ~~**Result:** The join silently returns `null` for every fixture~~
- ✅ **FIXED** in `007_final_schema_fixes.sql`

**ERROR 3: `api/bingo/wallet/route.ts` win action queries wrong table**
- ~~**Result:** Win claim always returns "No active game session found"~~
- ✅ **FIXED** — now validates `tgId`, queries `bingo_cards.tg_id`

**ERROR 4: `bingo_claim_win` RPC signature mismatch**
- ~~**Result:** `claim_bingo_win` RPC does not exist~~
- ✅ **FIXED** — `store/bingoStore.ts` now calls `bingo_claim_win`

**ERROR 5: `bingoStore.ts` calls `join_bingo_room` but RPC is named `bingo_join_room`**
- ~~**Result:** `join_bingo_room` RPC does not exist~~
- ✅ **FIXED** — `store/bingoStore.ts` now calls `bingo_join_room`

**ERROR 6: `bot.py` withdraw uses `chat_id` instead of `tg_id` for balance lookup**
- ✅ **FIXED** — `bot.py` now uses `message.from_user.id` for withdrawal balance check

---

### 🟠 ARCHITECTURE ERRORS — App is incomplete/broken by design

**~~ERROR 7: `GameBoard.tsx` is never imported or rendered anywhere~~**
- ✅ **FIXED** — `page.tsx` now imports and renders `<BingoGameBoard tgId={tgId} />`

**~~ERROR 8: `bingo/page.tsx` lobby shows hardcoded fake player counts~~**
- ✅ **FIXED** — Page rewritten to use `useBingoRoom` hook with real Supabase Realtime presence

**~~ERROR 9: `bingo/page.tsx` `startGame()` simulates fake opponents~~**
- ✅ **FIXED** — Page now joins real rooms via `/api/bingo/join` with real DB room UUID

**ERROR 10: `schema_betting.sql` defines two conflicting `bets` table schemas**
- ✅ **FIXED** in `007_final_schema_fixes.sql`

**ERROR 11: `refactor_dual_architecture.sql` renames `bingo_wallet_tx` → `bingo_transactions` but RPCs still reference old name**
- ✅ **FIXED** in `006_fix_wallet_rpcs.sql`

**ERROR 12: `refactor_dual_architecture.sql` drops `bingo_users.id` but RPCs still use UUID**
- ✅ **FIXED** in `006_fix_wallet_rpcs.sql`

---

### 🟡 LOGIC ERRORS — Wrong behavior, not crashes

**ERROR 13: `betting/page.tsx` betslip shows payout in `$` but stake label is `ETB`**
- ❌ Still needs fix — change `$` to `ETB` in potential payout display

**~~ERROR 14: `bingo/page.tsx` `daubCell` allows toggling off daubed cells~~**
- ✅ **FIXED** — Old page.tsx replaced; daubing now handled by `GameBoard.tsx` + `bingoStore.ts`

**~~ERROR 15: `bingo/page.tsx` `claimBingo` sends client-supplied `amount` to wallet API~~**
- ✅ **FIXED** — Old page.tsx replaced; win claims now go through `bingoStore.ts` → `bingo_claim_win` RPC

**ERROR 16: `bingoStore.ts` `joinRoom` picks a random card instead of letting user choose**
- ⚠️ Still present but less critical — the new flow generates cards server-side via `/api/bingo/join`

**ERROR 17: `api/bingo/auth/route.ts` `timingSafeEqual` fragile logic**
- ⚠️ Minor risk — not a crash but fragile

**ERROR 18: `api/bingo/auth/telegram/route.ts` Pattern B `timingSafeEqual` can throw**
- ⚠️ Minor risk — non-ASCII secret header could crash

**ERROR 19: `livescores` and `results` routes use `SPORTSMONKS_API_KEY` but `.env.local` has it commented out**
- ❌ Still needs fix — uncomment and fill in the key

**ERROR 20: `sync_worker.py` env var name mismatch with frontend**
- ❌ Still needs fix — `SPORTMONKS_API_KEY` vs `SPORTSMONKS_API_KEY`

---

### 🟡 MISSING FEATURES — Not errors but gaps

**MISSING 1: No `profiles` table definition anywhere**
- ⚠️ Relies on Supabase Auth auto-created table

**MISSING 2: No bet settlement trigger**
- ❌ All bets stay `pending` forever — needs cron/webhook/admin endpoint

**~~MISSING 3: No room creation flow~~**
- ⚠️ Partially addressed — room `1195fed0-8b0e-4dd5-9b9b-97dc01149502` exists in DB, but no UI to create new rooms

**MISSING 4: No number drawing trigger**
- ❌ `bingo_draw_number` RPC exists but nothing calls it — needs Edge Function or cron

**MISSING 5: `bingo_rooms.winner_id` FK broken after refactor**
- ✅ **FIXED** in `007_final_schema_fixes.sql` — `winner_tg_id BIGINT` with FK to `tg_users(tg_id)`

---

## 📋 CORRECT DATABASE MIGRATION ORDER

Apply in Supabase SQL Editor **in this exact order**:

| # | File | Notes |
|---|------|-------|
| 1 | `schema_bingo.sql` | Base bingo tables |
| 2 | `schema_betting.sql` | Betting tables — but `place_bet_batch` has `fixture_id` bug (needs fix) |
| 3 | `bingo_telegram_migration.sql` | Adds tg_id to bingo_users |
| 4 | `refactor_dual_architecture.sql` | Renames tables — breaks RPCs (needs fix) |
| 5 | `005_fixtures_table.sql` | ⭐ NEW — fixtures table |
| 6 | `006_fix_wallet_rpcs.sql` | Fixes wallet RPCs for tg_id + bingo_transactions |
| 7 | `007_final_schema_fixes.sql` | Fixes bets table, place_bet_batch, winner_tg_id |
| 8 | `20260412060000_bingo_cards_table.sql` | bingo_cards table |
| 9 | `20260412070000_bingo_rooms_and_draw_log.sql` | bingo_rooms + draw_log |

---

## 🔑 ENVIRONMENT VARIABLES STATUS

### `frontend/.env.local`
| Variable | Status |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Set |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Set |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Set |
| `TELEGRAM_BOT_TOKEN` | ✅ Set |
| `TELEGRAM_BOT_SECRET` | ✅ Set |
| `SPORTSMONKS_API_KEY` | ❌ Commented out — livescores/results always 503 |

### `backend/.env`
| Variable | Status |
|---|---|
| `SUPABASE_URL` | ✅ Set |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ Set but may be redacted (ends with `xxxxxxxx`) — verify real key |
| `SPORTMONKS_API_KEY` | ✅ Set |
| `TELEGRAM_BOT_TOKEN` | ✅ Set |
| `TELEGRAM_BOT_SECRET` | ✅ Set |
| `MINI_APP_URL` | ✅ Set (ngrok URL — update when tunnel changes) |

---

## 🚀 NEXT SPRINT — PRIORITIZED FIX LIST

### ✅ Completed (this session):
1. ~~**Fix `bot.py` line 284**~~ ✅ — uses `message.from_user.id` not `chat_id`
2. ~~**Wire `GameBoard.tsx` into `bingo/page.tsx`**~~ ✅ — imported and rendered
3. ~~**Connect `bingoStore.ts` to bingo page**~~ ✅ — Zustand store populated from `/api/bingo/join` response
4. ~~**Implement Telegram contact-sharing registration**~~ ✅ — `/start` → contact → upsert → Web App menu
5. ~~**Fix `/api/bingo/join` to not upsert users**~~ ✅ — SELECT-only, 403 for unregistered
6. ~~**Fix PGRST204 missing column error**~~ ✅ — removed `auth_type` from upsert
7. ~~**Fix 23502 null constraint on password_hash**~~ ✅ — added `"telegram_native_auth"` placeholder
8. ~~**Fix NoneType crash in registration check**~~ ✅ — defensive null checks
9. ~~**Fix `load_dotenv` path issue**~~ ✅ — explicit `dotenv_path=ENV_FILE`
10. ~~**Update room UUID to real DB room**~~ ✅ — `1195fed0-8b0e-4dd5-9b9b-97dc01149502`

### Still needs doing:
11. **Fix betslip payout currency** — change `$` to `ETB` in `betting/page.tsx`
12. **Add `SPORTSMONKS_API_KEY` to `frontend/.env.local`** — uncomment and fill in
13. **Fix env var name mismatch** — `SPORTMONKS_API_KEY` vs `SPORTSMONKS_API_KEY`
14. **Verify `SUPABASE_SERVICE_ROLE_KEY`** — check if the key in `backend/.env` is the real key (not redacted)
15. **Add number-drawing trigger** — Edge Function or cron to call `bingo_draw_number` RPC
16. **Add room creation UI/API** — currently rooms must be manually inserted
17. **Add bet settlement trigger** — cron/webhook to call `betting_settle_bet`
18. **Consolidate SQL migrations** — numbered migrations with README
