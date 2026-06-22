import {
  INowebLidPNRepository,
  LidToPN,
} from '@waha/core/engines/noweb/store/INowebLidPNRepository';
import { LimitOffsetParams } from '@waha/structures/pagination.dto';

import { MongoRepository } from './MongoRepository';

export class MongoLidPNRepository
  extends MongoRepository<LidToPN>
  implements INowebLidPNRepository
{
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
