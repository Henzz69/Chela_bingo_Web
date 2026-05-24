
/**
 * database.types.ts — TurboPlay Unified Schema Types
 *
 * Generated to match the unified schema after migration
 * 20260408000000_unify_schema.sql.
 *
 * Schema changes applied:
 *   - tg_users replaces the old user tables
 *   - bingo_cards replaces the old session tables
 *   - transactions (unified ledger) replaces all per-module tx tables
 *   - tg_users.balance is the single source of truth for all modules
 *   - bets.user_id is now BIGINT referencing tg_users(tg_id)
 */

// ================================================================
// CORE USER TYPE
// Represents a row in public.tg_users
// Single identity for both Sports Betting and Bingo modules.
// ================================================================

export interface TgUser {
  tg_id: number;           // BIGINT — Telegram user ID (primary key)
  tg_username: string | null;
  display_name: string;
  phone: string | null;    // nullable — Telegram-only users have no phone
  password_hash: string | null;
  auth_type: 'phone' | 'telegram';
  avatar_url: string | null;
  balance: number;         // SINGLE source of truth for ALL modules (sports + bingo)
  bonus_balance: number;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

// Payload returned by bingo_get_wallet_summary / bingo_upsert_telegram_user RPCs
export interface TgUserWalletPayload {
  tg_id: number;
  phone: string | null;
  name: string;
  wallet: number;          // maps to tg_users.balance
  transactions: TransactionRow[];
  gameHistory: BingoGameHistoryRow[];
}

// ================================================================
// UNIFIED TRANSACTION TYPE
// Represents a row in public.transactions
// ================================================================

export type TxType =
  // Global wallet operations
  | 'deposit'
  | 'withdrawal'
  | 'withdrawal_fee'
  | 'bonus_credit'
  | 'bonus_debit'
  | 'admin_credit'
  | 'admin_debit'
  // Bingo module
  | 'bingo_entry'
  | 'bingo_win'
  | 'bingo_refund'
  // Sports module
  | 'sports_bet'
  | 'sports_win'
  | 'sports_refund';

export type TxModule = 'sports' | 'bingo' | 'global';

export type TxStatus = 'pending' | 'completed' | 'failed' | 'reversed';

export interface Transaction {
  id: string;              // UUID
  user_id: number;         // BIGINT — references tg_users(tg_id)
  amount: number;          // positive = credit, negative = debit
  tx_type: TxType;
  module: TxModule;        // which subsystem owns this transaction
  status: TxStatus;
  reference_id: string | null;   // UUID — room_id, bet_id, etc.
  idempotency_key: string | null;
  balance_after: number | null;
  is_bonus: boolean;
  note: string | null;
  ip_address: string | null;
  created_at: string;
}

// Lightweight row shape returned inside wallet summary RPCs
export interface TransactionRow {
  id: string;
  amount: number;
  type: TxType;            // aliased from tx_type in the RPC
  note: string | null;
  balance_after: number | null;
  is_bonus: boolean;
  module: TxModule;
  status: TxStatus;
  created_at: string;
}

// ================================================================
// BINGO TYPES
// ================================================================

// Represents a row in public.bingo_cards
export interface BingoCard {
  id: string;              // UUID
  room_id: string;         // UUID — references bingo_rooms(id)
  tg_id: number;           // BIGINT — references tg_users(tg_id)
  grid: number[];          // 25-element flat array (5x5 card)
  daubed: number[];        // indices of daubed cells
  powerups_used: string[];
  final_rank: number | null;
  win_claimed: boolean;
  win_claimed_at: string | null;
  payout_amount: number | null;
  calls_to_win: number | null;
  winning_pattern: 'row' | 'column' | 'diagonal' | 'four_corners' | 'full_house' | null;
  joined_at: string;
}

export interface BingoRoom {
  id: string;              // UUID
  entry_fee: number;
  max_players: number;
  status: 'waiting' | 'active' | 'finished';
  winning_patterns: string[];
  drawn_numbers: number[];
  draw_sequence: number[];
  house_cut: number;
  prize_pot: number | null;
  derash_amount: number | null;
  game_code: string | null;
  card_assignments: Record<string, unknown>;
  countdown_secs: number;
  draw_interval_ms: number;
  room_type: 'public' | 'private';
  invite_code: string | null;
  stake_label: string;     // generated column
  started_at: string | null;
  finished_at: string | null;
  winner_tg_id: number | null;  // BIGINT — references tg_users(tg_id)
  created_at: string;
}

export interface BingoGameHistoryRow {
  id: string;
  gameId: string | null;   // game_code
  stake: number;
  result: 'win' | 'loss';
  payout: number;
  createdAt: string;
}

// ================================================================
// SPORTS BETTING TYPES
// ================================================================

export interface Bet {
  id: number;              // BIGSERIAL
  user_id: number;         // BIGINT — references tg_users(tg_id)
  fixture_id: number | null;
  match_name: string;
  league: string | null;
  selection: string;       // '1', 'X', '2'
  odds: number;
  slip_id: string;         // UUID
  total_odds: number;
  stake: number;
  potential_win: number;   // generated column
  status: 'pending' | 'won' | 'lost' | 'void' | 'cancelled';
  settled_at: string | null;
  payout: number | null;
  created_at: string;
}

export interface Fixture {
  id: number;              // BIGINT
  home_team: string;
  away_team: string;
  start_time: string | null;
  home_odds: number | null;
  draw_odds: number | null;
  away_odds: number | null;
  league: string | null;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
  created_at: string;
  updated_at: string;
}

// ================================================================
// DEPOSIT / WITHDRAWAL REQUEST TYPES
// ================================================================

export type PaymentMethod = 'mpesa' | 'telebirr' | 'cbe_birr' | 'bank_transfer' | 'card' | 'admin';
export type DepositStatus = 'pending' | 'confirmed' | 'failed' | 'expired';
export type WithdrawalStatus = 'pending' | 'approved' | 'processing' | 'completed' | 'rejected' | 'cancelled';

export interface BingoDepositRequest {
  id: string;              // UUID
  user_id: number;         // BIGINT — references tg_users(tg_id)
  amount: number;
  payment_method: PaymentMethod;
  provider_ref: string | null;
  provider_response: Record<string, unknown> | null;
  status: DepositStatus;
  transaction_id: string | null;  // UUID — references transactions(id)
  expires_at: string;
  confirmed_at: string | null;
  created_at: string;
}

export interface BingoWithdrawalRequest {
  id: string;              // UUID
  user_id: number;         // BIGINT — references tg_users(tg_id)
  amount: number;
  fee: number;
  net_amount: number;      // generated column
  payment_method: PaymentMethod;
  destination: Record<string, unknown>;
  status: WithdrawalStatus;
  reviewed_by: number | null;   // BIGINT — references tg_users(tg_id)
  review_note: string | null;
  reviewed_at: string | null;
  transaction_id: string | null;  // UUID — references transactions(id)
  provider_ref: string | null;
  created_at: string;
  completed_at: string | null;
}

// ================================================================
// POWERUP TYPES
// ================================================================

export type PowerupType = 'instant_daub' | 'coin_multiplier' | 'extra_card';

export interface BingoPowerupInventory {
  id: string;              // UUID
  user_id: number;         // BIGINT — references tg_users(tg_id)
  powerup_type: PowerupType;
  quantity: number;
  updated_at: string;
}

export interface BingoPowerupPurchase {
  id: string;              // UUID
  user_id: number;         // BIGINT — references tg_users(tg_id)
  powerup_type: PowerupType;
  quantity: number;
  unit_price: number;
  total_price: number;     // generated column
  paid_with_bonus: boolean;
  transaction_id: string | null;  // UUID — references transactions(id)
  created_at: string;
}

// ================================================================
// RPC RESPONSE TYPES
// ================================================================

export interface RpcSuccess<T = Record<string, unknown>> {
  success: true;
  new_balance?: number;
  tx_id?: string;
  session_id?: string;
  slip_id?: string;
  total_odds?: number;
  payout?: number;
  action?: string;
  amount?: number;
  data?: T;
}

export interface RpcError {
  error: string;
  available?: number;
  required?: number;
  status?: string;
}

export type RpcResult<T = Record<string, unknown>> = RpcSuccess<T> | RpcError;

// Type guard
export function isRpcError(result: RpcResult): result is RpcError {
  return 'error' in result && typeof (result as RpcError).error === 'string';
}
