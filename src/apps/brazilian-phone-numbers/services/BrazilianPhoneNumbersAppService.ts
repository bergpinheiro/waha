import { Injectable } from '@nestjs/common';
import {
  BrazilianPhoneNumbersAppConfig,
  DEFAULT_PERSISTENT_TTL,
} from '@waha/apps/brazilian-phone-numbers/dto/config.dto';
import { BrazilianPhoneGowsPlugin } from '@waha/apps/brazilian-phone-numbers/plugins/BrazilianPhoneGowsPlugin';
import { BrazilianPhoneNowebPlugin } from '@waha/apps/brazilian-phone-numbers/plugins/BrazilianPhoneNowebPlugin';
import { BrazilianPhoneCorePlugin } from '@waha/apps/brazilian-phone-numbers/plugins/BrazilianPhoneCorePlugin';
import { BrazilianPhoneCacheRepository } from '@waha/apps/brazilian-phone-numbers/storage/BrazilianPhoneCacheRepository';
import { App } from '@waha/apps/app_sdk/dto/app.dto';
import { IAppService } from '@waha/apps/app_sdk/services/IAppService';
import { AppDB } from '@waha/apps/app_sdk/storage/types';
import { DataStore } from '@waha/core/abc/DataStore';
import { SessionManager } from '@waha/core/abc/manager.abc';
import { WhatsappSession } from '@waha/core/abc/session.abc';
import { SessionPlugin } from '@waha/core/abc/session.plugin';
import { parseDurationMs } from '@waha/nestjs/validation/IsDuration';
import { WAHAEngine } from '@waha/structures/enums.dto';
import * as ms from 'ms';

// Engines with a local contact/LID store get their own tier; the rest run the
// core pipeline (cache + static rule + WhatsApp lookup).
const PLUGINS: Record<WAHAEngine, typeof BrazilianPhoneCorePlugin> = {
  [WAHAEngine.WEBJS]: BrazilianPhoneCorePlugin,
  [WAHAEngine.WPP]: BrazilianPhoneCorePlugin,
  [WAHAEngine.GOWS]: BrazilianPhoneGowsPlugin,
  [WAHAEngine.NOWEB]: BrazilianPhoneNowebPlugin,
};

@Injectable()
export class BrazilianPhoneNumbersAppService implements IAppService {
  validate(app: App<BrazilianPhoneNumbersAppConfig>): void {
    void app;
    return;
  }

  async beforeCreated(app: App<BrazilianPhoneNumbersAppConfig>): Promise<void> {
    void app;
    return;
  }

  async beforeEnabled(
    manager: SessionManager,
    savedApp: App<BrazilianPhoneNumbersAppConfig>,
    newApp: App<BrazilianPhoneNumbersAppConfig>,
  ): Promise<void> {
    void manager;
    void savedApp;
    void newApp;
  }

  async beforeDisabled(
    manager: SessionManager,
    savedApp: App<BrazilianPhoneNumbersAppConfig>,
    newApp: App<BrazilianPhoneNumbersAppConfig>,
  ): Promise<void> {
    void manager;
    void savedApp;
    void newApp;
  }

  async beforeUpdated(
    manager: SessionManager,
    savedApp: App<BrazilianPhoneNumbersAppConfig>,
    newApp: App<BrazilianPhoneNumbersAppConfig>,
  ): Promise<void> {
    void manager;
    void savedApp;
    void newApp;
  }

  async beforeDeleted(
    manager: SessionManager,
    app: App<BrazilianPhoneNumbersAppConfig>,
  ): Promise<void> {
    void manager;
    void app;
  }

  async afterCreated(
    manager: SessionManager,
    app: App<BrazilianPhoneNumbersAppConfig>,
  ): Promise<void> {
    void manager;
    void app;
  }

  async beforeSessionDeleted(
    manager: SessionManager,
    app: App<BrazilianPhoneNumbersAppConfig>,
  ): Promise<void> {
    void manager;
    void app;
  }

  async enrich(
    manager: SessionManager,
    app: App<BrazilianPhoneNumbersAppConfig>,
  ): Promise<void> {
    void manager;
    void app;
  }

  plugins(
    app: App<BrazilianPhoneNumbersAppConfig>,
    session: WhatsappSession,
    store?: DataStore,
  ): SessionPlugin<any>[] {
    const config = app.config ?? new BrazilianPhoneNumbersAppConfig();
    let repository: BrazilianPhoneCacheRepository | null = null;
    const persistent = config.cache?.persistent ?? true;
    const appPk = (app as AppDB).pk;
    if (persistent && store && appPk) {
      const ttlMs =
        parseDurationMs(config.cache?.persistentTtl) ??
        ms(DEFAULT_PERSISTENT_TTL);
      repository = new BrazilianPhoneCacheRepository(
        store.getWAHADatabase(),
        appPk,
        ttlMs,
      );
    }
    const BrazilianPhonePlugin = PLUGINS[session.engine];
    const logger = session.loggerBuilder.child({
      plugin: BrazilianPhonePlugin.name,
      app: app.app,
    });
    const plugin = new BrazilianPhonePlugin(
      session,
      logger,
      config,
      repository,
    );
    return [plugin];
  }

  beforeSessionStart(
    app: App<BrazilianPhoneNumbersAppConfig>,
    session: WhatsappSession,
  ): void {
    void app;
    void session;
    return;
  }

  afterSessionStart(
    app: App<BrazilianPhoneNumbersAppConfig>,
    session: WhatsappSession,
  ): void {
    void app;
    void session;
    return;
  }
}
