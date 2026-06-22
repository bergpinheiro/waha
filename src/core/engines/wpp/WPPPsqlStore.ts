import { PsqlFileRepository } from '@waha/core/storage/psql/PsqlFileRepository';
import { PsqlStore } from '@waha/core/storage/psql/PsqlStore';
import Knex from 'knex';
import { Logger } from 'pino';

import { WPPStore } from './WPPStore';

class WPPFileRepository extends PsqlFileRepository {
  get tableName() {
    return 'files';
  }
}

export class WPPPsqlStore implements WPPStore {
  private readonly repository: WPPFileRepository;

  constructor(
    knex: Knex.Knex,
    private readonly logger: Logger,
  ) {
    this.repository = new WPPFileRepository(knex, logger);
  }

  static async build(
    store: PsqlStore,
    sessionName: string,
    logger: Logger,
  ): Promise<WPPPsqlStore> {
    const knex = store.buildSessionKnex(sessionName, 'Session/Auth');
    const instance = new WPPPsqlStore(knex, logger);
    await instance.init();
    return instance;
  }

  private async init(): Promise<void> {
    await this.repository.init();
  }

  async sessionExists(sessionName: string): Promise<boolean> {
    return this.repository.exists(this.getFilename(sessionName));
  }

  async load(sessionName: string): Promise<Buffer | null> {
    const data = await this.repository.fetch(this.getFilename(sessionName));
    return data ? data.content : null;
  }

  async save(sessionName: string, data: Buffer): Promise<void> {
    await this.repository.save(this.getFilename(sessionName), data);
  }

  async delete(sessionName: string): Promise<void> {
    await this.repository.delete(this.getFilename(sessionName));
  }

  private getFilename(sessionName: string): string {
    return `${sessionName}.zip`;
  }
}
