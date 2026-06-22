import {
  ISessionWorkerRepository,
  SessionWorkerInfo,
} from '@waha/core/storage/ISessionWorkerRepository';
import {
  SQLSessionWorkerMigrations,
  SQLSessionWorkerSchema,
} from '@waha/core/storage/sql/schemas';
import { PsqlKVRepository } from '@waha/core/storage/psql/PsqlKVRepository';
import { PsqlStore } from '@waha/core/storage/psql/PsqlStore';

export class PsqlSessionWorkerRepository
  extends PsqlKVRepository<SessionWorkerInfo>
  implements ISessionWorkerRepository
{
  get schema() {
    return SQLSessionWorkerSchema;
  }

  get migrations() {
    return SQLSessionWorkerMigrations;
  }

  constructor(store: PsqlStore) {
    super(store.knex);
  }

  assign(session: string, worker: string): Promise<void> {
    return this.upsertOne({ id: session, worker: worker });
  }

  unassign(session: string, worker: string): Promise<void> {
    return this.deleteBy({ id: session, worker: worker });
  }

  remove(session: string) {
    return this.deleteById(session);
  }

  async getSessionsByWorker(worker: string): Promise<string[]> {
    const data = await this.getAllBy({ worker: worker });
    return data.map((d) => d.id);
  }

  protected async validateSchema() {
    // TODO: Implement
  }
}
