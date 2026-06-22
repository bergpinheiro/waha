import { DataStore } from '@waha/core/abc/DataStore';
import { IWPPAuthManager } from '@waha/core/engines/wpp/IWPPAuthManager';
import { WAHASessionStatus } from '@waha/structures/enums.dto';
import { LoggerBuilder } from '@waha/utils/logging';
import { MongoStore } from '@waha/core/storage/mongo/MongoStore';
import { PsqlStore } from '@waha/core/storage/psql/PsqlStore';
import { LocalStore } from '@waha/core/storage/LocalStore';
import { Logger } from 'pino';

import { Zipper } from '../webjs/RemoteAuth';
import { StreamZipper } from '../webjs/StreamZipper';
import { ZipUnzipZipper } from '../webjs/ZipUnzipZipper';
import { WPPAuthManager } from './WPPAuthManager';
import { WPPMongoStore } from './WPPMongoStore';
import { WPPPsqlStore } from './WPPPsqlStore';

export class WPPAuthFactory {
  async build(
    store: DataStore,
    sessionName: string,
    userDataDir: string,
    loggerBuilder: LoggerBuilder,
    getStatus: () => WAHASessionStatus,
  ): Promise<IWPPAuthManager | null> {
    if (store instanceof LocalStore) {
      return null;
    }
    if (store instanceof MongoStore) {
      return this.buildMongo(
        store,
        sessionName,
        userDataDir,
        loggerBuilder,
        getStatus,
      );
    }
    if (store instanceof PsqlStore) {
      return this.buildPsql(
        store,
        sessionName,
        userDataDir,
        loggerBuilder,
        getStatus,
      );
    }
    throw new Error(
      `WPPAuthFactory: unsupported store type '${store.constructor.name}'`,
    );
  }

  private buildMongo(
    store: MongoStore,
    sessionName: string,
    userDataDir: string,
    loggerBuilder: LoggerBuilder,
    getStatus: () => WAHASessionStatus,
  ): IWPPAuthManager {
    const logger = loggerBuilder.child({ name: WPPMongoStore.name });
    const wppStore = new WPPMongoStore(store, sessionName, logger);
    return this.buildManager(
      wppStore,
      sessionName,
      userDataDir,
      loggerBuilder,
      getStatus,
    );
  }

  private async buildPsql(
    store: PsqlStore,
    sessionName: string,
    userDataDir: string,
    loggerBuilder: LoggerBuilder,
    getStatus: () => WAHASessionStatus,
  ): Promise<IWPPAuthManager> {
    const logger = loggerBuilder.child({ name: WPPPsqlStore.name });
    const wppStore = await WPPPsqlStore.build(store, sessionName, logger);
    return this.buildManager(
      wppStore,
      sessionName,
      userDataDir,
      loggerBuilder,
      getStatus,
    );
  }

  private buildManager(
    wppStore: WPPMongoStore | WPPPsqlStore,
    sessionName: string,
    userDataDir: string,
    loggerBuilder: LoggerBuilder,
    getStatus: () => WAHASessionStatus,
  ): WPPAuthManager {
    const logger = loggerBuilder.child({ name: WPPAuthManager.name });
    const zipper = this.getZipper(logger);
    return new WPPAuthManager(
      wppStore,
      sessionName,
      userDataDir,
      zipper,
      logger,
      getStatus,
    );
  }

  private getZipper(logger: Logger): Zipper {
    if (process.env.WAHA_ZIPPER === 'ZIPUNZIP') {
      logger.debug('Using ZipUnzipZipper');
      return new ZipUnzipZipper();
    }
    logger.debug('Using StreamZipper');
    return new StreamZipper();
  }
}
