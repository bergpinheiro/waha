import type { WhatsappSession } from '@waha/core/abc/session.abc';
import { Logger } from 'pino';

export abstract class SessionPlugin<Config = void> {
  constructor(
    public readonly session: WhatsappSession,
    protected logger: Logger,
    protected config: Config,
  ) {}
}
