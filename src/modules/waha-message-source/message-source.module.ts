import { Module } from '@nestjs/common';
import { MessageSourcePluginsProvider } from '@waha/modules/waha-message-source/message-source.plugins';
import { SessionPluginsModule } from '@waha/plugins/session.plugins.module';
import { SessionPluginsService } from '@waha/plugins/SessionPluginsService';

@Module({
  imports: [SessionPluginsModule],
  providers: [MessageSourcePluginsProvider],
})
export class MessageSourceModule {
  constructor(
    sessionPlugins: SessionPluginsService,
    provider: MessageSourcePluginsProvider,
  ) {
    sessionPlugins.register(provider);
  }
}
