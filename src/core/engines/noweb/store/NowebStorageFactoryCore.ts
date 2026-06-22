import { LocalStore } from '@waha/core/storage/LocalStore';
import { MongoStore } from '@waha/core/storage/mongo/MongoStore';
import { PsqlStore } from '@waha/core/storage/psql/PsqlStore';

import { DataStore } from '../../../abc/DataStore';
import { MongoStorage } from './mongodb/MongoStorage';
import { INowebStorage } from './INowebStorage';
import { PsqlStorage } from './psql/PsqlStorage';
import { Sqlite3Storage } from './sqlite3/Sqlite3Storage';

export class NowebStorageFactoryCore {
  createStorage(store: DataStore, name: string): INowebStorage {
    if (store instanceof MongoStore) {
      return this.buildStorageMongo(store, name);
    }
    if (store instanceof PsqlStore) {
      return this.buildPsql(store, name);
    }
    if (store instanceof LocalStore) {
      return this.buildStorageSqlite3(store, name);
    }
    throw new Error(`Unsupported store type '${store.constructor.name}'`);
  }

  private buildStorageMongo(store: MongoStore, name: string) {
    const db = store.getSessionDb(name);
    return new MongoStorage(db);
  }

  private buildPsql(store: PsqlStore, name: string) {
    const knex = store.buildSessionKnex(name, 'Session/Storage');
    return new PsqlStorage(knex);
  }

  private buildStorageSqlite3(store: LocalStore, name: string) {
    const filePath = store.getFilePath(name, 'store.sqlite3');
    return new Sqlite3Storage(filePath);
  }
}
