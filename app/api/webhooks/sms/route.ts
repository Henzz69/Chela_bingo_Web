import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

// A secret password so hackers can't trigger fake deposits
const WEBHOOK_SECRET = process.env.SMS_WEBHOOK_SECRET || 'chela-super-secret-key-2026';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // 1. Authenticate the request (Make sure it's actually your phone)
    if (body.secret !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const smsText = body.message; // e.g., "Confirmed. You received 50.00 ETB... Ref: BFA123456"

    // 2. Extract the data using Regex
    // Note: You will need to tweak these Regex patterns slightly based on the EXACT format of a Telebirr SMS.
    const amountMatch = smsText.match(/received\s+([\d,.]+)\s+ETB/i);
    const refMatch = smsText.match(/Ref(?:erence)?\s*(?:Number|No)?[:\s]+([A-Z0-9]+)/i);

    if (!amountMatch || !refMatch) {
      return NextResponse.json({ error: 'Could not parse SMS format.' }, { status: 400 });
    }

    const actualAmount = parseFloat(amountMatch[1].replace(',', ''));
    const actualRef = refMatch[1].trim();

    // 3. Verify against the database
    const { data: pendingTx, error: txError } = await supabase
      .from('deposits')
      .select('*')
      .eq('tx_ref', actualRef)
      .eq('status', 'pending')
      .single();

    if (txError || !pendingTx) {
      return NextResponse.json({ message: 'Receipt ignored. No matching pending request found in database.' });
    }

    if (pendingTx.amount !== actualAmount) {
      // Player tried to cheat! They requested 100 ETB but only sent 10 ETB.
      await supabase.from('deposits').update({ status: 'failed_amount_mismatch' }).eq('id', pendingTx.id);
      return NextResponse.json({ message: 'Amount mismatch caught.' });
    }

    // 4. THE PAYOUT: Mark as successful and update wallet!
    await supabase.from('deposits').update({ status: 'successful', completed_at: new Date().toISOString() }).eq('id', pendingTx.id);
    
    await supabase.rpc('increment_wallet', { 
      p_tg_id: pendingTx.tg_id, 
      p_amount: actualAmount 
    });

    return NextResponse.json({ success: true, message: `Deposited ${actualAmount} to ${pendingTx.tg_id}` });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}