import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import checkDiskSpace from 'check-disk-space';

export interface CheckFreeDiskSpaceOptions {
  path: string;
  thresholdBytes: number;
}

export class CheckFreeDiskSpaceIndicator extends HealthIndicator {
  public async check(
    key: string,
    options: CheckFreeDiskSpaceOptions,
  ): Promise<HealthIndicatorResult> {
    const diskSpace = await checkDiskSpace(options.path);
    if (diskSpace.free < options.thresholdBytes) {
      const result = super.getStatus(key, false, {
        path: options.path,
        diskPath: diskSpace.diskPath,
        free: diskSpace.free,
        threshold: options.thresholdBytes,
      });
      throw new HealthCheckError('Disk space is low', result);
    }
    return super.getStatus(key, true, {
      path: options.path,
      diskPath: diskSpace.diskPath,
      free: diskSpace.free,
      threshold: options.thresholdBytes,
    });
  }
}
