import {
  ISessionWorkerRepository,
  SessionWorkerInfo,
} from '@waha/core/storage/ISessionWorkerRepository';
import { Collection } from 'mongodb';

import { MongoStore } from './MongoStore';

export class MongoSessionWorkerRepository implements ISessionWorkerRepository {
  private collection: Collection<SessionWorkerInfo>;

  constructor(store: MongoStore) {
    this.collection = store.getMainDb().collection('session_worker');
  }

  async assign(session: string, worker: string): Promise<void> {
    await this.collection.replaceOne(
      { id: session },
      { worker: worker, id: session },
      { upsert: true },
    );
  }

  async unassign(session: string, worker: string): Promise<void> {
    await this.collection.deleteMany({ id: session, worker: worker });
  }

  async remove(session: string): Promise<void> {
    await this.collection.deleteMany({ id: session });
  }

  async getAll(): Promise<SessionWorkerInfo[]> {
    return await this.collection.find().toArray();
  }

  async getSessionsByWorker(worker: string): Promise<string[]> {
    const data = await this.collection.find({ worker: worker }).toArray();
    return data.map((d) => d.id);
  }

  async init(): Promise<void> {
    await this.collection.createIndex({ worker: 1 });
  }
}
