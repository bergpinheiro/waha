import { parseBool } from '@waha/helpers';

// Automatically mark session as ONLINE on any messages activity
export const PRESENCE_AUTO_ONLINE = process.env.WAHA_PRESENCE_AUTO_ONLINE
  ? parseBool(process.env.WAHA_PRESENCE_AUTO_ONLINE)
  : true;
// Duration (in seconds) to keep session ONLINE after activity
// Web goes "unavailable" after ~90s of no user activity (60s idle grace + 30s timer)
export const PRESENCE_AUTO_ONLINE_DURATION_SECONDS =
  parseInt(process.env.WAHA_PRESENCE_AUTO_ONLINE_DURATION_SECONDS) || 90;
