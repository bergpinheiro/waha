import { Module } from '@nestjs/common';
import { WhatsappConfigService } from '@waha/config.service';
import { EngineConfigService } from '@waha/core/config/EngineConfigService';
import { MediaStorageFactory } from '@waha/core/media/MediaStorageFactory';
import { PsqlFilesController } from '@waha/core/media/psql/api/psql.files.controller';

import { MediaPsqlStorageConfig } from './MediaPsqlStorageConfig';
import { MediaPsqlStorageFactory } from './MediaPsqlStorageFactory';

@Module({
  providers: [
    {
      provide: MediaStorageFactory,
      useExisting: MediaPsqlStorageFactory,
    },
    MediaPsqlStorageFactory,
    WhatsappConfigService,
    EngineConfigService,
    MediaPsqlStorageConfig,
  ],
  exports: [MediaStorageFactory],
  controllers: [PsqlFilesController],
})
export class MediaPsqlStorageModule {}
