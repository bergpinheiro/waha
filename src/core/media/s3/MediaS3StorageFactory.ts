import { S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { IMediaStorage } from '@waha/core/media/IMediaStorage';
import { MediaStorageFactory } from '@waha/core/media/MediaStorageFactory';
import { MediaS3Storage } from '@waha/core/media/s3/MediaS3Storage';
import { MediaS3StorageConfig } from '@waha/core/media/s3/MediaS3StorageConfig';
import { MediaS3UrlResolver } from '@waha/core/media/s3/MediaS3UrlResolver';
import { Logger } from 'pino';

@Injectable()
export class MediaS3StorageFactory extends MediaStorageFactory {
  private readonly defaultBucket: string;

  constructor(
    private s3client: S3Client,
    private s3config: MediaS3StorageConfig,
    private s3url: MediaS3UrlResolver,
  ) {
    super();
    this.defaultBucket = this.s3config.bucket;
  }

  async build(name: string, logger: Logger): Promise<IMediaStorage> {
    // S3 uses the same buckets for all sessions
    return new MediaS3Storage(
      this.s3client,
      this.s3url,
      this.defaultBucket,
      logger,
    );
  }
}
