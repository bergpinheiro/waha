import { aesGcmDecrypt, hkdf, sha256 } from 'zapo-js/crypto';

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
 *
 * The primitives come from the library's own `crypto` subpath, so the key
 * this derives and the tag it checks cannot drift from the ones the library
 * derives and checks on its own path. See zapo-subpaths.d.ts for how that
 * import type-checks here.
 */

/** The labels that go into the derivation, as whatsmeow names them. */
export const MESSAGE_EDIT_MODIFICATION_TYPE = 'Message Edit';
export const POLL_VOTE_MODIFICATION_TYPE = 'Poll Vote';

const DERIVED_KEY_BYTES = 32;

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
  /**
   * Who made the modification, in the forms to try. It is bound into the
   * additional data as well, so the pair has to be built per candidate.
   */
  readonly modificationSenders: readonly string[];
  /**
   * The parent's sender, in the order to try. WhatsApp is migrating accounts
   * to lid, so the identity an event reports and the one the secret was stored
   * under can disagree; whatsmeow retries the same way, for the same reason.
   */
  readonly parentSenders: readonly string[];
  readonly modificationType: string;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
  /**
   * Whether the tag binds additional data. whatsmeow builds it only for a poll
   * vote and an event response; an edit carries none.
   */
  readonly withAdditionalData?: boolean;
}

export interface AddonDecryption {
  readonly plaintext: Buffer;
  /** The pair that authenticated, which is worth knowing: it says which of
   * the identities in play the sender actually derived from. */
  readonly parentSender: string;
  readonly modificationSender: string;
}

/**
 * Returns the plaintext and the pair it was derived from, or null when no
 * candidate authenticates - a wrong key rather than an error, so it is
 * reported and not thrown.
 */
export function decryptAddon(input: AddonDecryptionInput): AddonDecryption | null {
  if (!input.stanzaId || !input.secret?.length) {
    return null;
  }
  for (const modificationSender of dedupe(input.modificationSenders)) {
    // The additional data binds the same sender the key was derived from, so
    // it is rebuilt for each candidate rather than passed in.
    const additionalData = input.withAdditionalData
      ? buildAddonAdditionalData(input.stanzaId, modificationSender)
      : undefined;
    for (const parentSender of dedupe(input.parentSenders)) {
      const key = deriveAddonKey(
        input.secret,
        input.stanzaId,
        parentSender,
        modificationSender,
        input.modificationType,
      );
      const plaintext = gcmDecrypt(
        key,
        input.iv,
        input.ciphertext,
        additionalData,
      );
      if (plaintext) {
        return {
          plaintext: plaintext,
          parentSender: parentSender,
          modificationSender: modificationSender,
        };
      }
    }
  }
  return null;
}

/** The candidates worth trying: non-empty, each one once, order kept. */
function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
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
): Uint8Array {
  const info = Buffer.from(
    stanzaId + parentSender + modificationSender + modificationType,
  );
  return hkdf(secret, null, info, DERIVED_KEY_BYTES);
}

/**
 * A tag mismatch is the expected outcome of a wrong key rather than an error,
 * so it answers null. The library's primitive reads the tag off the trailer of
 * the ciphertext, which is how WhatsApp ships it.
 */
function gcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  additionalData?: Uint8Array,
): Buffer | null {
  try {
    return Buffer.from(aesGcmDecrypt(key, iv, ciphertext, additionalData));
  } catch {
    return null;
  }
}

/**
 * The additional data a poll vote binds into its tag: the two fields joined
 * by a NUL, the way whatsmeow builds it.
 */
export function buildAddonAdditionalData(
  stanzaId: string,
  modificationSender: string,
): Buffer {
  return Buffer.from(`${stanzaId}\u0000${modificationSender}`);
}

/**
 * A vote names the options it picked by the SHA-256 of the option name, so the
 * poll's own options are hashed to read them back.
 *
 * One unmatched option answers null for the whole vote rather than a partial
 * list, the way the library resolves it: a half-read vote reported as a good
 * one is worse than one reported as failed.
 */
export function toSelectedOptionNames(
  selectedOptions: readonly Uint8Array[],
  optionNames: readonly string[],
): string[] | null {
  const byHash = new Map<string, string>();
  for (const name of optionNames) {
    if (name) {
      byHash.set(toHex(sha256(Buffer.from(name))), name);
    }
  }
  const names: string[] = [];
  for (const option of selectedOptions) {
    const name = byHash.get(toHex(option));
    if (!name) {
      return null;
    }
    names.push(name);
  }
  return names;
}

/**
 * Strips the device suffix from a jid. whatsmeow derives from the non-AD form
 * (`ToNonAD`), while the secret this engine reads back was stored with the
 * device on it, so both forms are tried.
 */
export function toNonAdJid(jid: string): string {
  if (!jid) {
    return '';
  }
  const [user, server] = jid.split('@');
  return server ? `${user.split(':')[0]}@${server}` : jid;
}

/** Hex, for comparing an option hash with the ones the poll produces. */
function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}
