import { Injectable } from '@nestjs/common';
import { HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import type { HealthIndicatorFunction } from '@nestjs/terminus/dist/health-indicator';
import { MediaLocalStorageConfig } from '@waha/core/media/local/MediaLocalStorageConfig';
import * as path from 'path';

import { WhatsappConfigService } from '../../config.service';
import { SessionManager } from '../abc/manager.abc';
import { WAHAHealthCheckService } from '../abc/WAHAHealthCheckService';
import { LocalStore } from '../storage/LocalStore';
import { MongoStore } from '../storage/mongo/MongoStore';
import { CheckFreeDiskSpaceIndicator } from './CheckFreeDiskSpaceIndicator';
import { MongoStoreHealthIndicator } from './MongoStoreHealthIndicator';

const MB = 1024 * 1024;

@Injectable()
export class WAHAHealthCheckServiceCore extends WAHAHealthCheckService {
  constructor(
    protected sessionManager: SessionManager,
    protected health: HealthCheckService,
    protected config: WhatsappConfigService,
    protected mongoStoreHealthIndicator: MongoStoreHealthIndicator,
    protected checkFreeDiskSpaceIndicator: CheckFreeDiskSpaceIndicator,
    protected mediaLocalStorageConfig: MediaLocalStorageConfig,
  ) {
    super(sessionManager, health, config);
  }

  check(): Promise<HealthCheckResult> {
    const indicators = this.getIndicators();
    return this.health.check(indicators);
  }

  getIndicators(): HealthIndicatorFunction[] {
    const indicators = [
      () =>
        this.checkFreeDiskSpaceIndicator.check('mediaFiles.space', {
          path: path.resolve(this.mediaLocalStorageConfig.filesFolder),
          thresholdBytes: this.config.getHealthMediaFilesThreshold() * MB,
        }),
    ];
    if (this.sessionManager.store instanceof LocalStore) {
      indicators.push(() =>
        this.checkFreeDiskSpaceIndicator.check('sessionsFiles.space', {
          path: path.resolve(this.sessionManager.store.getBaseDirectory()),
          thresholdBytes: this.config.getHealthSessionFilesThreshold() * MB,
        }),
      );
    }
    if (this.sessionManager.store instanceof MongoStore) {
      indicators.push(() =>
        this.mongoStoreHealthIndicator.check(
          'mongodb',
          this.sessionManager.store,
          { timeout: this.config.getHealthMongoTimeout() },
        ),
      );
    }
    return indicators;
  }
}
