import {
  convertProtobufToPlainObject,
  replaceLongsWithNumber,
} from '@waha/core/engines/noweb/utils';
import { Field, Schema } from '@waha/core/storage/Schema';
import { PaginationParams } from '@waha/structures/pagination.dto';
import { MongoPaginator } from '@waha/utils/Paginator';
import { Collection, Db } from 'mongodb';
import esm from '@waha/vendor/esm';

/**
 * Key value repository with extra metadata
 */
export class MongoRepository<Entity> {
  private UPSERT_BATCH_SIZE = 1000;
  protected collection: Collection<any>;

  private readonly metadata: Map<string, (entity: Entity) => any>;
  private readonly columns: Field[];

  static replace(data: any): any {
    return JSON.parse(JSON.stringify(data, esm.b.BufferJSON.replacer));
  }

  static revive(row: any): any {
    if (!row) {
      return null;
    }
    return JSON.parse(JSON.stringify(row.data), esm.b.BufferJSON.reviver);
  }

  constructor(
    db: Db,
    schema: Schema,
    metadata: Map<string, (entity: Entity) => any> | null = null,
  ) {
    this.collection = db.collection(schema.name);
    this.columns = schema.columns;
    this.metadata = metadata || new Map();
  }

  async getAll(pagination?: PaginationParams) {
    let query = this.collection.find();
    query = this.pagination(query, pagination);
    const rows = await query.toArray();
    return rows.map(MongoRepository.revive);
  }

  async getCount() {
    return await this.collection.countDocuments();
  }

  async getAllBy(filters: any) {
    const rows = await this.collection.find(filters).toArray();
    return rows.map(MongoRepository.revive);
  }

  async getAllByIds(ids: string[]) {
    const entitiesMap = await this.getEntitiesByIds(ids);
    return Array.from(entitiesMap.values()).filter(
      (entity) => entity !== null,
    ) as Entity[];
  }

  async getEntitiesByIds(ids: string[]): Promise<Map<string, Entity | null>> {
    if (ids.length === 0) {
      return new Map();
    }

    const rows = await this.collection.find({ id: { $in: ids } }).toArray();
    const entitiesMap = new Map<string, Entity | null>();

    // Initialize a map with null values for all requested IDs
    for (const id of ids) {
      entitiesMap.set(id, null);
    }

    // Fill in the map with found entities
    for (const row of rows) {
      const entity = MongoRepository.revive(row);
      if (entity && row.id) {
        entitiesMap.set(row.id, entity);
      }
    }

    return entitiesMap;
  }

  protected async getBy(filters: any) {
    return await this.collection.findOne(filters).then(MongoRepository.revive);
  }

  private dump(entity: Entity): any {
    const raw = convertProtobufToPlainObject(entity);
    replaceLongsWithNumber(raw);
    const data = {};
    for (const field of this.columns) {
      const fn = this.metadata.get(field.fieldName);
      if (fn) {
        data[field.fieldName] = fn(raw);
      } else if (field.fieldName == 'data') {
        data['data'] = MongoRepository.replace(raw);
      } else {
        data[field.fieldName] = raw[field.fieldName];
      }
    }
    return data;
  }

  save(entity: Entity) {
    return this.upsertOne(entity);
  }

  async getById(id: string): Promise<Entity | null> {
    return this.getBy({ id: id });
  }

  async upsertOne(entity: Entity): Promise<void> {
    const row = this.dump(entity);
    await this.collection.replaceOne({ id: row.id }, row, { upsert: true });
  }

  async upsertMany(entities: Entity[]): Promise<void> {
    if (entities.length === 0) {
      return;
    }
    const batchSize = this.UPSERT_BATCH_SIZE;
    for (let i = 0; i < entities.length; i += batchSize) {
      const batch = entities.slice(i, i + batchSize);
      await this.upsertBatch(batch);
    }
  }

  private async upsertBatch(entities: Entity[]): Promise<void> {
    // Update using bulk write
    const bulk = this.collection.initializeUnorderedBulkOp();
    for (const entity of entities) {
      const row = this.dump(entity);
      bulk.find({ id: row.id }).upsert().replaceOne(row);
    }
    await bulk.execute();
  }

  protected async deleteBy(filters: any) {
    await this.collection.deleteMany(filters);
  }

  async deleteAll() {
    await this.deleteBy({});
  }

  async deleteById(id: string) {
    await this.deleteBy({ id: id });
  }

  protected pagination(query: any, pagination?: PaginationParams) {
    if (pagination?.sortBy) {
      // check if it's in 'columns'
      const column = this.columns.find(
        (column) => column.fieldName === pagination.sortBy,
      );
      if (!column) {
        // add "data"
        pagination.sortBy = `data.${pagination.sortBy}`;
      }
    }
    const paginator = new MongoPaginator(pagination);
    return paginator.apply(query);
  }
}
