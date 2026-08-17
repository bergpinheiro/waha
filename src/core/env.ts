import { parseBool } from '@waha/helpers';

//
// Presence
//

// Automatically mark session as ONLINE on any messages activity
export const PRESENCE_AUTO_ONLINE = process.env.WAHA_PRESENCE_AUTO_ONLINE
  ? parseBool(process.env.WAHA_PRESENCE_AUTO_ONLINE)
  : true;

// Duration (in seconds) to keep session ONLINE after activity
// 25 seconds is default web timeout with no activity
export const PRESENCE_AUTO_ONLINE_DURATION_SECONDS =
  parseInt(process.env.WAHA_PRESENCE_AUTO_ONLINE_DURATION_SECONDS) || 25;

//
// Local - sqlite3 engine
//
let KNEX_SQLITE_CLIENT = process.env.WAHA_SQLITE_ENGINE;
if (KNEX_SQLITE_CLIENT != 'sqlite3' && KNEX_SQLITE_CLIENT != 'better-sqlite3') {
  KNEX_SQLITE_CLIENT = 'sqlite3';
}
export { KNEX_SQLITE_CLIENT };

//
// Client config
//
export const WAHA_CLIENT_DEVICE_NAME =
  process.env.WAHA_CLIENT_DEVICE_NAME || null;
export const WAHA_CLIENT_BROWSER_NAME =
  process.env.WAHA_CLIENT_BROWSER_NAME || null;

//
// Brazil phone normalization (send lookup)
//
// Single switch. When enabled, the engine validates and resolves Brazilian
// mobile numbers on send (9th-digit ambiguity) using a fixed strategy:
// syntax check -> in-memory cache -> local contact store -> WhatsApp lookup.
// Everything else (DDD range, cache TTLs) is fixed in code; only the behavior
// for a confirmed-nonexistent number is tunable via WAHA_BR_PHONE_STRICT.
export const BR_PHONE_NORMALIZE = process.env.WAHA_BR_PHONE_NORMALIZE
  ? parseBool(process.env.WAHA_BR_PHONE_NORMALIZE)
  : false;

// When a Brazilian mobile is confirmed NOT to exist on WhatsApp:
// false (default) = soft (warn and send the best-guess anyway);
// true = strict (reject the send with 422). Strict trades delivery for
// certainty and can block valid sends on usync false-negatives (throttling),
// so it is opt-in.
export const BR_PHONE_STRICT = process.env.WAHA_BR_PHONE_STRICT
  ? parseBool(process.env.WAHA_BR_PHONE_STRICT)
  : false;
