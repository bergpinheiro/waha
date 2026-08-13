import {
  parseMessageIdSerialized,
  SerializeMessageKey,
} from '@waha/core/utils/ids';
import { normalizeJid, toCusFormat, toJID } from '@waha/core/utils/jids';
import { ChannelRole, ChannelRoleFilter } from '@waha/structures/channels.dto';
import { WAHAPresenceStatus, WAMessageAck } from '@waha/structures/enums.dto';
import { GroupParticipantRole } from '@waha/structures/groups.dto';
import { unwrapMessage } from 'zapo-js';
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

/**
 * Contents WAHA surfaces through an event of their own rather than as a
 * message. Letting one through turns a reaction, a vote or an edit into an
 * empty-bodied `message` webhook and pushes the chat up the list.
 *
 * `secretEncryptedMessage` is the envelope of an encrypted addon on an
 * arbitrary parent - an edit made on the phone arrives like this. When the
 * library cannot decrypt it, no addon event is emitted at all; the envelope
 * still has to be dropped, because it never carries a body either.
 *
 * The library's own unwrapper runs first so a stanza wrapped in ephemeral or
 * view-once is judged by what it actually carries.
 */
export function hasDedicatedEvent(message: any): boolean {
  const content: any = message && unwrapMessage(message);
  if (!content) {
    return false;
  }
  return Boolean(
    content.reactionMessage ||
      content.pollUpdateMessage ||
      content.encEventResponseMessage ||
      content.protocolMessage ||
      content.secretEncryptedMessage,
  );
}

/** The account-wide presences, which the protocol names differently. */
const ZAPO_PRESENCE_TO_WAHA: Record<string, WAHAPresenceStatus> = {
  available: WAHAPresenceStatus.ONLINE,
  unavailable: WAHAPresenceStatus.OFFLINE,
};

/**
 * The presence an event reports, in WAHA's own vocabulary.
 *
 * A chatstate arrives as the wire value - `composing` or `paused`, with
 * `media: 'audio'` telling a voice note apart from typing - and none of those
 * are what WAHAPresenceStatus calls them. Reported raw, a consumer comparing
 * against TYPING never matches. Mirrors how GOWS reads the pair.
 */
export function toPresenceStatus(event: any): WAHAPresenceStatus {
  if (event?.state === 'composing') {
    return event.media === 'audio'
      ? WAHAPresenceStatus.RECORDING
      : WAHAPresenceStatus.TYPING;
  }
  if (event?.state === 'paused') {
    return WAHAPresenceStatus.PAUSED;
  }
  return ZAPO_PRESENCE_TO_WAHA[event?.type] ?? WAHAPresenceStatus.OFFLINE;
}

/**
 * The id of the message an event points at, seen from this account.
 *
 * A message key is written from the perspective of whoever holds it, so the
 * target of an addon someone else sent is addressed from their side: in a 1:1
 * chat its `remoteJid` is us, and its `fromMe` says whether *they* wrote the
 * message. Read back as-is that names a chat that does not exist here and
 * reverses the authorship, so when the target is addressed to us the chat
 * comes from the event and the direction is inverted.
 *
 * In a group the target already names the group, which is never one of our
 * identities, so it is read unchanged.
 */
export function toTargetMessageId(
  eventKey: any,
  target: any,
  ourChatIds: readonly string[],
): string {
  const targetChat = target?.remoteJid ? toCusFormat(target.remoteJid) : null;
  const addressedToUs = Boolean(targetChat && ourChatIds.includes(targetChat));
  return buildMessageId({
    id: target?.id,
    fromMe: addressedToUs ? !target.fromMe : Boolean(target?.fromMe),
    remoteJid: eventKey?.remoteJid ?? target?.remoteJid,
    participant: target?.participant,
  });
}
