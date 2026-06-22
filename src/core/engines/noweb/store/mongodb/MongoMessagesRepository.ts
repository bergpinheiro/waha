import { ALL_JID } from '@waha/core/engines/noweb/session.noweb.core';
import { AckToStatus } from '@waha/core/utils/acks';
import { GetChatMessagesFilter } from '@waha/structures/chats.dto';
import { PaginationParams, SortOrder } from '@waha/structures/pagination.dto';
import { FindCursor } from 'mongodb';

import { IMessagesRepository } from '../../../../../core/engines/noweb/store/IMessagesRepository';
import { MongoRepository } from './MongoRepository';

export class MongoMessagesRepository
  extends MongoRepository<any>
  implements IMessagesRepository
{
  upsert(messages: any[]): Promise<void> {
    return this.upsertMany(messages);
  }

  async getAllByJid(
    jid: string,
    filter: GetChatMessagesFilter,
    pagination: PaginationParams,
    merge?: boolean,
  ): Promise<any[]> {
    const query: any = {};
    if (jid !== ALL_JID) {
      query['jid'] = jid;
    }
    if (
      filter['filter.timestamp.lte'] != null ||
      filter['filter.timestamp.gte'] != null
    ) {
      const filters: any = {};
      if (filter['filter.timestamp.lte'] != null) {
        filters['$lte'] = filter['filter.timestamp.lte'];
      }
      if (filter['filter.timestamp.gte'] != null) {
        filters['$gte'] = filter['filter.timestamp.gte'];
      }
      query['messageTimestamp'] = filters;
    }
    if (filter['filter.fromMe'] != null) {
      query['data.key.fromMe'] = filter['filter.fromMe'];
    }
    if (filter['filter.ack'] != null) {
      const status = AckToStatus(filter['filter.ack']);
      query['data.status'] = status;
    }

    let cursor = this.collection.find(query);
    cursor = this.pagination(cursor, pagination);
    const rows = await cursor.toArray();
    return rows.map(MongoRepository.revive);
  }

  async getByJidById(jid: string, id: string, merge?: boolean): Promise<any> {
    if (jid === ALL_JID) {
      return this.getBy({ id: id });
    }
    return this.getBy({ jid: jid, id: id });
  }

  async updateByJidAndId(
    jid: string,
    id: string,
    update: any,
  ): Promise<boolean> {
    const entity = await this.getByJidById(jid, id);
    if (!entity) {
      return false;
    }
    Object.assign(entity, update);
    await this.upsertOne(entity);
  }

  async deleteByJidByIds(jid: string, ids: string[]): Promise<void> {
    await this.collection.deleteMany({ jid: jid, id: { $in: ids } });
  }

  deleteAllByJid(jid: string): Promise<void> {
    return this.deleteBy({ jid: jid });
  }
}
