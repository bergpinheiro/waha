import {
  ZapoContactSchema,
  ZapoMigrations,
} from '@waha/core/engines/zapo/store/schemas';
import { MongoRepository } from '@waha/core/engines/noweb/store/mongodb/MongoRepository';
import { Schema } from '@waha/core/storage/Schema';
import { PsqlKVRepository } from '@waha/core/storage/psql/PsqlKVRepository';
import { Sqlite3KVRepository } from '@waha/core/storage/sqlite3/Sqlite3KVRepository';
import { PaginationParams } from '@waha/structures/pagination.dto';
import { KnexPaginator } from '@waha/utils/Paginator';
import Knex from 'knex';
import { Db } from 'mongodb';
import type { WaContactStore, WaStoredContactRecord } from 'zapo-js';

/**
 * The stored row: the record the library hands us, plus the primary key the
 * WAHA repositories address entities by.
 */
interface ZapoContactEntity extends WaStoredContactRecord {
  id: string;
}

/**
 * The subset of the WAHA repository surface this store needs. Keeping it
 * narrow lets the same store wrap the SQL and the Mongo repository, which do
 * not share a base class.
 */
interface ZapoContactRepository {
  /** SQL backends create the table here; Mongo is schemaless and has none. */
  init?(): Promise<void>;
  getAll(pagination?: PaginationParams): Promise<ZapoContactEntity[]>;
  getById(id: string): Promise<ZapoContactEntity | null>;
  getAllBy(filters: any): Promise<ZapoContactEntity[]>;
  upsertOne(entity: ZapoContactEntity): Promise<void>;
  upsertMany(entities: ZapoContactEntity[]): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteAll(): Promise<void>;
}

/** Columns lifted out of the record so they can be indexed and queried. */
const METADATA = new Map<string, (entity: ZapoContactEntity) => any>([
  ['id', (entity) => entity.jid],
  ['lid', (entity) => entity.lid ?? null],
  ['phoneNumber', (entity) => entity.phoneNumber ?? null],
]);

class ContactPaginator extends KnexPaginator {
  indexes = ['id'];
}

export class Sqlite3ZapoContactRepository extends Sqlite3KVRepository<ZapoContactEntity> {
  protected Paginator = ContactPaginator;

  get schema(): Schema {
    return ZapoContactSchema;
  }

  get migrations(): string[] {
    return ZapoMigrations;
  }

  get metadata() {
    return METADATA;
  }
}

export class PsqlZapoContactRepository extends PsqlKVRepository<ZapoContactEntity> {
  protected Paginator = ContactPaginator;

  get schema(): Schema {
    return ZapoContactSchema;
  }

  get migrations(): string[] {
    return ZapoMigrations;
  }

  get metadata() {
    return METADATA;
  }
}

/**
 * Implements the library's contact contract on top of WAHA storage, and adds
 * the listing the library's own store has no room for - it only ever needs
 * keyed lookup, while WAHA exposes GET /api/contacts/all.
 */
export class ZapoContactStore implements WaContactStore {
  constructor(private readonly repository: ZapoContactRepository) {}

  /** Creates the table on the SQL backends. Safe to call more than once. */
  async init(): Promise<void> {
    await this.repository.init?.();
  }

  async upsert(record: WaStoredContactRecord): Promise<void> {
    await this.repository.upsertOne(this.toEntity(record));
  }

  async upsertBatch(records: readonly WaStoredContactRecord[]): Promise<void> {
    await this.repository.upsertMany(records.map((r) => this.toEntity(r)));
  }

  async getByJid(jid: string): Promise<WaStoredContactRecord | null> {
    return this.repository.getById(jid);
  }

  async getByPhoneNumber(pn: string): Promise<WaStoredContactRecord | null> {
    const rows = await this.repository.getAllBy({ phoneNumber: pn });
    return rows[0] ?? null;
  }

  async deleteByJid(jid: string): Promise<number> {
    const existing = await this.repository.getById(jid);
    if (!existing) {
      return 0;
    }
    await this.repository.deleteById(jid);
    return 1;
  }

  async clear(): Promise<void> {
    await this.repository.deleteAll();
  }

  /** Not part of the library contract - this is what WAHA needs on top. */
  list(pagination?: PaginationParams): Promise<WaStoredContactRecord[]> {
    return this.repository.getAll(pagination);
  }

  private toEntity(record: WaStoredContactRecord): ZapoContactEntity {
    return { ...record, id: record.jid };
  }
}

export function buildSqliteContactStore(knex: Knex.Knex): ZapoContactStore {
  return new ZapoContactStore(new Sqlite3ZapoContactRepository(knex));
}

export function buildPsqlContactStore(knex: Knex.Knex): ZapoContactStore {
  return new ZapoContactStore(new PsqlZapoContactRepository(knex));
}

export function buildMongoContactStore(db: Db): ZapoContactStore {
  const repository = new MongoRepository<ZapoContactEntity>(
    db,
    ZapoContactSchema,
    METADATA,
  );
  return new ZapoContactStore(repository);
}
