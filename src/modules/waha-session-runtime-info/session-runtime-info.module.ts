import { Module } from '@nestjs/common';
import { SessionRuntimeInfoPluginsProvider } from '@waha/modules/waha-session-runtime-info/session-runtime-info.plugins';
import { SessionPluginsModule } from '@waha/plugins/session.plugins.module';
import { SessionPluginsService } from '@waha/plugins/SessionPluginsService';

@Module({
  imports: [SessionPluginsModule],
  providers: [SessionRuntimeInfoPluginsProvider],
})
export class SessionRuntimeInfoModule {
  constructor(
    sessionPlugins: SessionPluginsService,
    provider: SessionRuntimeInfoPluginsProvider,
  ) {
    sessionPlugins.register(provider);
  }
}
