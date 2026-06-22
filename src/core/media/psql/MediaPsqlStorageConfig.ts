import { Injectable } from '@nestjs/common';
import { WhatsappConfigService } from '@waha/config.service';

@Injectable()
export class MediaPsqlStorageConfig {
  public filesUri = '/api/files';

  constructor(private config: WhatsappConfigService) {}

  get databaseUrl(): string {
    const url = this.config.get('WAHA_MEDIA_POSTGRESQL_URL');
    if (!url) {
      throw new Error(
        'WAHA_MEDIA_POSTGRESQL_URL is required to use the PostgreSQL media storage',
      );
    }
    return url;
  }

  get filesURL(): string {
    return `${this.config.baseUrl}${this.filesUri}/`;
  }
}
