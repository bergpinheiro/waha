import {
  decryptAddon,
  deriveAddonKey,
  keyAuthor,
  MESSAGE_EDIT_MODIFICATION_TYPE,
} from '@waha/core/engines/zapo/addon-crypto';
import { createCipheriv, randomBytes } from 'crypto';

const ME = '558540423147@s.whatsapp.net';
const ME_LID = '72318944542853@lid';
const PEER = '558591203123@s.whatsapp.net';
const STANZA = 'A59B4EEA28AF8973AD5D48791F6F23FC';

/**
 * Encrypts the way WhatsApp ships an addon - key derived from the parent
 * secret and the two identities, tag appended to the ciphertext - so the
 * tests exercise the real derivation rather than a stub.
 */
function encrypt(
  secret: Uint8Array,
  parentSender: string,
  modificationSender: string,
  plaintext: Buffer,
): { iv: Buffer; ciphertext: Buffer } {
  const key = deriveAddonKey(
    secret,
    STANZA,
    parentSender,
    modificationSender,
    MESSAGE_EDIT_MODIFICATION_TYPE,
  );
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: iv, ciphertext: Buffer.concat([body, cipher.getAuthTag()]) };
}

describe('ZAPO addon crypto', () => {
  describe('keyAuthor', () => {
    // The branch the library omits, which is the whole defect: an addon of
    // ours is authored by us, not by whoever is on the other side.
    it('answers this account for an addon of ours', () => {
      expect(keyAuthor({ fromMe: true, remoteJid: PEER }, ME_LID)).toEqual(
        ME_LID,
      );
    });

    it('answers the sender for an addon of theirs', () => {
      expect(keyAuthor({ fromMe: false, remoteJid: PEER }, ME_LID)).toEqual(
        PEER,
      );
    });

    it('prefers the participant in a group', () => {
      const key = { fromMe: false, remoteJid: '123@g.us', participant: PEER };
      expect(keyAuthor(key, ME_LID)).toEqual(PEER);
    });

    it('prefers the alternate identity a lid chat reports', () => {
      const key = { fromMe: false, remoteJid: PEER, remoteJidAlt: ME_LID };
      expect(keyAuthor(key, ME)).toEqual(ME_LID);
    });
  });

  describe('decryptAddon', () => {
    const secret = randomBytes(32);
    const plaintext = Buffer.from('a mensagem editada');

    it('decrypts an edit this account made', () => {
      const { iv, ciphertext } = encrypt(secret, ME_LID, ME_LID, plaintext);
      const decrypted = decryptAddon({
        secret: secret,
        stanzaId: STANZA,
        modificationSender: ME_LID,
        parentSenders: [ME_LID],
        modificationType: MESSAGE_EDIT_MODIFICATION_TYPE,
        iv: iv,
        ciphertext: ciphertext,
      });
      expect(decrypted?.toString()).toEqual('a mensagem editada');
    });

    // What the library does today: it derives from the chat jid rather than
    // the author, and the payload does not authenticate.
    it('refuses the contact jid as the author of our own edit', () => {
      const { iv, ciphertext } = encrypt(secret, ME_LID, ME_LID, plaintext);
      const decrypted = decryptAddon({
        secret: secret,
        stanzaId: STANZA,
        modificationSender: PEER,
        parentSenders: [ME_LID],
        modificationType: MESSAGE_EDIT_MODIFICATION_TYPE,
        iv: iv,
        ciphertext: ciphertext,
      });
      expect(decrypted).toBeNull();
    });

    // An account mid-migration reports either identity, so the parent sender
    // is tried in both forms - the same retry whatsmeow carries.
    it('falls back to the other identity of this account', () => {
      const { iv, ciphertext } = encrypt(secret, ME, ME_LID, plaintext);
      const decrypted = decryptAddon({
        secret: secret,
        stanzaId: STANZA,
        modificationSender: ME_LID,
        parentSenders: [ME_LID, ME],
        modificationType: MESSAGE_EDIT_MODIFICATION_TYPE,
        iv: iv,
        ciphertext: ciphertext,
      });
      expect(decrypted?.toString()).toEqual('a mensagem editada');
    });

    it('answers null when no candidate authenticates', () => {
      const { iv, ciphertext } = encrypt(secret, ME_LID, ME_LID, plaintext);
      const decrypted = decryptAddon({
        secret: secret,
        stanzaId: STANZA,
        modificationSender: ME_LID,
        parentSenders: [PEER],
        modificationType: MESSAGE_EDIT_MODIFICATION_TYPE,
        iv: iv,
        ciphertext: ciphertext,
      });
      expect(decrypted).toBeNull();
    });

    it('answers null rather than throwing on a truncated payload', () => {
      const decrypted = decryptAddon({
        secret: secret,
        stanzaId: STANZA,
        modificationSender: ME_LID,
        parentSenders: [ME_LID],
        modificationType: MESSAGE_EDIT_MODIFICATION_TYPE,
        iv: randomBytes(12),
        ciphertext: randomBytes(8),
      });
      expect(decrypted).toBeNull();
    });
  });

  describe('deriveAddonKey', () => {
    // The four fields concatenated in this order is what the library and
    // whatsmeow both feed to HKDF; a different order silently derives a key
    // that never authenticates.
    it('depends on every field of the derivation', () => {
      const secret = randomBytes(32);
      const base = deriveAddonKey(secret, STANZA, ME, PEER, 'Message Edit');
      expect(
        deriveAddonKey(secret, 'other', ME, PEER, 'Message Edit'),
      ).not.toEqual(base);
      expect(
        deriveAddonKey(secret, STANZA, PEER, ME, 'Message Edit'),
      ).not.toEqual(base);
      expect(
        deriveAddonKey(secret, STANZA, ME, PEER, 'Enc Reaction'),
      ).not.toEqual(base);
      expect(base).toHaveLength(32);
    });
  });
});
