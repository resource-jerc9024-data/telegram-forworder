import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phoneCode } = req.body;

  try {
    const apiId = parseInt(process.env.API_ID);
    const apiHash = process.env.API_HASH;
    
    if (!apiId || !apiHash) {
      return res.status(400).json({
        error: 'Missing API credentials',
        message: 'Please set API_ID and API_HASH environment variables'
      });
    }

    const stringSession = new StringSession("");
    const client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });

    console.log('Starting Telegram session setup...');

    await client.start({
      phoneNumber: async () => process.env.PHONE_NUMBER,
      password: async () => process.env.PASSWORD || undefined,
      phoneCode: async () => {
        if (!phoneCode) {
          throw new Error('Phone code is required for setup');
        }
        return phoneCode;
      },
      onError: (err) => {
        console.error('Setup error:', err);
        throw err;
      },
    });

    const sessionString = client.session.save();
    
    console.log('Session setup completed successfully');

    res.status(200).json({
      success: true,
      session: sessionString,
      message: "Session setup completed successfully. Save this session string in USER_STRING_SESSION environment variable."
    });

  } catch (error) {
    console.error('Session setup failed:', error);
    
    let errorMessage = error.message;
    if (error.message.includes('PHONE_CODE_INVALID')) {
      errorMessage = 'Invalid phone code. Please check and try again.';
    } else if (error.message.includes('PHONE_NUMBER_INVALID')) {
      errorMessage = 'Invalid phone number format. Use international format (+91...)';
    } else if (error.message.includes('SESSION_PASSWORD_NEEDED')) {
      errorMessage = '2FA password required. Set PASSWORD environment variable.';
    }

    res.status(500).json({ 
      success: false,
      error: 'Session setup failed',
      message: errorMessage,
      details: error.message
    });
  }
}