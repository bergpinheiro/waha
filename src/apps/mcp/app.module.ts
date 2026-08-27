import { AppModule } from '@waha/apps/app_sdk/apps/definition';
import { AppName } from '@waha/apps/app_sdk/apps/apps';
import { McpController } from '@waha/apps/mcp/api/mcp.controller';
import { McpService } from '@waha/apps/mcp/mcp.service';
import { McpAppService } from '@waha/apps/mcp/services/McpAppService';

const McpAppModule: AppModule = {
  name: AppName.mcp,
  definition: {
    plainkey: false,
    queue: false,
    migrations: false,
    restartOnChange: false,
    unique: false,
  },
  nestjs: {
    imports: [],
    controllers: [McpController],
    providers: [McpService, McpAppService],
  },
  Service: McpAppService,
};

export default McpAppModule;
