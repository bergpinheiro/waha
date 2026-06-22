import { ISessionMeRepository } from '@waha/core/storage/ISessionMeRepository';
import { MeInfo, SessionConfig } from '@waha/structures/sessions.dto';
import { Collection } from 'mongodb';

import { MongoStore } from './MongoStore';

class SessionMeInfo {
  session: string;
  me?: MeInfo;
}

export class MongoSessionMeRepository extends ISessionMeRepository {
  private collection: Collection<SessionMeInfo>;

  constructor(store: MongoStore) {
    super();
    this.collection = store.getMainDb().collection('me');
  }

  async upsertMe(sessionName: string, me: MeInfo): Promise<void> {
    await this.collection.replaceOne(
      { session: sessionName },
      { me: me, session: sessionName },
      { upsert: true },
    );
  }

  async getMe(sessionName: string): Promise<MeInfo> {
    const data = await this.collection.findOne({ session: sessionName });
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
    for (const sessionName of uniqueNames) {
      result.set(sessionName, null);
    }
    const docs = await this.collection
      .find({ session: { $in: uniqueNames } })
      .toArray();
    for (const doc of docs) {
      result.set(doc.session, doc.me ?? null);
    }
    return result;
  }

  async removeMe(sessionName: string): Promise<void> {
    await this.collection.deleteOne({ session: sessionName });
  }

  async init(): Promise<void> {
    await this.collection.createIndex({ session: 1 }, { unique: true });
  }
}
