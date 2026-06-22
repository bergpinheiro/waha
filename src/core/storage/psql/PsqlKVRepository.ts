import { SqlKVRepository } from '@waha/core/storage/sql/SqlKVRepository';
import { PsqlJsonQuery } from '@waha/core/storage/psql/PsqlJsonQuery';
import Knex from 'knex';

export class PsqlKVRepository<Entity> extends SqlKVRepository<Entity> {
  protected knex: Knex.Knex;
  protected jsonQuery = new PsqlJsonQuery();

  constructor(knex: Knex.Knex) {
    super(knex);
  }
}
