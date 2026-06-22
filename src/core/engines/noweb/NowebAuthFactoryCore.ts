import { DataStore } from '@waha/core/abc/DataStore';
import { LocalStore } from '@waha/core/storage/LocalStore';
import { MongoStore } from '@waha/core/storage/mongo/MongoStore';
import { PsqlStore } from '@waha/core/storage/psql/PsqlStore';
import { makeSureJsonFile } from '@waha/core/utils/jsonutils';
import { join } from 'path';

import { NoWebMongoDbAuth } from './store/mongodb/NoWebMongoDbAuth';
import { NoWebPsqlAuth } from './store/psql/NoWebPsqlAuth';
import { useMultiFileAuthState } from './useMultiFileAuthState';

export class NowebAuthFactoryCore {
  buildAuth(store: DataStore, name: string) {
    if (store instanceof MongoStore) return this.buildMongoAuth(store, name);
    if (store instanceof PsqlStore) return this.buildPsql(store, name);
    if (store instanceof LocalStore) return this.buildLocalAuth(store, name);
    throw new Error(`Unsupported store type '${store.constructor.name}'`);
  }

  private async buildMongoAuth(store: MongoStore, name: string) {
    const db = store.getSessionDb(name);
    const authStore = new NoWebMongoDbAuth(db);
    await authStore.init();
    return authStore.methods();
  }

  async buildPsql(store: PsqlStore, name: string) {
    const knex = store.buildSessionKnex(name, 'Session/Auth');
    const authStore = new NoWebPsqlAuth(knex);
    await authStore.init();
    return authStore.methods();
  }

  protected async buildLocalAuth(store: LocalStore, name: string) {
    // Quick fix for
    // https://github.com/devlikeapro/waha/issues/347
    // We can remove it after some time and the fix
    // https://github.com/WhiskeySockets/Baileys/pull/824
    await this.makeCredsJsonValid(store, name);
    await store.init(name);
    const authFolder = store.getSessionDirectory(name);
    const { state, saveCreds, close } = await useMultiFileAuthState(authFolder);
    return { state, saveCreds, close };
  }

  private async makeCredsJsonValid(store: LocalStore, name: string) {
    try {
      await store.init(name);
      const authFolder = store.getSessionDirectory(name);
      const credsPath = join(authFolder, 'creds.json');
      await makeSureJsonFile(credsPath);
    } catch (error) {
      console.error('Failed to fix "creds.json" file, continue...', error);
    }
  }
}
