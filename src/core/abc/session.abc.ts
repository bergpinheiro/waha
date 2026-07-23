import { ReachoutTimelockTracker } from '@waha/core/abc/ReachoutTimelockTracker';
import { getBrowserExecutablePath as getBrowserExecutablePathAutodetect } from '@waha/core/abc/session.browser';
import { IMediaConverter } from '@waha/core/media/IConverter';
import { Ffmpeg } from '@waha/core/utils/ffmpeg';
import { MessagesForRead } from '@waha/core/utils/convertors';
import {
  IgnoreJidConfig,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isNullJid,
  JidFilter,
} from '@waha/core/utils/jids';
import {
  Channel,
  ChannelListResult,
  ChannelMessage,
  ChannelSearchByText,
  ChannelSearchByView,
  CreateChannelRequest,
  ListChannelsQuery,
  PreviewChannelMessages,
} from '@waha/structures/channels.dto';
import {
  ChatSummary,
  GetChatMessageQuery,
  GetChatMessagesFilter,
  GetChatMessagesQuery,
  OverviewFilter,
  ReadChatMessagesQuery,
  ReadChatMessagesResponse,
} from '@waha/structures/chats.dto';
import { SendButtonsRequest } from '@waha/structures/chatting.buttons.dto';
import { SendListRequest } from '@waha/structures/chatting.list.dto';
import { BinaryFile, RemoteFile } from '@waha/structures/files.dto';
import { Label, LabelDTO, LabelID } from '@waha/structures/labels.dto';
import { LidToPhoneNumber } from '@waha/structures/lids.dto';
import { PaginationParams } from '@waha/structures/pagination.dto';
import { MessageSource, WAMessage } from '@waha/structures/responses.dto';
import { BrowserTraceQuery } from '@waha/structures/server.debug.dto';
import { DefaultMap } from '@waha/utils/DefaultMap';
import { generatePrefixedId } from '@waha/utils/ids';
import { LoggerBuilder } from '@waha/utils/logging';
import { complete } from '@waha/utils/reactive/complete';
import { SwitchObservable } from '@waha/utils/reactive/SwitchObservable';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import * as fs from 'fs';
import * as lodash from 'lodash';
import * as NodeCache from 'node-cache';
import { Logger } from 'pino';
import {
  catchError,
  delay,
  filter,
  of,
  retry,
  scan,
  share,
  Subject,
  switchMap,
  timestamp,
} from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { MessageId } from 'whatsapp-web.js';

import {
  PasskeyChallenge,
  PasskeyConfirmationResponse,
} from '../../structures/auth.dto';
import {
  ChatRequest,
  CheckNumberStatusQuery,
  EditMessageRequest,
  MessageButtonReply,
  MessageContactVcardRequest,
  MessageFileRequest,
  MessageForwardRequest,
  MessageImageRequest,
  MessageLinkCustomPreviewRequest,
  MessageLinkPreviewRequest,
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
} from '../../structures/chatting.dto';
import {
  ContactQuery,
  ContactRequest,
  ContactUpdateBody,
} from '../../structures/contacts.dto';
import {
  WAHAEngine,
  WAHAEvents,
  WAHAPresenceStatus,
  WAHASessionStatus,
} from '../../structures/enums.dto';
import { EventMessageRequest } from '../../structures/events.dto';
import {
  CreateGroupRequest,
  GroupField,
  GroupParticipant,
  GroupsListFields,
  ParticipantsRequest,
  SettingsMemberAddMode,
  SettingsSecurityChangeInfo,
} from '../../structures/groups.dto';
import { WAHAChatPresences } from '../../structures/presence.dto';
import {
  MeInfo,
  ProxyConfig,
  SessionConfig,
} from '../../structures/sessions.dto';
import {
  DeleteStatusRequest,
  ImageStatus,
  TextStatus,
  VideoStatus,
  VoiceStatus,
} from '../../structures/status.dto';
import {
  SessionStatusPoint,
  WASessionStatusBody,
} from '../../structures/webhooks.dto';
import {
  AvailableInPlusVersion,
  NotImplementedByEngineError,
} from '../exceptions';
import { IMediaManager } from '../media/IMediaManager';
import { QR } from '../QR';
import { DataStore } from './DataStore';
import { fetchBuffer } from '@waha/utils/fetch';
import {
  PRESENCE_AUTO_ONLINE,
  PRESENCE_AUTO_ONLINE_DURATION_SECONDS,
  BR_PHONE_NORMALIZE,
  BR_PHONE_STRICT,
} from '@waha/core/env';
import { Activity } from '@waha/core/abc/activity';
import {
  BR_PHONE_CACHE_TTL_SECONDS,
  BR_PHONE_DDD_LOOKUP_MAX_DEFAULT,
  BR_PHONE_DDD_LOOKUP_MIN_DEFAULT,
  BR_PHONE_NEGATIVE_CACHE_TTL_SECONDS,
  extractPhoneDigits,
  generateBrazilMobileLookupCandidates,
  getBrazilPhoneCacheKeys,
  isBrazilCountryCode,
  isBrazilMobile,
  isMalformedBrazilPhone,
  needsBrazilWhatsAppLookup,
  normalizeBrazilMobileForSendDigits,
  normalizeBrazilTollFreeDigits,
  shouldSkipBrazilPhoneNormalization,
} from '@waha/core/utils/brPhone';
import { toJID } from '@waha/core/utils/jids';
import { UnprocessableEntityException } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const qrcode = require('qrcode-terminal');

axiosRetry(axios, { retries: 3 });

export function ensureSuffix(phone) {
  const suffix = '@c.us';
  if (phone.includes('@')) {
    return phone;
  }
  return phone + suffix;
}

export interface SessionParams {
  name: string;
  printQR: boolean;
  mediaManager: IMediaManager;
  loggerBuilder: LoggerBuilder;
  sessionStore: DataStore;
  proxyConfig?: ProxyConfig;
  // Raw unchanged SessionConfig
  sessionConfig?: SessionConfig;
  engineConfig?: any;
  // Ignore settings
  ignore: IgnoreJidConfig;
}

/**
 * A status change, along with the extra info that belongs to that status
 * (if any) - like the passkey challenge for PASSKEY_REQUIRED.
 */
interface SessionStatusUpdate {
  status: WAHASessionStatus;
  data: any;
}

interface SessionStatusUpdatePoint extends SessionStatusUpdate {
  timestamp: number;
}

export abstract class WhatsappSession {
  public engine: WAHAEngine;

  public name: string;
  protected mediaManager: IMediaManager;
  public loggerBuilder: LoggerBuilder;
  public logger: Logger;
  protected sessionStore: DataStore;
  protected proxyConfig?: ProxyConfig;
  public sessionConfig?: SessionConfig;
  protected engineConfig?: any;
  protected unpairing: boolean = false;
  protected jids: JidFilter;

  private _status: WAHASessionStatus;
  private _statusData: any = null;
  protected reachoutTimelock: ReachoutTimelockTracker;
  private _presence:
    | WAHAPresenceStatus.ONLINE
    | WAHAPresenceStatus.OFFLINE
    | null = null;
  private lastActivityTimestamp?: number;
  protected presenceAutoOnlineConfig = {
    enabled: PRESENCE_AUTO_ONLINE,
    duration: PRESENCE_AUTO_ONLINE_DURATION_SECONDS * 1000,
  };

  private shouldPrintQR: boolean;
  protected events2: DefaultMap<WAHAEvents, SwitchObservable<any>>;
  private status$: Subject<SessionStatusUpdate>;
  protected profilePictures: NodeCache = new NodeCache({
    stdTTL: 24 * 60 * 60, // 1 day
  });
  // BR phone resolution cache. Stores the resolved canonical digits. Verified
  // hits use the long TTL; unverified best-guesses use the short (negative) TTL
  // so we re-check later without re-running the WhatsApp lookup every send.
  protected brPhoneCache: NodeCache = new NodeCache({
    stdTTL: BR_PHONE_CACHE_TTL_SECONDS,
  });
  // Single-flight guard: concurrent first-time resolutions of the same number
  // share one in-flight WhatsApp lookup instead of each firing its own usync.
  private brPhoneInflight: Map<string, Promise<string>> = new Map();

  // Save sent messages ids in cache so we can determine if a message was sent
  // via API or APP
  private sentMessageIds: NodeCache = new NodeCache({
    stdTTL: 10 * 60, // 10 minutes
  });

  private presenceOfflineTimeout?: ReturnType<typeof setTimeout>;

  public mediaConverter: IMediaConverter;

  public constructor({
    name,
    printQR,
    loggerBuilder,
    sessionStore,
    proxyConfig,
    mediaManager,
    sessionConfig,
    engineConfig,
    ignore,
  }: SessionParams) {
    this._status = WAHASessionStatus.STOPPED;
    this.status$ = new Subject<SessionStatusUpdate>();

    this.name = name;
    this.proxyConfig = proxyConfig;
    this.loggerBuilder = loggerBuilder;
    this.logger = loggerBuilder.child({ name: 'WhatsappSession' });
    this.mediaConverter = new Ffmpeg(this.name, this.logger);
    this.reachoutTimelock = new ReachoutTimelockTracker(this.logger);
    this.reachoutTimelock.changes$.subscribe((timelock) => {
      if (this.status === WAHASessionStatus.WORKING) {
        // Re-issue WORKING so 'session.status' consumers get the update
        this.setStatus(WAHASessionStatus.WORKING, {
          reachoutTimelock: timelock,
        });
      }
    });
    this.events2 = new DefaultMap<WAHAEvents, SwitchObservable<any>>(
      (key) =>
        new SwitchObservable((obs$) => {
          return obs$.pipe(
            catchError((err) => {
              this.logger.error(
                `Caught error, dropping value from, event: '${key}'`,
              );
              this.logger.error(err, err.stack);
              throw err;
            }),
            filter(Boolean),
            map((data) => {
              data._eventId = generatePrefixedId('evt');
              data._timestampMs = Date.now();
              return data;
            }),
            retry(),
            share(),
          );
        }),
    );

    this.events2.get(WAHAEvents.SESSION_STATUS).switch(
      this.status$
        // Wait for WORKING status to get all the info
        // https://github.com/devlikeapro/waha/issues/409
        .pipe(
          switchMap((update: SessionStatusUpdate) => {
            const me = this.getSessionMeInfo();
            const hasMe = !!me?.pushName && !!me?.id;
            // Delay WORKING by 1 second if condition is met
            // Usually we get WORKING with all the info after
            if (update.status === WAHASessionStatus.WORKING && !hasMe) {
              return of(update).pipe(delay(2000));
            }
            return of(update);
          }),
          // Remove consecutive duplicate WORKING statuses, but let through WORKING re-issued with new data
          distinctUntilChanged(
            (prev, curr) =>
              prev.status === curr.status &&
              curr.status === WAHASessionStatus.WORKING &&
              lodash.isEqual(prev.data, curr.data),
          ),
          // attach current time (ms)
          timestamp(),
          map(
            ({ value, timestamp }) =>
              ({
                status: value.status,
                timestamp: timestamp,
                data: value.data,
              }) as SessionStatusUpdatePoint,
          ),
          // keep the last 3 entries
          scan<SessionStatusUpdatePoint, SessionStatusUpdatePoint[]>(
            (points, point: SessionStatusUpdatePoint) => {
              const next = [...points, point];
              return next.length > 3 ? next.slice(-3) : next;
            },
            [],
          ),
          // shape final payload
          map((points) => {
            const current = points.at(-1); // current
            return {
              name: this.name,
              status: current?.status,
              statuses: points.map(
                (point): SessionStatusPoint => ({
                  status: point.status,
                  timestamp: point.timestamp,
                }),
              ),
              data: current?.data ?? null,
            } as WASessionStatusBody;
          }),
        ),
    );

    this.sessionStore = sessionStore;
    this.mediaManager = mediaManager;
    this.sessionConfig = sessionConfig;
    this.engineConfig = engineConfig;
    this.shouldPrintQR = printQR;
    this.logger.info(
      { ignore: ignore },
      'The session ignores the following chat ids',
    );
    this.jids = new JidFilter(ignore);
  }

  public getEventObservable(event: WAHAEvents) {
    return this.events2.get(event);
  }

  /**
   * Set the status along with the extra info that belongs to it.
   * Plain 'status = value' assignments go through here without data,
   * so the data is dropped as soon as the session moves on.
   */
  protected setStatus(status: WAHASessionStatus, data: any = null) {
    if (this.unpairing && status !== WAHASessionStatus.STOPPED) {
      // In case of unpairing
      // wait for STOPPED event, ignore the rest
      return;
    }
    if (
      status === WAHASessionStatus.WORKING &&
      data == null &&
      this.reachoutTimelock.value?.isActive
    ) {
      // Plain 'status = WORKING' assignments (reconnects) must keep carrying the active timelock info
      data = { reachoutTimelock: this.reachoutTimelock.value };
    }
    if (
      status === WAHASessionStatus.STOPPED ||
      status === WAHASessionStatus.FAILED
    ) {
      this.reachoutTimelock?.stop();
    }
    this._status = status;
    this._statusData = data;
    this.status$.next({ status: status, data: data });
  }

  public set status(value: WAHASessionStatus) {
    this.setStatus(value);
  }

  public get status() {
    return this._status;
  }

  public get statusData() {
    return this._statusData;
  }

  protected set presence(value: WAHAPresenceStatus) {
    switch (value) {
      case null:
        this._presence = null;
        break;
      case WAHAPresenceStatus.ONLINE:
        this._presence = WAHAPresenceStatus.ONLINE;
        break;
      case WAHAPresenceStatus.OFFLINE:
        this._presence = WAHAPresenceStatus.OFFLINE;
        break;
      default:
        // Ignore chat relates presence
        return;
    }
  }

  public get presence():
    | WAHAPresenceStatus.ONLINE
    | WAHAPresenceStatus.OFFLINE
    | null {
    return this._presence;
  }

  getBrowserExecutablePath() {
    return getBrowserExecutablePathAutodetect();
  }

  getBrowserArgsForPuppeteer() {
    // Run optimized version of Chrome
    // References:
    // https://github.com/pedroslopez/whatsapp-web.js/issues/1420
    // https://github.com/wppconnect-team/wppconnect/issues/1326
    // https://superuser.com/questions/654565/how-to-run-google-chrome-in-a-single-process
    // https://www.bannerbear.com/blog/ways-to-speed-up-puppeteer-screenshots/
    return [
      '--disable-accelerated-2d-canvas',
      '--disable-application-cache',
      // DO NOT disable software rasterizer, it will break the video
      // https://github.com/devlikeapro/waha/issues/629
      // '--disable-software-rasterizer',
      '--disable-client-side-phishing-detection',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-metrics',
      // '--disable-features=site-per-process', // COMMENTED to test WEBJS stability
      '--disable-gpu', // COMMENTED to test WEBJS stability
      '--disable-offer-store-unmasked-wallet-cards',
      '--disable-offline-load-stale-cache',
      '--disable-popup-blocking',
      '--disable-setuid-sandbox',
      '--disable-site-isolation-trials',
      '--disable-speech-api',
      '--disable-sync',
      '--disable-translate',
      '--disable-web-security',
      '--hide-scrollbars',
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
      // https://github.com/devlikeapro/waha/issues/725
      // '--in-process-gpu', // COMMENTED to test WEBJS stability
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-first-run',
      '--no-pings',
      '--no-sandbox',
      '--no-zygote',
      '--password-store=basic',
      '--renderer-process-limit=2',
      '--safebrowsing-disable-auto-update',
      '--use-mock-keychain',
      '--window-size=1280,720',
      '--disable-blink-features=AutomationControlled',
      //
      // Cache options
      //
      '--disk-cache-size=1073741824', // 1GB
      // '--disk-cache-size=0',
      // '--disable-cache',
      // '--aggressive-cache-discard',
    ];
  }

  protected isDebugEnabled() {
    return this.logger.isLevelEnabled('debug');
  }

  /** Start the session */
  abstract start();

  /** Stop the session */
  abstract stop(): Promise<void>;

  protected stopEvents() {
    complete(this.events2);
  }

  /* Unpair the account */
  async unpair(): Promise<void> {
    return;
  }

  /**
   * START - Methods for API
   */

  public browserTrace(query: BrowserTraceQuery): Promise<string> {
    throw new NotImplementedByEngineError();
  }

  /**
   * Auth methods
   */

  public getQR(): QR {
    throw new NotImplementedByEngineError();
  }

  public requestCode(phoneNumber: string, method: string, params?: any) {
    throw new NotImplementedByEngineError();
  }

  public getPasskeyChallenge(): PasskeyChallenge {
    throw new NotImplementedByEngineError();
  }

  public async sendPasskeyResponse(responseJson: string): Promise<void> {
    throw new NotImplementedByEngineError();
  }

  public async confirmPasskey(): Promise<void> {
    throw new NotImplementedByEngineError();
  }

  public getPasskeyConfirmation(): PasskeyConfirmationResponse {
    throw new NotImplementedByEngineError();
  }

  abstract getScreenshot(): Promise<Buffer>;

  public getSessionMeInfo(): MeInfo | null {
    return null;
  }

  /**
   * Profile methods
   */
  public setProfileName(name: string): Promise<boolean> {
    throw new NotImplementedByEngineError();
  }

  public setProfileStatus(status: string): Promise<boolean> {
    throw new NotImplementedByEngineError();
  }

  public async updateProfilePicture(
    file: BinaryFile | RemoteFile | null,
  ): Promise<boolean> {
    if (file) {
      await this.setProfilePicture(file);
    } else {
      await this.deleteProfilePicture();
    }

    // Refresh profile picture after update
    setTimeout(() => {
      this.logger.debug('Refreshing my profile picture after update...');
      this.refreshMyProfilePicture()
        .then(() => {
          this.logger.debug('Refreshed my profile picture after update');
        })
        .catch((err) => {
          this.logger.error('Error refreshing my profile picture after update');
          this.logger.error(err, err.stack);
        });
    }, 3_000);

    return true;
  }

  protected async refreshMyProfilePicture() {
    const me = this.getSessionMeInfo();
    await this.getContactProfilePicture(me.id, true);
  }

  protected setProfilePicture(file: BinaryFile | RemoteFile): Promise<boolean> {
    throw new NotImplementedByEngineError();
  }

  protected deleteProfilePicture(): Promise<boolean> {
    throw new NotImplementedByEngineError();
  }

  /**
   * Other methods
   */
  generateNewMessageId(): Promise<string> {
    throw new NotImplementedByEngineError();
  }

  abstract checkNumberStatus(request: CheckNumberStatusQuery);

  abstract sendText(request: MessageTextRequest);

  sendContactVCard(request: MessageContactVcardRequest) {
    throw new NotImplementedByEngineError();
  }

  sendPoll(request: MessagePollRequest) {
    throw new NotImplementedByEngineError();
  }

  sendPollVote(request: MessagePollVoteRequest) {
    throw new NotImplementedByEngineError();
  }

  abstract sendLocation(request: MessageLocationRequest);

  sendLinkPreview(request: MessageLinkPreviewRequest) {
    throw new NotImplementedByEngineError();
  }

  sendLinkCustomPreview(
    request: MessageLinkCustomPreviewRequest,
  ): Promise<any> {
    throw new NotImplementedByEngineError();
  }

  abstract forwardMessage(request: MessageForwardRequest): Promise<WAMessage>;

  abstract sendImage(request: MessageImageRequest);

  abstract sendFile(request: MessageFileRequest);

  abstract sendVoice(request: MessageVoiceRequest);

  sendVideo(request: MessageVideoRequest) {
    throw new NotImplementedByEngineError();
  }

  sendButtons(request: SendButtonsRequest) {
    throw new NotImplementedByEngineError();
  }

  sendList(request: SendListRequest): Promise<any> {
    throw new NotImplementedByEngineError();
  }

  sendButtonsReply(request: MessageButtonReply) {
    throw new NotImplementedByEngineError();
  }

  abstract reply(request: MessageReplyRequest);

  abstract sendSeen(chat: SendSeenRequest);

  abstract startTyping(chat: ChatRequest): Promise<void>;

  abstract stopTyping(chat: ChatRequest);

  /**
   * Activity tracking and presence management
   */

  /**
   * Returns the timestamp of the last "activity" in the session
   * @returns Timestamp in milliseconds or undefined if there was never any activity
   */
  public getLastActivityTimestamp(): number | undefined {
    return this.lastActivityTimestamp;
  }

  /**
   * Maintains ONLINE presence active while there is activity
   * Resets the timer on each activity, only goes OFFLINE after Xs without activity
   */
  async maintainPresenceOnline(): Promise<void> {
    if (!this.presenceAutoOnlineConfig.enabled) {
      return;
    }
    if (this.status !== WAHASessionStatus.WORKING) {
      return;
    }
    this.lastActivityTimestamp = Date.now();
    // If not ONLINE yet, send ONLINE
    if (this._presence !== WAHAPresenceStatus.ONLINE) {
      try {
        // Force set ONLINE in case of many requests comes at the same time
        // So we'll set ONLINE exactly once
        this.presence = WAHAPresenceStatus.ONLINE;
        await this.setPresence(WAHAPresenceStatus.ONLINE);
        this.logger.debug('Set presence to ONLINE due to activity');
      } catch (error) {
        this.logger.debug('Failed to set presence ONLINE', error);
        return;
      }
    }
    // Cancel the previous timeout (if exists)
    this.cleanupPresenceTimeout();

    // Schedule to go back OFFLINE after timeout without activity
    this.presenceOfflineTimeout = setTimeout(async () => {
      try {
        const working = this.status === WAHASessionStatus.WORKING;
        const online = this.presence === WAHAPresenceStatus.ONLINE;
        if (!working || !online) {
          // Nothing to do
          return;
        }
        await this.setPresence(WAHAPresenceStatus.OFFLINE);
        this.logger.debug(
          'Auto-set presence to OFFLINE after time without activity',
        );
      } catch (error) {
        this.presence = WAHAPresenceStatus.OFFLINE;
        this.logger.debug('Failed to set presence OFFLINE', error);
      }
      this.cleanupPresenceTimeout();
    }, this.presenceAutoOnlineConfig.duration);
  }

  /**
   * Cleans up the timeout when the session stops
   */
  protected cleanupPresenceTimeout() {
    clearTimeout(this.presenceOfflineTimeout);
    this.presenceOfflineTimeout = null;
  }

  abstract setReaction(request: MessageReactionRequest);

  setStar(request: MessageStarRequest): Promise<void> {
    throw new NotImplementedByEngineError();
  }

  sendEvent(request: EventMessageRequest): Promise<WAMessage> {
    throw new NotImplementedByEngineError();
  }

  cancelEvent(eventId: string): Promise<WAMessage> {
    throw new NotImplementedByEngineError();
  }

  public rejectCall(from: string, id: string): Promise<void> {
    throw new NotImplementedByEngineError();
  }

  /**
   * Chats methods
   */
  public getChats(pagination: PaginationParams) {
    throw new NotImplementedByEngineError();
  }

  public getChatsOverview(
    pagination: PaginationParams,
    filter?: OverviewFilter,
  ): Promise<ChatSummary[]> {
    throw new NotImplementedByEngineError();
  }

  public deleteChat(chatId) {
    throw new NotImplementedByEngineError();
  }

  public getChatMessages(
    chatId: string,
    query: GetChatMessagesQuery,
    filter: GetChatMessagesFilter,
  ): Promise<WAMessage[]> {
    throw new NotImplementedByEngineError();
  }

  abstract readChatMessages(
    chatId: string,
    request: ReadChatMessagesQuery,
  ): Promise<ReadChatMessagesResponse>;

  protected async readChatMessagesWSImpl(
    chatId: string,
    request: ReadChatMessagesQuery,
  ): Promise<ReadChatMessagesResponse> {
    const { query, filter } = MessagesForRead(chatId, request);
    const messages = await this.getChatMessages(chatId, query, filter);
    this.logger.debug(`Found ${messages.length} messages to read`);
    if (messages.length === 0) {
      return { ids: [] };
    }
    const ids = messages.map((m) => m.id);
    const seen: SendSeenRequest = {
      chatId: chatId,
      messageIds: ids,
      session: '',
    };
    await this.sendSeen(seen);
    return { ids: ids };
  }

  public getChatMessage(
    chatId: string,
    messageId: string,
    query: GetChatMessageQuery,
  ): Promise<null | WAMessage> {
    throw new NotImplementedByEngineError();
  }

  public pinMessage(
    chatId: string,
    messageId: string,
    duration: number,
  ): Promise<boolean> {
    throw new NotImplementedByEngineError();
  }

  public unpinMessage(chatId: string, messageId: string): Promise<boolean> {
    throw new NotImplementedByEngineError();
  }

  public deleteMessage(chatId: string, messageId: string) {
    throw new NotImplementedByEngineError();
  }

  public editMessage(
    chatId: string,
    messageId: string,
    request: EditMessageRequest,
  ) {
    throw new NotImplementedByEngineError();
  }

  public clearMessages(chatId) {
    throw new NotImplementedByEngineError();
  }

  public chatsArchiveChat(chatId: string): Promise<any> {
    throw new NotImplementedByEngineError();
  }

  public chatsUnarchiveChat(chatId: string): Promise<any> {
    throw new NotImplementedByEngineError();
  }

  public chatsUnreadChat(chatId: string): Promise<any> {
    throw new NotImplementedByEngineError();
  }

  /**
   * Labels methods
   */
  public async getLabel(labelId: string): Promise<Label | undefined> {
    const labels = await this.getLabels();
    return lodash.find(labels, { id: labelId });
  }

  public getLabels(): Promise<Label[]> {
    throw new NotImplementedByEngineError();
  }

  public async createLabel(label: LabelDTO): Promise<Label> {
    throw new NotImplementedByEngineError();
  }

  public async updateLabel(label: Label): Promise<Label> {
    throw new NotImplementedByEngineError();
  }

  public async deleteLabel(label: Label): Promise<void> {
    throw new NotImplementedByEngineError();
  }

  public getChatsByLabelId(labelId: string) {
    throw new NotImplementedByEngineError();
  }

  public getChatLabels(chatId: string): Promise<Label[]> {
    throw new NotImplementedByEngineError();
  }

  public putLabelsToChat(chatId: string, labels: LabelID[]) {
    throw new NotImplementedByEngineError();
  }

  /**
   * Contacts methods
   */
  public upsertContact(chatId: string, body: ContactUpdateBody): Promise<void> {
    throw new NotImplementedByEngineError();
  }

  public getContact(query: ContactQuery) {
    throw new NotImplementedByEngineError();
  }

  public getContacts(pagination: PaginationParams) {
    throw new NotImplementedByEngineError();
  }

  public getContactAbout(query: ContactQuery): Promise<{ about: string }> {
    throw new NotImplementedByEngineError();
  }

  /**
   * Lid to Phone Number methods
   */
  public async getAllLids(
    pagination: PaginationParams,
  ): Promise<Array<LidToPhoneNumber>> {
    throw new NotImplementedByEngineError();
  }

  public async getLidsCount(): Promise<number> {
    throw new NotImplementedByEngineError();
  }

  public async findPNByLid(lid: string): Promise<LidToPhoneNumber> {
    throw new NotImplementedByEngineError();
  }

  public async findLIDByPhoneNumber(
    phoneNumber: string,
  ): Promise<LidToPhoneNumber> {
    throw new NotImplementedByEngineError();
  }

  /**
   * Fetch the latest profile picture of the contact (group, newsletter, etc.)
   * @param id
   */
  abstract fetchContactProfilePicture(id: string): Promise<string | null>;

  public async getContactProfilePicture(
    id: string,
    refresh: boolean,
  ): Promise<string | null> {
    const has: boolean = this.profilePictures.has(id);
    if (!has || refresh) {
      await this.refreshProfilePicture(id);
    }
    return this.profilePictures.get(id) || null;
  }

  protected async refreshProfilePicture(id: string) {
    this.logger.debug(`Refreshing profile picture for id "${id}"...`);
    // Have no pictures
    if (isNullJid(id)) {
      return null;
    } else if (isJidBroadcast(id)) {
      return null;
    }

    // Find the right method
    let fn: Promise<string>;
    if (isJidNewsletter(id)) {
      fn = this.channelsGetChannel(id).then(
        (channel: Channel) => channel.picture || channel.preview,
      );
    } else {
      fn = this.fetchContactProfilePicture(id);
    }
    this.profilePictures.del(id);
    const url = await fn.catch((err) => {
      this.logger.warn('Error fetching profile picture');
      this.logger.warn(err, err.stack);
      return null;
    });
    this.profilePictures.set(id, url);
    return url;
  }

  public blockContact(request: ContactRequest) {
    throw new NotImplementedByEngineError();
  }

  public unblockContact(request: ContactRequest) {
    throw new NotImplementedByEngineError();
  }

  /**
   * Group methods
   */
  public createGroup(request: CreateGroupRequest) {
    throw new NotImplementedByEngineError();
  }

  public joinGroup(code: string): Promise<string> {
    throw new NotImplementedByEngineError();
  }

  public joinInfoGroup(code: string): Promise<any> {
    throw new NotImplementedByEngineError();
  }

  public getGroups(pagination: PaginationParams): Promise<any> {
    throw new NotImplementedByEngineError();
  }

  public filterGroupsFields(data: any, fields: GroupsListFields) {
    const groups: any[] = Array.isArray(data) ? data : Object.values(data);
    if (fields.exclude?.includes(GroupField.PARTICIPANTS)) {
      groups.forEach((group) => this.removeGroupsFieldParticipant(group));
    }
    return data;
  }

  protected removeGroupsFieldParticipant(group: any) {
    return;
  }

  public refreshGroups(): Promise<boolean> {
    throw new NotImplementedByEngineError();
  }

  public getGroup(id) {
    throw new NotImplementedByEngineError();
  }

  public getGroupParticipants(id: string): Promise<GroupParticipant[]> {
    throw new NotImplementedByEngineError();
  }

  public getInfoAdminsOnly(id): Promise<SettingsSecurityChangeInfo> {
    throw new NotImplementedByEngineError();
  }

  public setInfoAdminsOnly(id, value) {
    throw new NotImplementedByEngineError();
  }

  public getMessagesAdminsOnly(id): Promise<SettingsSecurityChangeInfo> {
    throw new NotImplementedByEngineError();
  }

  public setMessagesAdminsOnly(id, value) {
    throw new NotImplementedByEngineError();
  }

  public getMemberAddMode(id): Promise<SettingsMemberAddMode> {
    throw new NotImplementedByEngineError();
  }

  public setMemberAddMode(id, value) {
    throw new NotImplementedByEngineError();
  }

  public deleteGroup(id) {
    throw new NotImplementedByEngineError();
  }

  public leaveGroup(id) {
    throw new NotImplementedByEngineError();
  }

  public setDescription(id, description) {
    throw new NotImplementedByEngineError();
  }

  public async updateGroupPicture(
    id: string,
    file: BinaryFile | RemoteFile | null,
  ): Promise<boolean> {
    if (file) {
      await this.setGroupPicture(id, file);
    } else {
      await this.deleteGroupPicture(id);
    }

    // Refresh picture after update
    setTimeout(() => {
      this.logger.debug('Refreshing group profile picture after update...');
      this.refreshProfilePicture(id)
        .then(() => {
          this.logger.debug('Refreshed group profile picture after update');
        })
        .catch((err) => {
          this.logger.error('Error refreshing my profile picture after update');
          this.logger.error(err, err.stack);
        });
    }, 3_000);

    return true;
  }

  protected setGroupPicture(
    id: string,
    file: BinaryFile | RemoteFile,
  ): Promise<boolean> {
    throw new NotImplementedByEngineError();
  }

  protected deleteGroupPicture(id: string): Promise<boolean> {
    throw new NotImplementedByEngineError();
  }

  public setSubject(id, description) {
    throw new NotImplementedByEngineError();
  }

  public getInviteCode(id): Promise<string> {
    throw new NotImplementedByEngineError();
  }

  public revokeInviteCode(id): Promise<string> {
    throw new NotImplementedByEngineError();
  }

  public getParticipants(id) {
    throw new NotImplementedByEngineError();
  }

  public addParticipants(id, request: ParticipantsRequest) {
    throw new NotImplementedByEngineError();
  }

  public removeParticipants(id, request: ParticipantsRequest) {
    throw new NotImplementedByEngineError();
  }

  public promoteParticipantsToAdmin(id, request: ParticipantsRequest) {
    throw new NotImplementedByEngineError();
  }

  public demoteParticipantsToUser(id, request: ParticipantsRequest) {
    throw new NotImplementedByEngineError();
  }

  public setPresence(
    presence: WAHAPresenceStatus,
    chatId?: string,
  ): Promise<void> {
    throw new NotImplementedByEngineError();
  }

  public getPresences(): Promise<WAHAChatPresences[]> {
    throw new NotImplementedByEngineError();
  }

  public getPresence(id: string): Promise<WAHAChatPresences> {
    throw new NotImplementedByEngineError();
  }

  public subscribePresence(id: string): Promise<any> {
    throw new NotImplementedByEngineError();
  }

  /**
   * Channels methods
   */
  public searchChannelsByView(
    query: ChannelSearchByView,
  ): Promise<ChannelListResult> {
    throw new NotImplementedByEngineError();
  }

  public searchChannelsByText(
    query: ChannelSearchByText,
  ): Promise<ChannelListResult> {
    throw new NotImplementedByEngineError();
  }

  public async previewChannelMessages(
    inviteCode: string,
    query: PreviewChannelMessages,
  ): Promise<ChannelMessage[]> {
    throw new NotImplementedByEngineError();
  }

  public channelsList(query: ListChannelsQuery): Promise<Channel[]> {
    throw new NotImplementedByEngineError();
  }

  public channelsCreateChannel(
    request: CreateChannelRequest,
  ): Promise<Channel> {
    throw new NotImplementedByEngineError();
  }

  public channelsGetChannel(id: string): Promise<Channel> {
    throw new NotImplementedByEngineError();
  }

  public channelsGetChannelByInviteCode(inviteCode: string): Promise<Channel> {
    throw new NotImplementedByEngineError();
  }

  public channelsDeleteChannel(id: string): Promise<void> {
    throw new NotImplementedByEngineError();
  }

  public channelsFollowChannel(id: string): Promise<void> {
    throw new NotImplementedByEngineError();
  }

  public channelsUnfollowChannel(id: string): Promise<void> {
    throw new NotImplementedByEngineError();
  }

  public channelsMuteChannel(id: string): Promise<void> {
    throw new NotImplementedByEngineError();
  }

  public channelsUnmuteChannel(id: string): Promise<void> {
    throw new NotImplementedByEngineError();
  }

  /**
   * Status methods
   */
  public sendTextStatus(status: TextStatus) {
    throw new NotImplementedByEngineError();
  }

  public sendImageStatus(status: ImageStatus) {
    throw new AvailableInPlusVersion();
  }

  public sendVoiceStatus(status: VoiceStatus) {
    throw new AvailableInPlusVersion();
  }

  public sendVideoStatus(status: VideoStatus) {
    throw new AvailableInPlusVersion();
  }

  public deleteStatus(request: DeleteStatusRequest) {
    throw new NotImplementedByEngineError();
  }

  /**
   * Engine methods
   */
  public async getEngineInfo(): Promise<any> {
    return {};
  }

  /**
   * END - Methods for API
   */

  /**
   * Add WhatsApp suffix (@c.us) to the phone number if it doesn't have it yet
   * @param phone
   */
  protected ensureSuffix(phone) {
    return ensureSuffix(phone);
  }

  // Cached values are full chat ids ('5511...@c.us' or '123@lid'), never bare
  // digits: stripping the suffix loses which addressing form was resolved, and
  // re-adding '@c.us' to LID digits builds an id that addresses nobody.
  protected cacheBrazilPhoneResolution(
    inputDigits: string,
    resolvedChatId: string,
  ) {
    const keys = getBrazilPhoneCacheKeys(inputDigits);
    for (const key of keys) {
      this.brPhoneCache.set(key, resolvedChatId);
    }
  }

  // Cache an unverified best-guess (e.g. WhatsApp said it does not exist, but we
  // send anyway). Short TTL so a number registered later is re-checked soon.
  protected cacheBrazilPhoneUnverified(
    inputDigits: string,
    bestGuessChatId: string,
  ) {
    const keys = getBrazilPhoneCacheKeys(inputDigits);
    for (const key of keys) {
      this.brPhoneCache.set(
        key,
        bestGuessChatId,
        BR_PHONE_NEGATIVE_CACHE_TTL_SECONDS,
      );
    }
  }

  // Cache a confirmed-negative (strict mode): the number does not exist on
  // WhatsApp. Stored as '' with the short TTL so retries re-check after a while.
  protected cacheBrazilPhoneNegative(inputDigits: string) {
    const keys = getBrazilPhoneCacheKeys(inputDigits);
    for (const key of keys) {
      this.brPhoneCache.set(key, '', BR_PHONE_NEGATIVE_CACHE_TTL_SECONDS);
    }
  }

  // undefined = cache miss, '' = confirmed-negative (strict), otherwise the
  // resolved chat id (verified canonical or unverified best-guess).
  protected getCachedBrazilPhoneResolution(digits: string): string | undefined {
    return this.brPhoneCache.get<string>(digits);
  }

  // Optional per-engine hook: resolve a candidate against the local contact
  // store without hitting WhatsApp servers. Default: no local store available.
  protected async lookupKnownChatId(
    candidates: string[],
  ): Promise<string | null> {
    void candidates;
    return null;
  }

  protected async resolveOutboundChatId(
    chatId: string,
    opts: { validate?: boolean } = {},
  ): Promise<string> {
    // validate=true (default): full resolution incl. WhatsApp lookup, used by
    // message-send paths. validate=false: local-only (cache + static + store),
    // never hits the network and never throws, used by read/presence ops.
    const validate = opts.validate ?? true;
    const withSuffix = this.ensureSuffix(chatId);
    if (!BR_PHONE_NORMALIZE) {
      return withSuffix;
    }
    if (shouldSkipBrazilPhoneNormalization(withSuffix)) {
      return withSuffix;
    }

    const digits = extractPhoneDigits(withSuffix);
    // Brazilian toll-free (0800): deterministic rewrite to the stored form, no
    // lookup. Handled before the country-code gate because the dialed form
    // ('0800...') has no 55 prefix.
    const tollFree = normalizeBrazilTollFreeDigits(digits);
    if (tollFree) {
      return ensureSuffix(tollFree);
    }
    // Only Brazilian numbers (country code 55) are handled here.
    if (!isBrazilCountryCode(digits)) {
      return withSuffix;
    }
    // Tier 0: malformed Brazilian numbers (e.g. 55859912). Hard error only on
    // the send path; read/presence ops just pass it through untouched.
    if (isMalformedBrazilPhone(digits)) {
      if (validate) {
        throw new UnprocessableEntityException(
          `Invalid Brazilian phone number '${withSuffix}'.`,
        );
      }
      return withSuffix;
    }
    // Landlines and already-valid non-mobile numbers are left untouched.
    if (!isBrazilMobile(digits)) {
      return withSuffix;
    }

    // Tier 1: in-memory cache. undefined = miss, '' = confirmed-negative
    // (strict mode), otherwise the resolved/best-guess chat id, stored ready
    // to use - no suffix is re-derived here.
    const cached = this.getCachedBrazilPhoneResolution(digits);
    if (cached !== undefined) {
      if (cached === '') {
        if (validate) {
          throw new UnprocessableEntityException(
            `Brazilian mobile phone number '${withSuffix}' does not exist on WhatsApp.`,
          );
        }
        return withSuffix;
      }
      return cached;
    }

    // DDD below the lookup range: static 9th-digit rule, no network needed.
    if (
      !needsBrazilWhatsAppLookup(
        digits,
        BR_PHONE_DDD_LOOKUP_MIN_DEFAULT,
        BR_PHONE_DDD_LOOKUP_MAX_DEFAULT,
      )
    ) {
      const normalized = ensureSuffix(
        normalizeBrazilMobileForSendDigits(digits),
      );
      this.cacheBrazilPhoneResolution(digits, normalized);
      return normalized;
    }

    const candidates = generateBrazilMobileLookupCandidates(digits);

    // Tier 2: local contact/LID store (engine-specific), no network.
    const fromStore = await this.lookupKnownChatId(candidates);
    if (fromStore) {
      this.cacheBrazilPhoneResolution(digits, fromStore);
      this.logger.debug(
        `BR mobile '${withSuffix}' resolved locally to '${fromStore}' (no WhatsApp lookup).`,
      );
      return fromStore;
    }

    // Read/presence ops never reach the network: return the best-guess as-is.
    if (!validate) {
      return withSuffix;
    }

    // Tier 3: WhatsApp lookup as last resort, de-duplicated via single-flight.
    return this.resolveBrazilPhoneViaWhatsApp(digits, withSuffix, candidates);
  }

  // Single-flight wrapper around the WhatsApp existence lookup so concurrent
  // sends to the same new number trigger a single usync, not one per message.
  private resolveBrazilPhoneViaWhatsApp(
    digits: string,
    withSuffix: string,
    candidates: string[],
  ): Promise<string> {
    const key = getBrazilPhoneCacheKeys(digits).sort().join('|');
    const inflight = this.brPhoneInflight.get(key);
    if (inflight) {
      return inflight;
    }
    const promise = this.lookupBrazilPhoneOnWhatsApp(
      digits,
      withSuffix,
      candidates,
    ).finally(() => this.brPhoneInflight.delete(key));
    this.brPhoneInflight.set(key, promise);
    return promise;
  }

  private async lookupBrazilPhoneOnWhatsApp(
    digits: string,
    withSuffix: string,
    candidates: string[],
  ): Promise<string> {
    this.logger.debug(
      `BR mobile '${withSuffix}' not found locally, performing WhatsApp lookup for: ${candidates.join(', ')}`,
    );
    let lookupFailed = false;
    for (const candidate of candidates) {
      let result: WANumberExistResult;
      try {
        result = await this.checkNumberStatus({
          phone: candidate,
          session: this.name,
        });
      } catch (error) {
        lookupFailed = true;
        this.logger.warn(
          `Failed to verify Brazilian mobile candidate '${candidate}': ${error}`,
        );
        continue;
      }
      if (result?.numberExists && result.chatId) {
        // Cache the chat id exactly as resolved. Engines answer with the phone
        // number whenever they can and fall back to a LID for accounts that
        // have no phone form - both are routable, and neither survives being
        // reduced to digits.
        this.cacheBrazilPhoneResolution(digits, result.chatId);
        return result.chatId;
      }
    }

    // Could not validate due to network/engine error: send as-is, do not cache.
    if (lookupFailed) {
      this.logger.warn(
        `Could not validate Brazilian mobile number '${withSuffix}', sending as-is. Tried: ${candidates.join(', ')}`,
      );
      return withSuffix;
    }

    // Verified not to exist in any form.
    if (BR_PHONE_STRICT) {
      // Strict (opt-in via WAHA_BR_PHONE_STRICT): reject so the caller knows.
      this.cacheBrazilPhoneNegative(digits);
      throw new UnprocessableEntityException(
        `Brazilian mobile phone number '${withSuffix}' does not exist on WhatsApp. Tried: ${candidates.join(', ')}`,
      );
    }
    // Soft (default): warn and send the best-guess anyway, so a usync
    // false-negative never blocks a valid send.
    const bestGuess = ensureSuffix(normalizeBrazilMobileForSendDigits(digits));
    this.cacheBrazilPhoneUnverified(digits, bestGuess);
    this.logger.warn(
      `Brazilian mobile number '${withSuffix}' not found on WhatsApp, sending best-guess '${bestGuess}'. Tried: ${candidates.join(', ')}`,
    );
    return bestGuess;
  }

  // Mentions are best-effort: a non-existent mention must never break the send.
  protected async resolveOutboundMentions(
    mentions?: string[],
  ): Promise<string[] | undefined> {
    if (!mentions?.length) {
      return undefined;
    }
    const resolved: string[] = [];
    for (const mention of mentions) {
      const chatId = await this.resolveOutboundMention(mention);
      resolved.push(toJID(chatId));
    }
    return resolved;
  }

  protected async resolveOutboundMentionsCus(
    mentions?: string[],
  ): Promise<string[] | undefined> {
    if (!mentions?.length) {
      return undefined;
    }
    const resolved: string[] = [];
    for (const mention of mentions) {
      resolved.push(await this.resolveOutboundMention(mention));
    }
    return resolved;
  }

  private async resolveOutboundMention(mention: string): Promise<string> {
    try {
      return await this.resolveOutboundChatId(mention);
    } catch (error) {
      this.logger.warn(
        `Could not resolve mention '${mention}', using as-is: ${error}`,
      );
      return this.ensureSuffix(mention);
    }
  }

  protected deserializeId(messageId: string): MessageId {
    const parts = messageId.split('_');
    return {
      fromMe: parts[0] === 'true',
      remote: parts[1],
      id: parts[2],
      _serialized: messageId,
    };
  }

  protected printQR(qr: QR) {
    if (!this.shouldPrintQR) {
      return;
    }
    if (!qr.raw) {
      this.logger.error(
        'QR.raw is not available, can not print it in the console',
      );
      return;
    }
    this.logger.info(
      "You can disable QR in console by setting 'WAHA_PRINT_QR=false' in your environment variables.",
    );
    qrcode.generate(qr.raw, { small: true });
  }

  protected saveSentMessageId(id: string) {
    this.sentMessageIds.set(id, true);
  }

  protected getMessageSource(id: string): MessageSource {
    if (!id) {
      return MessageSource.APP;
    }
    const api = this.sentMessageIds.has(id);
    return api ? MessageSource.API : MessageSource.APP;
  }

  /**
   * Fetches the content from the specified URL and returns it as a Buffer.
   */
  public fetch(url: string): Promise<Buffer> {
    return fetchBuffer(url);
  }

  public async resolveMentionsAll(chatId: string): Promise<string[]> {
    const participants = await this.getGroupParticipants(chatId);
    let mentions = participants.map((p) => p.id);
    // Exclude my ids
    const me = this.getSessionMeInfo();
    return mentions.filter((id) => id !== me.id && id !== me.lid);
  }
}

export function getGroupInviteLink(code: string) {
  if (code.startsWith('https://')) {
    return code;
  }
  return `https://chat.whatsapp.com/${code}`;
}

export function parseGroupInviteLink(link: string) {
  // https://chat.whatsapp.com/123 => 123
  return link.split('/').pop();
}

export function getChannelInviteLink(code: string) {
  return `https://whatsapp.com/channel/${code}`;
}

export function parseChannelInviteLink(link: string): string {
  // https://www.whatsapp.com/channel/123 => 123
  const code = link.split('/').pop();
  return code;
}

export function getPublicUrlFromDirectPath(directPath: string) {
  return `https://pps.whatsapp.net${directPath}`;
}

const deviceRegexp = /^.*:(\d+)@.*$/;

/**
 * Extracts the device ID from a JID string.
 *
 * @param jid - The JID string (e.g., "123123:12@c.us")
 * @return The extracted device ID (e.g., "12") or null if the format is invalid.
 */
export function extractDeviceId(jid: string): string | null {
  if (!jid) {
    return null;
  }
  const match = jid.match(deviceRegexp);
  return match ? match[1] : null;
}
