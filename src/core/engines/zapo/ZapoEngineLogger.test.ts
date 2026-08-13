import { ZapoEngineLogger } from '@waha/core/engines/zapo/ZapoEngineLogger';

function fakeLogger() {
  return {
    level: 'info',
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  };
}

describe('ZapoEngineLogger', () => {
  it('raises an ordinary warning', () => {
    const inner = fakeLogger();
    new ZapoEngineLogger(inner as any).warn('something went wrong', { a: 1 });
    expect(inner.warn).toHaveBeenCalledWith({ a: 1 }, 'something went wrong');
    expect(inner.debug).not.toHaveBeenCalled();
  });

  // The library fails to decrypt every addon this account made, because it
  // derives the key from the chat rather than from the author. The engine
  // decrypts that case itself, so the failure it reports did not happen.
  it('holds back the addon failure the engine recovers from', () => {
    const inner = fakeLogger();
    new ZapoEngineLogger(inner as any).warn('addon auto-decrypt failed', {
      id: 'AAA',
    });
    expect(inner.warn).not.toHaveBeenCalled();
    expect(inner.debug).toHaveBeenCalledWith(
      { id: 'AAA' },
      'addon auto-decrypt failed',
    );
  });
});
