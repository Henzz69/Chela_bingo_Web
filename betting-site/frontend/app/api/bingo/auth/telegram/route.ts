// POST /api/bingo/auth/telegram
// Dedicated endpoint for the Telegram Bot webhook.
// Called by your Python bot (main.py) when a user starts the mini-app.
//
// Two usage patterns:
//   A) Bot webhook — validates Telegram initData HMAC, then upserts user
//   B) Direct bot call — uses TELEGRAM_BOT_SECRET header for server-to-server auth
//
// Body (pattern A — from Telegram WebApp initData):
//   { init_data: string }   ← raw Telegram.WebApp.initData string
//
// Body (pattern B — from your Python bot backend):
//   { tg_id, tg_username?, first_name?, last_name?, photo_url? }
//   Header: x-bot-secret: <TELEGRAM_BOT_SECRET env var>
//
// Returns: { user, token }  — same shape as /api/bingo/auth
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Helpers ───────────────────────────────────────────────────
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeName(name: string): string {
  return name.replace(/[<>"'&]/g, '').trim().slice(0, 50);
}

/**
 * Validates Telegram WebApp initData HMAC signature.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateTelegramInitData(initData: string, botToken: string): Record<string, string> | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    // Build the data-check string (all fields except hash, sorted alphabetically)
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    // HMAC-SHA256 with key = HMAC-SHA256("WebAppData", botToken)
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // Constant-time comparison
    if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'))) {
      return null;
    }

    // Check auth_date is not older than 24 hours
    const authDate = parseInt(params.get('auth_date') ?? '0', 10);
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds > 86_400) return null; // expired

    // Return all params as a plain object
    const result: Record<string, string> = {};
    params.forEach((v, k) => { result[k] = v; });
    return result;

  } catch {
    return null;
  }
}

// ── Route handler ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
  const BOT_SECRET   = process.env.TELEGRAM_BOT_SECRET;

  // ════════════════════════════════════════════════════════════
  // PATTERN A — Telegram WebApp initData (from mini-app frontend)
  // ════════════════════════════════════════════════════════════
  if (body.init_data) {
    if (!BOT_TOKEN) {
      console.error('[/api/bingo/auth/telegram] TELEGRAM_BOT_TOKEN not configured');
      return NextResponse.json({ error: 'Telegram auth not configured' }, { status: 503 });
    }

    const validated = validateTelegramInitData(String(body.init_data), BOT_TOKEN);
    if (!validated) {
      return NextResponse.json({ error: 'Invalid or expired Telegram initData' }, { status: 401 });
    }

    // Parse the user JSON from initData
    let tgUser: any = {};
    try {
      tgUser = JSON.parse(validated.user ?? '{}');
    } catch {
      return NextResponse.json({ error: 'Malformed user data in initData' }, { status: 400 });
    }

    const tgId = tgUser.id;
    if (!tgId || typeof tgId !== 'number') {
      return NextResponse.json({ error: 'Missing tg_id in initData user' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc('bingo_upsert_telegram_user', {
      p_tg_id:       tgId,
      p_tg_username: tgUser.username    ? String(tgUser.username).slice(0, 32)         : null,
      p_first_name:  tgUser.first_name  ? sanitizeName(String(tgUser.first_name))       : null,
      p_last_name:   tgUser.last_name   ? sanitizeName(String(tgUser.last_name))        : null,
      p_photo_url:   tgUser.photo_url   ? String(tgUser.photo_url).slice(0, 500)        : null,
    });

    if (error || data?.error) {
      console.error('[/api/bingo/auth/telegram initData]', error?.message || data?.error);
      return NextResponse.json({ error: 'Auth failed — please try again' }, { status: 500 });
    }

    return NextResponse.json({ user: data, token: generateToken() });
  }

  // ════════════════════════════════════════════════════════════
  // PATTERN B — Server-to-server from Python bot backend
  // ════════════════════════════════════════════════════════════
  const incomingSecret = req.headers.get('x-bot-secret');
  if (!BOT_SECRET || !incomingSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Constant-time comparison of secrets
  const secretsMatch = BOT_SECRET.length === incomingSecret.length &&
    crypto.timingSafeEqual(Buffer.from(BOT_SECRET), Buffer.from(incomingSecret));

  if (!secretsMatch) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { tg_id, tg_username, first_name, last_name, photo_url } = body;

  if (!tg_id || typeof tg_id !== 'number' || !Number.isInteger(tg_id) || tg_id <= 0) {
    return NextResponse.json({ error: 'Valid tg_id (integer) is required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc('bingo_upsert_telegram_user', {
    p_tg_id:       tg_id,
    p_tg_username: tg_username  ? String(tg_username).slice(0, 32)  : null,
    p_first_name:  first_name   ? sanitizeName(String(first_name))   : null,
    p_last_name:   last_name    ? sanitizeName(String(last_name))    : null,
    p_photo_url:   photo_url    ? String(photo_url).slice(0, 500)    : null,
  });

  if (error || data?.error) {
    console.error('[/api/bingo/auth/telegram bot]', error?.message || data?.error);
    return NextResponse.json({ error: 'Auth failed — please try again' }, { status: 500 });
  }

  return NextResponse.json({ user: data, token: generateToken() });
}
