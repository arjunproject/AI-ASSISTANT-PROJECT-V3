import { access, readFile } from 'node:fs/promises';

import type { AdminCommandName, CommandExecutionReason } from '../command/types.js';
import type { AppConfig } from '../config/app-config.js';
import { readRuntimeStateSnapshot } from '../runtime/runtime-state-store.js';
import { inspectProcessLock } from './process-lock.js';

const REQUIRED_NPM_SCRIPTS = ['build', 'typecheck', 'test', 'health', 'start'] as const;

export interface HealthReport {
  runtimePid: number | null;
  processLockOwner: number | null;
  nodeReady: boolean;
  npmScriptsReady: boolean;
  buildReady: boolean;
  stageName: string;
  whatsappTransportMode: AppConfig['whatsappTransportMode'];
  connectionState: 'idle' | 'connecting' | 'qr_required' | 'connected' | 'reconnecting' | 'logged_out' | 'failed_closed';
  socketState: 'idle' | 'connecting' | 'open' | 'closed';
  syncState: 'idle' | 'awaiting_notifications' | 'awaiting_history' | 'syncing' | 'healthy' | 'degraded';
  sessionStoreReady: boolean;
  sessionPresent: boolean;
  receivedPendingNotifications: boolean;
  companionOnline: boolean;
  appStateSyncReady: boolean;
  deviceActivityState: 'unknown' | 'passive' | 'active';
  messageFlowState: 'idle' | 'probing' | 'usable' | 'degraded';
  inboundReady: boolean;
  accessGateReady: boolean;
  officialGroupWhitelistReady: boolean;
  officialGroupJid: string | null;
  officialGroupName: string | null;
  commandRegistryReady: boolean;
  aiGatewayReady: boolean;
  aiModelName: string | null;
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
  mirrorFreshnessState: 'unknown' | 'fresh' | 'stale' | 'error';
  syncAuthorityMode: 'live_authoritative' | 'mirror_authoritative' | 'conflict';
  activeWriteSessionId: string | null;
  activeWriteScope: string[];
  activeWriteSource: 'live_manual' | 'mirror_write_contract' | null;
  writeSessionStatus: 'idle' | 'active' | 'verifying' | 'committed' | 'failed' | 'conflict';
  lastAuthoritativeSource: 'live_manual' | 'mirror_write_contract' | null;
  lastAuthorityConflictReason: string | null;
  dynamicPromptRegistryReady: boolean;
  activeDynamicPromptCount: number;
  lastDynamicPromptAppliedAt: string | null;
  lastDynamicPromptAuditAt: string | null;
  lastDynamicPromptError: string | null;
  webSearchReady: boolean;
  qrState: 'not_requested' | 'generated' | 'opened_in_paint' | 'cleared' | 'open_failed';
  qrFilePath: string;
  qrOpenedInPaint: boolean;
  lastConnectAt: string | null;
  lastDisconnectAt: string | null;
  lastSyncAt: string | null;
  lastInboundMessageAt: string | null;
  lastInboundMessageId: string | null;
  lastInboundSender: string | null;
  lastInboundNormalizedSender: string | null;
  lastInboundChatJid: string | null;
  lastInboundWasFromSelf: boolean | null;
  lastInboundWasGroup: boolean | null;
  lastAccessDecisionAt: string | null;
  lastAccessDecisionRole: 'super_admin' | 'admin' | 'non_admin' | null;
  lastAccessDecisionReason:
    | 'official_super_admin'
    | 'active_dynamic_admin'
    | 'dm_access_disabled'
    | 'group_access_disabled'
    | 'group_not_whitelisted'
    | 'official_group_whitelist_not_ready'
    | 'not_in_whitelist'
    | 'unresolved_sender'
    | 'invalid_sender'
    | null;
  lastAccessDecisionAllowed: boolean | null;
  lastAccessDecisionSender: string | null;
  lastGroupAccessDecisionAt: string | null;
  lastGroupAccessDecisionAllowed: boolean | null;
  lastGroupAccessDecisionSender: string | null;
  lastGroupAccessDecisionChatJid: string | null;
  lastGroupAccessDecisionReason:
    | 'direct_message'
    | 'official_group'
    | 'group_not_whitelisted'
    | 'official_group_whitelist_not_ready'
    | null;
  lastCommandAt: string | null;
  lastCommandName: AdminCommandName | null;
  lastCommandAllowed: boolean | null;
  lastCommandReason: CommandExecutionReason | null;
  lastCommandSender: string | null;
  lastAiRequestAt: string | null;
  lastAiReplyAt: string | null;
  lastAiSender: string | null;
  lastAiChatJid: string | null;
  lastAiError: string | null;
  lastWebSearchAt: string | null;
  lastWebSearchQuery: string | null;
  lastWebSearchUsed: boolean;
  lastWebSearchError: string | null;
  lastWebSearchResultCount: number;
  lastContextUpdatedAt: string | null;
  activeConversationCount: number;
  activeDynamicAdminCount: number;
  superAdminCount: number;
  lastOutboundMessageAt: string | null;
  lastMessageFlowAt: string | null;
  lastProbeAt: string | null;
  lastDecryptIssue: string | null;
  lastSessionIssue: string | null;
  lastMessageFlowError: string | null;
  lastError: string | null;
  overallStatus: 'ready' | 'degraded' | 'blocked';
}

export async function collectHealthReport(config: AppConfig): Promise<HealthReport> {
  const issues: string[] = [];
  const nodeReady = typeof process.versions.node === 'string' && process.versions.node.length > 0;
  if (!nodeReady) {
    issues.push('Node runtime is not available.');
  }

  const scriptsCheck = await inspectPackageScripts(config.packageJsonPath);
  if (!scriptsCheck.ready) {
    issues.push(scriptsCheck.error);
  }

  const buildReady = await fileExists(config.buildArtifactPath);
  if (!buildReady) {
    issues.push(`Build artifact is missing at ${config.buildArtifactPath}.`);
  }

  const lockInspection = await inspectProcessLock(config.lockFilePath);
  if (lockInspection.error) {
    issues.push(`Process lock is invalid: ${lockInspection.error}`);
  } else if (lockInspection.exists && !lockInspection.isOwnerRunning) {
    issues.push(`Process lock exists but owner pid ${lockInspection.ownerPid} is not running.`);
  }

  const runtimePid = lockInspection.exists && lockInspection.isOwnerRunning ? lockInspection.ownerPid : null;
  const runtimeState = await readRuntimeStateSnapshot(config, runtimePid !== null);
  if (!runtimeState.sessionStoreReady && runtimeState.lastError) {
    issues.push(runtimeState.lastError);
  }
  if (!runtimeState.accessGateReady && runtimeState.lastError) {
    issues.push(runtimeState.lastError);
  }
  if (!runtimeState.commandRegistryReady && runtimeState.lastError) {
    issues.push(runtimeState.lastError);
  }
  if (!runtimeState.aiGatewayReady && runtimeState.lastAiError) {
    issues.push(runtimeState.lastAiError);
  }
  if (!runtimeState.voiceGatewayReady && runtimeState.lastVoiceError) {
    issues.push(runtimeState.lastVoiceError);
  }
  if (!runtimeState.imageGatewayReady && runtimeState.lastImageError) {
    issues.push(runtimeState.lastImageError);
  }
  if (!runtimeState.dynamicPromptRegistryReady && runtimeState.lastDynamicPromptError) {
    issues.push(runtimeState.lastDynamicPromptError);
  }
  if (!runtimeState.webSearchReady && runtimeState.lastWebSearchError) {
    issues.push(runtimeState.lastWebSearchError);
  }
  if (runtimeState.googleSheetsReady && runtimeState.mirrorFreshnessState === 'stale') {
    issues.push(`Mirror is stale. Last sync at ${runtimeState.lastMirrorSyncAt ?? 'unknown'}.`);
  }
  if (runtimeState.googleSheetsReady && runtimeState.lastMirrorSyncError) {
    issues.push(runtimeState.lastMirrorSyncError);
  }
  if (runtimeState.syncAuthorityMode === 'conflict' && runtimeState.lastAuthorityConflictReason) {
    issues.push(runtimeState.lastAuthorityConflictReason);
  }
  if (runtimeState.writeSessionStatus === 'failed') {
    issues.push('Mirror write session failed before finishing verification.');
  }

  let overallStatus: HealthReport['overallStatus'] = 'degraded';
  if (
    !nodeReady ||
    !scriptsCheck.ready ||
    !buildReady ||
    !runtimeState.sessionStoreReady ||
    !runtimeState.accessGateReady ||
    !runtimeState.commandRegistryReady ||
    !runtimeState.aiGatewayReady ||
    !runtimeState.voiceGatewayReady ||
    !runtimeState.imageGatewayReady ||
    !runtimeState.dynamicPromptRegistryReady ||
    !runtimeState.webSearchReady ||
    lockInspection.error
  ) {
    overallStatus = 'blocked';
  } else if (
    runtimeState.connectionState === 'connected' &&
    runtimeState.socketState === 'open' &&
    runtimeState.syncState === 'healthy' &&
    runtimeState.receivedPendingNotifications &&
    runtimeState.companionOnline &&
    runtimeState.appStateSyncReady &&
    runtimeState.deviceActivityState === 'active' &&
    runtimeState.messageFlowState === 'usable' &&
    runtimeState.inboundReady &&
    runtimeState.googleSheetsReady &&
    runtimeState.mirrorSyncReady &&
    runtimeState.mirrorFreshnessState === 'fresh' &&
    runtimeState.syncAuthorityMode !== 'conflict' &&
    runtimeState.writeSessionStatus !== 'failed'
  ) {
    overallStatus = 'ready';
  } else if (runtimeState.connectionState === 'logged_out' || runtimeState.connectionState === 'failed_closed') {
    overallStatus = 'blocked';
  }

  return {
    runtimePid,
    processLockOwner: lockInspection.ownerPid,
    nodeReady,
    npmScriptsReady: scriptsCheck.ready,
    buildReady,
    stageName: config.stageName,
    whatsappTransportMode: config.whatsappTransportMode,
    connectionState: runtimeState.connectionState,
    socketState: runtimeState.socketState,
    syncState: runtimeState.syncState,
    sessionStoreReady: runtimeState.sessionStoreReady,
    sessionPresent: runtimeState.sessionPresent,
    receivedPendingNotifications: runtimeState.receivedPendingNotifications,
    companionOnline: runtimeState.companionOnline,
    appStateSyncReady: runtimeState.appStateSyncReady,
    deviceActivityState: runtimeState.deviceActivityState,
    messageFlowState: runtimeState.messageFlowState,
    inboundReady: runtimeState.inboundReady,
    accessGateReady: runtimeState.accessGateReady,
    officialGroupWhitelistReady: runtimeState.officialGroupWhitelistReady,
    officialGroupJid: runtimeState.officialGroupJid,
    officialGroupName: runtimeState.officialGroupName,
    commandRegistryReady: runtimeState.commandRegistryReady,
    aiGatewayReady: runtimeState.aiGatewayReady,
    aiModelName: runtimeState.aiModelName,
    voiceGatewayReady: runtimeState.voiceGatewayReady,
    lastVoiceMessageAt: runtimeState.lastVoiceMessageAt,
    lastVoiceTranscriptionAt: runtimeState.lastVoiceTranscriptionAt,
    lastVoiceSender: runtimeState.lastVoiceSender,
    lastVoiceChatJid: runtimeState.lastVoiceChatJid,
    lastVoiceError: runtimeState.lastVoiceError,
    lastVoiceTranscriptPreview: runtimeState.lastVoiceTranscriptPreview,
    lastVoiceDurationSeconds: runtimeState.lastVoiceDurationSeconds,
    lastVoiceInputMode: runtimeState.lastVoiceInputMode,
    imageGatewayReady: runtimeState.imageGatewayReady,
    lastImageMessageAt: runtimeState.lastImageMessageAt,
    lastImageAnalysisAt: runtimeState.lastImageAnalysisAt,
    lastImageSender: runtimeState.lastImageSender,
    lastImageChatJid: runtimeState.lastImageChatJid,
    lastImageError: runtimeState.lastImageError,
    lastImageCaptionPreview: runtimeState.lastImageCaptionPreview,
    lastImageInputMode: runtimeState.lastImageInputMode,
    googleSheetsReady: runtimeState.googleSheetsReady,
    lastGoogleSheetsError: runtimeState.lastGoogleSheetsError,
    mirrorSyncReady: runtimeState.mirrorSyncReady,
    lastMirrorSyncAt: runtimeState.lastMirrorSyncAt,
    lastMirrorSyncError: runtimeState.lastMirrorSyncError,
    mirrorFreshnessState: runtimeState.mirrorFreshnessState,
    syncAuthorityMode: runtimeState.syncAuthorityMode,
    activeWriteSessionId: runtimeState.activeWriteSessionId,
    activeWriteScope: runtimeState.activeWriteScope,
    activeWriteSource: runtimeState.activeWriteSource,
    writeSessionStatus: runtimeState.writeSessionStatus,
    lastAuthoritativeSource: runtimeState.lastAuthoritativeSource,
    lastAuthorityConflictReason: runtimeState.lastAuthorityConflictReason,
    dynamicPromptRegistryReady: runtimeState.dynamicPromptRegistryReady,
    activeDynamicPromptCount: runtimeState.activeDynamicPromptCount,
    lastDynamicPromptAppliedAt: runtimeState.lastDynamicPromptAppliedAt,
    lastDynamicPromptAuditAt: runtimeState.lastDynamicPromptAuditAt,
    lastDynamicPromptError: runtimeState.lastDynamicPromptError,
    webSearchReady: runtimeState.webSearchReady,
    qrState: runtimeState.qrState,
    qrFilePath: runtimeState.qrFilePath,
    qrOpenedInPaint: runtimeState.qrOpenedInPaint,
    lastConnectAt: runtimeState.lastConnectAt,
    lastDisconnectAt: runtimeState.lastDisconnectAt,
    lastSyncAt: runtimeState.lastSyncAt,
    lastInboundMessageAt: runtimeState.lastInboundMessageAt,
    lastInboundMessageId: runtimeState.lastInboundMessageId,
    lastInboundSender: runtimeState.lastInboundSender,
    lastInboundNormalizedSender: runtimeState.lastInboundNormalizedSender,
    lastInboundChatJid: runtimeState.lastInboundChatJid,
    lastInboundWasFromSelf: runtimeState.lastInboundWasFromSelf,
    lastInboundWasGroup: runtimeState.lastInboundWasGroup,
    lastAccessDecisionAt: runtimeState.lastAccessDecisionAt,
    lastAccessDecisionRole: runtimeState.lastAccessDecisionRole,
    lastAccessDecisionReason: runtimeState.lastAccessDecisionReason,
    lastAccessDecisionAllowed: runtimeState.lastAccessDecisionAllowed,
    lastAccessDecisionSender: runtimeState.lastAccessDecisionSender,
    lastGroupAccessDecisionAt: runtimeState.lastGroupAccessDecisionAt,
    lastGroupAccessDecisionAllowed: runtimeState.lastGroupAccessDecisionAllowed,
    lastGroupAccessDecisionSender: runtimeState.lastGroupAccessDecisionSender,
    lastGroupAccessDecisionChatJid: runtimeState.lastGroupAccessDecisionChatJid,
    lastGroupAccessDecisionReason: runtimeState.lastGroupAccessDecisionReason,
    lastCommandAt: runtimeState.lastCommandAt,
    lastCommandName: runtimeState.lastCommandName,
    lastCommandAllowed: runtimeState.lastCommandAllowed,
    lastCommandReason: runtimeState.lastCommandReason,
    lastCommandSender: runtimeState.lastCommandSender,
    lastAiRequestAt: runtimeState.lastAiRequestAt,
    lastAiReplyAt: runtimeState.lastAiReplyAt,
    lastAiSender: runtimeState.lastAiSender,
    lastAiChatJid: runtimeState.lastAiChatJid,
    lastAiError: runtimeState.lastAiError,
    lastWebSearchAt: runtimeState.lastWebSearchAt,
    lastWebSearchQuery: runtimeState.lastWebSearchQuery,
    lastWebSearchUsed: runtimeState.lastWebSearchUsed,
    lastWebSearchError: runtimeState.lastWebSearchError,
    lastWebSearchResultCount: runtimeState.lastWebSearchResultCount,
    lastContextUpdatedAt: runtimeState.lastContextUpdatedAt,
    activeConversationCount: runtimeState.activeConversationCount,
    activeDynamicAdminCount: runtimeState.activeDynamicAdminCount,
    superAdminCount: runtimeState.superAdminCount,
    lastOutboundMessageAt: runtimeState.lastOutboundMessageAt,
    lastMessageFlowAt: runtimeState.lastMessageFlowAt,
    lastProbeAt: runtimeState.lastProbeAt,
    lastDecryptIssue: runtimeState.lastDecryptIssue,
    lastSessionIssue: runtimeState.lastSessionIssue,
    lastMessageFlowError: runtimeState.lastMessageFlowError,
    lastError:
      issues[0] ??
      runtimeState.lastAuthorityConflictReason ??
      runtimeState.lastVoiceError ??
      runtimeState.lastImageError ??
      runtimeState.lastDynamicPromptError ??
      runtimeState.lastAiError ??
      runtimeState.lastError ??
      runtimeState.lastMessageFlowError ??
      runtimeState.lastDecryptIssue ??
      runtimeState.lastSessionIssue,
    overallStatus,
  };
}

async function inspectPackageScripts(packageJsonPath: string): Promise<{ ready: boolean; error: string }> {
  try {
    const raw = await readFile(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    const missing = REQUIRED_NPM_SCRIPTS.filter((scriptName) => !parsed.scripts?.[scriptName]);

    if (missing.length > 0) {
      return {
        ready: false,
        error: `package.json is missing required npm scripts: ${missing.join(', ')}.`,
      };
    }

    return {
      ready: true,
      error: '',
    };
  } catch (error) {
    const typedError = error as Error;
    return {
      ready: false,
      error: `package.json could not be inspected: ${typedError.message}`,
    };
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
