import { Document } from 'bson';
import Knex from 'knex';
import { MongoClient } from 'mongodb';

import { DataStore } from '../../../core/abc/DataStore';

export class MongoStore extends DataStore {
  private mongo: MongoClient;
  private namespace: string;
  private sessionNamespace: string;

  constructor(mongo: MongoClient, namespace: string, sessionNamespace: string) {
    super();
    if (!mongo)
      throw new Error(
        'A valid MongoClient instance is required for MongoStore.',
      );
    this.mongo = mongo;
    this.namespace = namespace;
    this.sessionNamespace = sessionNamespace;
  }

  protected getMainDbName() {
    return `waha_${this.namespace}`;
  }

  protected getSessionDbName(name: string) {
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '_');
    return `waha_${this.sessionNamespace}_${slug}`;
  }

  getMainDb() {
    return this.mongo.db(this.getMainDbName());
  }

  getSessionDb(name: string) {
    return this.mongo.db(this.getSessionDbName(name));
  }

  command(command: Document) {
    return this.mongo.db().admin().command(command);
  }

  async init(sessionName?: string): Promise<void> {
    if (!sessionName) {
      const collection = this.getMainDb().collection('sessions');
      await collection.createIndex({ name: 1 }, { unique: true });
    }
  }

  async close() {
    await this.mongo?.close();
  }

  getWAHADatabase(): Knex.Knex {
    throw new Error(
      'MongoDB is deprecated and will not have all WAHA features. Consider switching to PostgreSQL',
    );
  }
}
