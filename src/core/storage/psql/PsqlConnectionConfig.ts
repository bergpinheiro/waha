export interface PsqlConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  application_name?: string;
  ssl: boolean | { rejectUnauthorized: boolean };
}

export function parsePsql(url: string): PsqlConnectionConfig {
  const urlObj = new URL(url);

  if (urlObj.protocol != 'postgresql:' && urlObj.protocol != 'postgres:') {
    throw new Error('Invalid postgresql url');
  }

  const host = urlObj.hostname;
  const port = parseInt(urlObj.port, 10) || 5432;
  const user = urlObj.username;
  const password = urlObj.password;
  const database = urlObj.pathname.split('/')[1];

  // sslmode=disable
  const ssl =
    urlObj.searchParams.get('sslmode') !== 'disable'
      ? { rejectUnauthorized: false }
      : false;

  return {
    host,
    port,
    user,
    password,
    database,
    ssl,
  };
}

export function changeDatabasePsql(config: PsqlConnectionConfig, name: string) {
  return {
    ...config,
    password: config.password,
    database: name,
  };
}

export function addSuffix(config: PsqlConnectionConfig, suffix: string) {
  suffix = suffix || 'Unknown';
  config.application_name = `${config.application_name}/${suffix}`;
}

export function stringifyPsql(config: PsqlConnectionConfig): string {
  const url = new URL(
    `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`,
  );
  if (!config.ssl) {
    url.searchParams.set('sslmode', 'disable');
  }
  return url.toString();
}
