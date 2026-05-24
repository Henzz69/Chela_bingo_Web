import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    const { initData } = await request.json();

    if (!initData) {
      return NextResponse.json({ error: 'Missing initData' }, { status: 400 });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      console.error("CRITICAL: TELEGRAM_BOT_TOKEN is missing from .env");
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }

    // 1. Parse the URL-encoded initData string into key-value pairs
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    
    if (!hash) {
      return NextResponse.json({ error: 'Missing hash' }, { status: 400 });
    }

    // Remove the hash from the data so we can verify the rest of the payload
    urlParams.delete('hash');

    // 2. Sort the data alphabetically by key and format it exactly as Telegram expects
    const dataCheckArr: string[] = [];
    urlParams.sort();
    urlParams.forEach((value, key) => {
      dataCheckArr.push(`${key}=${value}`);
    });
    const dataCheckString = dataCheckArr.join('\n');

    // 3. Cryptography: Generate the secret key using your Bot Token
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // 4. Cryptography: Hash the data string using the secret key
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // 5. Compare the signatures
    if (calculatedHash !== hash) {
      return NextResponse.json({ error: 'Invalid signature. Unauthorized.' }, { status: 403 });
    }

    // 6. Security Check: Prevent replay attacks (Make sure the data isn't 24 hours old)
    const authDate = urlParams.get('auth_date');
    if (authDate) {
      const now = Math.floor(Date.now() / 1000);
      const authTime = parseInt(authDate, 10);
      const dataAgeInSeconds = now - authTime;
      
      // If the data is older than 1 hour (3600 seconds), reject it
      if (dataAgeInSeconds > 3600) {
         return NextResponse.json({ error: 'Authentication data has expired.' }, { status: 403 });
      }
    }

    // 7. Success! Extract the user ID safely.
    const userStr = urlParams.get('user');
    if (!userStr) {
        return NextResponse.json({ error: 'No user data found.' }, { status: 400 });
    }
    
    const userObj = JSON.parse(userStr);

    // Return the mathematically verified Telegram ID
    return NextResponse.json({ 
      success: true, 
      verifiedTgId: userObj.id,
      user: userObj
    });

  } catch (error: any) {
    console.error("Telegram Auth Error:", error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
