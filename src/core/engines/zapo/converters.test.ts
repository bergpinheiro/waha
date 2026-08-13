import {
  buildMessageId,
  hexColorToArgb,
  matchesChannelRole,
  toParticipantRole,
  toZapoKey,
  WAHA_PRESENCE_TO_CHATSTATE,
  ZAPO_CHANNEL_ROLE,
  ZAPO_RECEIPT_TO_ACK,
} from '@waha/core/engines/zapo/converters';
import { ChannelRole, ChannelRoleFilter } from '@waha/structures/channels.dto';
import { WAHAPresenceStatus, WAMessageAck } from '@waha/structures/enums.dto';
import { GroupParticipantRole } from '@waha/structures/groups.dto';

describe('ZAPO converters', () => {
  describe('buildMessageId', () => {
    it('serializes an incoming key into the WAHA id', () => {
      const id = buildMessageId({
        id: 'AAA',
        fromMe: false,
        remoteJid: '11111111111@s.whatsapp.net',
      });
      expect(id).toEqual('false_11111111111@s.whatsapp.net_AAA');
    });

    it('keeps the participant for group messages', () => {
      const id = buildMessageId({
        id: 'BBB',
        fromMe: true,
        remoteJid: '123@g.us',
        participant: '22222222222@s.whatsapp.net',
      });
      expect(id).toEqual('true_123@g.us_BBB_22222222222@s.whatsapp.net');
    });
  });

  describe('toZapoKey', () => {
    it('fills the three fields the library requires', () => {
      const key = toZapoKey('false_11111111111@c.us_AAA');
      expect(key).toEqual({
        remoteJid: '11111111111@s.whatsapp.net',
        id: 'AAA',
        fromMe: false,
        participant: undefined,
      });
    });

    it('falls back to the chat id when the message id carries none', () => {
      const key = toZapoKey('AAA', '11111111111@c.us');
      expect(key.remoteJid).toEqual('11111111111@s.whatsapp.net');
      expect(key.id).toEqual('AAA');
      // fromMe must be a boolean, never undefined - the library requires it
      expect(key.fromMe).toBe(false);
    });

    it('round-trips with buildMessageId', () => {
      const original = 'true_123@g.us_CCC_22222222222@s.whatsapp.net';
      expect(buildMessageId(toZapoKey(original))).toEqual(original);
    });
  });

  describe('toParticipantRole', () => {
    it('reads superadmin from the pair of flags', () => {
      const role = toParticipantRole({
        isSuperAdmin: true,
        isAdmin: true,
      } as any);
      expect(role).toEqual(GroupParticipantRole.SUPERADMIN);
    });

    it('reads admin', () => {
      const role = toParticipantRole({
        isSuperAdmin: false,
        isAdmin: true,
      } as any);
      expect(role).toEqual(GroupParticipantRole.ADMIN);
    });

    it('defaults to participant', () => {
      const role = toParticipantRole({
        isSuperAdmin: false,
        isAdmin: false,
      } as any);
      expect(role).toEqual(GroupParticipantRole.PARTICIPANT);
    });
  });

  describe('hexColorToArgb', () => {
    it('converts a hex color to the signed ARGB int', () => {
      expect(hexColorToArgb('#38b42f')).toEqual(0xff38b42f);
    });

    it('accepts a color without the hash', () => {
      expect(hexColorToArgb('38b42f')).toEqual(0xff38b42f);
    });

    it('returns undefined for an empty or malformed color', () => {
      expect(hexColorToArgb(undefined)).toBeUndefined();
      expect(hexColorToArgb('#fff')).toBeUndefined();
    });
  });

  describe('receipt to ack', () => {
    it('maps delivery to DEVICE, not SERVER', () => {
      expect(ZAPO_RECEIPT_TO_ACK['delivery']).toEqual(WAMessageAck.DEVICE);
    });

    it('treats a self read like a read', () => {
      expect(ZAPO_RECEIPT_TO_ACK['read-self']).toEqual(WAMessageAck.READ);
      expect(ZAPO_RECEIPT_TO_ACK['read']).toEqual(WAMessageAck.READ);
    });

    it('covers the whole ack ladder', () => {
      const acks = new Set(Object.values(ZAPO_RECEIPT_TO_ACK));
      expect(acks).toContain(WAMessageAck.ERROR);
      expect(acks).toContain(WAMessageAck.PENDING);
      expect(acks).toContain(WAMessageAck.SERVER);
      expect(acks).toContain(WAMessageAck.DEVICE);
      expect(acks).toContain(WAMessageAck.READ);
      expect(acks).toContain(WAMessageAck.PLAYED);
    });
  });

  describe('presence', () => {
    it('maps only the chat-scoped presences', () => {
      expect(WAHA_PRESENCE_TO_CHATSTATE[WAHAPresenceStatus.TYPING]).toEqual(
        'composing',
      );
      expect(WAHA_PRESENCE_TO_CHATSTATE[WAHAPresenceStatus.RECORDING]).toEqual(
        'recording',
      );
      // online/offline are account-wide and must not resolve to a chatstate
      expect(
        WAHA_PRESENCE_TO_CHATSTATE[WAHAPresenceStatus.ONLINE],
      ).toBeUndefined();
      expect(
        WAHA_PRESENCE_TO_CHATSTATE[WAHAPresenceStatus.OFFLINE],
      ).toBeUndefined();
    });
  });

  describe('channel role', () => {
    it('maps the viewer roles', () => {
      expect(ZAPO_CHANNEL_ROLE['owner']).toEqual(ChannelRole.OWNER);
      expect(ZAPO_CHANNEL_ROLE['subscriber']).toEqual(ChannelRole.SUBSCRIBER);
    });

    it('matches across the two enums and passes everything with no filter', () => {
      expect(
        matchesChannelRole(ChannelRole.OWNER, ChannelRoleFilter.OWNER),
      ).toBe(true);
      expect(
        matchesChannelRole(ChannelRole.GUEST, ChannelRoleFilter.OWNER),
      ).toBe(false);
      expect(matchesChannelRole(ChannelRole.GUEST, undefined)).toBe(true);
    });
  });
});
