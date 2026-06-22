import type { Chat } from '@adiwajshing/baileys';
import { IChatRepository } from '@waha/core/engines/noweb/store/IChatRepository';
import { OverviewFilter } from '@waha/structures/chats.dto';
import { PaginationParams } from '@waha/structures/pagination.dto';

import { MongoRepository } from './MongoRepository';

export class MongoChatRepository
  extends MongoRepository<Chat>
  implements IChatRepository
{
  async getAllWithMessages(
    pagination: PaginationParams,
    broadcast: boolean,
    filter?: OverviewFilter,
    merge?: boolean,
  ): Promise<Chat[]> {
    // Get chats with conversationTimestamp is not Null
    const mongoFilter: any = { conversationTimestamp: { $ne: NaN } };

    // Build the ID filter conditions
    const conditions = [];
    if (!broadcast) {
      // Filter out chat by id if it ends at @newsletter or @broadcast
      conditions.push({ id: { $not: { $regex: /@broadcast|@newsletter/ } } });
    }
    if (filter?.ids && filter.ids.length > 0) {
      // Filter by IDs if provided
      conditions.push({ id: { $in: filter.ids } });
    }

    if (conditions.length != 0) {
      // Combine ID conditions with $and if there are multiple conditions
      mongoFilter.$and = conditions;
    }

    let query = this.collection.find(mongoFilter);
    // Sort by conversationTimestamp in descending order
    query = this.pagination(query, pagination);
    const rows = await query.toArray();
    return rows.map(MongoRepository.revive);
  }
}
