import { MongoStore } from '@waha/core/storage/mongo/MongoStore';
import { Db, GridFSBucket, GridFSFile } from 'mongodb';
import { Logger } from 'pino';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

import { WPPStore } from './WPPStore';

const BUCKET_NAME = 'auth';

export class WPPMongoStore implements WPPStore {
  private readonly db: Db;
  private readonly bucket: GridFSBucket;

  constructor(
    store: MongoStore,
    sessionName: string,
    private readonly logger: Logger,
  ) {
    this.db = store.getSessionDb(sessionName);
    this.bucket = new GridFSBucket(this.db, { bucketName: BUCKET_NAME });
  }

  async sessionExists(sessionName: string): Promise<boolean> {
    const filename = this.getFilename(sessionName);
    const count = await this.db
      .collection(`${BUCKET_NAME}.files`)
      .countDocuments({ filename: filename });
    return count > 0;
  }

  async load(sessionName: string): Promise<Buffer | null> {
    const filename = this.getFilename(sessionName);
    const files = await this.bucket.find({ filename: filename }).toArray();
    if (files.length === 0) {
      return null;
    }

    const chunks: Buffer[] = [];
    const downloadStream = this.bucket.openDownloadStreamByName(filename);
    for await (const chunk of downloadStream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async save(sessionName: string, data: Buffer): Promise<void> {
    const filename = this.getFilename(sessionName);
    const readable = Readable.from(data);
    const uploadStream = this.bucket.openUploadStream(filename);
    await pipeline(readable, uploadStream);
    await this.deletePrevious(filename);
  }

  async delete(sessionName: string): Promise<void> {
    const filename = this.getFilename(sessionName);
    const files = await this.bucket.find({ filename: filename }).toArray();
    await Promise.all(files.map((f: GridFSFile) => this.bucket.delete(f._id)));
  }

  private async deletePrevious(filename: string): Promise<void> {
    const files = await this.bucket.find({ filename: filename }).toArray();
    if (files.length <= 1) {
      return;
    }
    files.sort(
      (a: GridFSFile, b: GridFSFile) =>
        a.uploadDate.getTime() - b.uploadDate.getTime(),
    );
    // Keep the last one, delete the rest
    const toDelete = files.slice(0, files.length - 1);
    await Promise.all(
      toDelete.map((f: GridFSFile) => this.bucket.delete(f._id)),
    );
  }

  private getFilename(sessionName: string): string {
    return `${sessionName}.zip`;
  }
}
