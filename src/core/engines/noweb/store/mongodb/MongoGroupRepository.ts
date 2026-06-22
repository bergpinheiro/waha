import type { GroupMetadata } from '@adiwajshing/baileys/lib/Types/GroupMetadata';
import { IGroupRepository } from '@waha/core/engines/noweb/store/IGroupRepository';

import { MongoRepository } from './MongoRepository';

export class MongoGroupRepository
  extends MongoRepository<GroupMetadata>
  implements IGroupRepository {}
