import type { Contact } from '@adiwajshing/baileys';
import { IContactRepository } from '@waha/core/engines/noweb/store/IContactRepository';

import { MongoRepository } from './MongoRepository';

export class MongoContactRepository
  extends MongoRepository<Contact>
  implements IContactRepository {}
