import { populateSessionInfo } from '@waha/core/abc/manager.abc';
import { WhatsappSession } from '@waha/core/abc/session.abc';
import { SessionPlugin } from '@waha/core/abc/session.plugin';
import { WebhookSender } from '@waha/plugins/WebhookPlugin.sender';
import { WAHAEvents, WAHAEventsWild } from '@waha/structures/enums.dto';
import { WebhookConfig } from '@waha/structures/webhooks.config.dto';
import { EventWildUnmask } from '@waha/utils/events';
import { Logger } from 'pino';

export class WebhookPluginConfig {
  webhooks: WebhookConfig[];
}

/**
 * Sends session events to the configured webhooks (per session and global ones)
 */
export class WebhookPlugin extends SessionPlugin<WebhookPluginConfig> {
  private eventUnmask = new EventWildUnmask(WAHAEvents, WAHAEventsWild);

  constructor(
    session: WhatsappSession,
    logger: Logger,
    config: WebhookPluginConfig,
  ) {
    super(session, logger, config);
    for (const webhookConfig of config.webhooks) {
      this.configureSingleWebhook(session, webhookConfig);
    }
  }

  private getSuitableEvents(events: WAHAEvents[] | string[]): WAHAEvents[] {
    return this.eventUnmask.unmask(events);
  }

  private configureSingleWebhook(
    session: WhatsappSession,
    webhook: WebhookConfig,
  ) {
    if (!webhook || !webhook.url || webhook.events.length === 0) {
      return;
    }

    const url = webhook.url;
    this.logger.info(`Configuring webhooks for ${url}...`);
    const events = this.getSuitableEvents(webhook.events);
    const sender = new WebhookSender(this.logger, webhook);
    for (const event of events) {
      const obs$ = session.getEventObservable(event);
      obs$.subscribe((payload) => {
        setImmediate(() => {
          const data = populateSessionInfo(event, session)(payload);
          sender.send(data);
        });
      });
      this.logger.debug(`Event '${event}' is enabled for url: ${url}`);
    }
    this.logger.info(`Webhooks were configured for ${url}.`);
  }
}
