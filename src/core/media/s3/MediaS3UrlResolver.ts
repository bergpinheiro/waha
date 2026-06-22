import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { WhatsappConfigService } from '@waha/config.service';

export interface S3Object {
  bucket: string;
  key: string;
}

export abstract class MediaS3UrlResolver {
  abstract resolve(file: S3Object): Promise<string>;
}

@Injectable()
export class S3Url extends MediaS3UrlResolver {
  PRESIGN_EXPIRES = 3600;

  constructor(private client: S3Client) {
    super();
  }

  async resolve(file: S3Object): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: file.bucket,
      Key: file.key,
    });
    return await getSignedUrl(this.client, command, {
      expiresIn: this.PRESIGN_EXPIRES,
    });
  }
}

@Injectable()
export class S3ProxyUrl extends MediaS3UrlResolver {
  private url = 'api/s3';
  private readonly prefix: string;

  constructor(private config: WhatsappConfigService) {
    super();
    this.prefix = `${this.config.baseUrl}/${this.url}`;
  }

  async resolve(file: S3Object): Promise<string> {
    return `${this.prefix}/${file.bucket}/${file.key}`;
  }
}
