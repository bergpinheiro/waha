import type { Label } from '@adiwajshing/baileys/lib/Types/Label';
import { ILabelsRepository } from '@waha/core/engines/noweb/store/ILabelsRepository';

import { MongoRepository } from './MongoRepository';

export class MongoLabelsRepository
  extends MongoRepository<Label>
  implements ILabelsRepository {}
