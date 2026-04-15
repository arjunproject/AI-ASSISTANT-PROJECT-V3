import makeWASocket, {
  ALL_WA_PATCH_NAMES,
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestWaWebVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  proto,
  type ConnectionState,
  type MessageUpsertType,
  type MessageUserReceiptUpdate,
  type WAMessage,
  type WAVersion,
} from '@whiskeysockets/baileys';

import type { RuntimeTransportContext, RuntimeTransportController } from '../runtime/runtime-service.js';
import { startRuntimeTestOutbox } from '../runtime/runtime-test-outbox.js';
import { createAiOrchestrator } from '../ai/ai-orchestrator.js';
import { createAccessController } from '../access/access-controller.js';
import { createAdminCommandExecutor } from '../command/admin-command-executor.js';
import { createBaileysDiagnosticLogger, type BaileysDiagnosticEntry } from './baileys-log-bridge.js';
import { resolveSenderIdentity, type SenderIdentityContext } from './identity-resolver.js';
import { createInboundMessageListener, isUserFacingMessage } from './inbound-listener.js';
import { splitOutgoingText } from './message-chunker.js';
import { createRuntimeMessageStore } from './message-store.js';
import { createQrManager } from './qr-manager.js';
import { createReconnectManager } from './reconnect-manager.js';
import { loadSessionAuthState, loadStoredLidMappings } from './session-store.js';
import { getSystemBotRoutingSkipReason } from './system-bot-guard.js';
import type { RuntimeIdentityResolutionSnapshot, RuntimeStateSnapshot } from './types.js';

const SESSION_ERROR_PATTERNS = [
  /Bad MAC/iu,
  /No matching sessions found/iu,
  /No session found to decrypt message/iu,
  /failed to sync state/iu,
];

const PRESENCE_HEARTBEAT_INTERVAL_MS = 10_000;
const SELF_PROBE_DELAY_MS = 1_500;
const SELF_PROBE_TIMEOUT_MS = 20_000;
const SELF_PROBE_MESSAGE_TEXT = 'Tes koneksi internal bot. Abaikan pesan ini ya.';
const MEDIA_DOWNLOAD_LOGGER = {
  level: 'info',
  child() {
    return MEDIA_DOWNLOAD_LOGGER;
  },
  trace() {
    return;
  },
  debug() {
    return;
  },
  info() {
    return;
  },
  warn() {
    return;
  },
  error() {
    return;
  },
};

export async function startBaileysTransport(
  context: RuntimeTransportContext,
): Promise<RuntimeTransportController> {
  const { config, logger, runtimeStateStore } = context;
  const reconnectManager = createReconnectManager(config.reconnectDelaysMs);
  const qrManager = createQrManager(config, logger);
  const messageStore = createRuntimeMessageStore();
  const accessController = createAccessController({
    config,
    logger,
    runtimeStateStore,
  });
  const aiOrchestrator = createAiOrchestrator({
    config,
    logger,
    runtimeStateStore,
    async sendReply(chatJid, text, quotedMessage) {
      await sendChunkedReply(chatJid, text, quotedMessage, 'ai');
    },
    async downloadVoiceMedia(message) {
      if (!activeSocket) {
        throw new Error('WhatsApp socket is not available for voice download.');
      }

      return downloadMediaMessage(message, 'buffer', {}, {
        logger: MEDIA_DOWNLOAD_LOGGER,
        reuploadRequest: activeSocket.updateMediaMessage,
      });
    },
    async downloadImageMedia(message) {
      if (!activeSocket) {
        throw new Error('WhatsApp socket is not available for image download.');
      }

      return downloadMediaMessage(message, 'buffer', {}, {
        logger: MEDIA_DOWNLOAD_LOGGER,
        reuploadRequest: activeSocket.updateMediaMessage,
      });
    },
  });
  const adminCommandExecutor = createAdminCommandExecutor({
    config,
    logger,
    runtimeStateStore,
    async sendReply(chatJid, text, quotedMessage) {
      await sendChunkedReply(chatJid, text, quotedMessage, 'command');
    },
  });
  const inboundListener = createInboundMessageListener({
    logger,
    runtimeStateStore,
  });
  const lidMappings = await loadStoredLidMappings(config.whatsappAuthDir);

  let stopped = false;
  let socketGeneration = 0;
  let activeSocket: ReturnType<typeof makeWASocket> | null = null;
  let testOutboxController: { stop(): Promise<void> } | null = null;
  let saveCreds: (() => Promise<void>) | null = null;
  let resolvedVersion: WAVersion | null = null;
  let selfJid: string | null = null;
  let selfLid: string | null = null;
  let selfChatJid: string | null = null;
  let selfProbeJid: string | null = null;
  let healthyGeneration = 0;
  let fallbackSyncTimer: NodeJS.Timeout | null = null;
  let presenceHeartbeatTimer: NodeJS.Timeout | null = null;
  let flowProbeTimer: NodeJS.Timeout | null = null;
  let probeTimeoutTimer: NodeJS.Timeout | null = null;
  let activeProbeMessageId: string | null = null;
  const runtimeOriginatedMessageIds = new Set<string>();
  let resolveStopped: () => void = () => {};
  const untilStopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  await runtimeStateStore.syncDerivedState();
  await aiOrchestrator.syncState();
  await openSocket('initial');
  testOutboxController = startRuntimeTestOutbox({
    config,
    logger,
    async sendText(targetJid, text, request) {
      if (!activeSocket) {
        throw new Error('WhatsApp socket is not available for test-send.');
      }

      const sentMessage = await activeSocket.sendMessage(targetJid, {
        text,
      });
      if (sentMessage) {
        messageStore.remember(sentMessage);
      }

      const messageId = sentMessage?.key?.id ?? null;
      if (messageId) {
        runtimeOriginatedMessageIds.add(messageId);
      }

      await runtimeStateStore.update({
        lastOutboundMessageAt: new Date().toISOString(),
      });

      logger.info('test_outbox.outbound_sent', {
        requestId: request.id,
        targetJid,
        messageId,
      });

      return {
        messageId,
      };
    },
  });

  return {
    untilStopped,
    async stop(reason = 'manual') {
      if (stopped) {
        return untilStopped;
      }

      stopped = true;
      clearFallbackSyncTimer();
      clearPresenceHeartbeat();
      clearFlowProbeTimer();
      clearProbeTimeout();
      reconnectManager.cancel();
      await qrManager.dispose();

      await testOutboxController?.stop();
      testOutboxController = null;

      if (activeSocket) {
        activeSocket.end(new Error(`Runtime stopped: ${reason}`));
        activeSocket = null;
      }

      resolveStopped();
    },
  };

  async function openSocket(mode: 'initial' | 'reconnect'): Promise<void> {
    if (stopped) {
      return;
    }

    socketGeneration += 1;
    const generation = socketGeneration;
    healthyGeneration = 0;
    clearFallbackSyncTimer();
    clearPresenceHeartbeat();
    clearFlowProbeTimer();
    clearProbeTimeout();
    activeProbeMessageId = null;
    runtimeOriginatedMessageIds.clear();

    await runtimeStateStore.syncDerivedState();
    await runtimeStateStore.update({
      connectionState: mode === 'reconnect' ? 'reconnecting' : 'connecting',
      socketState: 'connecting',
      syncState: 'idle',
      receivedPendingNotifications: false,
      companionOnline: false,
      appStateSyncReady: false,
      qrState: 'not_requested',
      qrOpenedInPaint: false,
      lastDecryptIssue: null,
      lastDecryptIssueAt: null,
      lastSessionIssue: null,
      lastSessionIssueAt: null,
      deviceActivityState: 'unknown',
      messageFlowState: 'idle',
      inboundReady: false,
      lastInboundMessageId: null,
      lastInboundSender: null,
      lastInboundNormalizedSender: null,
      lastInboundChatJid: null,
      lastInboundWasFromSelf: null,
      lastInboundWasGroup: null,
      lastAccessDecisionAt: null,
      lastAccessDecisionRole: null,
      lastAccessDecisionReason: null,
      lastAccessDecisionAllowed: null,
      lastAccessDecisionSender: null,
      commandRegistryReady: true,
      lastCommandAt: null,
      lastCommandName: null,
      lastCommandAllowed: null,
      lastCommandReason: null,
      lastCommandSender: null,
      aiGatewayReady: runtimeStateStore.getSnapshot().aiGatewayReady,
      aiModelName: runtimeStateStore.getSnapshot().aiModelName,
      lastAiError: runtimeStateStore.getSnapshot().lastAiError,
      webSearchReady: runtimeStateStore.getSnapshot().webSearchReady,
      lastWebSearchAt: runtimeStateStore.getSnapshot().lastWebSearchAt,
      lastWebSearchQuery: runtimeStateStore.getSnapshot().lastWebSearchQuery,
      lastWebSearchUsed: runtimeStateStore.getSnapshot().lastWebSearchUsed,
      lastWebSearchError: runtimeStateStore.getSnapshot().lastWebSearchError,
      lastWebSearchResultCount: runtimeStateStore.getSnapshot().lastWebSearchResultCount,
      lastInboundMessageAt: null,
      lastOutboundMessageAt: null,
      lastMessageFlowAt: null,
      lastProbeAt: null,
      lastMessageFlowError: null,
      recentIdentityResolutions: [],
      lastError: mode === 'initial' ? null : runtimeStateStore.getSnapshot().lastError,
    });

    const authState = await loadSessionAuthState(config.whatsappAuthDir);
    saveCreds = authState.saveCreds;
    selfJid = authState.state.creds.me?.id ?? null;
    selfLid = authState.state.creds.me?.lid ?? null;
    selfChatJid = selfJid ? jidNormalizedUser(selfJid) : null;
    selfProbeJid = selfLid ? jidNormalizedUser(selfLid) : selfChatJid;
    const diagnosticsLogger = createBaileysDiagnosticLogger((entry) => {
      void handleDiagnosticLog(generation, entry);
    });
    const version = await resolveSocketVersion();

    const socket = makeWASocket({
      auth: {
        creds: authState.state.creds,
        keys: makeCacheableSignalKeyStore(authState.state.keys, diagnosticsLogger),
      },
      browser: Browsers.windows('Desktop'),
      logger: diagnosticsLogger,
      getMessage: (key) => messageStore.getMessage(key),
      markOnlineOnConnect: true,
      printQRInTerminal: false,
      syncFullHistory: true,
      shouldSyncHistoryMessage: shouldSyncHistoryMessage,
      enableAutoSessionRecreation: true,
      enableRecentMessageCache: true,
      appStateMacVerification: {
        patch: true,
        snapshot: true,
      },
      version,
    });

    activeSocket = socket;

    socket.ev.on('creds.update', () => {
      selfJid = socket.authState.creds.me?.id ?? selfJid;
      selfLid = socket.authState.creds.me?.lid ?? selfLid;
      selfChatJid = selfJid ? jidNormalizedUser(selfJid) : selfChatJid;
      selfProbeJid = selfLid ? jidNormalizedUser(selfLid) : selfChatJid;
      void persistCreds(generation);
    });

    socket.ev.on('connection.update', (update) => {
      void handleConnectionUpdate(generation, mode, update);
    });

    socket.ev.on('messaging-history.set', (update) => {
      void handleHistorySync(generation, update);
    });

    socket.ev.on('lid-mapping.update', (update) => {
      void handleLidMappingUpdate(generation, update);
    });

    socket.ev.on('messages.upsert', (update) => {
      void handleMessagesUpsert(generation, update.messages, update.type);
    });

    socket.ev.on('messages.media-update', (updates) => {
      void handleMediaUpdates(generation, updates);
    });

    socket.ev.on('messages.update', (updates) => {
      void handleMessageUpdates(generation, updates);
    });

    socket.ev.on('message-receipt.update', (updates) => {
      void handleMessageReceiptUpdates(generation, updates);
    });
  }

  async function sendChunkedReply(
    chatJid: string,
    text: string,
    quotedMessage: WAMessage,
    source: 'ai' | 'command',
  ): Promise<void> {
    if (!activeSocket) {
      throw new Error('WhatsApp socket is not available for reply.');
    }

    const chunks = splitOutgoingText(text);
    logger.info('outbound.packaged', {
      source,
      chatJid,
      chunkCount: chunks.length,
      textLength: text.length,
      longestChunkLength: chunks.reduce((longest, chunk) => Math.max(longest, chunk.length), 0),
    });

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]!;
      await activeSocket.sendMessage(
        chatJid,
        { text: chunk },
        { quoted: quotedMessage },
      );
    }
  }

  async function persistCreds(generation: number): Promise<void> {
    if (stopped || generation !== socketGeneration || !saveCreds) {
      return;
    }

    await saveCreds();
    await runtimeStateStore.syncDerivedState();
  }

  async function handleConnectionUpdate(
    generation: number,
    mode: 'initial' | 'reconnect',
    update: Partial<ConnectionState>,
  ): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    if (typeof update.isOnline === 'boolean') {
      await runtimeStateStore.update({
        companionOnline: update.isOnline,
      });
    }

    if (typeof update.receivedPendingNotifications === 'boolean') {
      const snapshot = runtimeStateStore.getSnapshot();
      await runtimeStateStore.update({
        receivedPendingNotifications: update.receivedPendingNotifications,
        syncState: update.receivedPendingNotifications
          ? snapshot.syncState === 'healthy'
            ? 'healthy'
            : 'awaiting_history'
          : snapshot.socketState === 'open'
            ? 'awaiting_notifications'
            : snapshot.syncState,
      });

      if (update.receivedPendingNotifications) {
        scheduleFallbackAppStateSync(generation);
      }
    }

    if (update.connection === 'connecting') {
      await runtimeStateStore.update({
        connectionState: mode === 'reconnect' ? 'reconnecting' : 'connecting',
        socketState: 'connecting',
        syncState: 'idle',
      });
    }

    if (update.qr) {
      const qrResult = await qrManager.generate(update.qr);
      await runtimeStateStore.syncDerivedState();
      await runtimeStateStore.update({
        connectionState: 'qr_required',
        socketState: 'connecting',
        syncState: 'idle',
        qrState: qrResult.opened ? 'opened_in_paint' : 'generated',
        qrOpenedInPaint: qrResult.opened,
        lastError: qrResult.opened ? null : 'QR PNG was generated but Paint could not be opened.',
      });
    }

    if (update.connection === 'open') {
      reconnectManager.reset();
      startPresenceHeartbeat(generation);
      await qrManager.clear();
      await runtimeStateStore.syncDerivedState();
      await runtimeStateStore.update({
        connectionState: mode === 'reconnect' ? 'reconnecting' : 'connecting',
        socketState: 'open',
        syncState: runtimeStateStore.getSnapshot().receivedPendingNotifications
          ? 'awaiting_history'
          : 'awaiting_notifications',
        deviceActivityState: 'passive',
        messageFlowState: 'idle',
        qrState: 'cleared',
        qrOpenedInPaint: false,
        lastError: null,
      });
      return;
    }

    if (update.connection === 'close') {
      const disconnectReason = extractDisconnectReason(update.lastDisconnect?.error);
      const disconnectMessage = formatDisconnectMessage(update.lastDisconnect?.error);
      const now = new Date().toISOString();

      await runtimeStateStore.update({
        socketState: 'closed',
        companionOnline: false,
        appStateSyncReady: false,
        deviceActivityState: 'unknown',
        messageFlowState: 'degraded',
        lastDisconnectAt: now,
      });
      clearFallbackSyncTimer();
      clearPresenceHeartbeat();
      clearFlowProbeTimer();
      clearProbeTimeout();
      activeProbeMessageId = null;

      if (stopped) {
        return;
      }

      if (
        disconnectReason === DisconnectReason.loggedOut ||
        disconnectReason === DisconnectReason.badSession
      ) {
        reconnectManager.cancel();
        await qrManager.clear();
        await runtimeStateStore.syncDerivedState();
        await runtimeStateStore.update({
          connectionState: 'logged_out',
          syncState: 'degraded',
          deviceActivityState: 'unknown',
          messageFlowState: 'degraded',
          qrState: 'not_requested',
          qrOpenedInPaint: false,
          lastError: disconnectMessage,
          lastSessionIssue: disconnectMessage,
          lastSessionIssueAt: now,
          lastMessageFlowError: disconnectMessage,
        });
        logger.warn('whatsapp.logged_out', {
          reasonCode: disconnectReason,
          message: disconnectMessage,
          authStoreRetained: true,
        });
        return;
      }

      logger.warn('whatsapp.disconnected', {
        reasonCode: disconnectReason,
        message: disconnectMessage,
      });

      const delayMs = reconnectManager.schedule(() => {
        if (stopped) {
          return;
        }
        void openSocket('reconnect');
      });

      await runtimeStateStore.update({
        connectionState: 'reconnecting',
        syncState: 'degraded',
        deviceActivityState: 'unknown',
        messageFlowState: 'degraded',
        qrState: 'not_requested',
        qrOpenedInPaint: false,
        lastError: disconnectMessage,
        lastSessionIssue: disconnectMessage,
        lastSessionIssueAt: now,
        lastMessageFlowError: disconnectMessage,
      });
      logger.info('whatsapp.reconnecting', {
        delayMs,
      });
    }
  }

  async function handleHistorySync(
    generation: number,
    update: {
      syncType?: number | null;
      isLatest?: boolean;
      progress?: number | null;
    },
  ): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    const nextSyncState =
      update.isLatest || update.progress === 100 ? 'syncing' : runtimeStateStore.getSnapshot().syncState;
    await runtimeStateStore.update({
      syncState: nextSyncState === 'healthy' ? 'healthy' : 'syncing',
    });
  }

  async function handleLidMappingUpdate(
    generation: number,
    update: {
      lid: string;
      pn: string;
    },
  ): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    lidMappings.lidToPn.set(bareUser(update.lid), bareUser(update.pn));
    lidMappings.pnToLid.set(bareUser(update.pn), bareUser(update.lid));
  }

  async function handleMessagesUpsert(
    generation: number,
    messages: WAMessage[],
    upsertType: MessageUpsertType,
  ): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    for (const message of messages) {
      messageStore.remember(message);
      const resolvedIdentity = resolveSenderIdentity(message, {
        selfJid,
        selfLid,
        botPrimaryNumber: config.botPrimaryNumber,
        lidToPn: lidMappings.lidToPn,
        pnToLid: lidMappings.pnToLid,
      });

      if (resolvedIdentity) {
        await trackIdentityResolution(generation, resolvedIdentity);
      }

      const stubError = extractStubError(message);
      if (stubError) {
        await trackDecryptIssue(generation, stubError, {
          remoteJid: message.key?.remoteJid ?? null,
          participant: message.key?.participant ?? null,
          messageId: message.key?.id ?? null,
        });
      }

      await inboundListener.processMessage(message, upsertType, resolvedIdentity);
      await handleLiveMessageFlow(generation, message, upsertType, resolvedIdentity);

      if (upsertType === 'append' || !isUserFacingMessage(message)) {
        continue;
      }

      const systemBotRoutingSkipReason = getSystemBotRoutingSkipReason({
        message,
        normalizedSender: resolvedIdentity?.normalizedSender ?? null,
        botPrimaryNumber: config.botPrimaryNumber,
        superAdminNumbers: config.superAdminNumbers,
        runtimeProfile: config.runtimeProfile,
        isFromSelf: resolvedIdentity?.isFromSelf ?? message.key?.fromMe === true,
        isGroup: resolvedIdentity?.isGroup ?? false,
        chatJid: resolvedIdentity?.chatJid ?? message.key?.remoteJid ?? null,
        botJid: resolvedIdentity?.botJid ?? null,
        botLid: resolvedIdentity?.botLid ?? null,
      });
      if (systemBotRoutingSkipReason) {
        logger.warn('ai.skipped_system_bot_routing', {
          messageId: message.key?.id ?? null,
          reason: systemBotRoutingSkipReason,
          senderJid: resolvedIdentity?.senderJid ?? null,
          normalizedSender: resolvedIdentity?.normalizedSender ?? null,
          chatJid: resolvedIdentity?.chatJid ?? null,
          isFromSelf: resolvedIdentity?.isFromSelf ?? false,
          isGroup: resolvedIdentity?.isGroup ?? false,
          runtimeProfile: config.runtimeProfile,
        });
        continue;
      }

      const accessDecision = await accessController.evaluateMessageAccess(message, resolvedIdentity);
      if (!accessDecision.isAllowed) {
        logger.info('ai.skipped_denied', {
          messageId: message.key?.id ?? null,
          senderJid: accessDecision.senderJid,
          normalizedSender: accessDecision.normalizedSender,
          chatJid: accessDecision.chatJid,
          role: accessDecision.role,
          reason: accessDecision.reason,
          isFromSelf: accessDecision.isFromSelf,
          isGroup: accessDecision.isGroup,
        });
        continue;
      }

      const commandResult = await adminCommandExecutor.processAllowedMessage(message, resolvedIdentity, accessDecision);
      if (commandResult.handled) {
        logger.info('ai.skipped_command', {
          messageId: message.key?.id ?? null,
          senderJid: accessDecision.senderJid,
          normalizedSender: accessDecision.normalizedSender,
          chatJid: accessDecision.chatJid,
          role: accessDecision.role,
          commandName: commandResult.commandName,
          reason: commandResult.reason,
          isFromSelf: accessDecision.isFromSelf,
          isGroup: accessDecision.isGroup,
        });
        continue;
      }

      await aiOrchestrator.handleAllowedNonCommandMessage(message, resolvedIdentity, accessDecision);
    }
  }

  async function handleMediaUpdates(
    generation: number,
    updates: Array<{
      key: {
        id?: string | null;
        remoteJid?: string | null;
        participant?: string | null;
      };
      error?: Error;
    }>,
  ): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    for (const update of updates) {
      if (!update.error) {
        continue;
      }

      await trackDecryptIssue(generation, update.error.message, {
        remoteJid: update.key.remoteJid ?? null,
        participant: update.key.participant ?? null,
        messageId: update.key.id ?? null,
      });
    }
  }

  async function handleMessageUpdates(
    generation: number,
    updates: Array<{
      key: {
        id?: string | null;
        remoteJid?: string | null;
        participant?: string | null;
      };
      update: {
        status?: number | null;
        message?: proto.IMessage | null;
        messageStubParameters?: unknown;
      };
    }>,
  ): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    for (const update of updates) {
      const stubError = extractStubError({
        key: update.key,
        messageStubParameters: update.update.messageStubParameters,
      } as WAMessage);
      if (update.update.message) {
        messageStore.rememberProto(update.key, update.update.message);
      }
      if (!stubError) {
        const status = typeof update.update.status === 'number' ? update.update.status : null;
        if (status !== null) {
          await handleOutboundStatusUpdate(generation, update.key.id ?? null, status, {
            remoteJid: update.key.remoteJid ?? null,
            participant: update.key.participant ?? null,
          });
        }
        continue;
      }

      await trackDecryptIssue(generation, stubError, {
        remoteJid: update.key.remoteJid ?? null,
        participant: update.key.participant ?? null,
        messageId: update.key.id ?? null,
      });
    }
  }

  async function handleMessageReceiptUpdates(
    generation: number,
    updates: MessageUserReceiptUpdate[],
  ): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    for (const update of updates) {
      const messageId = update.key.id ?? null;
      const receipt = update.receipt as Record<string, unknown>;
      const delivered = typeof receipt.receiptTimestamp === 'number' || typeof receipt.readTimestamp === 'number';
      if (!delivered) {
        continue;
      }

      const now = new Date().toISOString();
      await runtimeStateStore.update({
        lastOutboundMessageAt: now,
      });

      if (messageId && messageId === activeProbeMessageId) {
        await markMessageFlowUsable(generation, 'probe_receipt_update', {
          remoteJid: update.key.remoteJid ?? null,
          participant: update.key.participant ?? null,
          messageId,
        });
      }
    }
  }

  async function handleDiagnosticLog(
    generation: number,
    entry: BaileysDiagnosticEntry,
  ): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    const message = entry.msg;
    if (!message) {
      const diagnosticIssue = extractRelevantDiagnosticText(entry.data);
      if (diagnosticIssue) {
        await trackDecryptIssue(generation, diagnosticIssue, {});
      }
      return;
    }

    if (message.includes('Connection is now AwaitingInitialSync')) {
      await runtimeStateStore.update({
        syncState: 'awaiting_history',
      });
      return;
    }

    if (message.includes('Transitioned to Syncing state') || message.includes('Doing app state sync')) {
      await runtimeStateStore.update({
        syncState: 'syncing',
      });
      return;
    }

    if (message.includes('App state sync complete, transitioning to Online state and flushing buffer')) {
      await markSyncHealthy(generation, 'app_state_sync_complete');
      return;
    }

    if (
      message.startsWith('synced ') ||
      message.startsWith('restored state of ')
    ) {
      await markSessionSyncRecovered(generation, message);
      return;
    }

    if (message.includes('Timeout in AwaitingInitialSync')) {
      const snapshot = runtimeStateStore.getSnapshot();
      if (
        snapshot.connectionState === 'connected' &&
        snapshot.socketState === 'open' &&
        snapshot.appStateSyncReady &&
        snapshot.lastSyncAt
      ) {
        return;
      }

      await runtimeStateStore.update({
        syncState: 'degraded',
        appStateSyncReady: false,
        deviceActivityState: 'passive',
        lastError: message,
      });
      return;
    }

    if (message.includes('failed to sync state')) {
      if (message.includes('removing and trying from scratch')) {
        await trackRecoverableSessionIssue(generation, message);
        return;
      }

      await trackSessionIssue(generation, message);
      return;
    }

    if (message.includes('identity changed')) {
      const identityJid = typeof entry.data.jid === 'string' ? entry.data.jid : null;
      const now = new Date().toISOString();
      await runtimeStateStore.update({
        lastSessionIssue: identityJid ? `Identity changed for ${identityJid}.` : 'Identity changed.',
        lastSessionIssueAt: now,
      });
      return;
    }

    const diagnosticIssue = extractRelevantDiagnosticText(entry.data);
    if (diagnosticIssue) {
      await trackDecryptIssue(generation, diagnosticIssue, {});
    }
  }

  async function trackIdentityResolution(
    generation: number,
    resolution: RuntimeIdentityResolutionSnapshot,
  ): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    const snapshot = runtimeStateStore.getSnapshot();
    const existing = snapshot.recentIdentityResolutions.filter((item) => item.senderJid !== resolution.senderJid);
    const nextResolutions = [resolution, ...existing].slice(0, 10);

    await runtimeStateStore.update({
      recentIdentityResolutions: nextResolutions,
    });
  }

  async function trackDecryptIssue(
    generation: number,
    issue: string,
    contextPatch: Record<string, unknown>,
  ): Promise<void> {
    if (stopped || generation !== socketGeneration || !SESSION_ERROR_PATTERNS.some((pattern) => pattern.test(issue))) {
      return;
    }

    const now = new Date().toISOString();
    await runtimeStateStore.update({
      syncState: 'degraded',
      lastDecryptIssue: issue,
      lastDecryptIssueAt: now,
      deviceActivityState: 'passive',
      messageFlowState: 'degraded',
      lastMessageFlowError: issue,
      lastError: issue,
    });
    logger.warn('whatsapp.error', {
      kind: 'decrypt_issue',
      message: issue,
      ...contextPatch,
    });
  }

  async function trackSessionIssue(generation: number, issue: string): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    healthyGeneration = 0;
    const now = new Date().toISOString();
    await runtimeStateStore.update({
      syncState: 'degraded',
      appStateSyncReady: false,
      deviceActivityState: 'passive',
      messageFlowState: 'degraded',
      lastSessionIssue: issue,
      lastSessionIssueAt: now,
      lastMessageFlowError: issue,
      lastError: issue,
    });
    logger.warn('whatsapp.error', {
      kind: 'session_sync_issue',
      message: issue,
    });
  }

  async function trackRecoverableSessionIssue(generation: number, issue: string): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    const snapshot = runtimeStateStore.getSnapshot();
    const now = new Date().toISOString();
    await runtimeStateStore.update({
      syncState:
        snapshot.connectionState === 'connected' &&
        snapshot.socketState === 'open' &&
        snapshot.receivedPendingNotifications
          ? 'syncing'
          : snapshot.syncState,
      lastSessionIssue: issue,
      lastSessionIssueAt: now,
      lastError: null,
    });

    if (
      snapshot.connectionState === 'connected' &&
      snapshot.socketState === 'open' &&
      snapshot.receivedPendingNotifications
    ) {
      scheduleFallbackAppStateSync(generation);
    }
  }

  async function markSessionSyncRecovered(generation: number, sourceMessage: string): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    const snapshot = runtimeStateStore.getSnapshot();
    if (snapshot.connectionState !== 'connected' || snapshot.socketState !== 'open') {
      return;
    }

    const now = new Date().toISOString();
    healthyGeneration = generation;
    clearFallbackSyncTimer();
    await runtimeStateStore.update({
      syncState: 'healthy',
      appStateSyncReady: true,
      deviceActivityState: snapshot.messageFlowState === 'usable' ? 'active' : snapshot.deviceActivityState,
      lastSyncAt: now,
      lastSessionIssue: null,
      lastSessionIssueAt: null,
      lastError: null,
    });
  }

  async function markSyncHealthy(generation: number, source: string): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    const currentSnapshot = runtimeStateStore.getSnapshot();
    if (
      healthyGeneration === generation &&
      currentSnapshot.syncState === 'healthy' &&
      currentSnapshot.appStateSyncReady
    ) {
      return;
    }

    healthyGeneration = generation;
    clearFallbackSyncTimer();
    const now = new Date().toISOString();
    await runtimeStateStore.syncDerivedState();
    await runtimeStateStore.update({
      connectionState: 'connected',
      socketState: 'open',
      syncState: 'healthy',
      appStateSyncReady: true,
      deviceActivityState: runtimeStateStore.getSnapshot().messageFlowState === 'usable' ? 'active' : 'passive',
      lastConnectAt: now,
      lastSyncAt: now,
      lastSessionIssue: null,
      lastSessionIssueAt: null,
      lastError: null,
    });
    logger.info('whatsapp.connected', {
      whatsappTransportMode: config.whatsappTransportMode,
      source,
    });

    if (runtimeStateStore.getSnapshot().messageFlowState !== 'usable') {
      scheduleFlowProbe(generation, SELF_PROBE_DELAY_MS, 'post_connect');
    }
  }

  function scheduleFallbackAppStateSync(generation: number): void {
    clearFallbackSyncTimer();
    fallbackSyncTimer = setTimeout(() => {
      void runFallbackAppStateSync(generation);
    }, 2_500);
  }

  async function runFallbackAppStateSync(generation: number): Promise<void> {
    if (stopped || generation !== socketGeneration || healthyGeneration === generation || !activeSocket) {
      return;
    }

    const snapshot = runtimeStateStore.getSnapshot();
    if (snapshot.socketState !== 'open' || snapshot.receivedPendingNotifications !== true) {
      return;
    }

    await runtimeStateStore.update({
      syncState: 'syncing',
    });

    try {
      await activeSocket.resyncAppState(ALL_WA_PATCH_NAMES, true);
      await markSyncHealthy(generation, 'manual_resync_app_state');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await trackSessionIssue(generation, `App state resync failed: ${message}`);
    }
  }

  function clearFallbackSyncTimer(): void {
    if (!fallbackSyncTimer) {
      return;
    }

    clearTimeout(fallbackSyncTimer);
    fallbackSyncTimer = null;
  }

  function startPresenceHeartbeat(generation: number): void {
    clearPresenceHeartbeat();
    presenceHeartbeatTimer = setInterval(() => {
      if (stopped || generation !== socketGeneration || !activeSocket) {
        return;
      }

      void activeSocket.sendPresenceUpdate('available').catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        await trackSessionIssue(generation, `Presence heartbeat failed: ${message}`);
      });
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
  }

  function clearPresenceHeartbeat(): void {
    if (!presenceHeartbeatTimer) {
      return;
    }

    clearInterval(presenceHeartbeatTimer);
    presenceHeartbeatTimer = null;
  }

  function scheduleFlowProbe(generation: number, delayMs: number, reason: string): void {
    clearFlowProbeTimer();
    flowProbeTimer = setTimeout(() => {
      void sendSelfFlowProbe(generation, reason);
    }, delayMs);
  }

  function clearFlowProbeTimer(): void {
    if (!flowProbeTimer) {
      return;
    }

    clearTimeout(flowProbeTimer);
    flowProbeTimer = null;
  }

  async function sendSelfFlowProbe(generation: number, reason: string): Promise<void> {
    if (stopped || generation !== socketGeneration || !activeSocket || !selfProbeJid) {
      return;
    }

    const now = new Date().toISOString();
    await runtimeStateStore.update({
      deviceActivityState: 'passive',
      messageFlowState: 'probing',
      lastProbeAt: now,
      lastMessageFlowError: null,
      lastError: null,
    });

    try {
      const probeMessage = await activeSocket.sendMessage(selfProbeJid, {
        text: SELF_PROBE_MESSAGE_TEXT,
      });
      if (probeMessage) {
        messageStore.remember(probeMessage);
      }

      activeProbeMessageId = probeMessage?.key?.id ?? null;
      if (activeProbeMessageId) {
        runtimeOriginatedMessageIds.add(activeProbeMessageId);
      }
      await runtimeStateStore.update({
        lastOutboundMessageAt: now,
      });
      scheduleProbeTimeout(generation, activeProbeMessageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await runtimeStateStore.update({
        deviceActivityState: 'passive',
        messageFlowState: 'degraded',
        lastMessageFlowError: `Self flow probe failed: ${message}`,
        lastError: `Self flow probe failed: ${message}`,
      });
      logger.warn('whatsapp.error', {
        kind: 'message_flow_probe_failed',
        message,
        targetJid: selfProbeJid,
        reason,
      });
    }
  }

  function scheduleProbeTimeout(generation: number, messageId: string | null): void {
    clearProbeTimeout();
    probeTimeoutTimer = setTimeout(() => {
      void handleProbeTimeout(generation, messageId);
    }, SELF_PROBE_TIMEOUT_MS);
  }

  function clearProbeTimeout(): void {
    if (!probeTimeoutTimer) {
      return;
    }

    clearTimeout(probeTimeoutTimer);
    probeTimeoutTimer = null;
  }

  async function handleProbeTimeout(generation: number, messageId: string | null): Promise<void> {
    if (stopped || generation !== socketGeneration || activeProbeMessageId !== messageId) {
      return;
    }

    activeProbeMessageId = null;
    if (messageId) {
      runtimeOriginatedMessageIds.delete(messageId);
    }
    const message = `Self flow probe did not reach a delivered/read state within ${SELF_PROBE_TIMEOUT_MS}ms.`;
    await runtimeStateStore.update({
      deviceActivityState: 'passive',
      messageFlowState: 'degraded',
      lastMessageFlowError: message,
      lastError: message,
    });
  }

  async function handleLiveMessageFlow(
    generation: number,
    message: WAMessage,
    upsertType: MessageUpsertType,
    resolvedIdentity: RuntimeIdentityResolutionSnapshot | null,
  ): Promise<void> {
    if (!isUserFacingMessage(message)) {
      return;
    }

    const now = new Date().toISOString();
    const key = message.key ?? {};
    if (key.fromMe) {
      const messageId = key.id ?? null;
      const originatedLocally = messageId ? runtimeOriginatedMessageIds.has(messageId) : false;
      if (originatedLocally) {
        await runtimeStateStore.update({
          lastOutboundMessageAt: now,
        });
        if (upsertType !== 'append') {
          await markMessageFlowUsable(generation, 'probe_roundtrip', {
            remoteJid: key.remoteJid ?? null,
            participant: key.participant ?? null,
            messageId,
            upsertType,
          });
        }
        return;
      }

      if (upsertType === 'append') {
        return;
      }

      await markMessageFlowUsable(generation, 'own_device_message', {
        remoteJid: key.remoteJid ?? null,
        participant: key.participant ?? null,
        messageId,
        upsertType,
      });
      return;
    }

    if (upsertType !== 'notify') {
      return;
    }

    if (activeSocket) {
      try {
        await activeSocket.readMessages([key]);
      } catch {
        // Keep flow monitoring honest without adding noisy logs for transient read failures.
      }
    }

    await markMessageFlowUsable(generation, 'live_inbound_message', {
      remoteJid: key.remoteJid ?? null,
      participant: key.participant ?? null,
      senderJid: resolvedIdentity?.senderJid ?? null,
    });
  }

  async function handleOutboundStatusUpdate(
    generation: number,
    messageId: string | null,
    status: number,
    contextPatch: Record<string, unknown>,
  ): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    const now = new Date().toISOString();
    if (status >= proto.WebMessageInfo.Status.SERVER_ACK) {
      await runtimeStateStore.update({
        lastOutboundMessageAt: now,
      });
    }

    if (
      messageId &&
      messageId === activeProbeMessageId &&
      status >= proto.WebMessageInfo.Status.DELIVERY_ACK
    ) {
      await markMessageFlowUsable(generation, 'probe_delivery_ack', {
        messageId,
        status,
        ...contextPatch,
      });
    }
  }

  async function markMessageFlowUsable(
    generation: number,
    reason: string,
    contextPatch: Record<string, unknown>,
  ): Promise<void> {
    if (stopped || generation !== socketGeneration) {
      return;
    }

    const now = new Date().toISOString();
    const snapshot = runtimeStateStore.getSnapshot();
    const canRecoverHealthySync =
      snapshot.connectionState === 'connected' &&
      snapshot.socketState === 'open' &&
      snapshot.receivedPendingNotifications &&
      snapshot.appStateSyncReady;

    clearFlowProbeTimer();
    clearProbeTimeout();
    if (activeProbeMessageId) {
      runtimeOriginatedMessageIds.delete(activeProbeMessageId);
    }
    activeProbeMessageId = null;
    if (canRecoverHealthySync) {
      healthyGeneration = generation;
    }
    await runtimeStateStore.update({
      syncState: canRecoverHealthySync ? 'healthy' : snapshot.syncState,
      deviceActivityState: 'active',
      messageFlowState: 'usable',
      lastSyncAt: canRecoverHealthySync ? now : snapshot.lastSyncAt,
      lastDecryptIssue: canRecoverHealthySync ? null : snapshot.lastDecryptIssue,
      lastDecryptIssueAt: canRecoverHealthySync ? null : snapshot.lastDecryptIssueAt,
      lastSessionIssue: canRecoverHealthySync ? null : snapshot.lastSessionIssue,
      lastSessionIssueAt: canRecoverHealthySync ? null : snapshot.lastSessionIssueAt,
      lastMessageFlowAt: now,
      lastMessageFlowError: null,
      lastError: null,
    });
    logger.info('whatsapp.message_flow_usable', {
      reason,
      ...contextPatch,
    });
  }

  async function resolveSocketVersion(): Promise<WAVersion | undefined> {
    if (resolvedVersion) {
      return resolvedVersion;
    }

    try {
      const latest = await fetchLatestWaWebVersion();
      resolvedVersion = latest.version;
      return resolvedVersion;
    } catch {
      return undefined;
    }
  }
}

function shouldSyncHistoryMessage(historyMessage: proto.Message.IHistorySyncNotification): boolean {
  return historyMessage.syncType === proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP ||
    historyMessage.syncType === proto.HistorySync.HistorySyncType.RECENT ||
    historyMessage.syncType === proto.HistorySync.HistorySyncType.FULL ||
    historyMessage.syncType === proto.HistorySync.HistorySyncType.ON_DEMAND ||
    historyMessage.syncType === proto.HistorySync.HistorySyncType.PUSH_NAME ||
    historyMessage.syncType === proto.HistorySync.HistorySyncType.NON_BLOCKING_DATA ||
    historyMessage.syncType === proto.HistorySync.HistorySyncType.INITIAL_STATUS_V3;
}

function extractDisconnectReason(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as {
    output?: {
      statusCode?: number;
    };
  };

  return candidate.output?.statusCode ?? null;
}

function formatDisconnectMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'WhatsApp transport disconnected.';
}

function extractStubError(message: WAMessage): string | null {
  const rawParameters = message.messageStubParameters;
  if (!Array.isArray(rawParameters)) {
    return null;
  }

  const match = rawParameters.find(
    (item): item is string =>
      typeof item === 'string' && SESSION_ERROR_PATTERNS.some((pattern) => pattern.test(item)),
  );

  return match ?? null;
}

function extractRelevantDiagnosticText(value: unknown): string | null {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > 4) {
      continue;
    }

    const currentValue = current.value;
    if (typeof currentValue === 'string' && SESSION_ERROR_PATTERNS.some((pattern) => pattern.test(currentValue))) {
      return currentValue;
    }

    if (!currentValue || typeof currentValue !== 'object') {
      continue;
    }

    if (currentValue instanceof Error) {
      if (SESSION_ERROR_PATTERNS.some((pattern) => pattern.test(currentValue.message))) {
        return currentValue.message;
      }
    }

    for (const nested of Object.values(currentValue as Record<string, unknown>)) {
      if (typeof nested === 'string' || (nested && typeof nested === 'object')) {
        queue.push({
          value: nested,
          depth: current.depth + 1,
        });
      }
    }
  }

  return null;
}

function bareUser(value: string): string {
  return value.split('@', 1)[0]?.split(':', 1)[0] ?? value;
}
