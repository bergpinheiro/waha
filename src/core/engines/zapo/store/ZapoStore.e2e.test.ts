import { FakeWaServer } from '@zapo-js/fake-server';
import { ZapoStoreFactoryCore } from '@waha/core/engines/zapo/store/ZapoStoreFactoryCore';
import { ZapoContactStore } from '@waha/core/engines/zapo/store/ZapoContactStore';
import { buildMessageId } from '@waha/core/engines/zapo/converters';
import { KNEX_SQLITE_CLIENT } from '@waha/core/env';
import { LocalStoreCore } from '@waha/core/storage/LocalStoreCore';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createStore, WaClient, WaStore } from 'zapo-js';

/**
 * The SQLite driver ships as a native binary. When the working copy has one
 * built for another platform the storage half cannot run at all, so it is
 * skipped with the reason rather than reported as a failure of this engine.
 */
function sqliteDriverWorks(): boolean {
  try {
    const driver = require(KNEX_SQLITE_CLIENT);
    if (KNEX_SQLITE_CLIENT === 'better-sqlite3') {
      new driver(':memory:').close();
    }
    return true;
  } catch {
    return false;
  }
}

const SQLITE_AVAILABLE = sqliteDriverWorks();
const describeStorage = SQLITE_AVAILABLE ? describe : describe.skip;

/**
 * Runs the store this engine builds against the library and the in-process
 * fake WhatsApp server, which speaks the real protocol: Noise handshake, QR
 * pairing and Signal (X3DH + Double Ratchet). Nothing is mocked, and no
 * account is involved.
 *
 * The session class itself is not exercised here: importing it pulls in the
 * ESM protobuf bridge, which Jest cannot load (the same reason two of the
 * repository's own suites fail). That part is covered by the live run.
 */

const PEER_JID = '5585999990000@s.whatsapp.net';
const PEER_CHAT_ID = '5585999990000@c.us';
const DEVICE_JID = '5585991203123:12@s.whatsapp.net';
const SESSION = 'zapo-e2e';

function silentLogger(): any {
  const noop = () => undefined;
  const logger: any = {
    level: 'error',
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
  logger.child = () => logger;
  return logger;
}

describe('ZAPO against the fake server', () => {
  let server: FakeWaServer;
  let store: WaStore;
  let client: WaClient;
  // Pairing makes the client reconnect, so the pipeline used afterwards is the
  // one captured after pair-success, not the one that carried the QR.
  let live: any;
  let peer: any;

  beforeAll(async () => {
    server = await FakeWaServer.start();
    // Memory-backed: this half exercises the protocol and the converters, and
    // must not depend on a native database driver being installed.
    store = createStore({});

    client = new WaClient(
      {
        store: store,
        sessionId: SESSION,
        chatSocketUrls: [server.url],
        testHooks: { noiseRootCa: server.noiseRootCa },
      },
      silentLogger(),
    );
  }, 60_000);

  afterAll(async () => {
    await client?.disconnect().catch(() => undefined);
    await server?.stop().catch(() => undefined);
  }, 60_000);

  it('pairs over QR and keeps the credentials in the store', async () => {
    const qrSeen = new Promise<any>((resolve) =>
      client.once('auth_qr', resolve),
    );
    const paired = new Promise<any>((resolve) =>
      client.once('auth_paired', resolve),
    );
    const connecting = client.connect();
    const pipeline = await server.waitForAuthenticatedPipeline(30_000);

    // auth_qr only fires once the server pushes pair-device, so the QR is
    // awaited inside the resolver rather than before.
    await server.runPairing(pipeline, { deviceJid: DEVICE_JID }, async () => {
      const parts: string[] = (await qrSeen).qr.split(',');
      return {
        identityPublicKey: Buffer.from(parts[2], 'base64'),
        advSecretKey: Buffer.from(parts[3], 'base64'),
      };
    });

    const event = await paired;
    await connecting;
    expect(event.credentials.meJid).toEqual(DEVICE_JID);
    expect(client.getState().registered).toBe(true);

    const credentials = await store.session(SESSION).auth.load();
    expect(credentials).toBeTruthy();

    live = await server.waitForNextAuthenticatedPipeline(30_000);
    peer = await server.createFakePeer({ jid: PEER_JID }, live);
  }, 60_000);

  it('receives a message and builds the WAHA id from the real key', async () => {
    const incoming = new Promise<any>((resolve) =>
      client.once('message', resolve),
    );

    await peer.sendConversation('ola do peer falso');
    const event = await incoming;

    expect(event.message?.conversation).toEqual('ola do peer falso');
    expect(event.key.remoteJid).toEqual(PEER_JID);
    expect(event.key.fromMe).toBe(false);
    // The converter has to survive a key produced by the protocol, not a
    // fixture - and emit the customer-facing form the API accepts back.
    expect(buildMessageId(event.key)).toEqual(
      `false_${PEER_CHAT_ID}_${event.key.id}`,
    );
  }, 60_000);

  it('sends a message the peer can decrypt', async () => {
    const expectation = peer.expectMessage();

    const result = await client.message.send(PEER_JID, 'resposta do zapo');
    const seen = await expectation;

    expect(result.id).toBeTruthy();
    expect(seen.message?.conversation).toEqual('resposta do zapo');
  }, 60_000);
});

describeStorage('ZAPO contact store over WAHA storage', () => {
  let baseDir: string;
  let previousBaseDir: string | undefined;
  let localStore: LocalStoreCore;
  let contacts: ZapoContactStore;
  let storage: any;

  beforeAll(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waha-zapo-store-'));
    previousBaseDir = process.env.WAHA_LOCAL_STORE_BASE_DIR;
    process.env.WAHA_LOCAL_STORE_BASE_DIR = baseDir;

    localStore = new LocalStoreCore('zapo', 'zapo');
    await localStore.init(SESSION);

    // The factory hands the contact store back directly: WaStore.session()
    // returns a lock-wrapped bundle, not the instance that was registered.
    storage = new ZapoStoreFactoryCore().createStorage(localStore, SESSION);
    contacts = storage.contacts;
    await contacts.init();
  }, 60_000);

  afterAll(async () => {
    await storage?.close().catch(() => undefined);
    await localStore?.close().catch(() => undefined);
    if (previousBaseDir === undefined) {
      delete process.env.WAHA_LOCAL_STORE_BASE_DIR;
    } else {
      process.env.WAHA_LOCAL_STORE_BASE_DIR = previousBaseDir;
    }
    await fs.rm(baseDir, { recursive: true, force: true });
  }, 60_000);

  it('routes contacts to the WAHA store rather than the library one', () => {
    expect(contacts).toBeInstanceOf(ZapoContactStore);
  });

  it('is only reachable through the factory, not through session()', async () => {
    const other = new ZapoStoreFactoryCore().createStorage(localStore, SESSION);
    // session() hands back a lock-wrapped bundle, so the listing this engine
    // adds is not on it - reading the store back from there loses it.
    const wrapped: any = other.store.session(SESSION).contacts;
    expect(wrapped).not.toBeInstanceOf(ZapoContactStore);
    expect(typeof wrapped.list).not.toEqual('function');
    // ...while the contract the library relies on is still there.
    expect(typeof wrapped.getByJid).toEqual('function');
    await other.close();
  });

  it('stores a contact and reads it back by jid and by phone number', async () => {
    await contacts.upsert({
      jid: PEER_JID,
      pushName: 'Peer Falso',
      lid: '77820596330581@lid',
      phoneNumber: '5585999990000',
      lastUpdatedMs: Date.now(),
    });

    const byJid = await contacts.getByJid(PEER_JID);
    expect(byJid?.pushName).toEqual('Peer Falso');

    // The phone lookup is the reason the column lives outside the JSON blob
    const byPhone = await contacts.getByPhoneNumber('5585999990000');
    expect(byPhone?.jid).toEqual(PEER_JID);
    expect(byPhone?.lid).toEqual('77820596330581@lid');
  }, 60_000);

  it('lists contacts, which the library store cannot do', async () => {
    const all = await contacts.list();
    expect(all.map((contact) => contact.jid)).toContain(PEER_JID);
  }, 60_000);

  it('reports how many rows a delete removed', async () => {
    expect(await contacts.deleteByJid(PEER_JID)).toEqual(1);
    expect(await contacts.deleteByJid(PEER_JID)).toEqual(0);
  }, 60_000);
});
