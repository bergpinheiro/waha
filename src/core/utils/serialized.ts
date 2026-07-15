/**
 * Serialized-ID helpers for the WEBJS engine.
 *
 * COPIED from whatsapp-web.js `src/util/Serialized.js` (fork: ../whatsapp-web.js).
 * Keep this file in sync with that upstream version whenever it changes.
 *
 * WhatsApp Web renamed the `_serialized` property on its ID objects (Wid /
 * MsgKey) to a minified name (`$1`) in the 2026-07 update. Rather than depend on
 * that unstable minified name, each helper reconstructs the serialized string
 * deterministically from the object's own component keys - existing
 * `_serialized` -> reconstruct from keys - and caches it back onto the object as
 * `_serialized` so later reads keep working.
 */

interface CacheHit {
  done: boolean;
  value: string | null;
}

function cached(id: any): CacheHit {
  if (id == null) {
    return { done: true, value: id };
  }
  if (typeof id === 'string') {
    return { done: true, value: id };
  }
  if (typeof id._serialized === 'string' && id._serialized !== '') {
    return { done: true, value: id._serialized };
  }
  return { done: false, value: null };
}

/**
 * Serializes a Wid (WhatsApp ID): `user[:device]@server`.
 */
export function GetSerializedWid(id: any): string | null {
  const hit = cached(id);
  if (hit.done) {
    return hit.value;
  }

  let value: string | null;
  if (id.user != null && id.server != null) {
    value =
      id.user === 'call'
        ? 'call'
        : `${id.user}${id.device ? `:${id.device}` : ''}@${id.server}`;
  } else {
    value = null;
  }

  if (value != null) {
    id._serialized = value;
  }
  return value;
}

/**
 * Serializes a MsgKey (message ID): `fromMe_remote_id[_self][_participant]`.
 */
export function GetSerializedMsgKey(id: any): string | null {
  const hit = cached(id);
  if (hit.done) {
    return hit.value;
  }

  let value: string | null;
  if (id.remote != null && id.id != null) {
    const remote = GetSerializedWid(id.remote);
    const participant =
      id.participant != null ? GetSerializedWid(id.participant) : null;
    value =
      `${id.fromMe ? 'true' : 'false'}_${remote}_${id.id}` +
      (id.self ? `_${id.self}` : '') +
      (participant ? `_${participant}` : '');
  } else {
    value = null;
  }

  if (value != null) {
    id._serialized = value;
  }
  return value;
}

/**
 * Generic entry point: resolves `_serialized`/`$1` then dispatches to the Wid
 * or MsgKey helper based on the object's shape. Use the specific helpers when
 * the id type is known.
 */
export function GetSerialized(id: any): string | null {
  const hit = cached(id);
  if (hit.done) {
    return hit.value;
  }
  if (id.remote != null && id.id != null) {
    return GetSerializedMsgKey(id);
  }
  if (id.user != null && id.server != null) {
    return GetSerializedWid(id);
  }
  return null;
}
