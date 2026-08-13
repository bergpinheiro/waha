import { Field, Index, Schema } from '@waha/core/storage/Schema';

/**
 * Contacts kept by WAHA rather than by the library.
 *
 * The library's own contact store is keyed lookup only, so it cannot answer
 * GET /api/contacts/all. Both identities get their own column because the
 * lookups are by jid and by phone number, and the pair is what the BR number
 * resolution needs without a second query.
 */
export const ZapoContactSchema = new Schema(
  'zapo_contacts',
  [
    new Field('id', 'TEXT'),
    new Field('lid', 'TEXT'),
    new Field('phoneNumber', 'TEXT'),
    new Field('data', 'TEXT'),
  ],
  [
    new Index('zapo_contacts_id_index', ['id']),
    new Index('zapo_contacts_phone_index', ['phoneNumber']),
  ],
);
