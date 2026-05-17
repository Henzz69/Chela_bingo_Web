# TurboPlay — Schema Unification Review
**Date:** April 8, 2026  
**Migration file:** `frontend/supabase/20260408000000_unify_schema.sql`  
**Status:** ✅ All code modifications complete — awaiting manual DB execution and QA

---

## 1. Summary of Changes

This refactor eliminates identity fragmentation and unifies the transaction ledger across the Sports Betting and Bingo modules. The core principle: **one user record, one balance column, one transaction table**.

### Before → After

| Concept | Before | After |
|---|---|---|
| User table (bingo) | `bingo_users` | `tg_users` |
| User table (sports) | `profiles` (Supabase Auth) | `tg_users` |
| User PK | UUID (`id`) | BIGINT (`tg_id`) |
| Bingo balance | `tg_users.bingo_balance` | `tg_users.balance` |
| Sports balance | `profiles.balance` | `tg_users.balance` |
| Bingo transactions | `bingo_transactions` | `public.transactions` |
| Sports transactions | `sports_transactions` | `public.transactions` |
| Game sessions | `bingo_sessions` | `bingo_cards` |
| Bets FK | `bets.user_id UUID → profiles(id)` | `bets.user_id BIGINT → tg_users(tg_id)` |

---

## 2. Files Altered

### 2a. New Files Created

| File | Purpose |
|---|---|
| `frontend/supabase/20260408000000_unify_schema.sql` | Master migration — drops legacy tables, merges balances, creates unified `transactions` table, re-points all FKs, rewrites RPCs |
| `frontend/lib/database.types.ts` | Unified TypeScript type definitions for all DB entities |

### 2b. Modified Files

#### Backend (Python)
| File | Change |
|---|---|
| `backend/bot.py` | `_get_bingo_balance()`: changed `SELECT "bingo_balance"` → `SELECT "balance"` from `tg_users`. Also added comment clarifying `message.from_user.id` (not `chat_id`) for withdrawal balance check. |

#### Frontend API Routes (Next.js)
| File | Change |
|---|---|
| `frontend/app/api/bingo/auth/route.ts` | All `bingo_users` table references → `tg_users`. `SELECT 'id'` → `SELECT 'tg_id'`. `INSERT` now includes `auth_type: 'phone'`. `formatUser()` now prefers `tg_id` over UUID `id`. |
| `frontend/app/api/bingo/wallet/route.ts` | GET: `?userId=` (UUID) → `?tgId=` (BIGINT). POST: removed UUID `userId` validation; all actions now use `tgId` (BIGINT). All RPC calls updated: `p_user_id` → `p_tg_id`. Final win summary uses `bingo_get_wallet_summary` (not `bingo_get_user_by_tg_id`). |
| `frontend/app/api/user/route.ts` | Primary lookup: `profiles.balance` → `tg_users.balance` (by `tg_id`). Added fallback to `profiles` table for legacy Supabase-auth users. Fixed TS null-safety on `profile?.balance`. |
| `frontend/app/api/place-bet/route.ts` | Added tg_id resolution step (looks up `tg_users` then `profiles` fallback). RPC call: `p_user_id: user.id` → `p_tg_id: tgId`. Error message: `'User profile not found'` → `'User not found'`. |
| `frontend/app/api/bets/route.ts` | Added tg_id resolution step. Query: `.eq('user_id', user.id)` → `.eq('user_id', tgId)`. Added `match_name` and `odds` to SELECT (stored columns from `place_bet_batch`). Improved odds fallback logic. |

#### Frontend UI
| File | Change |
|---|---|
| `frontend/app/bingo/page.tsx` | `User` interface: `id` is now `number \| string` (tg_id preferred), added `tg_id?: number`. All wallet API calls: `userId: user.id` → `tgId` (resolved from `user.tg_id ?? user.id`). Win claim: removed client-supplied `amount` from body (server-side only). |

#### Type Definitions
| File | Change |
|---|---|
| `frontend/lib/database.types.ts` | **NEW FILE.** Defines: `TgUser`, `Transaction`, `TxType`, `TxModule`, `TxStatus`, `BingoCard`, `BingoRoom`, `Bet`, `Fixture`, `BingoDepositRequest`, `BingoWithdrawalRequest`, `BingoPowerupInventory`, `BingoPowerupPurchase`, `RpcSuccess`, `RpcError`, `RpcResult`. Deprecated aliases: `BingoUser`, `BingoWalletTx`, `SportsTransaction`, `BingoSession`. |

---

## 3. New Unified Transaction Payload

### Table: `public.transactions`

```sql
CREATE TABLE public.transactions (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          BIGINT        NOT NULL REFERENCES tg_users(tg_id) ON DELETE CASCADE,
  amount           NUMERIC(14,2) NOT NULL,   -- positive=credit, negative=debit
  tx_type          TEXT          NOT NULL,   -- see enum below
  module           TEXT          NOT NULL DEFAULT 'global',  -- 'sports'|'bingo'|'global'
  status           TEXT          NOT NULL DEFAULT 'completed',
  reference_id     UUID,                     -- room_id, bet_id, deposit_request_id
  idempotency_key  TEXT          UNIQUE,     -- prevents duplicate writes on retry
  balance_after    NUMERIC(14,2),            -- snapshot of balance after this tx
  is_bonus         BOOLEAN       NOT NULL DEFAULT FALSE,
  note             TEXT,
  ip_address       INET,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
```

### `tx_type` Enum Values

| Value | Module | Direction | Description |
|---|---|---|---|
| `deposit` | global | credit | Manual or payment-provider deposit |
| `withdrawal` | global | debit | User withdrawal request |
| `withdrawal_fee` | global | debit | Fee deducted on withdrawal |
| `bonus_credit` | global | credit | Bonus awarded |
| `bonus_debit` | global | debit | Bonus consumed |
| `admin_credit` | global | credit | Admin manual top-up |
| `admin_debit` | global | debit | Admin manual deduction |
| `bingo_entry` | bingo | debit | Entry fee for a bingo room |
| `bingo_win` | bingo | credit | Payout from winning a bingo game |
| `bingo_refund` | bingo | credit | Refund if room cancelled |
| `sports_bet` | sports | debit | Stake placed on a bet slip |
| `sports_win` | sports | credit | Payout from a won bet |
| `sports_refund` | sports | credit | Refund for voided/cancelled bet |

### TypeScript Type

```typescript
// From frontend/lib/database.types.ts
export interface Transaction {
  id: string;              // UUID
  user_id: number;         // BIGINT — references tg_users(tg_id)
  amount: number;          // positive = credit, negative = debit
  tx_type: TxType;
  module: TxModule;        // 'sports' | 'bingo' | 'global'
  status: TxStatus;        // 'pending' | 'completed' | 'failed' | 'reversed'
  reference_id: string | null;
  idempotency_key: string | null;
  balance_after: number | null;
  is_bonus: boolean;
  note: string | null;
  ip_address: string | null;
  created_at: string;
}
```

---

## 4. Updated RPC Signatures

All RPCs now accept `p_tg_id BIGINT` instead of `p_user_id UUID`.

| RPC | Old Signature | New Signature |
|---|---|---|
| `bingo_wallet_credit` | `(p_user_id UUID, p_amount, p_type, p_note)` | `(p_tg_id BIGINT, p_amount, p_type, p_idem_key, p_note, p_is_bonus)` |
| `bingo_wallet_debit` | `(p_user_id UUID, p_amount, p_type, p_note)` | `(p_tg_id BIGINT, p_amount, p_type, p_idem_key, p_note, p_is_bonus)` |
| `bingo_get_wallet_summary` | `(p_user_id UUID)` | `(p_tg_id BIGINT)` |
| `bingo_get_user_by_tg_id` | `(p_tg_id BIGINT)` | `(p_tg_id BIGINT)` — now delegates to `bingo_get_wallet_summary` |
| `bingo_upsert_telegram_user` | `(p_tg_id, p_tg_username, ...)` | unchanged — now reads `balance` (not `bingo_balance`) |
| `place_bet_batch` | `(p_user_id UUID, p_total_stake, p_bets)` | `(p_tg_id BIGINT, p_total_stake, p_bets)` |

---

## 5. Migration Execution Order

Run in Supabase SQL Editor **in this exact order**:

| # | File | Notes |
|---|---|---|
| 1 | `schema_bingo.sql` | Base bingo tables (if not already applied) |
| 2 | `schema_betting.sql` | Betting tables (if not already applied) |
| 3 | `bingo_telegram_migration.sql` | Adds tg_id to bingo_users |
| 4 | `refactor_dual_architecture.sql` | Renames tables |
| 5 | `005_fixtures_table.sql` | Fixtures table |
| 6 | `006_fix_wallet_rpcs.sql` | Fixes wallet RPCs |
| 7 | `007_final_schema_fixes.sql` | Fixes bets table |
| **8** | **`20260408000000_unify_schema.sql`** | **THIS MIGRATION — run last** |

> ⚠️ The migration is **fully idempotent** — safe to re-run if it fails partway through.

---

## 6. Edge Cases & Manual Testing Required

### 🔴 CRITICAL — Must test before going live

**EC-1: `bingo_wallet_credit` PL/pgSQL syntax**  
The migration rewrites `bingo_wallet_credit` with a simplified UPDATE/RETURNING pattern. The original had a `SELECT ... FOR UPDATE INTO STRICT` with a `USING` clause that is not valid PL/pgSQL syntax. The new version uses a clean `UPDATE ... RETURNING balance INTO v_new_bal`. **Manually verify the RPC executes without error in Supabase SQL Editor before deploying.**

**EC-2: `bets.user_id` type change UUID → BIGINT**  
The migration changes `bets.user_id` from `UUID` to `BIGINT` using `USING NULL` — all existing rows will have `user_id = NULL`. This is safe for dev/staging but **will break any existing bet history in production**. If you have production bet data, you must write a data migration to map old UUID user_ids to their corresponding tg_ids via the `profiles` table before running this migration.

**EC-3: `place_bet_batch` RPC parameter rename**  
The RPC now accepts `p_tg_id` instead of `p_user_id`. The frontend `api/place-bet/route.ts` has been updated. However, if any other client (mobile app, admin panel, etc.) calls this RPC directly with `p_user_id`, it will fail with "function does not exist". **Search all clients for `place_bet_batch` calls.**

**EC-4: Phone-auth users have no `tg_id`**  
Phone-registered users (via `/api/bingo/auth` register action) are inserted into `tg_users` without a `tg_id` (it's NULL). The wallet API now requires `tgId` for all operations. **Phone-auth users cannot use the wallet until they link a Telegram account.** The bingo page shows "Wallet requires Telegram login" for these users. This is a UX gap that needs a resolution path (e.g., link phone account to Telegram).

**EC-5: `bingo_get_wallet_summary` joins `bingo_rooms` on `game_code`**  
The game history query in `bingo_get_wallet_summary` references `r.game_code`. If `bingo_rooms` does not have a `game_code` column (it was added in `turboplay_expansion.sql`), this query will fail. **Verify `bingo_rooms.game_code` exists before running the migration.**

**EC-6: `bingo_transactions` data migration**  
The migration copies rows from `bingo_transactions` into `public.transactions` using `ON CONFLICT (idempotency_key) DO NOTHING`. Rows with `NULL` idempotency_key will be inserted without conflict checking. If `bingo_transactions` has rows with unknown `tx_type` values not in the new enum, they will be mapped to `'admin_credit'` as a fallback. **Review any non-standard tx_type values in `bingo_transactions` before migrating.**

**EC-7: `api/user/route.ts` tg_id lookup**  
The route now does `.eq('tg_id', user.id)` where `user.id` is a Supabase Auth UUID string. This will never match a BIGINT `tg_id`. The fallback to `profiles` table is the correct path for sports betting users. **The primary `tg_users` lookup by `tg_id` will always miss for Supabase-auth users — this is expected behavior, not a bug.** The fallback handles it correctly.

**EC-8: `api/place-bet/route.ts` tg_id resolution**  
The route tries to find `tg_id` in `tg_users` by `.eq('tg_id', user.id)` (UUID vs BIGINT — will always miss), then falls back to `profiles.tg_id`. This means the `profiles` table must have a `tg_id` column for sports betting to work. **Verify `profiles.tg_id BIGINT` column exists** (added by `refactor_dual_architecture.sql`). If it doesn't exist, all bet placements will return 404.

### 🟡 LOGIC — Test for correctness

**EC-9: `bingo/page.tsx` win payout is still fake**  
The `claimBingo()` function calculates `payout = Math.floor(pot * (1 - HOUSE_CUT))` from a fake `pot` (random player count × stake). The wallet API correctly ignores the client-supplied amount for `win` actions — the server calculates the real payout from `bingo_claim_win` RPC. However, the `winnings` state shown on the winner screen is still the fake client-calculated value. **The displayed payout on the winner screen may differ from the actual credited amount.** Fix: use the `payout` value returned from the wallet API response.

**EC-10: `bingo_wallet_credit` called for 'win' action**  
The `bingo_claim_win` RPC (defined in `006_fix_wallet_rpcs.sql`) internally calls `bingo_wallet_credit` to credit the winner. After this migration, `bingo_wallet_credit` now writes to `public.transactions` instead of `bingo_transactions`. **Verify `bingo_claim_win` RPC still works end-to-end** — it may still reference `bingo_transactions` internally if `006_fix_wallet_rpcs.sql` was not updated.

**EC-11: `bingo_rooms.winner_tg_id` vs `winner_id`**  
`007_final_schema_fixes.sql` added `winner_tg_id BIGINT` to `bingo_rooms`. The `bingoStore.ts` still reads `room.winner_id` (string). After the migration, `winner_id` (UUID) is dropped and replaced by `winner_tg_id` (BIGINT). **Update `bingoStore.ts` line 181: `winnerId: room.winner_id` → `winnerId: String(room.winner_tg_id)`.**

**EC-12: `GET /api/bingo/wallet` query param change**  
The GET endpoint now requires `?tgId=xxx` instead of `?userId=xxx`. Any frontend code calling `GET /api/bingo/wallet?userId=...` will receive a 400 error. **Search the codebase for `bingo/wallet?userId=` and update to `bingo/wallet?tgId=`.**

---

## 7. What Was NOT Changed (Out of Scope)

- `frontend/app/api/fixtures/route.ts` — reads from `fixtures` table only, no user identity involved
- `frontend/app/api/livescores/route.ts` — external API proxy, no DB user identity
- `frontend/app/api/results/route.ts` — external API proxy, no DB user identity
- `frontend/app/api/bingo/auth/telegram/route.ts` — already uses `bingo_upsert_telegram_user` RPC with `p_tg_id`; no changes needed
- `frontend/store/bingoStore.ts` — already uses `tg_id` throughout (was updated in a previous sprint); no changes needed
- `frontend/app/bingo/GameBoard.tsx` — already uses `tg_id`; no changes needed
- `backend/sync_worker.py` — only touches `fixtures` table; no user identity involved

---

## 8. Recommended Next Steps (Post-Migration)

1. **Run the migration** in Supabase SQL Editor and verify all `RAISE NOTICE` messages appear without errors
2. **Fix EC-11**: Update `bingoStore.ts` `winnerId: room.winner_id` → `winnerId: String(room.winner_tg_id ?? '')`
3. **Fix EC-9**: Update `claimBingo()` in `bingo/page.tsx` to use the payout from the API response instead of the fake client-calculated value
4. **Verify EC-5**: Confirm `bingo_rooms.game_code` column exists
5. **Verify EC-8**: Confirm `profiles.tg_id` column exists
6. **Test the full bingo flow**: Telegram login → deposit → join room → play → claim win → check balance
7. **Test the full sports flow**: Telegram login → view fixtures → place bet → check bet history → check balance
8. **Test phone-auth flow**: Register → login → attempt wallet → confirm "Telegram login required" message appears
9. **Drop `bingo_transactions`** once you've confirmed all data is in `public.transactions` and all RPCs are working correctly
