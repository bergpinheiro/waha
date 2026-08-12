import { UnprocessableEntityException } from '@nestjs/common';
import { createMediaProcessor } from '@zapo-js/media-utils';
import { WhatsappSession } from '@waha/core/abc/session.abc';
import { ZapoEngineLogger } from '@waha/core/engines/zapo/ZapoEngineLogger';
import { ZapoStoreFactoryCore } from '@waha/core/engines/zapo/store/ZapoStoreFactoryCore';
import { NotImplementedByEngineError } from '@waha/core/exceptions';
import { extractBody } from '@waha/core/engines/noweb/session.noweb.core';
import { extractMediaContent } from '@waha/core/engines/noweb/utils';
import { createAgentProxy } from '@waha/core/helpers.proxy';
import { IMediaEngineProcessor } from '@waha/core/media/IMediaEngineProcessor';
import { QR } from '@waha/core/QR';
import { SerializeMessageKey } from '@waha/core/utils/ids';
import { toCusFormat, toJID } from '@waha/core/utils/jids';
import { PairingCodeResponse } from '@waha/structures/auth.dto';
import {
  ChatRequest,
  CheckNumberStatusQuery,
  MessageFileRequest,
  MessageForwardRequest,
  MessageImageRequest,
  MessageLocationRequest,
  MessageReactionRequest,
  MessageReplyRequest,
  MessageTextRequest,
  MessageVideoRequest,
  MessageVoiceRequest,
  SendSeenRequest,
  WANumberExistResult,
} from '@waha/structures/chatting.dto';
import {
  ReadChatMessagesQuery,
  ReadChatMessagesResponse,
} from '@waha/structures/chats.dto';
import {
  WAHAEngine,
  WAHAEvents,
  WAHASessionStatus,
  WAMessageAck,
} from '@waha/structures/enums.dto';
import { BinaryFile, RemoteFile } from '@waha/structures/files.dto';
import { WAMessage } from '@waha/structures/responses.dto';
import type { Agent } from 'https';
import { Subject } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';
import {
  WaClient,
  WaIncomingMessageEvent,
  WaMessagePublishResult,
  WaSendMessageContent,
  WaStore,
} from 'zapo-js';

import { Activity } from '../../abc/activity';

/**
 * Client events forwarded as-is to the 'engine.event' stream. Debug and
 * transport-level events are left out: they fire per frame and would flood
 * the webhook.
 */
const FORWARDED_EVENTS = [
  'message',
  'message_send',
  'message_addon',
  'message_protocol',
  'receipt',
  'presence',
  'chatstate',
  'call',
  'group',
  'newsletter',
  'picture',
  'privacy',
  'blocklist',
  'mutation',
  'stream_failure',
  'stanza_error',
] as const;

interface EngineEvent {
  event: string;
  data: any;
}

/**
 * Thumbnails, audio probing, waveform extraction and voice-note normalization.
 * Backed by sharp and ffmpeg, both already present in the WAHA image. The
 * processor is stateless and documented as safe to share, so one instance
 * serves every session - each call still logs through its own session logger.
 * Missing ffmpeg is non-fatal: the affected step is skipped with a warning.
 */
const MEDIA_PROCESSOR = createMediaProcessor();

/** zapo receipt statuses mapped onto WAHA's numeric ack ladder. */
const ZAPO_RECEIPT_TO_ACK = {
  error: WAMessageAck.ERROR,
  pending: WAMessageAck.PENDING,
  server: WAMessageAck.SERVER,
  delivery: WAMessageAck.DEVICE,
  read: WAMessageAck.READ,
  'read-self': WAMessageAck.READ,
  played: WAMessageAck.PLAYED,
};

function buildMessageId(key: any): string {
  return SerializeMessageKey({
    id: key.id,
    fromMe: key.fromMe,
    remoteJid: key.remoteJid,
    participant: key.participant,
  });
}

export class WhatsappSessionZapoCore extends WhatsappSession {
  engine = WAHAEngine.ZAPO;

  storeFactory = new ZapoStoreFactoryCore();

  private client: WaClient;
  private store: WaStore;
  private qr: QR;
  private all$: Subject<EngineEvent>;
  private incoming$: Subject<WaIncomingMessageEvent>;
  private receipts$: Subject<any>;
  private unsubscribes: Array<() => void>;

  public constructor(config) {
    super(config);
    this.qr = new QR();
    this.all$ = new Subject<EngineEvent>();
    this.incoming$ = new Subject<WaIncomingMessageEvent>();
    this.receipts$ = new Subject<any>();
    this.unsubscribes = [];
  }

  async start() {
    this.status = WAHASessionStatus.STARTING;
    this.buildClient().catch((error) => {
      this.logger.error('Failed to start the client');
      this.logger.error(error, error.stack);
      this.status = WAHASessionStatus.FAILED;
    });
  }

  private async buildClient() {
    this.store = this.storeFactory.createStore(this.sessionStore, this.name);
    const engineLogger = new ZapoEngineLogger(
      this.loggerBuilder.child({ name: 'ZapoEngine' }) as any,
    );

    this.client = new WaClient(
      {
        store: this.store,
        sessionId: this.name,
        proxy: this.buildProxyOptions(),
        media: { processor: MEDIA_PROCESSOR },
      },
      engineLogger,
    );

    this.subscribeEngineEvents();
    this.subscribeEngineEvents2();

    // connect() stays pending until the user scans the QR, so it is not
    // awaited here - auth_qr and auth_paired drive the status instead.
    this.client.connect().catch((error) => {
      this.logger.error('Failed to connect');
      this.logger.error(error, error.stack);
      this.status = WAHASessionStatus.FAILED;
    });
  }

  /**
   * zapo takes an http(s) Agent per leg, not a proxy URL, so the agents WAHA
   * already builds for the other engines are reused as-is. Media goes through
   * the fetch agent because the library downloads over https.request.
   */
  private buildProxyOptions() {
    if (!this.proxyConfig) {
      return undefined;
    }
    const agents = createAgentProxy(this.proxyConfig);
    if (!agents) {
      return undefined;
    }
    return {
      ws: agents.socket as Agent,
      mediaUpload: agents.fetch as Agent,
      mediaDownload: agents.fetch as Agent,
    };
  }

  /**
   * Wires the zapo client events onto the session status and the raw engine
   * stream. Every listener registered here is tracked so stop() can remove
   * it - a client that is reconnected without cleanup would double-emit.
   */
  private subscribeEngineEvents() {
    this.on('auth_qr', (event) => {
      this.qr.save(event.qr);
      this.status = WAHASessionStatus.SCAN_QR_CODE;
    });

    this.on('auth_paired', () => {
      this.qr.save('');
      this.status = WAHASessionStatus.WORKING;
    });

    this.on('connection', (event) => {
      // The library reconnects on its own after an abnormal socket drop and
      // emits nothing while doing so, so a close here is always deliberate:
      // our own disconnect, a logout, or the device being unlinked.
      if (event.status === 'open') {
        this.status = WAHASessionStatus.WORKING;
        return;
      }
      if (event.status === 'close' && event.isLogout) {
        this.status = WAHASessionStatus.FAILED;
      }
    });

    this.on('message', (event) => this.incoming$.next(event));
    this.on('receipt', (event) => this.receipts$.next(event));

    for (const name of FORWARDED_EVENTS) {
      this.on(name, (data) => {
        this.all$.next({ event: name, data: data });
      });
    }
  }

  private on(event: string, listener: (payload: any) => void) {
    this.client.on(event as any, listener);
    this.unsubscribes.push(() => {
      this.client.off(event as any, listener);
    });
  }

  subscribeEngineEvents2() {
    const all$ = this.all$.asObservable();
    this.events2.get(WAHAEvents.ENGINE_EVENT).switch(all$);

    const incoming$ = this.incoming$.asObservable();

    // 'message' carries what the user received, 'message.any' carries both
    // directions, matching how the other engines split the two streams.
    const messages$ = incoming$.pipe(
      mergeMap((event) => this.processIncomingMessage(event)),
      filter(Boolean),
    );
    this.events2
      .get(WAHAEvents.MESSAGE)
      .switch(messages$.pipe(filter((message) => !message.fromMe)));
    this.events2.get(WAHAEvents.MESSAGE_ANY).switch(messages$);

    const acks$ = this.receipts$
      .asObservable()
      .pipe(map((event) => this.toMessageAck(event)));
    this.events2.get(WAHAEvents.MESSAGE_ACK).switch(acks$);
  }

  /**
   * Converts an incoming message and downloads its media, mirroring how the
   * other engines shape the webhook payload.
   */
  protected async processIncomingMessage(
    event: WaIncomingMessageEvent,
    downloadMedia = true,
  ): Promise<WAMessage | null> {
    const message = this.toWAMessage(event);
    if (!message) {
      return null;
    }
    if (downloadMedia) {
      message.media = await this.downloadMediaSafe(event);
    }
    return message;
  }

  private toWAMessage(event: WaIncomingMessageEvent): WAMessage | null {
    const key = event.key;
    if (!key?.remoteJid) {
      return null;
    }
    const chatId = toCusFormat(key.remoteJid);
    const me = this.getSessionMeInfo();
    const body = extractBody(event.message) ?? '';
    return {
      id: buildMessageId(key),
      timestamp: event.timestampSeconds ?? Math.floor(Date.now() / 1000),
      from: chatId,
      fromMe: Boolean(key.fromMe),
      // In groups the sender is the participant; in 1:1 it is the chat itself.
      participant: key.participant ? toCusFormat(key.participant) : undefined,
      to: key.fromMe ? chatId : me?.id ?? '',
      body: body,
      hasMedia: Boolean(extractMediaContent(event.message)),
      ack: WAMessageAck.SERVER,
      ackName: 'SERVER',
      replyTo: undefined,
      _data: event,
    } as WAMessage;
  }

  private toMessageAck(event: any) {
    const ids: string[] = event.ids ?? [event.id];
    const ack = ZAPO_RECEIPT_TO_ACK[event.status] ?? WAMessageAck.SERVER;
    return {
      id: ids[0],
      from: toCusFormat(event.chatJid ?? event.from ?? ''),
      participant: event.participant
        ? toCusFormat(event.participant)
        : undefined,
      fromMe: true,
      ack: ack,
      ackName: WAMessageAck[ack],
      _data: event,
    };
  }

  private async downloadMediaSafe(event: WaIncomingMessageEvent) {
    try {
      const processor = new ZapoEngineMediaProcessor(this);
      return await this.mediaManager.processMedia(processor, event, this.name);
    } catch (error) {
      this.logger.error('Failed when tried to download media for a message');
      this.logger.error(error, error.stack);
      return null;
    }
  }

  /** Raw bytes for the media manager; the library decrypts and verifies. */
  public downloadMediaBytes(
    event: WaIncomingMessageEvent,
  ): Promise<Uint8Array> {
    return this.client.message.downloadBytes(event);
  }

  async stop(): Promise<void> {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes = [];
    await this.client?.disconnect();
    this.client = null;
    this.stopEvents();
  }

  async unpair(): Promise<void> {
    await this.client?.logout();
  }

  async getScreenshot(): Promise<Buffer> {
    if (this.status === WAHASessionStatus.STARTING) {
      throw new UnprocessableEntityException(
        `The session is starting, please try again after few seconds`,
      );
    } else if (this.status === WAHASessionStatus.SCAN_QR_CODE) {
      return this.qr.get();
    } else if (this.status === WAHASessionStatus.WORKING) {
      throw new UnprocessableEntityException(
        `Can not get screenshot for non chrome based engine.`,
      );
    }
    throw new UnprocessableEntityException(`Unknown status - ${this.status}`);
  }

  @Activity()
  async requestCode(
    phoneNumber: string,
    method: string,
    code?: string,
  ): Promise<PairingCodeResponse> {
    const pairingCode = await this.client.auth.requestPairingCode(
      phoneNumber,
      undefined,
      code,
    );
    return { code: pairingCode };
  }

  @Activity()
  async checkNumberStatus(
    request: CheckNumberStatusQuery,
  ): Promise<WANumberExistResult> {
    const phone = request.phone.split('@')[0];
    const results = await this.client.profile.getLidsByPhoneNumbers([phone]);
    const result = results?.[0];
    if (!result?.exists) {
      return { numberExists: false };
    }
    return {
      numberExists: true,
      chatId: toCusFormat(result.phoneJid ?? toJID(phone)),
    };
  }

  @Activity()
  async sendText(request: MessageTextRequest) {
    const chatId = toJID(request.chatId);
    const result = await this.client.message.send(
      chatId,
      { type: 'text', text: request.text },
      { mentions: this.toMentionJids(request.mentions) },
    );
    return this.toSentMessage(chatId, result);
  }

  @Activity()
  async reply(request: MessageReplyRequest) {
    const chatId = toJID(request.chatId);
    const result = await this.client.message.send(
      chatId,
      { type: 'text', text: request.text },
      { quote: this.toQuoteRef(request.reply_to) },
    );
    return this.toSentMessage(chatId, result);
  }

  @Activity()
  async sendLocation(request: MessageLocationRequest) {
    const chatId = toJID(request.chatId);
    const result = await this.client.message.send(chatId, {
      locationMessage: {
        degreesLatitude: request.latitude,
        degreesLongitude: request.longitude,
        name: request.title,
      },
    });
    return this.toSentMessage(chatId, result);
  }

  @Activity()
  async forwardMessage(request: MessageForwardRequest): Promise<WAMessage> {
    throw new NotImplementedByEngineError();
  }

  @Activity()
  async sendSeen(request: SendSeenRequest) {
    const chatId = toJID(request.chatId);
    await this.client.message.sendReceipt(chatId, [request.messageId], {
      type: 'read',
    });
  }

  @Activity()
  async startTyping(request: ChatRequest): Promise<void> {
    await this.client.presence.sendChatstate(toJID(request.chatId), {
      state: 'composing',
    });
  }

  @Activity()
  async stopTyping(request: ChatRequest): Promise<void> {
    await this.client.presence.sendChatstate(toJID(request.chatId), {
      state: 'paused',
    });
  }

  @Activity()
  async setReaction(request: MessageReactionRequest) {
    throw new NotImplementedByEngineError();
  }

  async readChatMessages(
    chatId: string,
    request: ReadChatMessagesQuery,
  ): Promise<ReadChatMessagesResponse> {
    return this.readChatMessagesWSImpl(chatId, request);
  }

  @Activity()
  async fetchContactProfilePicture(id: string): Promise<string | null> {
    const result = await this.client.profile.getProfilePicture(
      toJID(id),
      'image',
    );
    return result?.url ?? null;
  }

  @Activity()
  async sendImage(request: MessageImageRequest) {
    return this.sendMedia(
      request.chatId,
      {
        type: 'image',
        ...(await this.fileToMedia(request.file)),
        caption: request.caption,
      },
      request.mentions,
    );
  }

  @Activity()
  async sendFile(request: MessageFileRequest) {
    return this.sendMedia(
      request.chatId,
      {
        type: 'document',
        ...(await this.fileToMedia(request.file)),
        caption: request.caption,
      },
      request.mentions,
    );
  }

  @Activity()
  async sendVideo(request: MessageVideoRequest) {
    // asNote maps to WhatsApp's push-to-video (round video) message type.
    const content: WaSendMessageContent = request.asNote
      ? { type: 'ptv', ...(await this.fileToMedia(request.file)) }
      : {
          type: 'video',
          ...(await this.fileToMedia(request.file)),
          caption: request.caption,
        };
    return this.sendMedia(request.chatId, content, request.mentions);
  }

  @Activity()
  async sendVoice(request: MessageVoiceRequest) {
    // ptt marks it as a voice note; the media processor normalizes the codec
    // and computes the waveform when ffmpeg is available.
    return this.sendMedia(request.chatId, {
      type: 'audio',
      ...(await this.fileToMedia(request.file)),
      ptt: true,
    });
  }

  private async sendMedia(
    chatId: string,
    content: WaSendMessageContent,
    mentions?: string[],
  ) {
    const jid = toJID(chatId);
    const result = await this.client.message.send(jid, content, {
      mentions: this.toMentionJids(mentions),
    });
    return this.toSentMessage(jid, result);
  }

  /**
   * Turns a WAHA file payload into the media fields zapo's send builder takes.
   * A remote URL is downloaded here rather than handed over as a string: the
   * library would treat a string as a local path.
   */
  private async fileToMedia(file: RemoteFile | BinaryFile) {
    let content: Buffer;
    if ('url' in file) {
      content = await this.fetch(file.url);
    } else if ('data' in file) {
      content = Buffer.from(file.data, 'base64');
    } else {
      throw new UnprocessableEntityException(
        'Either "file.url" or "file.data" must be specified.',
      );
    }
    return {
      media: content,
      mimetype: file.mimetype,
      fileName: file.filename,
    };
  }

  private toMentionJids(mentions?: string[]) {
    if (!mentions?.length) {
      return undefined;
    }
    return mentions.map((mention) => toJID(mention));
  }

  private toQuoteRef(replyTo?: string) {
    if (!replyTo) {
      return undefined;
    }
    return { id: replyTo };
  }

  private toSentMessage(chatId: string, result: WaMessagePublishResult): any {
    return {
      id: result?.id,
      to: toCusFormat(chatId),
      fromMe: true,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }
}

/**
 * Feeds WAHA's media manager from an incoming zapo message: the library keeps
 * the decryption keys on the event, so the whole event is the download handle.
 */
export class ZapoEngineMediaProcessor
  implements IMediaEngineProcessor<WaIncomingMessageEvent>
{
  constructor(public session: WhatsappSessionZapoCore) {}

  hasMedia(message: WaIncomingMessageEvent): boolean {
    return Boolean(extractMediaContent(message.message));
  }

  getFilename(message: WaIncomingMessageEvent): string | null {
    const content: any = extractMediaContent(message.message);
    return content?.fileName ?? null;
  }

  getMimetype(message: WaIncomingMessageEvent): string {
    const content: any = extractMediaContent(message.message);
    return content?.mimetype;
  }

  getMessageId(message: WaIncomingMessageEvent): string {
    return message.key.id;
  }

  getChatId(message: WaIncomingMessageEvent): string {
    return toCusFormat(message.key.remoteJid);
  }

  async getMediaBuffer(
    message: WaIncomingMessageEvent,
  ): Promise<Buffer | null> {
    const bytes = await this.session.downloadMediaBytes(message);
    if (!bytes) {
      return null;
    }
    return Buffer.from(bytes);
  }
}
