import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';

import { promiseTimeout } from '../../utils/promiseTimeout';
import { MongoStore } from '../storage/mongo/MongoStore';

export interface MongoStoreHealthIndicatorOptions {
  timeout: number;
}

export class MongoStoreHealthIndicator extends HealthIndicator {
  constructor() {
    super();
  }

  private async ping(mongoStore: MongoStore) {
    await mongoStore.command({ ismaster: 1 });
  }

  public async check(
    key: string,
    mongo: MongoStore,
    options: MongoStoreHealthIndicatorOptions,
  ): Promise<HealthIndicatorResult> {
    try {
      await promiseTimeout(options.timeout, this.ping(mongo));
      return super.getStatus(key, true, { message: 'Up and running' });
    } catch (e) {
      const result = super.getStatus(key, false, { error: 'Timeout' });
      throw new HealthCheckError('Timeout happened', result);
    }
  }
}
