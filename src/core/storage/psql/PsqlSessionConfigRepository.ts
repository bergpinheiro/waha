import { ISessionConfigRepository } from '@waha/core/storage/ISessionConfigRepository';
import {
  SQLSessionConfigMigrations,
  SQLSessionConfigSchema,
} from '@waha/core/storage/sql/schemas';
import { PsqlKVRepository } from '@waha/core/storage/psql/PsqlKVRepository';
import { PsqlStore } from '@waha/core/storage/psql/PsqlStore';
import { SessionConfig } from '@waha/structures/sessions.dto';

class SessionConfigInfo {
  id: string;
  config?: SessionConfig;
}

export class PsqlSessionConfigRepository
  extends PsqlKVRepository<SessionConfigInfo>
  implements ISessionConfigRepository
{
  constructor(store: PsqlStore) {
    super(store.knex);
  }

  get schema() {
    return SQLSessionConfigSchema;
  }

  get migrations() {
    return SQLSessionConfigMigrations;
  }

  saveConfig(sessionName: string, config: SessionConfig): Promise<void> {
    return this.upsertOne({ id: sessionName, config: config });
  }

  async getConfig(sessionName: string): Promise<SessionConfig | null> {
    const data = await this.getById(sessionName);
    return data?.config ?? null;
  }

  async getConfigBySessions(
    sessionNames: string[],
  ): Promise<Map<string, SessionConfig | null>> {
    const result = new Map<string, SessionConfig | null>();
    const uniqueNames = Array.from(new Set(sessionNames));
    if (uniqueNames.length === 0) {
      return result;
    }
    const entities = await this.getEntitiesByIds(uniqueNames);
    for (const sessionName of uniqueNames) {
      const entity = entities.get(sessionName);
      result.set(sessionName, entity?.config ?? null);
    }
    return result;
  }

  async exists(sessionName: string): Promise<boolean> {
    const data = await this.getById(sessionName);
    return data !== null;
  }

  async deleteConfig(sessionName: string): Promise<void> {
    return this.deleteById(sessionName);
  }

  async getAllConfigs(): Promise<string[]> {
    const configs = await this.getAll();
    return configs.map((config) => config.id);
  }

  protected async validateSchema() {
    // TODO: Implement
  }
}
