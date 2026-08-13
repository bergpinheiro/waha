import {
  parseMessageIdSerialized,
  SerializeMessageKey,
} from '@waha/core/utils/ids';
import { normalizeJid, toCusFormat, toJID } from '@waha/core/utils/jids';
import { ChannelRole, ChannelRoleFilter } from '@waha/structures/channels.dto';
import { WAHAPresenceStatus, WAMessageAck } from '@waha/structures/enums.dto';
import { GroupParticipantRole } from '@waha/structures/groups.dto';
import type { WaGroupParticipant, WaMessageKey } from 'zapo-js';

/**
 * Pure translations between the library's shapes and WAHA's.
 *
 * They live apart from the session so they can be tested without loading the
 * engine, which pulls in the ESM protobuf bridge.
 */

/** zapo viewer roles mapped onto WAHA's channel roles. */
export const ZAPO_CHANNEL_ROLE = {
  owner: ChannelRole.OWNER,
  admin: ChannelRole.ADMIN,
  subscriber: ChannelRole.SUBSCRIBER,
  guest: ChannelRole.GUEST,
};

/** Chat-scoped presences map onto chatstates; the rest are account-wide. */
export const WAHA_PRESENCE_TO_CHATSTATE = {
  [WAHAPresenceStatus.TYPING]: 'composing',
  [WAHAPresenceStatus.RECORDING]: 'recording',
  [WAHAPresenceStatus.PAUSED]: 'paused',
};

/** zapo receipt statuses mapped onto WAHA's numeric ack ladder. */
/**
 * Keyed by the four values WaReceiptStatus actually carries. An invented key
 * silently degrades every receipt to SERVER, so this list must not drift from
 * the library's type.
 */
export const ZAPO_RECEIPT_TO_ACK = {
  delivered: WAMessageAck.DEVICE,
  read: WAMessageAck.READ,
  played: WAMessageAck.PLAYED,
  inactive: WAMessageAck.SERVER,
};

/** The participant carries two admin flags rather than a single rank. */
export function toParticipantRole(
  participant: WaGroupParticipant,
): GroupParticipantRole {
  if (participant.isSuperAdmin) {
    return GroupParticipantRole.SUPERADMIN;
  }
  if (participant.isAdmin) {
    return GroupParticipantRole.ADMIN;
  }
  return GroupParticipantRole.PARTICIPANT;
}

/**
 * WAHA's parsed key has every field optional; zapo requires remoteJid, id and
 * fromMe, so the shape is restated instead of cast.
 */
export function toZapoKey(messageId: string, chatId?: string): WaMessageKey {
  // A bare id with no chat part is a documented input ("or just ID"), so the
  // parser is asked not to throw on it and the chat is taken from the route.
  const key = parseMessageIdSerialized(messageId, true);
  return {
    remoteJid: key.remoteJid ?? toJID(chatId),
    id: key.id,
    fromMe: Boolean(key.fromMe),
    participant: key.participant,
  };
}

/**
 * The documented id format uses the customer-facing chat id, which is what
 * every other engine emits and what the API accepts back.
 */
export function buildMessageId(key: any): string {
  return SerializeMessageKey({
    id: key.id,
    fromMe: key.fromMe,
    remoteJid: toCusFormat(key.remoteJid),
    participant: key.participant
      ? toCusFormat(normalizeJid(key.participant))
      : undefined,
  });
}

/** WhatsApp stores the status background as a signed ARGB int, not a hex string. */
export function hexColorToArgb(color?: string): number | undefined {
  if (!color) {
    return undefined;
  }
  const hex = color.replace('#', '');
  if (hex.length !== 6) {
    return undefined;
  }
  return (0xff000000 | parseInt(hex, 16)) >>> 0;
}

/**
 * ChannelRoleFilter is a narrower enum over the same string values, so the
 * comparison is done on those rather than across the two enum types.
 */
export function matchesChannelRole(
  role: ChannelRole,
  filter?: ChannelRoleFilter,
): boolean {
  if (!filter) {
    return true;
  }
  return String(role) === String(filter);
}
