import { Module } from '@nestjs/common';
import { GlobalWebhookConfig } from '@waha/modules/waha-webhook/webhook.config';
import { WebhookPluginsProvider } from '@waha/modules/waha-webhook/webhook.plugins';
import { SessionPluginsModule } from '@waha/plugins/session.plugins.module';
import { SessionPluginsService } from '@waha/plugins/SessionPluginsService';

@Module({
  imports: [SessionPluginsModule],
  providers: [GlobalWebhookConfig, WebhookPluginsProvider],
})
export class WebhookModule {
  constructor(
    sessionPlugins: SessionPluginsService,
    provider: WebhookPluginsProvider,
  ) {
    sessionPlugins.register(provider);
  }
}
