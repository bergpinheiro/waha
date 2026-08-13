import { KNEX_SQLITE_CLIENT } from '@waha/core/env';
import {
  buildMongoChatStore,
  buildPsqlChatStore,
  buildSqliteChatStore,
  ZapoChatStore,
} from '@waha/core/engines/zapo/store/ZapoChatStore';
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
    cacheProviders: CACHE_PROVIDERS,
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
 * The cache domains default to memory, which loses them on restart. The
 * message secret in particular is what decrypts an addon - a reaction to a
 * message this session has already seen would stop decrypting after a
 * restart - so the caches are persisted alongside the rest of the session.
 */
const CACHE_PROVIDERS = {
  retry: 'waha',
  groupMetadata: 'waha',
  chatMetadata: 'waha',
  deviceList: 'waha',
  messageSecret: 'waha',
} as const;

/**
 * Table/collection prefix so zapo's own schema never collides with WAHA's
 * inside a shared database.
 */
const PREFIX = 'zapo_';

const SQLITE_FILE = 'zapo.sqlite3';

/**
 * The store the library gets, plus a direct handle on the contact store.
 *
 * WaStore.session() hands back a lock-wrapped bundle rather than the instance
 * that was registered, so the WAHA-specific listing is only reachable through
 * the reference kept here.
 */
export interface ZapoStorage {
  readonly store: WaStore;
  readonly contacts: ZapoContactStore;
  readonly chats: ZapoChatStore;
  /** Releases the library backends and any connection opened for this session. */
  close(): Promise<void>;
}

/**
 * Sessions are started and stopped repeatedly, so every connection opened here
 * has to be released on stop - the same contract the NOWEB storage follows.
 */
function closeStorage(store: WaStore, knex?: Knex.Knex): () => Promise<void> {
  return async () => {
    await store.destroy().catch(() => undefined);
    await knex?.destroy().catch(() => undefined);
  };
}

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
  createStorage(store: DataStore, name: string): ZapoStorage {
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

  private buildSqlite(store: LocalStore, name: string): ZapoStorage {
    const filePath = store.getFilePath(name, SQLITE_FILE);
    const knex = buildSqliteKnex(filePath);
    const contacts = buildSqliteContactStore(knex);
    const waStore = buildStore(createSqliteStore({ path: filePath }), contacts);
    return {
      store: waStore,
      contacts: contacts,
      chats: buildSqliteChatStore(knex),
      close: closeStorage(waStore, knex),
    };
  }

  private buildPsql(store: PsqlStore, name: string): ZapoStorage {
    // getSessionDbURL points at the session database WAHA already provisioned,
    // so zapo's tables land there instead of in a database of its own.
    const knex = store.buildSessionKnex(name, 'Zapo/Contacts');
    const contacts = buildPsqlContactStore(knex);
    const waStore = buildStore(
      createPostgresStore({
        pool: { connectionString: store.getSessionDbURL(name) },
        tablePrefix: PREFIX,
      }),
      contacts,
    );
    return {
      store: waStore,
      contacts: contacts,
      chats: buildPsqlChatStore(knex),
      close: closeStorage(waStore, knex),
    };
  }

  private buildMongo(store: MongoStore, name: string): ZapoStorage {
    // The Db belongs to the MongoStore, so only the library backends are
    // released here.
    const db = store.getSessionDb(name);
    const contacts = buildMongoContactStore(db);
    const waStore = buildStore(
      createMongoStore({ db: db, collectionPrefix: PREFIX }),
      contacts,
    );
    return {
      store: waStore,
      contacts: contacts,
      chats: buildMongoChatStore(db),
      close: closeStorage(waStore),
    };
  }
}
