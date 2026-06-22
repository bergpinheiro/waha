import type { Label } from '@adiwajshing/baileys/lib/Types/Label';
import { ILabelsRepository } from '@waha/core/engines/noweb/store/ILabelsRepository';
import { NowebLabelsSchema } from '@waha/core/engines/noweb/store/schemas';

import { NOWEBPsqlKVRepository } from './NOWEBPsqlKVRepository';

export class PsqlLabelsRepository
  extends NOWEBPsqlKVRepository<Label>
  implements ILabelsRepository
{
  get schema() {
    return NowebLabelsSchema;
  }
}
