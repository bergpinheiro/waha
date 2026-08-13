import { MongoRepository } from '@waha/core/engines/noweb/store/mongodb/MongoRepository';
import {
  ZapoChatMigrations,
  ZapoChatSchema,
} from '@waha/core/engines/zapo/store/schemas';
import { PsqlKVRepository } from '@waha/core/storage/psql/PsqlKVRepository';
import { Schema } from '@waha/core/storage/Schema';
import { Sqlite3KVRepository } from '@waha/core/storage/sqlite3/Sqlite3KVRepository';
import { PaginationParams, SortOrder } from '@waha/structures/pagination.dto';
import { KnexPaginator } from '@waha/utils/Paginator';
import Knex from 'knex';
import { Db } from 'mongodb';

/**
 * What WAHA needs to answer "the latest conversations", which the library's
 * thread store cannot: it lists without an order.
 */
export interface ZapoChatRecord {
  id: string;
  conversationTimestamp: number;
  name?: string | null;
}

interface ZapoChatRepositoryLike {
  init?(): Promise<void>;
  getAll(pagination?: PaginationParams): Promise<ZapoChatRecord[]>;
  getById(id: string): Promise<ZapoChatRecord | null>;
  upsertOne(entity: ZapoChatRecord): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteAll(): Promise<void>;
}

/** Lifted out of the blob so the list can be ordered by it in the database. */
const METADATA = new Map<string, (entity: ZapoChatRecord) => any>([
  ['id', (entity) => entity.id],
  ['conversationTimestamp', (entity) => entity.conversationTimestamp ?? 0],
]);

class ChatPaginator extends KnexPaginator {
  indexes = ['id', 'conversationTimestamp'];
}

export class Sqlite3ZapoChatRepository extends Sqlite3KVRepository<ZapoChatRecord> {
  protected Paginator = ChatPaginator;

  get schema(): Schema {
    return ZapoChatSchema;
  }

  get migrations(): string[] {
    return ZapoChatMigrations;
  }

  get metadata() {
    return METADATA;
  }
}

export class PsqlZapoChatRepository extends PsqlKVRepository<ZapoChatRecord> {
  protected Paginator = ChatPaginator;

  get schema(): Schema {
    return ZapoChatSchema;
  }

  get migrations(): string[] {
    return ZapoChatMigrations;
  }

  get metadata() {
    return METADATA;
  }
}

/**
 * Tracks when each conversation last had activity.
 *
 * Fed from the messages this session sees in both directions and from the
 * initial history sync, so the chat list can be ordered the way every other
 * engine orders it - most recent first.
 */
export class ZapoChatStore {
  constructor(private readonly repository: ZapoChatRepositoryLike) {}

  async init(): Promise<void> {
    await this.repository.init?.();
  }

  /**
   * Moves a conversation forward in time. An older timestamp is ignored, so
   * replaying history can never push a live chat down the list.
   */
  async touch(id: string, timestampMs: number, name?: string): Promise<void> {
    const current = await this.repository.getById(id);
    if (current && current.conversationTimestamp >= timestampMs && !name) {
      return;
    }
    await this.repository.upsertOne({
      id: id,
      conversationTimestamp: Math.max(
        timestampMs,
        current?.conversationTimestamp ?? 0,
      ),
      name: name ?? current?.name ?? null,
    });
  }

  list(limit?: number): Promise<ZapoChatRecord[]> {
    return this.repository.getAll({
      limit: limit,
      sortBy: 'conversationTimestamp',
      sortOrder: SortOrder.DESC,
    });
  }

  getById(id: string): Promise<ZapoChatRecord | null> {
    return this.repository.getById(id);
  }

  async remove(id: string): Promise<void> {
    await this.repository.deleteById(id);
  }

  async clear(): Promise<void> {
    await this.repository.deleteAll();
  }
}

export function buildSqliteChatStore(knex: Knex.Knex): ZapoChatStore {
  return new ZapoChatStore(new Sqlite3ZapoChatRepository(knex));
}

export function buildPsqlChatStore(knex: Knex.Knex): ZapoChatStore {
  return new ZapoChatStore(new PsqlZapoChatRepository(knex));
}

export function buildMongoChatStore(db: Db): ZapoChatStore {
  return new ZapoChatStore(
    new MongoRepository<ZapoChatRecord>(db, ZapoChatSchema, METADATA),
  );
}
