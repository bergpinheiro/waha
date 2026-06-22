import type { Chat } from '@adiwajshing/baileys';
import { IChatRepository } from '@waha/core/engines/noweb/store/IChatRepository';
import { NowebChatSchema } from '@waha/core/engines/noweb/store/schemas';
import { SqlChatMethods } from '@waha/core/engines/noweb/store/sql/SqlChatMethods';
import { NOWEBPsqlKVRepository } from '@waha/core/engines/noweb/store/psql/NOWEBPsqlKVRepository';
import { OverviewFilter } from '@waha/structures/chats.dto';
import { PaginationParams } from '@waha/structures/pagination.dto';
import { KnexPaginator } from '@waha/utils/Paginator';

class ChatPaginator extends KnexPaginator {
  indexes = ['id', 'conversationTimestamp'];
}

export class PsqlChatRepository
  extends NOWEBPsqlKVRepository<Chat>
  implements IChatRepository
{
  protected Paginator = ChatPaginator;

  get schema() {
    return NowebChatSchema;
  }

  get methods() {
    return new SqlChatMethods(this);
  }

  getAllWithMessages(
    pagination: PaginationParams,
    broadcast: boolean,
    filter?: OverviewFilter,
    merge?: boolean,
  ): Promise<Chat[]> {
    return this.methods.getAllWithMessages(
      pagination,
      broadcast,
      filter,
      merge,
    );
  }
}
