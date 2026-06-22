import {
  ApiKey,
  IApiKeyRepository,
} from '@waha/core/storage/IApiKeyRepository';
import {
  SQLApiKeyMigrations,
  SQLApiKeySchema,
} from '@waha/core/storage/sql/schemas';
import { PsqlKVRepository } from '@waha/core/storage/psql/PsqlKVRepository';
import { PsqlStore } from '@waha/core/storage/psql/PsqlStore';

export class PsqlApiKeyRepository
  extends PsqlKVRepository<ApiKey>
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

  constructor(store: PsqlStore) {
    super(store.knex);
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
    // TODO: Implement
  }
}
