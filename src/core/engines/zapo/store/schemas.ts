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

/**
 * The repository base only runs the statements listed here - it does not
 * derive DDL from the schema - so the table has to be declared explicitly,
 * the same way the NOWEB store declares its own.
 *
 * Quoted "phoneNumber" keeps the camel case on Postgres, which folds unquoted
 * identifiers to lower case. Every statement is idempotent.
 */
export const ZapoMigrations: string[] = [
  'CREATE TABLE IF NOT EXISTS zapo_contacts (id TEXT PRIMARY KEY, lid TEXT, "phoneNumber" TEXT, data TEXT)',
  'CREATE UNIQUE INDEX IF NOT EXISTS zapo_contacts_id_index ON zapo_contacts (id)',
  'CREATE INDEX IF NOT EXISTS zapo_contacts_phone_index ON zapo_contacts ("phoneNumber")',
];
