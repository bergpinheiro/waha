import {
  GetSerialized,
  GetSerializedMsgKey,
  GetSerializedWid,
} from './serialized';

describe('serialized helpers', () => {
  describe('GetSerializedWid', () => {
    it('returns strings and nullish values as-is', () => {
      expect(GetSerializedWid('123@c.us')).toBe('123@c.us');
      expect(GetSerializedWid(null)).toBeNull();
      expect(GetSerializedWid(undefined)).toBeUndefined();
    });

    it('uses existing _serialized', () => {
      expect(GetSerializedWid({ _serialized: '123@c.us' })).toBe('123@c.us');
    });

    it('ignores the minified $1 property and reconstructs from keys', () => {
      const wid: any = { $1: 'ignored', user: '123', server: 'c.us' };
      expect(GetSerializedWid(wid)).toBe('123@c.us');
      expect(wid._serialized).toBe('123@c.us');
    });

    it('reconstructs from user/server and caches', () => {
      const wid: any = { user: '123', server: 'c.us' };
      expect(GetSerializedWid(wid)).toBe('123@c.us');
      expect(wid._serialized).toBe('123@c.us');
    });

    it('reconstructs a group wid', () => {
      expect(GetSerializedWid({ user: '123-456', server: 'g.us' })).toBe(
        '123-456@g.us',
      );
    });

    it('appends the device when present and truthy', () => {
      expect(GetSerializedWid({ user: '123', server: 'c.us', device: 7 })).toBe(
        '123:7@c.us',
      );
      expect(GetSerializedWid({ user: '123', server: 'c.us', device: 0 })).toBe(
        '123@c.us',
      );
    });

    it('handles the special "call" wid', () => {
      expect(GetSerializedWid({ user: 'call', server: 'call' })).toBe('call');
    });

    it('returns null when it cannot reconstruct (no keys, only $1)', () => {
      expect(GetSerializedWid({ foo: 'bar' })).toBeNull();
      expect(GetSerializedWid({ $1: '123@c.us' })).toBeNull();
    });
  });

  describe('GetSerializedMsgKey', () => {
    it('reconstructs fromMe_remote_id and caches', () => {
      const key: any = {
        fromMe: true,
        remote: { _serialized: '123@c.us' },
        id: 'AAA',
      };
      expect(GetSerializedMsgKey(key)).toBe('true_123@c.us_AAA');
      expect(key._serialized).toBe('true_123@c.us_AAA');
    });

    it('reconstructs a remote wid that only has component keys', () => {
      const key: any = {
        fromMe: false,
        remote: { user: '123', server: 'c.us' },
        id: 'AAA',
      };
      expect(GetSerializedMsgKey(key)).toBe('false_123@c.us_AAA');
    });

    it('appends the participant', () => {
      const key: any = {
        fromMe: false,
        remote: { _serialized: '123-456@g.us' },
        id: 'AAA',
        participant: { _serialized: '789@c.us' },
      };
      expect(GetSerializedMsgKey(key)).toBe('false_123-456@g.us_AAA_789@c.us');
    });

    it('appends self before participant', () => {
      const key: any = {
        fromMe: true,
        remote: { _serialized: '123@c.us' },
        id: 'AAA',
        self: 'out',
        participant: { _serialized: '789@c.us' },
      };
      expect(GetSerializedMsgKey(key)).toBe('true_123@c.us_AAA_out_789@c.us');
    });

    it('ignores $1 and reconstructs from keys', () => {
      const key: any = {
        $1: 'ignored',
        fromMe: true,
        remote: { _serialized: '999@c.us' },
        id: 'BBB',
      };
      expect(GetSerializedMsgKey(key)).toBe('true_999@c.us_BBB');
    });
  });

  describe('GetSerialized (dispatcher)', () => {
    it('dispatches wid shapes', () => {
      expect(GetSerialized({ user: '123', server: 'c.us' })).toBe('123@c.us');
    });

    it('dispatches msgkey shapes', () => {
      expect(
        GetSerialized({
          fromMe: true,
          remote: { user: '123', server: 'c.us' },
          id: 'AAA',
        }),
      ).toBe('true_123@c.us_AAA');
    });

    it('honours existing _serialized before dispatching', () => {
      expect(GetSerialized({ _serialized: 'x@c.us' })).toBe('x@c.us');
    });

    it('returns null for unknown shapes', () => {
      expect(GetSerialized({ foo: 'bar' })).toBeNull();
    });
  });
});
