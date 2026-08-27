import { ApiExtraModels } from '@nestjs/swagger';
import { AppRuntimeConfig } from '@waha/apps/app_sdk/apps/AppRuntime';
import { GetApps } from '@waha/apps/app_sdk/apps/registry';
import { App } from '@waha/apps/app_sdk/dto/app.dto';
import { AppsDisabled } from '@waha/apps/apps.module.disabled';
import { AppsEnabled } from '@waha/apps/apps.module.enabled';

// Swagger models for app configs come from the registry -
// applied here instead of app.dto.ts to avoid a require cycle through the registry
ApiExtraModels(...GetApps().map((app) => app.ConfigClass))(App);

export const AppsModuleExports = AppRuntimeConfig.Enabled()
  ? AppsEnabled
  : AppsDisabled;
