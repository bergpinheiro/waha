import { Logger } from 'pino';
import type { Logger as ZapoLogger, LogLevel as ZapoLogLevel } from 'zapo-js';

/** Not re-exported from the package root, so it is restated here. */
interface LoggerChildOptions {
  readonly level?: ZapoLogLevel;
}

/**
 * Adapts the WAHA pino logger to the Logger interface zapo-js expects.
 *
 * zapo calls `logger.info(message, context)` - message first, structured
 * context second - while pino takes the object first. The order is swapped
 * here so engine logs keep the same shape as the rest of WAHA.
 */
/** The library's wording, matched exactly so a reworded one is not swallowed. */
const ADDON_DECRYPT_FAILED = 'addon auto-decrypt failed';

export class ZapoEngineLogger implements ZapoLogger {
  constructor(private readonly logger: Logger) {}

  get level(): ZapoLogLevel {
    const level = this.logger.level;
    if (level === 'fatal') {
      return 'error';
    }
    if (level === 'silent') {
      return 'error';
    }
    return level as ZapoLogLevel;
  }

  trace(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.logger.trace(context ?? {}, message);
  }

  debug(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.logger.debug(context ?? {}, message);
  }

  info(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.logger.info(context ?? {}, message);
  }

  warn(message: string, context?: Readonly<Record<string, unknown>>): void {
    if (message === ADDON_DECRYPT_FAILED) {
      // Expected on every edit made on this account's phone: the library
      // derives the addon key from the chat rather than from the author, so
      // an addon of ours never authenticates on its path. The engine decrypts
      // that case itself and warns on its own when it cannot, so raising this
      // one would report a failure that did not happen.
      this.logger.debug(context ?? {}, message);
      return;
    }
    this.logger.warn(context ?? {}, message);
  }

  error(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.logger.error(context ?? {}, message);
  }

  child(
    bindings: Readonly<Record<string, unknown>>,
    options?: LoggerChildOptions,
  ): ZapoLogger {
    const child = this.logger.child(
      bindings as Record<string, any>,
      options?.level ? { level: options.level } : undefined,
    );
    return new ZapoEngineLogger(child);
  }
}
