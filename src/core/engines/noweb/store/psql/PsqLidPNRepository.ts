import {
  INowebLidPNRepository,
  LidToPN,
} from '@waha/core/engines/noweb/store/INowebLidPNRepository';
import { NowebLidMapSchema } from '@waha/core/engines/noweb/store/schemas';
import { LidPaginator } from '@waha/core/engines/noweb/store/sqlite3/Sqlite3LidPNRepository';
import { LimitOffsetParams } from '@waha/structures/pagination.dto';

import { NOWEBPsqlKVRepository } from './NOWEBPsqlKVRepository';

export class PsqlLidPNRepository
  extends NOWEBPsqlKVRepository<LidToPN>
  implements INowebLidPNRepository
{
  protected Paginator = LidPaginator;

  get schema() {
    return NowebLidMapSchema;
  }

  saveLids(lids: LidToPN[]): Promise<void> {
    return this.upsertMany(lids);
  }

  getAllLids(pagination?: LimitOffsetParams): Promise<LidToPN[]> {
    return this.getAll(pagination);
  }

  getLidsCount(): Promise<number> {
    return this.getCount();
  }

  async findLidByPN(pn: string): Promise<string | null> {
    const value = await this.getBy({ pn: pn });
    return value?.id || null;
  }

  async findPNByLid(lid: string): Promise<string | null> {
    const value = await this.getBy({ id: lid });
    return value?.pn || null;
  }
}
