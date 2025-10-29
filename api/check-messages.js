import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const stringSession = new StringSession(process.env.USER_STRING_SESSION || "");

let client = null;
let lastCheckTime = 0;

// Initialize Telegram client
async function initClient() {
  if (!client) {
    console.log('Initializing Telegram client...');
    client = new TelegramClient(
      stringSession,
      parseInt(process.env.API_ID),
      process.env.API_HASH,
      { 
        connectionRetries: 5, 
        useWSS: false,
        baseLogger: console
      }
    );
    
    if (!client.connected) {
      console.log('Connecting to Telegram...');
      await client.connect();
    }

    // Check if we need to authenticate
    if (!await client.checkAuthorization()) {
      console.log('Not authorized, starting authentication...');
      await client.start({
        phoneNumber: async () => process.env.PHONE_NUMBER,
        password: async () => process.env.PASSWORD || undefined,
        phoneCode: async () => {
          // For first-time setup, you'll need to handle this
          console.log('Phone code required - run setup first');
          return process.env.PHONE_CODE || '';
        },
        onError: (err) => console.error('Authentication error:', err),
      });
      console.log('Authentication successful');
    }
  }
  return client;
}

// Check if current time is within active hours in IST
function isWithinActiveHours() {
  const startTime = process.env.ACTIVE_START_TIME || "00:00";
  const endTime = process.env.ACTIVE_END_TIME || "24:00";
  const timezone = process.env.TIMEZONE || "Asia/Kolkata";
  
  const now = new Date();
  
  // Format current time in IST
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const currentTime = formatter.format(now);
  const [currentHour, currentMinute] = currentTime.split(':').map(Number);
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  
  const currentTotalMinutes = currentHour * 60 + currentMinute;
  const startTotalMinutes = startHour * 60 + startMinute;
  const endTotalMinutes = endHour * 60 + endMinute;
  
  // Handle overnight time windows (e.g., 22:00 to 06:00)
  if (endTotalMinutes < startTotalMinutes) {
    return currentTotalMinutes >= startTotalMinutes || currentTotalMinutes <= endTotalMinutes;
  }
  
  return currentTotalMinutes >= startTotalMinutes && currentTotalMinutes <= endTotalMinutes;
}

// Get formatted IST time
function getCurrentIST() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  return formatter.format(now) + ' IST';
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const currentIST = getCurrentIST();
    console.log(`[${currentIST}] Check messages endpoint called`);

    // Check if within active hours
    if (!isWithinActiveHours()) {
      const startTime = process.env.ACTIVE_START_TIME || "00:00";
      const endTime = process.env.ACTIVE_END_TIME || "24:00";
      
      console.log(`Outside active hours (${startTime} to ${endTime} IST)`);
      
      return res.status(200).json({
        success: true,
        active: false,
        message: `Outside active hours (${startTime} to ${endTime} IST). Current time: ${currentIST}. No messages processed.`,
        current_time_ist: currentIST,
        active_hours: `${startTime} to ${endTime} IST`,
        next_check: new Date(Date.now() + (parseInt(process.env.CHECK_INTERVAL_SECONDS || 300) * 1000)).toISOString()
      });
    }

    // Rate limiting check
    const checkInterval = parseInt(process.env.CHECK_INTERVAL_SECONDS || 300) * 1000;
    const now = Date.now();
    
    if (now - lastCheckTime < checkInterval) {
      const waitSeconds = Math.ceil((checkInterval - (now - lastCheckTime)) / 1000);
      console.log(`Rate limited: Please wait ${waitSeconds} seconds`);
      return res.status(429).json({
        error: 'Rate limited',
        message: `Please wait ${waitSeconds} seconds before checking again`,
        wait_seconds: waitSeconds
      });
    }

    lastCheckTime = now;

    // Initialize and connect client
    const client = await initClient();
    console.log('Telegram client connected successfully');

    // Calculate time window for messages
    const lookbackMinutes = parseInt(process.env.MESSAGE_LOOKBACK_MINUTES) || 15;
    const lookbackTime = new Date(Date.now() - lookbackMinutes * 60 * 1000);
    const maxMessages = parseInt(process.env.MAX_MESSAGES_PER_CHECK) || 10;

    console.log(`Fetching last ${maxMessages} messages from last ${lookbackMinutes} minutes`);

    // Get recent messages
    const messages = await client.getMessages("me", { 
      limit: maxMessages 
    });

    const targetGroupId = process.env.TARGET_GROUP_CHAT_ID;
    const forwardedMessages = [];
    const skippedMessages = [];

    console.log(`Found ${messages.length} recent messages, processing...`);

    // Process each message
    for (const message of messages) {
      try {
        // Check if message is within our time window
        const messageDate = new Date(message.date * 1000);
        if (messageDate < lookbackTime) {
          skippedMessages.push({
            id: message.id,
            reason: 'too_old',
            timestamp: message.date
          });
          continue;
        }

        // Check if message is from a bot
        if (message.fromId && typeof message.fromId === 'object') {
          const sender = await client.getEntity(message.fromId);
          
          if (sender.bot) {
            console.log(`Forwarding message ${message.id} from bot ${sender.username || sender.id}`);
            
            // Forward message to target group
            await client.forwardMessages(targetGroupId, {
              messages: message.id,
              fromPeer: "me"
            });
            
            forwardedMessages.push({
              id: message.id,
              text: message.text?.substring(0, 100) + (message.text?.length > 100 ? '...' : ''),
              from: sender.username || sender.id,
              timestamp: message.date,
              timestamp_ist: new Date(message.date * 1000).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
            });

            // Delay between forwards to avoid rate limits
            const delayMs = parseInt(process.env.DELAY_BETWEEN_FORWARDS_MS) || 1000;
            await new Promise(resolve => setTimeout(resolve, delayMs));
          } else {
            skippedMessages.push({
              id: message.id,
              reason: 'not_from_bot',
              from: sender.username || sender.id
            });
          }
        } else {
          skippedMessages.push({
            id: message.id,
            reason: 'no_sender_info'
          });
        }
      } catch (error) {
        console.error(`Error processing message ${message.id}:`, error);
        skippedMessages.push({
          id: message.id,
          reason: 'error',
          error: error.message
        });
      }
    }

    const nextCheckSeconds = parseInt(process.env.CHECK_INTERVAL_SECONDS || 300);
    const nextCheckIST = new Date(Date.now() + (nextCheckSeconds * 1000))
      .toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

    console.log(`Processing complete. Forwarded: ${forwardedMessages.length}, Skipped: ${skippedMessages.length}`);

    res.status(200).json({
      success: true,
      active: true,
      forwarded: forwardedMessages.length,
      skipped: skippedMessages.length,
      messages: forwardedMessages,
      skipped_details: skippedMessages,
      current_time_ist: currentIST,
      active_hours: `${process.env.ACTIVE_START_TIME || "00:00"} to ${process.env.ACTIVE_END_TIME || "24:00"} IST`,
      next_check: new Date(Date.now() + (nextCheckSeconds * 1000)).toISOString(),
      next_check_ist: nextCheckIST,
      settings: {
        check_interval_seconds: nextCheckSeconds,
        max_messages_per_check: maxMessages,
        lookback_minutes: lookbackMinutes,
        delay_between_forwards_ms: parseInt(process.env.DELAY_BETWEEN_FORWARDS_MS) || 1000
      }
    });

  } catch (error) {
    // Handle Telegram flood waits
    if (error.message && error.message.includes('FLOOD_WAIT')) {
      const waitTime = error.message.match(/\d+/)?.[0] || 60;
      console.error(`Telegram flood wait: ${waitTime} seconds`);
      return res.status(429).json({
        error: 'Telegram rate limit',
        message: `Telegram requires waiting ${waitTime} seconds`,
        wait_seconds: parseInt(waitTime),
        current_time_ist: getCurrentIST()
      });
    }
    
    console.error('Critical error:', error);
    res.status(500).json({ 
      error: 'Failed to process messages',
      details: error.message,
      current_time_ist: getCurrentIST()
    });
  }
}