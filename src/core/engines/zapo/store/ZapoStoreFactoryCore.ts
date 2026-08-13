import { KNEX_SQLITE_CLIENT } from '@waha/core/env';
import {
  buildMongoContactStore,
  buildPsqlContactStore,
  buildSqliteContactStore,
  ZapoContactStore,
} from '@waha/core/engines/zapo/store/ZapoContactStore';
import Knex from 'knex';
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

/** Backend names: the library bundle, plus WAHA's own contact store. */
type Backend = 'waha' | 'contacts';

/**
 * zapo narrows each provider to the backends that actually declare the domain,
 * using `undefined extends T` to detect a missing one. That check needs
 * strictNullChecks, which this project does not enable, so the inference
 * collapses to 'memory' and the inferring overload never matches. The library
 * exposes WaCreateStoreOptionsStrict for exactly this case ("annotate with this
 * one when the backend values aren't in scope"), which keeps the options fully
 * type-checked without casting anything away.
 */
/**
 * Contacts are routed to a WAHA-backed store instead of the library one.
 * The library only ever needs keyed lookup, so its contact store has no
 * enumeration, while WAHA exposes GET /api/contacts/all. Everything else
 * stays on the @zapo-js backend.
 */
function buildStore(
  backend: WaStoreBackend,
  contacts: ZapoContactStore,
): WaStore {
  const contactsBackend = {
    stores: { contacts: () => contacts },
    caches: {},
  };
  const options = {
    backends: { waha: backend, contacts: contactsBackend },
    providers: PROVIDERS,
  } as unknown as WaCreateStoreOptionsStrict<Backend>;
  return createStore(options);
}

function buildSqliteKnex(filePath: string): Knex.Knex {
  return Knex({
    client: KNEX_SQLITE_CLIENT,
    connection: { filename: filePath },
    useNullAsDefault: true,
    pool: { min: 1, max: 10, idleTimeoutMillis: 60_000 },
  });
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
  contacts: 'contacts',
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
    return buildStore(
      createSqliteStore({ path: filePath }),
      buildSqliteContactStore(buildSqliteKnex(filePath)),
    );
  }

  private buildPsql(store: PsqlStore, name: string): WaStore {
    // getSessionDbURL points at the session database WAHA already provisioned,
    // so zapo's tables land there instead of in a database of its own.
    return buildStore(
      createPostgresStore({
        pool: { connectionString: store.getSessionDbURL(name) },
        tablePrefix: PREFIX,
      }),
      buildPsqlContactStore(store.buildSessionKnex(name, 'Zapo/Contacts')),
    );
  }

  private buildMongo(store: MongoStore, name: string): WaStore {
    const db = store.getSessionDb(name);
    return buildStore(
      createMongoStore({ db: db, collectionPrefix: PREFIX }),
      buildMongoContactStore(db),
    );
  }
}
