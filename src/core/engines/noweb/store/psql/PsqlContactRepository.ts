import type { Contact } from '@adiwajshing/baileys';
import { IContactRepository } from '@waha/core/engines/noweb/store/IContactRepository';
import { NowebContactSchema } from '@waha/core/engines/noweb/store/schemas';
import { KnexPaginator } from '@waha/utils/Paginator';

import { NOWEBPsqlKVRepository } from './NOWEBPsqlKVRepository';

class ContactPaginator extends KnexPaginator {
  indexes = ['id'];
}

export class PsqlContactRepository
  extends NOWEBPsqlKVRepository<Contact>
  implements IContactRepository
{
  protected Paginator = ContactPaginator;

  get schema() {
    return NowebContactSchema;
  }
}
