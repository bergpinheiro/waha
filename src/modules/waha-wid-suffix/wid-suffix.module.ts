import { Module } from '@nestjs/common';
import { WidSuffixPluginsProvider } from '@waha/modules/waha-wid-suffix/wid-suffix.plugins';
import { SessionPluginsModule } from '@waha/plugins/session.plugins.module';
import { SessionPluginsService } from '@waha/plugins/SessionPluginsService';

@Module({
  imports: [SessionPluginsModule],
  providers: [WidSuffixPluginsProvider],
})
export class WidSuffixModule {
  constructor(
    sessionPlugins: SessionPluginsService,
    provider: WidSuffixPluginsProvider,
  ) {
    sessionPlugins.register(provider);
  }
}
