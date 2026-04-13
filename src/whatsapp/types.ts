import type { AppConfig } from '../config/app-config.js';
import { getManagedSeedSuperAdminProfiles } from '../access/super-admin-seed.js';
import type { AccessReason, AccessRole, ChatAccessReason } from '../access/types.js';
import type { AdminCommandName, CommandExecutionReason } from '../command/types.js';

export type RuntimeConnectionState =
  | 'idle'
  | 'connecting'
  | 'qr_required'
  | 'connected'
  | 'reconnecting'
  | 'logged_out'
  | 'failed_closed';

export type RuntimeSocketState = 'idle' | 'connecting' | 'open' | 'closed';

export type RuntimeSyncState =
  | 'idle'
  | 'awaiting_notifications'
  | 'awaiting_history'
  | 'syncing'
  | 'healthy'
  | 'degraded';

export type RuntimeDeviceActivityState = 'unknown' | 'passive' | 'active';

export type RuntimeMessageFlowState = 'idle' | 'probing' | 'usable' | 'degraded';

export type RuntimeMirrorFreshnessState = 'unknown' | 'fresh' | 'stale' | 'error';

export type RuntimeSyncAuthorityMode =
  | 'live_authoritative'
  | 'mirror_authoritative'
  | 'conflict';

export type RuntimeWriteSessionStatus =
  | 'idle'
  | 'active'
  | 'verifying'
  | 'committed'
  | 'failed'
  | 'conflict';

export type RuntimeAuthoritativeSource = 'live_manual' | 'mirror_write_contract';

export type RuntimeQrState =
  | 'not_requested'
  | 'generated'
  | 'opened_in_paint'
  | 'cleared'
  | 'open_failed';

export type IdentityResolutionSource =
  | 'self'
  | 'sender_pn'
  | 'participant'
  | 'participant_alt'
  | 'context_participant'
  | 'remote_jid'
  | 'remote_jid_alt'
  | 'context_remote_jid'
  | 'unknown';

export interface RuntimeIdentityResolutionSnapshot {
  observedAt: string;
  chatJid: string | null;
  senderJid: string;
  normalizedSender: string | null;
  senderPn: string | null;
  senderLid: string | null;
  botNumber: string | null;
  botJid: string | null;
  botLid: string | null;
  remoteJid: string | null;
  participant: string | null;
  keyParticipant: string | null;
  contextParticipant: string | null;
  explicitSenderPn: string | null;
  isFromSelf: boolean;
  isGroup: boolean;
  source: IdentityResolutionSource;
}

export interface RuntimeStateSnapshot {
  stageName: string;
  whatsappTransportMode: AppConfig['whatsappTransportMode'];
  connectionState: RuntimeConnectionState;
  socketState: RuntimeSocketState;
  syncState: RuntimeSyncState;
  sessionStoreReady: boolean;
  sessionPresent: boolean;
  receivedPendingNotifications: boolean;
  companionOnline: boolean;
  appStateSyncReady: boolean;
  deviceActivityState: RuntimeDeviceActivityState;
  messageFlowState: RuntimeMessageFlowState;
  qrState: RuntimeQrState;
  qrFilePath: string;
  qrOpenedInPaint: boolean;
  lastConnectAt: string | null;
  lastDisconnectAt: string | null;
  lastSyncAt: string | null;
  lastInboundMessageAt: string | null;
  lastOutboundMessageAt: string | null;
  lastMessageFlowAt: string | null;
  lastProbeAt: string | null;
  inboundReady: boolean;
  lastInboundMessageId: string | null;
  lastInboundSender: string | null;
  lastInboundNormalizedSender: string | null;
  lastInboundChatJid: string | null;
  lastInboundWasFromSelf: boolean | null;
  lastInboundWasGroup: boolean | null;
  accessGateReady: boolean;
  officialGroupWhitelistReady: boolean;
  officialGroupJid: string | null;
  officialGroupName: string | null;
  lastAccessDecisionAt: string | null;
  lastAccessDecisionRole: AccessRole | null;
  lastAccessDecisionReason: AccessReason | null;
  lastAccessDecisionAllowed: boolean | null;
  lastAccessDecisionSender: string | null;
  lastGroupAccessDecisionAt: string | null;
  lastGroupAccessDecisionAllowed: boolean | null;
  lastGroupAccessDecisionSender: string | null;
  lastGroupAccessDecisionChatJid: string | null;
  lastGroupAccessDecisionReason: ChatAccessReason | null;
  commandRegistryReady: boolean;
  lastCommandAt: string | null;
  lastCommandName: AdminCommandName | null;
  lastCommandAllowed: boolean | null;
  lastCommandReason: CommandExecutionReason | null;
  lastCommandSender: string | null;
  aiGatewayReady: boolean;
  aiModelName: string | null;
  lastAiRequestAt: string | null;
  lastAiReplyAt: string | null;
  lastAiSender: string | null;
  lastAiChatJid: string | null;
  lastAiError: string | null;
  voiceGatewayReady: boolean;
  lastVoiceMessageAt: string | null;
  lastVoiceTranscriptionAt: string | null;
  lastVoiceSender: string | null;
  lastVoiceChatJid: string | null;
  lastVoiceError: string | null;
  lastVoiceTranscriptPreview: string | null;
  lastVoiceDurationSeconds: number | null;
  lastVoiceInputMode: 'voice_note' | 'audio' | null;
  imageGatewayReady: boolean;
  lastImageMessageAt: string | null;
  lastImageAnalysisAt: string | null;
  lastImageSender: string | null;
  lastImageChatJid: string | null;
  lastImageError: string | null;
  lastImageCaptionPreview: string | null;
  lastImageInputMode: 'image' | null;
  googleSheetsReady: boolean;
  lastGoogleSheetsError: string | null;
  mirrorSyncReady: boolean;
  lastMirrorSyncAt: string | null;
  lastMirrorSyncError: string | null;
  mirrorFreshnessState: RuntimeMirrorFreshnessState;
  syncAuthorityMode: RuntimeSyncAuthorityMode;
  activeWriteSessionId: string | null;
  activeWriteScope: string[];
  activeWriteSource: RuntimeAuthoritativeSource | null;
  writeSessionStatus: RuntimeWriteSessionStatus;
  lastAuthoritativeSource: RuntimeAuthoritativeSource | null;
  lastAuthorityConflictReason: string | null;
  dynamicPromptRegistryReady: boolean;
  activeDynamicPromptCount: number;
  lastDynamicPromptAppliedAt: string | null;
  lastDynamicPromptAuditAt: string | null;
  lastDynamicPromptError: string | null;
  webSearchReady: boolean;
  lastWebSearchAt: string | null;
  lastWebSearchQuery: string | null;
  lastWebSearchUsed: boolean;
  lastWebSearchError: string | null;
  lastWebSearchResultCount: number;
  lastContextUpdatedAt: string | null;
  activeConversationCount: number;
  activeDynamicAdminCount: number;
  superAdminCount: number;
  lastDecryptIssue: string | null;
  lastDecryptIssueAt: string | null;
  lastSessionIssue: string | null;
  lastSessionIssueAt: string | null;
  lastMessageFlowError: string | null;
  recentIdentityResolutions: RuntimeIdentityResolutionSnapshot[];
  lastError: string | null;
}

export function buildDefaultRuntimeState(config: AppConfig): RuntimeStateSnapshot {
  const googleSheetsEnabled = config.spreadsheetReadEnabled || config.mirrorSyncEnabled;
  const googleSheetsReady = googleSheetsEnabled
    ? Boolean(
        config.googleSheetsSpreadsheetId &&
          config.googleServiceAccountEmail &&
          config.googleServiceAccountKeyPath,
      )
    : false;

  return {
    stageName: config.stageName,
    whatsappTransportMode: config.whatsappTransportMode,
    connectionState: 'idle',
    socketState: 'idle',
    syncState: 'idle',
    sessionStoreReady: false,
    sessionPresent: false,
    receivedPendingNotifications: false,
    companionOnline: false,
    appStateSyncReady: false,
    deviceActivityState: 'unknown',
    messageFlowState: 'idle',
    qrState: 'not_requested',
    qrFilePath: config.whatsappQrFilePath,
    qrOpenedInPaint: false,
    lastConnectAt: null,
    lastDisconnectAt: null,
    lastSyncAt: null,
    lastInboundMessageAt: null,
    lastOutboundMessageAt: null,
    lastMessageFlowAt: null,
    lastProbeAt: null,
    inboundReady: false,
    lastInboundMessageId: null,
    lastInboundSender: null,
    lastInboundNormalizedSender: null,
    lastInboundChatJid: null,
    lastInboundWasFromSelf: null,
    lastInboundWasGroup: null,
    accessGateReady: true,
    officialGroupWhitelistReady: false,
    officialGroupJid: null,
    officialGroupName: null,
    lastAccessDecisionAt: null,
    lastAccessDecisionRole: null,
    lastAccessDecisionReason: null,
    lastAccessDecisionAllowed: null,
    lastAccessDecisionSender: null,
    lastGroupAccessDecisionAt: null,
    lastGroupAccessDecisionAllowed: null,
    lastGroupAccessDecisionSender: null,
    lastGroupAccessDecisionChatJid: null,
    lastGroupAccessDecisionReason: null,
    commandRegistryReady: true,
    lastCommandAt: null,
    lastCommandName: null,
    lastCommandAllowed: null,
    lastCommandReason: null,
    lastCommandSender: null,
    aiGatewayReady: false,
    aiModelName: config.openAiTextModel,
    lastAiRequestAt: null,
    lastAiReplyAt: null,
    lastAiSender: null,
    lastAiChatJid: null,
    lastAiError: config.openAiApiKey && config.openAiTextModel ? null : 'AI gateway is not ready.',
    voiceGatewayReady: config.openAiApiKey !== null && config.openAiTranscribeModel !== null,
    lastVoiceMessageAt: null,
    lastVoiceTranscriptionAt: null,
    lastVoiceSender: null,
    lastVoiceChatJid: null,
    lastVoiceError:
      config.openAiApiKey !== null && config.openAiTranscribeModel !== null
        ? null
        : 'Voice transcription gateway is not ready.',
    lastVoiceTranscriptPreview: null,
    lastVoiceDurationSeconds: null,
    lastVoiceInputMode: null,
    imageGatewayReady: config.openAiApiKey !== null && config.openAiTextModel !== null,
    lastImageMessageAt: null,
    lastImageAnalysisAt: null,
    lastImageSender: null,
    lastImageChatJid: null,
    lastImageError:
      config.openAiApiKey !== null && config.openAiTextModel !== null
        ? null
        : 'Image gateway is not ready.',
    lastImageCaptionPreview: null,
    lastImageInputMode: null,
    googleSheetsReady,
    lastGoogleSheetsError:
      !googleSheetsEnabled
        ? null
        : googleSheetsReady
          ? null
          : !config.googleSheetsSpreadsheetId
            ? 'GOOGLE_SHEETS_SPREADSHEET_ID is missing.'
          : !config.googleServiceAccountEmail
              ? 'GOOGLE_SERVICE_ACCOUNT_EMAIL is missing.'
              : 'GOOGLE_SERVICE_ACCOUNT_KEY_PATH is missing.',
    mirrorSyncReady: false,
    lastMirrorSyncAt: null,
    lastMirrorSyncError: null,
    mirrorFreshnessState: 'unknown',
    syncAuthorityMode: 'live_authoritative',
    activeWriteSessionId: null,
    activeWriteScope: [],
    activeWriteSource: null,
    writeSessionStatus: 'idle',
    lastAuthoritativeSource: null,
    lastAuthorityConflictReason: null,
    dynamicPromptRegistryReady: true,
    activeDynamicPromptCount: 0,
    lastDynamicPromptAppliedAt: null,
    lastDynamicPromptAuditAt: null,
    lastDynamicPromptError: null,
    webSearchReady: config.openAiApiKey !== null && config.openAiTextModel !== null,
    lastWebSearchAt: null,
    lastWebSearchQuery: null,
    lastWebSearchUsed: false,
    lastWebSearchError: config.openAiApiKey && config.openAiTextModel ? null : 'Web search is not ready.',
    lastWebSearchResultCount: 0,
    lastContextUpdatedAt: null,
    activeConversationCount: 0,
    activeDynamicAdminCount: 0,
    superAdminCount: 1 + getManagedSeedSuperAdminProfiles(config.superAdminNumbers).length,
    lastDecryptIssue: null,
    lastDecryptIssueAt: null,
    lastSessionIssue: null,
    lastSessionIssueAt: null,
    lastMessageFlowError: null,
    recentIdentityResolutions: [],
    lastError: null,
  };
}
