import { Field, Index, Schema } from '@waha/core/storage/Schema';
import { Migration } from '@waha/core/storage/sql/SqlKVRepository';

export const SqlAuthSchema = new Schema(
  'auth',
  [new Field('id', 'TEXT'), new Field('data', 'TEXT')],
  [new Index('auth_id_index', ['id'])],
);

export const SqlAuthMigrations: Migration[] = [
  'CREATE TABLE IF NOT EXISTS auth (id TEXT PRIMARY KEY, data TEXT)',
  'CREATE UNIQUE INDEX IF NOT EXISTS auth_id_index ON auth (id)',
];
