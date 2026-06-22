import { sleep } from '@nestjs/terminus/dist/utils';
import { PsqlFileRepository } from '@waha/core/storage/psql/PsqlFileRepository';
import Knex from 'knex';
import { Logger } from 'pino';
import { Store } from 'whatsapp-web.js';

interface Options {
  session: string;
  path?: string;
}

class WebjsFileRepository extends PsqlFileRepository {
  get tableName() {
    return 'files';
  }
}

export class WebJSPsqlAuth implements Store {
  private repository: PsqlFileRepository;

  constructor(
    private knex: Knex.Knex,
    private logger: Logger,
  ) {
    this.repository = new WebjsFileRepository(knex, logger);
  }

  async sessionExists(options: Options): Promise<boolean> {
    this.logger.info('Checking if session exists...');
    const filename = this.getAuthFileName(options);
    const exists = await this.repository.exists(filename);
    this.logger.info(`Session exists: ${exists}`);
    return exists;
  }

  async delete(options: Options): Promise<any> {
    this.logger.debug('Deleting session...');
    const filename = this.getAuthFileName(options);
    await this.repository.delete(filename);
    this.logger.debug('Session deleted.');
  }

  async save(options: Options): Promise<any> {
    this.logger.debug('Saving session...');
    const filename = this.getAuthFileName(options);
    await this.repository.saveFromFile(filename, filename);
    this.logger.debug('Session saved.');
  }

  async extract(options: Options) {
    this.logger.debug('Extracting existing session...');
    const filename = this.getAuthFileName(options);
    const found = await this.repository.fetchToFile(filename, options.path);
    if (!found) {
      this.logger.warn('Session does not exist.');
      return;
    }

    // Wait a second before giving the zip file to next phase
    await sleep(1_000);
    this.logger.info('Session has been extracted.');
  }

  async init() {
    await this.repository.init();
  }

  private getAuthFileName(options: Options): string {
    return `${options.session}.zip`;
  }

  async close() {
    await this.knex.destroy();
  }
}
