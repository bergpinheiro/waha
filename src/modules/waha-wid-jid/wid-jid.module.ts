import { Module } from '@nestjs/common';
import { WidJIDPluginsProvider } from '@waha/modules/waha-wid-jid/wid-jid.plugins';
import { SessionPluginsModule } from '@waha/plugins/session.plugins.module';
import { SessionPluginsService } from '@waha/plugins/SessionPluginsService';

@Module({
  imports: [SessionPluginsModule],
  providers: [WidJIDPluginsProvider],
})
export class WidJIDModule {
  constructor(
    sessionPlugins: SessionPluginsService,
    provider: WidJIDPluginsProvider,
  ) {
    sessionPlugins.register(provider);
  }
}
