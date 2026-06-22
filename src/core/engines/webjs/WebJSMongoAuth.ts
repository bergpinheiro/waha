import { sleep } from '@nestjs/terminus/dist/utils';
import * as fs from 'fs';
import { Db, GridFSBucket, GridFSFile } from 'mongodb';
import { Logger } from 'pino';
import { pipeline } from 'stream/promises';
import { Store } from 'whatsapp-web.js';

import { MongoStore } from '../../storage/mongo/MongoStore';

class WebJSMongoAuth implements Store {
  private store: MongoStore;
  private logger: Logger;
  private sessionName: string;
  private db: Db;
  private bucket: GridFSBucket;

  constructor(sessionName: string, store: MongoStore, logger: Logger) {
    this.store = store;
    this.logger = logger;
    this.sessionName = sessionName;
    this.db = this.store.getSessionDb(sessionName);
    const bucketName = this.getBucketName();
    this.bucket = new GridFSBucket(this.db, {
      bucketName: bucketName,
    });
  }

  async sessionExists(options) {
    this.checkSessionName(options);
    this.logger.info('Checking if session exists...');
    const filesCollection = this.getFilesCollectionName();
    const multiDeviceCollection = this.db.collection(filesCollection);
    const hasExistingSession = await multiDeviceCollection.countDocuments();
    const result = !!hasExistingSession;
    this.logger.info(`Session exists: ${result}`);
    return result;
  }

  async save(options) {
    this.checkSessionName(options);
    this.logger.debug('Saving session...');
    const filename = this.getAuthFileName(options);
    const readStream = fs.createReadStream(filename);
    const uploadStream = this.bucket.openUploadStream(filename);
    await pipeline(readStream, uploadStream);
    this.logger.debug('Session saved.');
    await this.#deletePrevious(options, this.bucket);
  }

  async extract(options) {
    this.checkSessionName(options);
    this.logger.info('Extracting existing session...');
    const filename = this.getAuthFileName(options);
    const downloadStream = this.bucket.openDownloadStreamByName(filename);
    const writeStream = fs.createWriteStream(options.path);
    await pipeline(downloadStream, writeStream);
    // Wait a second before giving the zip file to next phase
    await sleep(1_000);
    this.logger.info('Session has been extracted.');
  }

  async delete(options) {
    this.checkSessionName(options);
    this.logger.debug('Deleting session...');
    const filename = this.getAuthFileName(options);
    const documents = await this.bucket
      .find({
        filename: filename,
      })
      .toArray();

    documents.map(async (doc) => {
      return this.bucket.delete(doc._id);
    });
    this.logger.debug('Session deleted.');
  }

  async #deletePrevious(options, bucket) {
    const filename = this.getAuthFileName(options);
    const documents = await bucket
      .find({
        filename: filename,
      })
      .toArray();
    if (documents.length > 1) {
      this.logger.debug('Deleting old auth files...');
      // Got all, but not the last one
      const oldDocuments = documents.slice();
      // Sort by uploadDate, desc
      oldDocuments.sort((a, b) => {
        return a.uploadDate - b.uploadDate;
      });
      const keepDocument = oldDocuments.pop();
      this.logger.debug(
        `Keeping document - '${keepDocument.uploadDate}', '${keepDocument._id}'`,
      );
      oldDocuments.map((document: GridFSFile) => {
        this.logger.debug(
          `Deleting document - '${document.uploadDate}', '${document._id}'`,
        );
        return bucket.delete(document._id);
      });
    }
  }

  /**
   * Get session name
   */
  private getSessionName(options): string {
    const prefix = 'RemoteAuth';
    if (!options.session || options.session === prefix) {
      return 'default';
    }
    // Remote prefix
    return options.session.replace(`${prefix}-`, '');
  }

  /**
   * Even tho we accept any "session" in options,
   * but the store hold a single session database link (bucket)
   * This is why we need to check if the session name
   * is the same as the store session name
   */
  private checkSessionName(options) {
    const session = this.getSessionName(options);
    if (session !== this.sessionName) {
      throw new Error(
        `Session name '${session}' does not match the store session name '${this.sessionName}'`,
      );
    }
  }

  private getBucketName(): string {
    return `auth`;
  }

  private getFilesCollectionName(): string {
    const bucket = this.getBucketName();
    return `${bucket}.files`;
  }

  private getAuthFileName(options): string {
    return `${options.session}.zip`;
  }
}

export { WebJSMongoAuth };
