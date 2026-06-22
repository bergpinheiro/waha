import { ISessionMeRepository } from '@waha/core/storage/ISessionMeRepository';
import { SQLMeMigrations, SQLMeSchema } from '@waha/core/storage/sql/schemas';
import { PsqlKVRepository } from '@waha/core/storage/psql/PsqlKVRepository';
import { PsqlStore } from '@waha/core/storage/psql/PsqlStore';
import { MeInfo } from '@waha/structures/sessions.dto';

class SessionMeInfo {
  id: string;
  me?: MeInfo;
}

export class PsqlSessionMeRepository
  extends PsqlKVRepository<SessionMeInfo>
  implements ISessionMeRepository
{
  constructor(store: PsqlStore) {
    super(store.knex);
  }

  get schema() {
    return SQLMeSchema;
  }

  get migrations() {
    return SQLMeMigrations;
  }

  upsertMe(sessionName: string, me: MeInfo): Promise<void> {
    return this.upsertOne({ id: sessionName, me: me });
  }

  async getMe(sessionName: string): Promise<MeInfo | null> {
    const data = await this.getById(sessionName);
    return data?.me;
  }

  async getMeBySessions(
    sessionNames: string[],
  ): Promise<Map<string, MeInfo | null>> {
    const result = new Map<string, MeInfo | null>();
    const uniqueNames = Array.from(new Set(sessionNames));
    if (uniqueNames.length === 0) {
      return result;
    }
    const entities = await this.getEntitiesByIds(uniqueNames);
    for (const sessionName of uniqueNames) {
      const entity = entities.get(sessionName);
      result.set(sessionName, entity?.me ?? null);
    }
    return result;
  }

  removeMe(sessionName: string): Promise<void> {
    return this.deleteById(sessionName);
  }

  protected async validateSchema() {
    // TODO: Implement
  }
}
