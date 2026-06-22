import { ISessionAuthRepository } from '../../../core/storage/ISessionAuthRepository';
import { MongoStore } from './MongoStore';

export class MongoSessionAuthRepository implements ISessionAuthRepository {
  private store: MongoStore;

  constructor(store: MongoStore) {
    this.store = store;
  }

  async init(sessionName?: string): Promise<void> {
    return;
  }

  async clean(sessionName: string): Promise<void> {
    const db = this.store.getSessionDb(sessionName);
    await db.dropDatabase();
  }
}
