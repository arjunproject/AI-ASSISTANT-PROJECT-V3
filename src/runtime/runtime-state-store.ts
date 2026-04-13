import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { AppConfig } from '../config/app-config.js';
import { inspectGoogleSheetsConfig } from '../config/google-sheets-config.js';
import { inspectDynamicAdminRegistry } from '../access/admin-registry.js';
import { getManagedSeedSuperAdminProfiles } from '../access/super-admin-seed.js';
import { inspectManagedSuperAdminRegistry } from '../access/super-admin-registry.js';
import { inspectDynamicPromptRegistryFiles } from '../ai/dynamic-prompt-registry.js';
import { inspectImageGatewayConfig } from '../ai/openai-image-gateway.js';
import { inspectVoiceGatewayConfig } from '../ai/openai-voice-gateway.js';
import { inspectOfficialGroupWhitelist } from '../access/official-group-whitelist.js';
import { inspectAiGatewayConfig } from '../ai/openai-text-gateway.js';
import { inspectSessionStore } from '../whatsapp/session-store.js';
import { buildDefaultRuntimeState, type RuntimeStateSnapshot } from '../whatsapp/types.js';
import { readGoogleSheetsMirrorIndex } from '../google/google-sheets-mirror.js';

export interface RuntimeStateStore {
  readonly path: string;
  getSnapshot(): RuntimeStateSnapshot;
  update(patch: Partial<RuntimeStateSnapshot>): Promise<RuntimeStateSnapshot>;
  replace(snapshot: RuntimeStateSnapshot): Promise<RuntimeStateSnapshot>;
  syncDerivedState(): Promise<RuntimeStateSnapshot>;
}

export async function createRuntimeStateStore(config: AppConfig): Promise<RuntimeStateStore> {
  await mkdir(dirname(config.runtimeStateFilePath), { recursive: true });

  let snapshot = await readRuntimeStateSnapshot(config, false);
  await persistSnapshot(config.runtimeStateFilePath, snapshot);

  return {
    path: config.runtimeStateFilePath,
    getSnapshot() {
      return snapshot;
    },
    async update(patch) {
      snapshot = {
        ...snapshot,
        ...patch,
      };
      await persistSnapshot(config.runtimeStateFilePath, snapshot);
      return snapshot;
    },
    async replace(nextSnapshot) {
      snapshot = nextSnapshot;
      await persistSnapshot(config.runtimeStateFilePath, snapshot);
      return snapshot;
    },
    async syncDerivedState() {
      const derived = await readRuntimeStateSnapshot(config, true, snapshot);
      snapshot = {
        ...snapshot,
        sessionStoreReady: derived.sessionStoreReady,
        sessionPresent: derived.sessionPresent,
        qrFilePath: derived.qrFilePath,
        accessGateReady: derived.accessGateReady,
        officialGroupWhitelistReady: derived.officialGroupWhitelistReady,
        officialGroupJid: derived.officialGroupJid,
        officialGroupName: derived.officialGroupName,
        commandRegistryReady: derived.commandRegistryReady,
        aiGatewayReady: derived.aiGatewayReady,
        aiModelName: derived.aiModelName,
        voiceGatewayReady: derived.voiceGatewayReady,
        imageGatewayReady: derived.imageGatewayReady,
        googleSheetsReady: derived.googleSheetsReady,
        lastGoogleSheetsError: derived.lastGoogleSheetsError,
        mirrorSyncReady: derived.mirrorSyncReady,
        lastMirrorSyncAt: derived.lastMirrorSyncAt,
        lastMirrorSyncError: derived.lastMirrorSyncError,
        mirrorFreshnessState: derived.mirrorFreshnessState,
        syncAuthorityMode: derived.syncAuthorityMode,
        activeWriteSessionId: derived.activeWriteSessionId,
        activeWriteScope: derived.activeWriteScope,
        activeWriteSource: derived.activeWriteSource,
        writeSessionStatus: derived.writeSessionStatus,
        lastAuthoritativeSource: derived.lastAuthoritativeSource,
        lastAuthorityConflictReason: derived.lastAuthorityConflictReason,
        dynamicPromptRegistryReady: derived.dynamicPromptRegistryReady,
        activeDynamicPromptCount: derived.activeDynamicPromptCount,
        lastDynamicPromptAuditAt: derived.lastDynamicPromptAuditAt,
        lastDynamicPromptError: derived.lastDynamicPromptError,
        webSearchReady: derived.webSearchReady,
        activeDynamicAdminCount: derived.activeDynamicAdminCount,
        superAdminCount: derived.superAdminCount,
      };
      await persistSnapshot(config.runtimeStateFilePath, snapshot);
      return snapshot;
    },
  };
}

export async function readRuntimeStateSnapshot(
  config: AppConfig,
  runtimeActive: boolean,
  baseSnapshot?: RuntimeStateSnapshot,
): Promise<RuntimeStateSnapshot> {
  const storedSnapshot = sanitizeStoredStateSnapshot(
    config,
    baseSnapshot ?? (await readStoredStateFile(config.runtimeStateFilePath)),
  );
  const sessionInspection = await inspectSessionStore(config.whatsappAuthDir);
  const accessInspection = await inspectDynamicAdminRegistry(config.accessRegistryFilePath);
  const managedSuperAdminInspection = await inspectManagedSuperAdminRegistry({
    registryFilePath: config.superAdminRegistryFilePath,
    seededProfiles: getManagedSeedSuperAdminProfiles(config.superAdminNumbers),
  });
  const officialGroupInspection = await inspectOfficialGroupWhitelist(config.officialGroupWhitelistFilePath);
  const aiInspection = inspectAiGatewayConfig(config);
  const voiceInspection = inspectVoiceGatewayConfig(config);
  const imageInspection = inspectImageGatewayConfig(config);
  const googleSheetsEnabled = config.spreadsheetReadEnabled || config.mirrorSyncEnabled;
  const googleSheetsInspection = googleSheetsEnabled
    ? await inspectGoogleSheetsConfig(config)
    : {
        ready: false,
        spreadsheetId: null,
        serviceAccountEmail: null,
        serviceAccountKeyPath: null,
        error: null,
      };
  const dynamicPromptInspection = await inspectDynamicPromptRegistryFiles(
    config.dynamicPromptRegistryFilePath,
    config.dynamicPromptAuditFilePath,
  );
  const qrFileExists = await fileExists(config.whatsappQrFilePath);
  const mirrorAuthoritySnapshot = config.mirrorSyncEnabled
    ? await readMirrorAuthoritySnapshot(config)
    : buildDefaultMirrorAuthoritySnapshot();
  const lastMirrorSyncAt = config.mirrorSyncEnabled
    ? normalizeStoredTimestamp(storedSnapshot.lastMirrorSyncAt)
    : null;
  const lastMirrorSyncError = config.mirrorSyncEnabled
    ? normalizeStoredString(storedSnapshot.lastMirrorSyncError)
    : null;
  const mirrorFreshnessState = config.mirrorSyncEnabled
    ? deriveMirrorFreshnessState({
        googleSheetsReady: googleSheetsInspection.ready,
        lastMirrorSyncAt,
        lastMirrorSyncError,
        staleAfterMs: config.mirrorFreshnessStaleAfterMs,
      })
    : 'unknown';

  let snapshot: RuntimeStateSnapshot = {
    ...buildDefaultRuntimeState(config),
    ...storedSnapshot,
    stageName: config.stageName,
    whatsappTransportMode: config.whatsappTransportMode,
    sessionStoreReady: sessionInspection.ready,
    sessionPresent: sessionInspection.present,
    accessGateReady: accessInspection.ready && managedSuperAdminInspection.ready && officialGroupInspection.ready,
    officialGroupWhitelistReady: officialGroupInspection.ready,
    officialGroupJid: officialGroupInspection.group?.groupJid ?? null,
    officialGroupName: officialGroupInspection.group?.groupName ?? null,
    commandRegistryReady: accessInspection.ready,
    aiGatewayReady: aiInspection.ready,
    aiModelName: aiInspection.modelName,
    voiceGatewayReady: voiceInspection.ready,
    imageGatewayReady: imageInspection.ready,
    googleSheetsReady: googleSheetsInspection.ready,
    lastGoogleSheetsError: googleSheetsInspection.error,
    mirrorSyncReady:
      config.mirrorSyncEnabled &&
      googleSheetsInspection.ready &&
      storedSnapshot.mirrorSyncReady === true &&
      mirrorFreshnessState === 'fresh',
    lastMirrorSyncAt,
    lastMirrorSyncError,
    mirrorFreshnessState,
    syncAuthorityMode: mirrorAuthoritySnapshot.syncAuthorityMode,
    activeWriteSessionId: mirrorAuthoritySnapshot.activeWriteSessionId,
    activeWriteScope: mirrorAuthoritySnapshot.activeWriteScope,
    activeWriteSource: mirrorAuthoritySnapshot.activeWriteSource,
    writeSessionStatus: mirrorAuthoritySnapshot.writeSessionStatus,
    lastAuthoritativeSource: mirrorAuthoritySnapshot.lastAuthoritativeSource,
    lastAuthorityConflictReason: mirrorAuthoritySnapshot.lastAuthorityConflictReason,
    dynamicPromptRegistryReady: dynamicPromptInspection.ready,
    activeDynamicPromptCount: dynamicPromptInspection.activeCount,
    lastDynamicPromptAuditAt: dynamicPromptInspection.lastAuditAt,
    lastDynamicPromptError: dynamicPromptInspection.error,
    webSearchReady: aiInspection.webSearchReady,
    activeDynamicAdminCount: accessInspection.activeCount,
    superAdminCount: 1 + managedSuperAdminInspection.activeCount,
    qrFilePath: config.whatsappQrFilePath,
    qrState: qrFileExists ? storedSnapshot?.qrState ?? 'generated' : storedSnapshot?.qrState ?? 'not_requested',
  };

  if (!qrFileExists && (snapshot.qrState === 'generated' || snapshot.qrState === 'opened_in_paint')) {
    snapshot = {
      ...snapshot,
      qrState: snapshot.lastConnectAt ? 'cleared' : 'not_requested',
      qrOpenedInPaint: false,
    };
  }

  if (!runtimeActive && !['idle', 'logged_out', 'failed_closed'].includes(snapshot.connectionState)) {
    snapshot = {
      ...snapshot,
      connectionState: 'idle',
      socketState: 'idle',
      syncState: 'idle',
      receivedPendingNotifications: false,
      companionOnline: false,
      appStateSyncReady: false,
      deviceActivityState: 'unknown',
      messageFlowState: 'idle',
      qrOpenedInPaint: false,
      activeConversationCount: 0,
    };
  }

  if (!sessionInspection.ready && sessionInspection.error) {
    snapshot = {
      ...snapshot,
      lastError: sessionInspection.error,
    };
  }

  if (!accessInspection.ready && accessInspection.error) {
    snapshot = {
      ...snapshot,
      lastError: accessInspection.error,
    };
  }

  if (!managedSuperAdminInspection.ready && managedSuperAdminInspection.error) {
    snapshot = {
      ...snapshot,
      lastError: snapshot.lastError ?? managedSuperAdminInspection.error,
    };
  }

  if (!officialGroupInspection.ready && officialGroupInspection.error) {
    snapshot = {
      ...snapshot,
      lastError: snapshot.lastError ?? officialGroupInspection.error,
    };
  }

  if (!aiInspection.ready) {
    snapshot = {
      ...snapshot,
      aiGatewayReady: false,
      aiModelName: aiInspection.modelName,
      lastAiError: aiInspection.error,
      webSearchReady: false,
      lastWebSearchError: aiInspection.webSearchError,
      lastError: snapshot.lastError ?? aiInspection.error,
    };
  }

  if (!voiceInspection.ready) {
    snapshot = {
      ...snapshot,
      voiceGatewayReady: false,
      lastVoiceError: voiceInspection.error,
      lastError: snapshot.lastError ?? voiceInspection.error,
    };
  }

  if (!imageInspection.ready) {
    snapshot = {
      ...snapshot,
      imageGatewayReady: false,
      lastImageError: imageInspection.error,
      lastError: snapshot.lastError ?? imageInspection.error,
    };
  }

  if (!dynamicPromptInspection.ready) {
    snapshot = {
      ...snapshot,
      dynamicPromptRegistryReady: false,
      activeDynamicPromptCount: 0,
      lastDynamicPromptError: dynamicPromptInspection.error,
      lastError: snapshot.lastError ?? dynamicPromptInspection.error,
    };
  }

  if (mirrorAuthoritySnapshot.syncAuthorityMode === 'conflict' && mirrorAuthoritySnapshot.lastAuthorityConflictReason) {
    snapshot = {
      ...snapshot,
      lastError: snapshot.lastError ?? mirrorAuthoritySnapshot.lastAuthorityConflictReason,
    };
  }

  return snapshot;
}

async function readStoredStateFile(stateFilePath: string): Promise<Partial<RuntimeStateSnapshot>> {
  try {
    const raw = await readFile(stateFilePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        connectionState: 'failed_closed',
        lastError: 'Runtime state file must contain an object.',
      };
    }

    return parsed as Partial<RuntimeStateSnapshot>;
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code === 'ENOENT') {
      return {};
    }

    return {
      connectionState: 'failed_closed',
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function persistSnapshot(stateFilePath: string, snapshot: RuntimeStateSnapshot): Promise<void> {
  await writeFile(stateFilePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

function sanitizeStoredStateSnapshot(
  config: AppConfig,
  storedSnapshot: Partial<RuntimeStateSnapshot>,
): Partial<RuntimeStateSnapshot> {
  const allowedKeys = new Set(Object.keys(buildDefaultRuntimeState(config)));
  const sanitized: Partial<RuntimeStateSnapshot> = {};

  for (const [key, value] of Object.entries(storedSnapshot)) {
    if (!allowedKeys.has(key)) {
      continue;
    }

    (sanitized as Record<string, unknown>)[key] = value;
  }

  return sanitized;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeStoredTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const timestamp = Date.parse(trimmed);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function normalizeStoredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveMirrorFreshnessState(input: {
  googleSheetsReady: boolean;
  lastMirrorSyncAt: string | null;
  lastMirrorSyncError: string | null;
  staleAfterMs: number;
}): RuntimeStateSnapshot['mirrorFreshnessState'] {
  if (!input.googleSheetsReady || input.lastMirrorSyncError) {
    return 'error';
  }

  if (!input.lastMirrorSyncAt) {
    return 'unknown';
  }

  const ageMs = Date.now() - Date.parse(input.lastMirrorSyncAt);
  if (!Number.isFinite(ageMs)) {
    return 'error';
  }

  return ageMs <= input.staleAfterMs ? 'fresh' : 'stale';
}

async function readMirrorAuthoritySnapshot(config: AppConfig): Promise<Pick<
  RuntimeStateSnapshot,
  | 'syncAuthorityMode'
  | 'activeWriteSessionId'
  | 'activeWriteScope'
  | 'activeWriteSource'
  | 'writeSessionStatus'
  | 'lastAuthoritativeSource'
  | 'lastAuthorityConflictReason'
>> {
  try {
    const index = await readGoogleSheetsMirrorIndex(config);
    return {
      syncAuthorityMode: index.authorityState.syncAuthorityMode,
      activeWriteSessionId: index.authorityState.activeWriteSessionId,
      activeWriteScope: index.authorityState.activeWriteScope,
      activeWriteSource: index.authorityState.activeWriteSource,
      writeSessionStatus: index.authorityState.writeSessionStatus,
      lastAuthoritativeSource: index.authorityState.lastAuthoritativeSource,
      lastAuthorityConflictReason: index.authorityState.lastAuthorityConflictReason,
    };
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code === 'ENOENT') {
      return {
        syncAuthorityMode: 'live_authoritative',
        activeWriteSessionId: null,
        activeWriteScope: [],
        activeWriteSource: null,
        writeSessionStatus: 'idle',
        lastAuthoritativeSource: null,
        lastAuthorityConflictReason: null,
      };
    }

    return {
      syncAuthorityMode: 'conflict',
      activeWriteSessionId: null,
      activeWriteScope: [],
      activeWriteSource: null,
      writeSessionStatus: 'conflict',
      lastAuthoritativeSource: null,
      lastAuthorityConflictReason: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildDefaultMirrorAuthoritySnapshot(): Pick<
  RuntimeStateSnapshot,
  | 'syncAuthorityMode'
  | 'activeWriteSessionId'
  | 'activeWriteScope'
  | 'activeWriteSource'
  | 'writeSessionStatus'
  | 'lastAuthoritativeSource'
  | 'lastAuthorityConflictReason'
> {
  return {
    syncAuthorityMode: 'live_authoritative',
    activeWriteSessionId: null,
    activeWriteScope: [],
    activeWriteSource: null,
    writeSessionStatus: 'idle',
    lastAuthoritativeSource: null,
    lastAuthorityConflictReason: null,
  };
}
