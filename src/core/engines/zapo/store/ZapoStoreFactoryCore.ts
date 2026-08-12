import { createMongoStore } from '@zapo-js/store-mongo';
import { createPostgresStore } from '@zapo-js/store-postgres';
import { createSqliteStore } from '@zapo-js/store-sqlite';
import { DataStore } from '@waha/core/abc/DataStore';
import { LocalStore } from '@waha/core/storage/LocalStore';
import { MongoStore } from '@waha/core/storage/mongo/MongoStore';
import { PsqlStore } from '@waha/core/storage/psql/PsqlStore';
import {
  createStore,
  WaCreateStoreOptionsStrict,
  WaStore,
  WaStoreBackend,
} from 'zapo-js';

/** The single backend name every domain of a session is routed to. */
type Backend = 'waha';

/**
 * zapo narrows each provider to the backends that actually declare the domain,
 * using `undefined extends T` to detect a missing one. That check needs
 * strictNullChecks, which this project does not enable, so the inference
 * collapses to 'memory' and the inferring overload never matches. The library
 * exposes WaCreateStoreOptionsStrict for exactly this case ("annotate with this
 * one when the backend values aren't in scope"), which keeps the options fully
 * type-checked without casting anything away.
 */
function buildStore(backend: WaStoreBackend): WaStore {
  const options = {
    backends: { waha: backend },
    providers: PROVIDERS,
  } as unknown as WaCreateStoreOptionsStrict<Backend>;
  return createStore(options);
}

/**
 * Points every domain zapo can persist at the single backend WAHA provided, so
 * a session lives in one place. `messages`, `threads` and `contacts` back the
 * chat and contact endpoints - dropping them to 'none' would make those answer
 * empty.
 */
const PROVIDERS = {
  auth: 'waha',
  signal: 'waha',
  preKey: 'waha',
  session: 'waha',
  identity: 'waha',
  senderKey: 'waha',
  appState: 'waha',
  privacyToken: 'waha',
  messages: 'waha',
  threads: 'waha',
  contacts: 'waha',
} as const;

/**
 * Table/collection prefix so zapo's own schema never collides with WAHA's
 * inside a shared database.
 */
const PREFIX = 'zapo_';

const SQLITE_FILE = 'zapo.sqlite3';

/**
 * Builds the zapo store on top of the storage WAHA already owns.
 *
 * The three zapo store packages line up one-to-one with WAHA's three data
 * stores, and each accepts an externally-owned connection, so no parallel
 * persistence path is created: the file lives in the session folder, or the
 * tables live in the session database WAHA provisioned.
 *
 * Mirrors NowebStorageFactoryCore so both engines resolve storage the same way.
 */
export class ZapoStoreFactoryCore {
  createStore(store: DataStore, name: string): WaStore {
    if (store instanceof MongoStore) {
      return this.buildMongo(store, name);
    }
    if (store instanceof PsqlStore) {
      return this.buildPsql(store, name);
    }
    if (store instanceof LocalStore) {
      return this.buildSqlite(store, name);
    }
    throw new Error(`Unsupported store type '${store.constructor.name}'`);
  }

  private buildSqlite(store: LocalStore, name: string): WaStore {
    const filePath = store.getFilePath(name, SQLITE_FILE);
    return buildStore(createSqliteStore({ path: filePath }));
  }

  private buildPsql(store: PsqlStore, name: string): WaStore {
    // getSessionDbURL points at the session database WAHA already provisioned,
    // so zapo's tables land there instead of in a database of its own.
    return buildStore(
      createPostgresStore({
        pool: { connectionString: store.getSessionDbURL(name) },
        tablePrefix: PREFIX,
      }),
    );
  }

  private buildMongo(store: MongoStore, name: string): WaStore {
    return buildStore(
      createMongoStore({
        db: store.getSessionDb(name),
        collectionPrefix: PREFIX,
      }),
    );
  }
}
