import { ISessionAuthRepository } from '@waha/core/storage/ISessionAuthRepository';
import { PsqlStore } from '@waha/core/storage/psql/PsqlStore';

export class PsqlSessionAuthRepository implements ISessionAuthRepository {
  constructor(private store: PsqlStore) {}

  async init(sessionName?: string): Promise<void> {
    await this.store.init(sessionName);
  }

  async clean(sessionName: string): Promise<void> {
    await this.store.removeDbForSession(sessionName);
  }
}
