import { Module } from '@nestjs/common';
import { SessionPluginsModule } from '@waha/plugins/session.plugins.module';
import { SessionPluginsService } from '@waha/plugins/SessionPluginsService';
import { MaintainOnlineStatusConfigService } from '@waha/modules/waha-maintain-online-status/maintain-online-status.config';
import { MaintainOnlineStatusPluginsProvider } from '@waha/modules/waha-maintain-online-status/maintain-online-status.plugins';

@Module({
  imports: [SessionPluginsModule],
  providers: [
    MaintainOnlineStatusConfigService,
    MaintainOnlineStatusPluginsProvider,
  ],
})
export class MaintainOnlineStatusModule {
  constructor(
    sessionPlugins: SessionPluginsService,
    provider: MaintainOnlineStatusPluginsProvider,
  ) {
    sessionPlugins.register(provider);
  }
}
