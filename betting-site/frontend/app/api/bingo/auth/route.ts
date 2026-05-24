// POST /api/bingo/auth
// Supports two auth modes:
//   1. Phone/password  — { action: 'register'|'login', phone, password, name? }
//   2. Telegram        — { action: 'telegram', tg_id, tg_username?, first_name?, last_name?, photo_url? }
//
// Unified schema: all users stored in tg_users.
// balance column is the single source of truth for all modules.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Security constants ────────────────────────────────────────
const MIN_PASSWORD_LEN = 6;
const MAX_PASSWORD_LEN = 128;
const MAX_NAME_LEN     = 50;
const PHONE_REGEX      = /^\+?[0-9]{7,15}$/;

// ── Helpers ───────────────────────────────────────────────────
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + 'chela-salt-2024').digest('hex');
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeName(name: string): string {
  return name.replace(/[<>"'&]/g, '').trim().slice(0, MAX_NAME_LEN);
}

function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (/^09\d{8}$/.test(cleaned))     return '+251' + cleaned.slice(1);
  if (/^2519\d{8}$/.test(cleaned))   return '+' + cleaned;
  if (/^\+2519\d{8}$/.test(cleaned)) return cleaned;
  if (PHONE_REGEX.test(cleaned))     return cleaned;
  return null;
}

function formatUser(u: any) {
  return {
    id:           u.tg_id        ?? u.id,   // prefer tg_id; fall back to UUID id for phone users
    phone:        u.phone        ?? null,
    tg_id:        u.tg_id        ?? null,
    tg_username:  u.tg_username  ?? null,
    auth_type:    u.auth_type    ?? 'phone',
    name:         u.display_name,
    display_name: u.display_name,
    wallet:       parseFloat(u.balance)       || 0,  // unified balance
    bonus:        parseFloat(u.bonus_balance) || 0,
  };
}

// ── Route handler ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const { action } = body;
  if (!action || typeof action !== 'string') {
    return NextResponse.json({ error: 'action is required' }, { status: 400 });
  }

  // ════════════════════════════════════════════════════════════
  // TELEGRAM AUTH (requires bingo_telegram_migration.sql to be run)
  // ════════════════════════════════════════════════════════════
  if (action === 'telegram') {
    const { tg_id, tg_username, first_name, last_name, photo_url } = body;

    if (!tg_id || typeof tg_id !== 'number' || !Number.isInteger(tg_id) || tg_id <= 0) {
      return NextResponse.json({ error: 'Valid tg_id (integer) is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc('bingo_upsert_telegram_user', {
      p_tg_id:       tg_id,
      p_tg_username: tg_username ? String(tg_username).slice(0, 32)       : null,
      p_first_name:  first_name  ? sanitizeName(String(first_name))        : null,
      p_last_name:   last_name   ? sanitizeName(String(last_name))         : null,
      p_photo_url:   photo_url   ? String(photo_url).slice(0, 500)         : null,
    });

    if (error || data?.error) {
      console.error('[POST /api/bingo/auth telegram]', error?.message || data?.error);
      return NextResponse.json({ error: 'Telegram auth failed — please try again' }, { status: 500 });
    }

    return NextResponse.json({ user: data, token: generateToken() });
  }

  // ════════════════════════════════════════════════════════════
  // PHONE AUTH
  // ════════════════════════════════════════════════════════════
  if (!['register', 'login'].includes(action)) {
    return NextResponse.json(
      { error: 'Invalid action — must be register, login, or telegram' },
      { status: 400 }
    );
  }

  const { phone, password, name } = body;

  if (!phone || typeof phone !== 'string') {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 });
  }
  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'password is required' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
    return NextResponse.json(
      { error: `Password must be ${MIN_PASSWORD_LEN}–${MAX_PASSWORD_LEN} characters` },
      { status: 400 }
    );
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return NextResponse.json(
      { error: 'Invalid phone number — use format 09xxxxxxxx or +2519xxxxxxxx' },
      { status: 400 }
    );
  }

  // ── REGISTER ────────────────────────────────────────────────
  if (action === 'register') {
    const { data: existing, error: checkErr } = await supabaseAdmin
      .from('tg_users')
      .select('tg_id')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (checkErr) {
      console.error('[POST /api/bingo/auth register check]', checkErr.message);
      return NextResponse.json({ error: 'Registration failed — please try again' }, { status: 500 });
    }

    if (existing) {
      return NextResponse.json({ error: 'Phone number already registered' }, { status: 409 });
    }

    const displayName = name
      ? sanitizeName(String(name))
      : `Player_${normalizedPhone.slice(-4)}`;

    // Insert into unified tg_users table
    // balance is the single source of truth
    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('tg_users')
      .insert({
        phone:         normalizedPhone,
        password_hash: hashPassword(password),
        display_name:  displayName,
        auth_type:     'phone',
      })
      .select('tg_id, phone, display_name, balance, bonus_balance')
      .single();

    if (insertError) {
      console.error('[POST /api/bingo/auth register insert]', insertError.message);
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ user: formatUser(newUser), token: generateToken() });
  }

  // ── LOGIN ────────────────────────────────────────────────────
  if (action === 'login') {
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('tg_users')
      .select('tg_id, phone, display_name, balance, bonus_balance, password_hash')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (fetchError) {
      console.error('[POST /api/bingo/auth login]', fetchError.message);
      return NextResponse.json({ error: 'Login failed — please try again' }, { status: 500 });
    }

    const expectedHash = user?.password_hash ?? '';
    const actualHash   = hashPassword(password);

    // Constant-time comparison — both are always 64-char hex strings
    const hashesMatch = expectedHash.length === actualHash.length &&
      crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(actualHash, 'hex'));

    if (!user || !hashesMatch) {
      return NextResponse.json({ error: 'Invalid phone or password' }, { status: 401 });
    }

    return NextResponse.json({ user: formatUser(user), token: generateToken() });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
