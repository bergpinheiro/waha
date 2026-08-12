import { UnprocessableEntityException } from '@nestjs/common';
import { WhatsappSession } from '@waha/core/abc/session.abc';
import { ZapoEngineLogger } from '@waha/core/engines/zapo/ZapoEngineLogger';
import { ZapoStoreFactoryCore } from '@waha/core/engines/zapo/store/ZapoStoreFactoryCore';
import { NotImplementedByEngineError } from '@waha/core/exceptions';
import { createAgentProxy } from '@waha/core/helpers.proxy';
import { QR } from '@waha/core/QR';
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
} from '@waha/structures/enums.dto';
import { WAMessage } from '@waha/structures/responses.dto';
import type { Agent } from 'https';
import { Subject } from 'rxjs';
import { WaClient, WaIncomingMessageEvent, WaStore } from 'zapo-js';

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

export class WhatsappSessionZapoCore extends WhatsappSession {
  engine = WAHAEngine.ZAPO;

  storeFactory = new ZapoStoreFactoryCore();

  private client: WaClient;
  private store: WaStore;
  private qr: QR;
  private all$: Subject<EngineEvent>;
  private unsubscribes: Array<() => void>;

  public constructor(config) {
    super(config);
    this.qr = new QR();
    this.all$ = new Subject<EngineEvent>();
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
    this.events2.get(WAHAEvents.ENGINE_EVENT).switch(this.all$.asObservable());
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
      { mentions: request.mentions, quote: undefined },
    );
    return this.toWAMessage(chatId, result);
  }

  @Activity()
  async reply(request: MessageReplyRequest) {
    const chatId = toJID(request.chatId);
    const result = await this.client.message.send(
      chatId,
      { type: 'text', text: request.text },
      { quote: this.toQuoteRef(request.reply_to) },
    );
    return this.toWAMessage(chatId, result);
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
    return this.toWAMessage(chatId, result);
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

  sendImage(request: MessageImageRequest) {
    throw new NotImplementedByEngineError();
  }

  sendFile(request: MessageFileRequest) {
    throw new NotImplementedByEngineError();
  }

  sendVoice(request: MessageVoiceRequest) {
    throw new NotImplementedByEngineError();
  }

  private toQuoteRef(replyTo?: string) {
    if (!replyTo) {
      return undefined;
    }
    return { id: replyTo };
  }

  private toWAMessage(chatId: string, result: any): any {
    return {
      id: result?.id,
      to: toCusFormat(chatId),
      fromMe: true,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }
}
