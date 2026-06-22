import { Injectable } from '@nestjs/common';
import { WhatsappConfigService } from '@waha/config.service';
import { parseBool } from '@waha/helpers';

@Injectable()
export class MediaS3StorageConfig {
  constructor(private config: WhatsappConfigService) {}

  get region(): string {
    const region = this.config.get('WAHA_S3_REGION');
    if (!region) {
      throw new Error('WAHA_S3_REGION is required');
    }
    return region;
  }

  get accessKeyId(): string {
    const accessKeyId = this.config.get('WAHA_S3_ACCESS_KEY_ID');
    if (!accessKeyId) {
      throw new Error('WAHA_S3_ACCESS_KEY_ID is required');
    }
    return accessKeyId;
  }

  get secretAccessKey(): string {
    const secretAccessKey = this.config.get('WAHA_S3_SECRET_ACCESS_KEY');
    if (!secretAccessKey) {
      throw new Error('WAHA_S3_SECRET_ACCESS_KEY is required');
    }
    return secretAccessKey;
  }

  get endpoint(): string | null {
    return this.config.get('WAHA_S3_ENDPOINT', null);
  }

  get bucket(): string {
    const bucket = this.config.get('WAHA_S3_BUCKET');
    if (!bucket) {
      throw new Error('WAHA_S3_BUCKET is required');
    }
    return bucket;
  }

  get forcePathStyle(): boolean {
    const value = this.config.get('WAHA_S3_FORCE_PATH_STYLE', 'false');
    return parseBool(value);
  }

  get s3ClientConfig() {
    return {
      region: this.region,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
      endpoint: this.endpoint,
      forcePathStyle: this.forcePathStyle,
    };
  }

  get s3ProxyFiles() {
    const value = this.config.get('WAHA_S3_PROXY_FILES', 'false');
    return parseBool(value);
  }
}
