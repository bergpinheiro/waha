import { AppModule } from '@waha/apps/app_sdk/apps/definition';
import BrazilianPhoneNumbersAppModule from '@waha/apps/brazilian-phone-numbers/app.module';
import CallsAppModule from '@waha/apps/calls/app.module';
import ChatWootAppModule from '@waha/apps/chatwoot/app.module';
import McpAppModule from '@waha/apps/mcp/app.module';

/**
 * Registry of available apps.
 * Add new apps here - the rest of app_sdk works off this list.
 */
const APPS: AppModule[] = [
  BrazilianPhoneNumbersAppModule,
  CallsAppModule,
  ChatWootAppModule,
  McpAppModule,
];

export function GetApps(): AppModule[] {
  return APPS;
}

export function GetApp(name: string): AppModule | undefined {
  return APPS.find((app) => app.name === name);
}
