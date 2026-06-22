import { Sqlite3SchemaValidation } from '@waha/core/engines/noweb/store/sqlite3/Sqlite3SchemaValidation';
import {
  IApiKeyRepository,
  ApiKey,
} from '@waha/core/storage/IApiKeyRepository';
import { LocalStore } from '@waha/core/storage/LocalStore';
import {
  SQLApiKeyMigrations,
  SQLApiKeySchema,
} from '@waha/core/storage/sql/schemas';
import { Sqlite3KVRepository } from '@waha/core/storage/sqlite3/Sqlite3KVRepository';

export class Sqlite3ApiKeyRepository
  extends Sqlite3KVRepository<ApiKey>
  implements IApiKeyRepository
{
  get schema() {
    return SQLApiKeySchema;
  }

  get migrations() {
    return SQLApiKeyMigrations;
  }

  get metadata() {
    return new Map<string, (entity: ApiKey) => any>([
      ['key', (entity) => entity.key],
      ['isActive', (entity) => (entity.isActive ? 1 : 0)],
      ['session', (entity) => entity.session],
    ]);
  }

  constructor(store: LocalStore) {
    const knex = store.getWAHADatabase();
    super(knex);
  }

  list(): Promise<ApiKey[]> {
    return this.getAll();
  }

  async upsert(key: ApiKey): Promise<ApiKey> {
    await this.upsertOne(key);
    return key;
  }

  getActiveByKey(key: string): Promise<ApiKey | null> {
    return this.getBy({ key: key, isActive: 1 });
  }

  getById(id: string): Promise<ApiKey | null> {
    return super.getById(id);
  }

  getByKey(key: string): Promise<ApiKey | null> {
    return this.getBy({ key: key });
  }

  async deleteBySession(session: string): Promise<void> {
    await this.deleteBy({ session: session });
  }

  protected async validateSchema() {
    const validation = new Sqlite3SchemaValidation(this.schema, this.knex);
    await validation.validate();
  }
}
