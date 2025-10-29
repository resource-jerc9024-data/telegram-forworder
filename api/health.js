export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  const currentIST = getCurrentIST();

  res.status(200).json({
    status: 'healthy',
    service: 'Telegram Auto Forwarder',
    current_time_ist: currentIST,
    active_hours: `${process.env.ACTIVE_START_TIME || "00:00"} to ${process.env.ACTIVE_END_TIME || "24:00"} IST`,
    check_interval: `${process.env.CHECK_INTERVAL_SECONDS || 300} seconds`,
    timezone: process.env.TIMEZONE || 'Asia/Kolkata',
    endpoints: {
      health: '/api/health',
      check_messages: '/api/check-messages',
      setup: '/api/setup-session (POST)'
    },
    environment: {
      api_id_set: !!process.env.API_ID,
      api_hash_set: !!process.env.API_HASH,
      phone_number_set: !!process.env.PHONE_NUMBER,
      target_group_set: !!process.env.TARGET_GROUP_CHAT_ID,
      session_set: !!process.env.USER_STRING_SESSION
    }
  });
}