import { createDecipheriv, hkdfSync } from 'crypto';

/**
 * Decryption of the encrypted addons the library leaves undecrypted.
 *
 * An addon - a reaction, a vote, an edit - is encrypted with a key derived
 * from the parent message secret plus the two people involved: whoever sent
 * the parent, and whoever made the modification. The library resolves the
 * second one as `key.participant ?? key.remoteJid`, which in a 1:1 chat is the
 * person on the other side. That is right for an addon they made and wrong for
 * one we made: an edit performed on the connected phone derives a key from the
 * contact's jid instead of ours, and the payload fails to authenticate.
 *
 * Both reference implementations of this protocol resolve the author the same
 * way, and both special-case `fromMe`:
 *
 *   Baileys      getKeyAuthor()        `key.fromMe ? meId : ...`
 *   whatsmeow    getOrigSenderFromKey() `if key.GetFromMe() { return Sender }`
 *
 * The derivation itself matches the library's byte for byte - HKDF-SHA256 over
 * the same four fields, in the same order - so only the identities differ.
 */

/** The label that goes into the derivation, as whatsmeow names it. */
export const MESSAGE_EDIT_MODIFICATION_TYPE = 'Message Edit';

const DERIVED_KEY_BYTES = 32;
const GCM_TAG_BYTES = 16;
const EMPTY_SALT = Buffer.alloc(0);

/**
 * Who authored a message key. `fromMe` means this account, which is the branch
 * the library omits; the alternates come before the plain fields because a
 * chat addressed by lid reports the other form there.
 */
export function keyAuthor(key: any, meJid: string): string {
  if (key?.fromMe) {
    return meJid;
  }
  return (
    key?.participantAlt ||
    key?.remoteJidAlt ||
    key?.participant ||
    key?.remoteJid ||
    ''
  );
}

export interface AddonDecryptionInput {
  readonly secret: Uint8Array;
  readonly stanzaId: string;
  readonly modificationSender: string;
  /**
   * The parent's sender, in the order to try. WhatsApp is migrating accounts
   * to lid, so the identity an event reports and the one the secret was stored
   * under can disagree; whatsmeow retries the same way, for the same reason.
   */
  readonly parentSenders: readonly string[];
  readonly modificationType: string;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/**
 * Returns the plaintext, or null when no candidate authenticates - which is a
 * wrong key rather than an error, so it is reported and not thrown.
 */
export function decryptAddon(input: AddonDecryptionInput): Buffer | null {
  if (!input.stanzaId || !input.modificationSender || !input.secret?.length) {
    return null;
  }
  for (const parentSender of input.parentSenders) {
    if (!parentSender) {
      continue;
    }
    const key = deriveAddonKey(
      input.secret,
      input.stanzaId,
      parentSender,
      input.modificationSender,
      input.modificationType,
    );
    const plaintext = gcmDecrypt(key, input.iv, input.ciphertext);
    if (plaintext) {
      return plaintext;
    }
  }
  return null;
}

/**
 * HKDF-SHA256 with an empty salt over the four fields concatenated - the same
 * shape as the library's own `createUseCaseSecret` and whatsmeow's
 * `generateMsgSecretKey`.
 */
export function deriveAddonKey(
  secret: Uint8Array,
  stanzaId: string,
  parentSender: string,
  modificationSender: string,
  modificationType: string,
): Buffer {
  const info = Buffer.from(
    stanzaId + parentSender + modificationSender + modificationType,
  );
  return Buffer.from(
    hkdfSync('sha256', secret, EMPTY_SALT, info, DERIVED_KEY_BYTES),
  );
}

/**
 * The tag is the trailer of the ciphertext, the way WhatsApp ships it. A tag
 * mismatch is the expected outcome of a wrong key, so it answers null.
 *
 * `Message Edit` carries no additional data: whatsmeow only builds it for
 * `Poll Vote` and `Event Response`.
 */
function gcmDecrypt(
  key: Buffer,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Buffer | null {
  if (ciphertext.length <= GCM_TAG_BYTES) {
    return null;
  }
  const tagOffset = ciphertext.length - GCM_TAG_BYTES;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(ciphertext.subarray(tagOffset));
    return Buffer.concat([
      decipher.update(ciphertext.subarray(0, tagOffset)),
      decipher.final(),
    ]);
  } catch {
    return null;
  }
}
