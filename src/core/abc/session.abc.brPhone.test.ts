/**
 * Brazilian 9th-digit resolution (resolveOutboundChatId).
 *
 * Lives in its own file because BR_PHONE_NORMALIZE is read from the
 * environment when core/env is first loaded, so the switch has to be in place
 * before session.abc is required.
 */

const logger: any = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
logger.child = () => logger;

const IGNORE_NOTHING = {
  status: false,
  groups: false,
  channels: false,
  broadcast: false,
};

describe('resolveOutboundChatId - BR 9th digit', () => {
  let BaseSession: any;

  beforeAll(() => {
    process.env.WAHA_BR_PHONE_NORMALIZE = 'true';
    jest.resetModules();
    BaseSession = require('@waha/core/abc/session.abc').WhatsappSession;
  });

  function buildSession(chatIdToAnswer: string): any {
    class TestSession extends BaseSession {
      public lookups: string[] = [];

      constructor(params: any) {
        super(params);
      }

      async checkNumberStatus(request: any) {
        this.lookups.push(request.phone);
        return { numberExists: true, chatId: chatIdToAnswer };
      }
    }

    return new TestSession({
      name: 'test',
      printQR: false,
      loggerBuilder: { child: () => logger },
      sessionStore: null,
      mediaManager: null,
      sessionConfig: null,
      engineConfig: null,
      ignore: IGNORE_NOTHING,
    });
  }

  it('resolves and caches the canonical phone when the engine answers with a PN', async () => {
    // '558591203123' is the real number: DDD 85 with an 8-digit local part.
    const session = buildSession('558591203123@c.us');

    const first = await session.resolveOutboundChatId('5585991203123@c.us');
    const second = await session.resolveOutboundChatId('5585991203123@c.us');

    expect(first).toBe('558591203123@c.us');
    expect(second).toBe('558591203123@c.us');
    // Second call is served from cache - no extra WhatsApp lookup.
    expect(session.lookups).toEqual(['558591203123']);
  });

  it('caches a LID answer as-is instead of stapling a phone suffix on it', async () => {
    // Engines answer with a LID only when the account has no phone form. The
    // LID is routable, but '77820596330581@c.us' - its digits with a phone
    // suffix - addresses nobody.
    const session = buildSession('77820596330581@lid');

    const first = await session.resolveOutboundChatId('5585991203123@c.us');
    const second = await session.resolveOutboundChatId('5585991203123@c.us');

    expect(first).toBe('77820596330581@lid');
    expect(second).toBe('77820596330581@lid');
    expect(session.lookups).toEqual(['558591203123']);
  });

  it('reuses the cache across both forms of the same number', async () => {
    const session = buildSession('558591203123@c.us');

    // Wrong form first, then the already-correct one: same target, one lookup.
    const wrongForm = await session.resolveOutboundChatId('5585991203123@c.us');
    const rightForm = await session.resolveOutboundChatId('558591203123@c.us');

    expect(wrongForm).toBe('558591203123@c.us');
    expect(rightForm).toBe('558591203123@c.us');
    expect(session.lookups).toEqual(['558591203123']);
  });

  it('rewrites a dialed toll-free (0800) to the stored form, no lookup', async () => {
    const session = buildSession('unused@c.us');

    // Dialed forms with and without the country code, plus the already-stored
    // form, all address the same chat id - and none hits the WhatsApp lookup.
    expect(await session.resolveOutboundChatId('08000464636@c.us')).toBe(
      '558000464636@c.us',
    );
    expect(await session.resolveOutboundChatId('5508000464636@c.us')).toBe(
      '558000464636@c.us',
    );
    expect(await session.resolveOutboundChatId('558000464636@c.us')).toBe(
      '558000464636@c.us',
    );
    expect(session.lookups).toEqual([]);
  });
});
