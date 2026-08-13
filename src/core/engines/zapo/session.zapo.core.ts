import { proto } from '@adiwajshing/baileys';
import { UnprocessableEntityException } from '@nestjs/common';
import { createMediaProcessor } from '@zapo-js/media-utils';
import {
  getChannelInviteLink,
  WhatsappSession,
} from '@waha/core/abc/session.abc';
import { ZapoEngineLogger } from '@waha/core/engines/zapo/ZapoEngineLogger';
import {
  buildMessageId,
  hexColorToArgb,
  matchesChannelRole,
  toParticipantRole,
  toZapoKey,
  WAHA_PRESENCE_TO_CHATSTATE,
  ZAPO_CHANNEL_ROLE,
  ZAPO_RECEIPT_TO_ACK,
} from '@waha/core/engines/zapo/converters';
import {
  ZapoStorage,
  ZapoStoreFactoryCore,
} from '@waha/core/engines/zapo/store/ZapoStoreFactoryCore';
import { NotImplementedByEngineError } from '@waha/core/exceptions';
import { extractBody } from '@waha/core/engines/noweb/session.noweb.core';
import { extractMediaContent } from '@waha/core/engines/noweb/utils';
import { createAgentProxy } from '@waha/core/helpers.proxy';
import { IMediaEngineProcessor } from '@waha/core/media/IMediaEngineProcessor';
import { QR } from '@waha/core/QR';
import {
  parseMessageIdSerialized,
  SerializeMessageKey,
} from '@waha/core/utils/ids';
import {
  isJidGroup,
  isLidUser,
  normalizeJid,
  toCusFormat,
  toJID,
} from '@waha/core/utils/jids';
import { PairingCodeResponse } from '@waha/structures/auth.dto';
import { MeInfo } from '@waha/structures/sessions.dto';
import { DeleteStatusRequest, TextStatus } from '@waha/structures/status.dto';
import {
  Channel,
  ChannelRole,
  CreateChannelRequest,
  ListChannelsQuery,
} from '@waha/structures/channels.dto';
import {
  ChatRequest,
  CheckNumberStatusQuery,
  EditMessageRequest,
  MessageFileRequest,
  MessageForwardRequest,
  MessageImageRequest,
  MessageLocationRequest,
  MessagePollRequest,
  MessagePollVoteRequest,
  MessageReactionRequest,
  MessageReplyRequest,
  MessageStarRequest,
  MessageTextRequest,
  MessageVideoRequest,
  MessageVoiceRequest,
  SendSeenRequest,
  WANumberExistResult,
} from '@waha/structures/chatting.dto';
import {
  ChatSummary,
  GetChatMessageQuery,
  GetChatMessagesFilter,
  GetChatMessagesQuery,
  OverviewFilter,
  ReadChatMessagesQuery,
  ReadChatMessagesResponse,
} from '@waha/structures/chats.dto';
import {
  CreateGroupRequest,
  GroupParticipant,
  GroupParticipantRole,
  ParticipantsRequest,
  SettingsMemberAddMode,
  SettingsSecurityChangeInfo,
} from '@waha/structures/groups.dto';
import { PaginationParams } from '@waha/structures/pagination.dto';
import {
  SECOND,
  WAHAEngine,
  WAHAPresenceStatus,
  WAHAEvents,
  WAHASessionStatus,
  WAMessageAck,
} from '@waha/structures/enums.dto';
import { ContactQuery, ContactRequest } from '@waha/structures/contacts.dto';
import { BinaryFile, RemoteFile } from '@waha/structures/files.dto';
import { WAMessage } from '@waha/structures/responses.dto';
import type { Agent } from 'https';
import { Subject } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';
import {
  WaClient,
  WaIncomingMessageEvent,
  WaMessageKey,
  WaGroupMetadata,
  WaGroupParticipant,
  WaNewsletterMetadata,
  WaStoredContactRecord,
  WaStoredMessageRecord,
  WaStoredThreadRecord,
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

export class WhatsappSessionZapoCore extends WhatsappSession {
  engine = WAHAEngine.ZAPO;

  storeFactory = new ZapoStoreFactoryCore();

  private client: WaClient;
  private storage: ZapoStorage;
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
    this.storage = this.storeFactory.createStorage(
      this.sessionStore,
      this.name,
    );
    // Creates the contacts table before the library starts writing to it.
    await this.storage.contacts.init();
    const engineLogger = new ZapoEngineLogger(
      this.loggerBuilder.child({ name: 'ZapoEngine' }) as any,
    );

    this.client = new WaClient(
      {
        store: this.storage.store,
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
        this.presence = null;
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
    // Releases the database connections opened for this session.
    await this.storage?.close();
    this.storage = null;
    this.stopEvents();
  }

  async unpair(): Promise<void> {
    await this.client?.logout();
  }

  /**
   * The account behind the session, which the dashboard and the session
   * endpoints read. The library keeps it on the credentials, so it survives a
   * restart without asking the server again.
   *
   * `id` is the phone-addressed jid without the device suffix, matching what
   * the other engines report; `jid` keeps the device number.
   */
  public getSessionMeInfo(): MeInfo | null {
    const credentials = this.client?.getCredentials();
    if (!credentials?.meJid) {
      return null;
    }
    return {
      // The stored jid carries the device number; `id` drops it to match what
      // the other engines report, while `jid` keeps it.
      id: toCusFormat(normalizeJid(credentials.meJid)),
      lid: credentials.meLid ? normalizeJid(credentials.meLid) : undefined,
      jid: credentials.meJid,
      pushName: credentials.pushName ?? credentials.meDisplayName,
    };
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

  /**
   * Forwarding needs the original content, which the message store keeps as
   * raw proto bytes. A message the session never saw cannot be forwarded.
   */
  @Activity()
  async forwardMessage(request: MessageForwardRequest): Promise<WAMessage> {
    const key = toZapoKey(request.messageId, request.chatId);
    const stored = await this.storage.store
      .session(this.name)
      .messages.getById(key.id);
    if (!stored?.messageBytes) {
      throw new UnprocessableEntityException(
        `Message '${request.messageId}' is not available to forward.`,
      );
    }
    // Both packages generate their own class for the same protobuf message,
    // so the structurally identical value needs a bridge through the shape
    // zapo declares.
    const content = proto.Message.decode(
      stored.messageBytes,
    ) as unknown as WaSendMessageContent;
    const jid = toJID(request.chatId);
    const result = await this.client.message.send(jid, content, {
      forward: true,
    });
    return this.toSentMessage(jid, result);
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
    const key = toZapoKey(request.messageId);
    // An empty emoji revokes the reaction, which is what WAHA sends too.
    await this.client.message.send(key.remoteJid, {
      type: 'reaction',
      emoji: request.reaction,
      target: key,
    });
  }

  @Activity()
  async setStar(request: MessageStarRequest): Promise<void> {
    const key = toZapoKey(request.messageId, request.chatId);
    // The app-state mutation uses its own key naming.
    await this.client.chat.setMessageStar(
      {
        chatJid: key.remoteJid,
        id: key.id,
        fromMe: key.fromMe,
        participantJid: key.participant,
      },
      request.star,
    );
  }

  @Activity()
  async deleteMessage(chatId: string, messageId: string) {
    const key = toZapoKey(messageId, chatId);
    await this.client.message.send(toJID(chatId), {
      type: 'revoke',
      target: key,
    });
  }

  @Activity()
  async editMessage(
    chatId: string,
    messageId: string,
    request: EditMessageRequest,
  ) {
    const key = toZapoKey(messageId, chatId);
    const jid = toJID(chatId);
    const result = await this.client.message.send(
      jid,
      { type: 'text', text: request.text },
      {
        editKey: { id: key.id },
        mentions: this.toMentionJids(request.mentions),
      },
    );
    return this.toSentMessage(jid, result);
  }

  @Activity()
  async pinMessage(
    chatId: string,
    messageId: string,
    duration: number,
  ): Promise<boolean> {
    const key = toZapoKey(messageId, chatId);
    // Without a duration the receiving clients drop the pin silently.
    await this.client.message.send(toJID(chatId), {
      type: 'pin',
      target: key,
      durationSecs: duration,
    });
    return true;
  }

  @Activity()
  async unpinMessage(chatId: string, messageId: string): Promise<boolean> {
    const key = toZapoKey(messageId, chatId);
    await this.client.message.send(toJID(chatId), {
      type: 'unpin',
      target: key,
    });
    return true;
  }

  @Activity()
  async sendPoll(request: MessagePollRequest) {
    const jid = toJID(request.chatId);
    const result = await this.client.message.send(jid, {
      type: 'poll',
      name: request.poll.name,
      options: request.poll.options,
      selectableCount: request.poll.multipleAnswers
        ? request.poll.options.length
        : 1,
    });
    return this.toSentMessage(jid, result);
  }

  /**
   * A vote is encrypted with the parent poll's secret, which the library keeps
   * in the message-secret store when the poll arrives. A poll this session
   * never received cannot be voted on.
   */
  @Activity()
  async sendPollVote(request: MessagePollVoteRequest) {
    const key = toZapoKey(request.pollMessageId, request.chatId);
    const entry = await this.storage.store
      .session(this.name)
      .messageSecret.get(key.id);
    if (!entry) {
      throw new UnprocessableEntityException(
        `Poll '${request.pollMessageId}' is not available to vote on.`,
      );
    }
    const jid = toJID(request.chatId);
    const result = await this.client.message.send(jid, {
      type: 'poll-vote',
      poll: {
        id: key.id,
        fromMe: key.fromMe,
        participant: key.participant,
        authorJid: entry.senderJid,
        messageSecret: entry.secret,
      },
      selectedOptionNames: request.votes,
    });
    return this.toSentMessage(jid, result);
  }

  @Activity()
  async chatsArchiveChat(chatId: string): Promise<any> {
    await this.client.chat.setChatArchive(toJID(chatId), true);
  }

  @Activity()
  async chatsUnarchiveChat(chatId: string): Promise<any> {
    await this.client.chat.setChatArchive(toJID(chatId), false);
  }

  @Activity()
  async chatsUnreadChat(chatId: string): Promise<any> {
    await this.client.chat.setChatRead(toJID(chatId), false);
  }

  @Activity()
  async deleteChat(chatId: string) {
    await this.client.chat.deleteChat(toJID(chatId));
  }

  @Activity()
  async clearMessages(chatId: string) {
    await this.client.chat.clearChat(toJID(chatId));
  }

  /**
   * Chats and messages are read from the store the library fills as the
   * session runs, so they only cover what this session has seen.
   */
  async getChats(pagination: PaginationParams) {
    const threads = await this.storage.store
      .session(this.name)
      .threads.list(pagination?.limit);
    return threads.map((thread) => this.toChatSummary(thread));
  }

  async getChatsOverview(
    pagination: PaginationParams,
    filter?: OverviewFilter,
  ): Promise<ChatSummary[]> {
    const chats = await this.getChats(pagination);
    const ids = filter?.ids?.map((id) => toJID(id));
    const selected = ids
      ? chats.filter((chat) => ids.includes(toJID(chat.id)))
      : chats;
    return Promise.all(selected.map((chat) => this.fetchChatSummary(chat)));
  }

  /**
   * Fills in what the thread store does not carry, following the same shape
   * the other engines return: WhatsApp only names group and channel threads,
   * so a 1:1 chat takes its name from the contact.
   */
  protected async fetchChatSummary(chat: ChatSummary): Promise<ChatSummary> {
    if (!chat.name && !isJidGroup(toJID(chat.id))) {
      chat.name = await this.resolveContactName(chat.id);
    }
    chat.picture = await this.getContactProfilePicture(chat.id, false);
    chat.lastMessage = await this.getLastMessage(chat.id);
    return chat;
  }

  private async resolveContactName(chatId: string): Promise<string | null> {
    // Contacts are keyed by whichever jid addressed them, which today is
    // usually the @lid one, so a phone-addressed chat is found through the
    // phone column - which holds a full jid, not digits.
    const jid = toJID(chatId);
    const contact =
      (await this.storage.contacts.getByJid(jid)) ??
      (await this.storage.contacts.getByPhoneNumber(jid));
    return contact?.displayName ?? contact?.pushName ?? null;
  }

  async getChatMessages(
    chatId: string,
    query: GetChatMessagesQuery,
    filter: GetChatMessagesFilter,
  ): Promise<WAMessage[]> {
    const records = await this.storage.store
      .session(this.name)
      .messages.listByThread(
        toJID(chatId),
        query?.limit,
        filter?.['filter.timestamp.lte']
          ? filter['filter.timestamp.lte'] * SECOND
          : undefined,
      );
    const messages: WAMessage[] = [];
    for (const record of records) {
      const message = await this.storedToWAMessage(
        record,
        query?.downloadMedia ?? true,
      );
      if (message) {
        messages.push(message);
      }
    }
    return this.applyMessageFilter(messages, filter);
  }

  async getChatMessage(
    chatId: string,
    messageId: string,
    query: GetChatMessageQuery,
  ): Promise<null | WAMessage> {
    const key = toZapoKey(messageId, chatId);
    const record = await this.storage.store
      .session(this.name)
      .messages.getById(key.id);
    if (!record) {
      return null;
    }
    return this.storedToWAMessage(record, query?.downloadMedia ?? true);
  }

  private async getLastMessage(chatId: string) {
    const records = await this.storage.store
      .session(this.name)
      .messages.listByThread(toJID(chatId), 1);
    if (!records.length) {
      return null;
    }
    return this.storedToWAMessage(records[0], false);
  }

  private toChatSummary(thread: WaStoredThreadRecord): ChatSummary {
    return {
      id: toCusFormat(thread.jid),
      name: thread.name ?? null,
      picture: null,
      lastMessage: null,
      _chat: thread,
    };
  }

  /**
   * Rebuilds a webhook-shaped message from what the store kept. The store
   * holds the raw proto, so the same converter as the live path is reused by
   * rebuilding the event around it.
   */
  private async storedToWAMessage(
    record: WaStoredMessageRecord,
    downloadMedia: boolean,
  ): Promise<WAMessage | null> {
    if (!record.messageBytes) {
      return null;
    }
    const event = {
      key: {
        remoteJid: record.threadJid,
        id: record.id,
        fromMe: record.fromMe,
        participant: record.participantJid,
      },
      message: proto.Message.decode(record.messageBytes),
      timestampSeconds: record.timestampMs
        ? Math.floor(record.timestampMs / SECOND)
        : undefined,
    } as unknown as WaIncomingMessageEvent;
    return this.processIncomingMessage(event, downloadMedia);
  }

  private applyMessageFilter(
    messages: WAMessage[],
    filter: GetChatMessagesFilter,
  ): WAMessage[] {
    if (!filter) {
      return messages;
    }
    let result = messages;
    const fromMe = filter['filter.fromMe'];
    if (fromMe !== undefined) {
      result = result.filter((message) => message.fromMe === fromMe);
    }
    const gte = filter['filter.timestamp.gte'];
    if (gte !== undefined) {
      result = result.filter((message) => message.timestamp >= gte);
    }
    return result;
  }

  async readChatMessages(
    chatId: string,
    request: ReadChatMessagesQuery,
  ): Promise<ReadChatMessagesResponse> {
    return this.readChatMessagesWSImpl(chatId, request);
  }

  @Activity()
  async setProfileName(name: string): Promise<boolean> {
    await this.client.profile.setPushName(name);
    return true;
  }

  @Activity()
  async setProfileStatus(status: string): Promise<boolean> {
    await this.client.profile.setStatus(status);
    return true;
  }

  @Activity()
  async updateProfilePicture(
    file: BinaryFile | RemoteFile | null,
  ): Promise<boolean> {
    if (!file) {
      await this.client.profile.deleteProfilePicture();
      return true;
    }
    // The library uploads the bytes as-is, so the caller must send a picture
    // WhatsApp accepts (square JPEG) - there is no transcoding step.
    const media = await this.fileToMedia(file);
    await this.client.profile.setProfilePicture(media.media);
    return true;
  }

  /**
   * Reads from WAHA's own contact store, which the session store routes the
   * contacts domain to. The library's store has keyed lookup only, so listing
   * would not be possible on top of it.
   */
  @Activity()
  async getContacts(pagination: PaginationParams) {
    const contacts = await this.storage.contacts.list(pagination);
    return contacts.map((contact) => this.toContact(contact));
  }

  @Activity()
  async getContact(query: ContactQuery) {
    const jid = toJID(query.contactId);
    const stored = await this.storage.store
      .session(this.name)
      .contacts.getByJid(jid);
    if (stored) {
      return this.toContact(stored);
    }
    const [profile] = await this.client.profile.getProfiles([jid]);
    if (!profile) {
      return null;
    }
    return {
      id: toCusFormat(profile.jid),
      name: null,
      pushname: null,
    };
  }

  @Activity()
  async getContactAbout(query: ContactQuery): Promise<{ about: string }> {
    const about = await this.client.profile.getAboutStatus(
      toJID(query.contactId),
    );
    return { about: about };
  }

  @Activity()
  async blockContact(request: ContactRequest) {
    await this.client.privacy.blockUser(toJID(request.contactId));
  }

  @Activity()
  async unblockContact(request: ContactRequest) {
    await this.client.privacy.unblockUser(toJID(request.contactId));
  }

  /**
   * Status updates need an explicit recipient list. The other engines fall
   * back to "everyone in my contacts", which this engine cannot do: the
   * contact store has no enumeration (see getContacts).
   */
  @Activity()
  async sendTextStatus(status: TextStatus) {
    const recipients = this.requireStatusRecipients(status.contacts);
    // The typed text content carries no styling, so the styled status goes
    // through the raw proto, which the send builder also accepts.
    return this.client.status.send({
      content: {
        extendedTextMessage: {
          text: status.text,
          backgroundArgb: hexColorToArgb(status.backgroundColor),
          font: status.font,
        },
      } as unknown as WaSendMessageContent,
      recipients: recipients,
    });
  }

  @Activity()
  async deleteStatus(request: DeleteStatusRequest) {
    const recipients = this.requireStatusRecipients(request.contacts);
    await this.client.status.revokeStatus({
      messageId: request.id,
      recipients: recipients,
    });
  }

  private requireStatusRecipients(contacts?: string[]): string[] {
    if (!contacts?.length) {
      throw new UnprocessableEntityException(
        'Provide "contacts" - this engine cannot resolve the full contact list.',
      );
    }
    return contacts.map((contact) => toJID(contact));
  }

  /**
   * Calls are read-only in the library, so the reject is written as a raw
   * stanza. The caller's exact jid is used with no normalization - a
   * normalized jid addresses a different device and the reject is dropped.
   */
  @Activity()
  async rejectCall(from: string, id: string): Promise<void> {
    const caller = toJID(from);
    await this.client.lowlevel.sendNode({
      tag: 'call',
      // The stanza id doubles as the call id, which is already unique.
      attrs: { to: caller, id: id },
      content: [
        {
          tag: 'reject',
          attrs: {
            'call-id': id,
            'call-creator': caller,
            count: '0',
          },
        },
      ],
    });
  }

  @Activity()
  async channelsList(query: ListChannelsQuery): Promise<Channel[]> {
    const newsletters = await this.client.newsletter.listSubscribed();
    const channels = newsletters.map((data) => this.toChannel(data));
    return channels.filter((channel) =>
      matchesChannelRole(channel.role, query?.role),
    );
  }

  @Activity()
  async channelsCreateChannel(request: CreateChannelRequest): Promise<Channel> {
    let picture: Uint8Array;
    if (request.picture) {
      const media = await this.fileToMedia(request.picture);
      picture = media.media;
    }
    const created = await this.client.newsletter.create({
      name: request.name,
      description: request.description,
      picture: picture,
    });
    return this.toChannel(created);
  }

  @Activity()
  async channelsGetChannel(id: string): Promise<Channel> {
    const data = await this.client.newsletter.fetch(toJID(id));
    return this.toChannel(data);
  }

  @Activity()
  async channelsGetChannelByInviteCode(inviteCode: string): Promise<Channel> {
    const data = await this.client.newsletter.fetchByInvite(inviteCode);
    return this.toChannel(data);
  }

  @Activity()
  async channelsDeleteChannel(id: string): Promise<void> {
    await this.client.newsletter.delete(toJID(id));
  }

  @Activity()
  async channelsFollowChannel(id: string): Promise<void> {
    await this.client.newsletter.follow(toJID(id));
  }

  @Activity()
  async channelsUnfollowChannel(id: string): Promise<void> {
    await this.client.newsletter.unfollow(toJID(id));
  }

  @Activity()
  async channelsMuteChannel(id: string): Promise<void> {
    await this.client.newsletter.mute({
      newsletterJid: toJID(id),
      mute: true,
    });
  }

  @Activity()
  async channelsUnmuteChannel(id: string): Promise<void> {
    await this.client.newsletter.mute({
      newsletterJid: toJID(id),
      mute: false,
    });
  }

  private toChannel(data: WaNewsletterMetadata): Channel {
    return {
      id: data.jid,
      name: data.name ?? null,
      description: data.description ?? null,
      invite: data.invite ? getChannelInviteLink(data.invite) : null,
      preview: data.preview?.directPath ?? null,
      picture: data.picture?.directPath ?? null,
      verified: Boolean(data.verification),
      subscribersCount: data.subscribersCount ?? null,
      role: ZAPO_CHANNEL_ROLE[data.viewerRole] ?? ChannelRole.GUEST,
    } as Channel;
  }

  @Activity()
  async createGroup(request: CreateGroupRequest) {
    const participants = request.participants.map((p) => toJID(p.id));
    const metadata = await this.client.group.createGroup(
      request.name,
      participants,
    );
    return this.toGroup(metadata);
  }

  @Activity()
  async getGroups(pagination: PaginationParams): Promise<any> {
    const groups = await this.client.group.queryAllGroups();
    const limited = pagination?.limit
      ? groups.slice(0, pagination.limit)
      : groups;
    return limited.map((metadata) => this.toGroup(metadata));
  }

  @Activity()
  async getGroup(id: string) {
    const metadata = await this.client.group.queryGroupMetadata(toJID(id));
    return this.toGroup(metadata);
  }

  /**
   * The library queries the server on every call and keeps its own metadata
   * cache warm, so there is no separate refresh step to trigger.
   */
  async refreshGroups(): Promise<boolean> {
    return true;
  }

  @Activity()
  async joinGroup(code: string): Promise<string> {
    const metadata = await this.client.group.joinGroupViaInvite(code);
    return toCusFormat(metadata.jid);
  }

  @Activity()
  async joinInfoGroup(code: string): Promise<any> {
    return this.client.group.queryGroupInviteInfo(code);
  }

  @Activity()
  async leaveGroup(id: string) {
    await this.client.group.leaveGroup([toJID(id)]);
  }

  @Activity()
  async getInviteCode(id: string): Promise<string> {
    return this.client.group.queryInviteCode(toJID(id));
  }

  @Activity()
  async revokeInviteCode(id: string): Promise<string> {
    const result = await this.client.group.revokeInvite(toJID(id));
    return result?.code;
  }

  @Activity()
  async getParticipants(id: string) {
    return this.getGroupParticipants(id);
  }

  @Activity()
  async getGroupParticipants(id: string): Promise<GroupParticipant[]> {
    const metadata = await this.client.group.queryGroupMetadata(toJID(id));
    return metadata.participants.map((participant) => ({
      id: toCusFormat(participant.jid),
      role: toParticipantRole(participant),
    }));
  }

  @Activity()
  async addParticipants(id: string, request: ParticipantsRequest) {
    await this.client.group.addParticipants(
      toJID(id),
      request.participants.map((p) => toJID(p.id)),
    );
  }

  @Activity()
  async removeParticipants(id: string, request: ParticipantsRequest) {
    await this.client.group.removeParticipants(
      toJID(id),
      request.participants.map((p) => toJID(p.id)),
    );
  }

  @Activity()
  async promoteParticipantsToAdmin(id: string, request: ParticipantsRequest) {
    await this.client.group.promoteParticipants(
      toJID(id),
      request.participants.map((p) => toJID(p.id)),
    );
  }

  @Activity()
  async demoteParticipantsToUser(id: string, request: ParticipantsRequest) {
    await this.client.group.demoteParticipants(
      toJID(id),
      request.participants.map((p) => toJID(p.id)),
    );
  }

  @Activity()
  async setSubject(id: string, subject: string) {
    await this.client.group.setSubject(toJID(id), subject);
  }

  @Activity()
  async setDescription(id: string, description: string) {
    await this.client.group.setDescription(toJID(id), description);
  }

  // 'restrict' locks group info to admins; 'announcement' locks messages.
  // Both are read back from the metadata flags rather than a dedicated query.
  @Activity()
  async getInfoAdminsOnly(id: string): Promise<SettingsSecurityChangeInfo> {
    const metadata = await this.client.group.queryGroupMetadata(toJID(id));
    return { adminsOnly: metadata.restrict };
  }

  @Activity()
  async setInfoAdminsOnly(id: string, value: SettingsSecurityChangeInfo) {
    await this.client.group.setSetting(toJID(id), 'restrict', value.adminsOnly);
  }

  @Activity()
  async getMessagesAdminsOnly(id: string): Promise<SettingsSecurityChangeInfo> {
    const metadata = await this.client.group.queryGroupMetadata(toJID(id));
    return { adminsOnly: metadata.announce };
  }

  @Activity()
  async setMessagesAdminsOnly(id: string, value: SettingsSecurityChangeInfo) {
    await this.client.group.setSetting(
      toJID(id),
      'announcement',
      value.adminsOnly,
    );
  }

  @Activity()
  async setMemberAddMode(id: string, value: SettingsMemberAddMode) {
    const mode = value.membersCanAddNewMember ? 'all_member_add' : 'admin_add';
    await this.client.group.setMemberAddMode(toJID(id), mode);
  }

  private toGroup(metadata: WaGroupMetadata) {
    return {
      id: toCusFormat(metadata.jid),
      subject: metadata.subject,
      description: metadata.desc ?? null,
      owner: metadata.owner ? toCusFormat(metadata.owner) : null,
      creation: metadata.creation ?? null,
      participants: (metadata.participants ?? []).map((participant) => ({
        id: toCusFormat(participant.jid),
        role: toParticipantRole(participant),
      })),
      _data: metadata,
    };
  }

  @Activity()
  async setPresence(
    presence: WAHAPresenceStatus,
    chatId?: string,
  ): Promise<void> {
    // Global availability and per-chat typing are different stanzas: with a
    // chatId it is a chatstate, without one it is the account presence.
    if (chatId) {
      const state = WAHA_PRESENCE_TO_CHATSTATE[presence];
      if (!state) {
        throw new UnprocessableEntityException(
          `Presence '${presence}' is not a chat presence.`,
        );
      }
      await this.client.presence.sendChatstate(toJID(chatId), { state: state });
      return;
    }
    const type =
      presence === WAHAPresenceStatus.ONLINE ? 'available' : 'unavailable';
    await this.client.presence.send(type);
    // The base setter keeps the account-wide value and drops chat ones, and
    // this is what feeds session.presence - without it the session reports
    // null forever, including under WAHA_PRESENCE_AUTO_ONLINE.
    this.presence = presence;
  }

  @Activity()
  async subscribePresence(id: string): Promise<any> {
    await this.client.presence.subscribe(toJID(id));
  }

  /**
   * The library stores whichever jid addressed the contact, which today is
   * usually the @lid one, and keeps the phone side as a full jid rather than
   * digits. `id` is normalized to the phone-addressed chat id so it matches
   * what the other engines return, falling back to the stored jid when the
   * phone side is unknown.
   */
  private toContact(contact: WaStoredContactRecord) {
    const phoneJid = contact.phoneNumber;
    return {
      id: toCusFormat(phoneJid ?? contact.jid),
      name: contact.displayName ?? null,
      pushname: contact.pushName ?? null,
      // Both identities are already indexed here, which the other engines
      // have to resolve with an extra query.
      lid: contact.lid ?? (isLidUser(contact.jid) ? contact.jid : null),
      number: phoneJid ? phoneJid.split('@')[0] : null,
    };
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
