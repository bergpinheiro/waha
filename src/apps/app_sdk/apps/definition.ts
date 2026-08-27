import { AppName } from '@waha/apps/app_sdk/apps/name';

export interface AppDefinition {
  // App name
  name: AppName;
  // If app requires WAHA_API_KEY_PLAIN to work
  plainkey: boolean;
  // If app requires queue to work
  queue: boolean;
  // If app has any migrations
  migrations: boolean;
  // If adding, updating, or removing this app requires a session restart
  restartOnChange: boolean;
  // If only one instance of this app is allowed per session
  unique: boolean;
}

// All Apps
export const APPS: Record<AppName, AppDefinition> = {
  [AppName.calls]: {
    name: AppName.calls,
    plainkey: false,
    queue: false,
    migrations: false,
    restartOnChange: true,
    unique: true,
  },
  [AppName.chatwoot]: {
    name: AppName.chatwoot,
    plainkey: true,
    queue: true,
    migrations: true,
    restartOnChange: true,
    unique: true,
  },
  [AppName.mcp]: {
    name: AppName.mcp,
    plainkey: false,
    queue: false,
    migrations: false,
    restartOnChange: false,
    unique: false,
  },
  [AppName.brazilianPhoneNumbers]: {
    name: AppName.brazilianPhoneNumbers,
    plainkey: false,
    queue: false,
    migrations: true,
    restartOnChange: true,
    unique: true,
  },
};

export function isUniqueApp(name: AppName): boolean {
  return APPS[name]?.unique === true;
}

// Returns the first unique AppName that appears more than once in the list, or null
export function findDuplicateUniqueApp(
  apps: Array<{ app: AppName }>,
): AppName | null {
  const seen = new Set<AppName>();
  for (const app of apps) {
    if (!isUniqueApp(app.app)) {
      continue;
    }
    if (seen.has(app.app)) {
      return app.app;
    }
    seen.add(app.app);
  }
  return null;
}
