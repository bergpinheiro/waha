import { DataStore } from '@waha/core/abc/DataStore';
import {
  addSuffix,
  changeDatabasePsql,
  PsqlConnectionConfig,
  stringifyPsql,
} from '@waha/core/storage/psql/PsqlConnectionConfig';
import Knex from 'knex';

const PostgreSQLKnexConfig: Knex.Knex.Config = {
  client: 'pg',
  useNullAsDefault: true,
  pool: {
    min: 0,
    max: 10,
  },
  acquireConnectionTimeout: 120_000, // by default, it's 60s
};

export class PsqlStore extends DataStore {
  // postgres database
  // Use to create new databases
  private main: Knex.Knex;

  // waha database
  // Use to store the WAHA session data
  public knex: Knex.Knex;

  constructor(
    private config: PsqlConnectionConfig,
    private namespace: string,
    private sessionNamespace: string,
  ) {
    super();
    this.main = Knex({
      connection: config,
      ...PostgreSQLKnexConfig,
    });
  }

  async init(sessionName?: string): Promise<void> {
    if (!sessionName) {
      if (this.knex) {
        return;
      }
      const dbName = this.getMainDbName();
      await this.upsertDatabase(dbName);
      const config = changeDatabasePsql(this.config, dbName);
      addSuffix(config, 'Sessions');
      this.knex = Knex({
        connection: config,
        ...PostgreSQLKnexConfig,
      });
    } else {
      const dbName = this.getSessionDbName(sessionName);
      await this.upsertDatabase(dbName);
    }
  }

  private async upsertDatabase(name: string) {
    const exists = await this.databaseExists(name);
    if (exists) {
      return;
    }
    await this.createDatabase(name);
  }

  private async databaseExists(databaseName) {
    const result = await this.main
      .select(1)
      .from('pg_database')
      .where('datname', databaseName);

    return result.length > 0; // Returns true if database exists
  }

  private async createDatabase(databaseName) {
    await this.main.raw(`CREATE DATABASE ??`, [databaseName]);
  }

  private async removeDatabase(name: string) {
    const exists = await this.databaseExists(name);
    if (!exists) {
      return;
    }
    // Force close all connections to the database
    await this.main.raw(`DROP DATABASE ?? WITH (FORCE);`, [name]);
  }

  async close(): Promise<any> {
    await this.main.destroy();
    await this.knex?.destroy();
  }

  protected getMainDbName() {
    return `waha_${this.namespace}`;
  }

  protected getSessionDbName(name: string) {
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '_');
    return `waha_${this.sessionNamespace}_${slug}`;
  }

  public async removeDbForSession(name) {
    const dbname = this.getSessionDbName(name);
    await this.removeDatabase(dbname);
  }

  public getSessionDbURL(name): string {
    const dbname = this.getSessionDbName(name);
    const config = changeDatabasePsql(this.config, dbname);
    return stringifyPsql(config);
  }

  public buildSessionKnex(name: string, suffix: string): Knex.Knex {
    const dbName = this.getSessionDbName(name);
    const config = changeDatabasePsql(this.config, dbName);
    addSuffix(config, suffix);
    return Knex({
      connection: config,
      ...PostgreSQLKnexConfig,
    });
  }

  getWAHADatabase(): Knex.Knex {
    if (!this.knex) {
      throw new Error('Knex is not initialized, call LocalStore.init() first');
    }
    return this.knex;
  }
}
