import { join, resolve } from 'node:path';

import { getOfficialSuperAdminSeed } from '../access/super-admin-seed.js';
import { loadEnvFile } from './env-loader.js';

export type RuntimeProfile = 'primary' | 'secondary';

export interface AppConfig {
  projectRoot: string;
  runtimeProfile: RuntimeProfile;
  stageName: string;
  envFilePath: string;
  runtimeRoot: string;
  logFilePath: string;
  lockFilePath: string;
  buildArtifactPath: string;
  packageJsonPath: string;
  runtimeStateFilePath: string;
  accessRegistryFilePath: string;
  superAdminRegistryFilePath: string;
  officialGroupWhitelistFilePath: string;
  dynamicPromptRegistryFilePath: string;
  dynamicPromptAuditFilePath: string;
  whatsappAuthDir: string;
  whatsappQrFilePath: string;
  whatsappTransportMode: 'baileys-local-auth-qr';
  botPrimaryNumber: string;
  superAdminNumbers: string[];
  paintCommand: string;
  reconnectDelaysMs: number[];
  openAiApiKey: string | null;
  openAiTextModel: string | null;
  openAiTranscribeModel: string | null;
  googleSheetsSpreadsheetId: string | null;
  googleServiceAccountEmail: string | null;
  googleServiceAccountKeyPath: string | null;
  mirrorSyncIntervalMs: number;
  mirrorFreshnessStaleAfterMs: number;
  aiSessionMaxTurns: number;
  aiRequestTimeoutMs: number;
  voiceTranscribeTimeoutMs: number;
  voiceMaxAudioSeconds: number;
  voiceMaxFileBytes: number;
  imageAnalysisTimeoutMs: number;
  imageMaxFileBytes: number;
  imageMaxEdgePixels: number;
  spreadsheetReadEnabled: boolean;
  mirrorSyncEnabled: boolean;
}

export function loadAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const projectRoot = resolve(overrides.projectRoot ?? process.cwd());
  const envFilePath = resolveFromProject(projectRoot, overrides.envFilePath ?? '.env');
  loadEnvFile(envFilePath);
  const runtimeProfile = normalizeRuntimeProfile(
    (overrides.runtimeProfile as string | undefined) ?? process.env.APP_RUNTIME_PROFILE,
  );
  const defaultRuntimeRootInput = runtimeProfile === 'secondary' ? '.runtime-bot2' : '.runtime';
  const runtimeRootInput = overrides.runtimeRoot ?? process.env.APP_RUNTIME_ROOT ?? defaultRuntimeRootInput;
  const sharedRuntimeRootInput =
    process.env.APP_SHARED_RUNTIME_ROOT ?? (runtimeProfile === 'secondary' ? '.runtime' : runtimeRootInput);
  const runtimeRoot = resolveFromProject(projectRoot, runtimeRootInput);
  const stageName =
    overrides.stageName ??
    process.env.APP_STAGE_NAME ??
    (runtimeProfile === 'secondary' ? 'stage-5-bot2' : 'stage-5');
  const logFilePath = resolveFromProject(
    projectRoot,
    overrides.logFilePath ?? process.env.APP_LOG_FILE ?? join(runtimeRootInput, 'logs', 'runtime.log'),
  );
  const lockFilePath = resolveFromProject(
    projectRoot,
    overrides.lockFilePath ?? process.env.APP_LOCK_FILE ?? join(runtimeRootInput, 'lock', 'runtime.lock.json'),
  );
  const buildArtifactPath = resolveFromProject(
    projectRoot,
    overrides.buildArtifactPath ?? 'dist/src/index.js',
  );
  const packageJsonPath = resolveFromProject(projectRoot, overrides.packageJsonPath ?? 'package.json');
  const runtimeStateFilePath = resolveFromProject(
    projectRoot,
    overrides.runtimeStateFilePath ?? process.env.APP_RUNTIME_STATE_FILE ?? join(runtimeRootInput, 'status', 'runtime-state.json'),
  );
  const accessRegistryFilePath = resolveFromProject(
    projectRoot,
    overrides.accessRegistryFilePath ??
      process.env.APP_ADMIN_REGISTRY_FILE ??
      join(sharedRuntimeRootInput, 'access', 'admin-registry.json'),
  );
  const superAdminRegistryFilePath = resolveFromProject(
    projectRoot,
    overrides.superAdminRegistryFilePath ??
      process.env.APP_SUPER_ADMIN_REGISTRY_FILE ??
      join(sharedRuntimeRootInput, 'access', 'super-admin-registry.json'),
  );
  const officialGroupWhitelistFilePath = resolveFromProject(
    projectRoot,
    overrides.officialGroupWhitelistFilePath ??
      process.env.APP_OFFICIAL_GROUP_WHITELIST_FILE ??
      join(sharedRuntimeRootInput, 'access', 'official-group-whitelist.json'),
  );
  const dynamicPromptRegistryFilePath = resolveFromProject(
    projectRoot,
    overrides.dynamicPromptRegistryFilePath ??
      process.env.APP_DYNAMIC_PROMPT_REGISTRY_FILE ??
      join(sharedRuntimeRootInput, 'ai', 'dynamic-prompts.json'),
  );
  const dynamicPromptAuditFilePath = resolveFromProject(
    projectRoot,
    overrides.dynamicPromptAuditFilePath ??
      process.env.APP_DYNAMIC_PROMPT_AUDIT_FILE ??
      join(sharedRuntimeRootInput, 'ai', 'dynamic-prompt-audit.json'),
  );
  const whatsappAuthDir = resolveFromProject(
    projectRoot,
    overrides.whatsappAuthDir ?? process.env.APP_WA_AUTH_DIR ?? join(runtimeRootInput, 'whatsapp', 'auth'),
  );
  const whatsappQrFilePath = resolveFromProject(
    projectRoot,
    overrides.whatsappQrFilePath ?? process.env.APP_WA_QR_FILE ?? join(runtimeRootInput, 'whatsapp', 'qr', 'login-qr.png'),
  );
  const whatsappTransportMode = overrides.whatsappTransportMode ?? 'baileys-local-auth-qr';
  const superAdminNumbers = getOfficialSuperAdminSeed(overrides.superAdminNumbers);
  const defaultBotPrimaryNumber =
    runtimeProfile === 'secondary'
      ? superAdminNumbers[1] ?? superAdminNumbers[0] ?? '201507007785'
      : '6285655002277';
  const botPrimaryNumber = normalizePhoneNumber(
    overrides.botPrimaryNumber ?? process.env.APP_BOT_PRIMARY_NUMBER ?? defaultBotPrimaryNumber,
  );
  const paintCommand = overrides.paintCommand ?? process.env.APP_PAINT_COMMAND ?? 'mspaint.exe';
  const reconnectDelaysMs =
    overrides.reconnectDelaysMs ??
    parseReconnectDelays(process.env.APP_RECONNECT_DELAYS_MS, [1_000, 3_000, 5_000, 10_000]);
  const openAiApiKey = normalizeOptionalEnvValue(overrides.openAiApiKey ?? process.env.OPENAI_API_KEY);
  const openAiTextModel = normalizeOptionalEnvValue(overrides.openAiTextModel ?? process.env.OPENAI_TEXT_MODEL);
  const openAiTranscribeModel = normalizeOptionalEnvValue(
    overrides.openAiTranscribeModel ?? process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe',
  );
  const googleSheetsSpreadsheetId = normalizeOptionalEnvValue(
    overrides.googleSheetsSpreadsheetId ?? process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
  );
  const googleServiceAccountEmail = normalizeOptionalEnvValue(
    overrides.googleServiceAccountEmail ?? process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  );
  const googleServiceAccountKeyPath = resolveOptionalPathFromProject(
    projectRoot,
    overrides.googleServiceAccountKeyPath ?? process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  );
  const mirrorSyncIntervalMs = parseNonNegativeInteger(
    overrides.mirrorSyncIntervalMs ?? process.env.MIRROR_SYNC_INTERVAL_MS,
    30_000,
  );
  const mirrorFreshnessStaleAfterMs = parsePositiveInteger(
    overrides.mirrorFreshnessStaleAfterMs ?? process.env.MIRROR_FRESHNESS_STALE_AFTER_MS,
    120_000,
  );
  const aiSessionMaxTurns = parsePositiveInteger(
    overrides.aiSessionMaxTurns ?? process.env.AI_SESSION_MAX_TURNS,
    6,
  );
  const aiRequestTimeoutMs = parsePositiveInteger(
    overrides.aiRequestTimeoutMs ?? process.env.AI_REQUEST_TIMEOUT_MS,
    20_000,
  );
  const voiceTranscribeTimeoutMs = parsePositiveInteger(
    overrides.voiceTranscribeTimeoutMs ?? process.env.VOICE_TRANSCRIBE_TIMEOUT_MS,
    20_000,
  );
  const voiceMaxAudioSeconds = parsePositiveInteger(
    overrides.voiceMaxAudioSeconds ?? process.env.VOICE_MAX_AUDIO_SECONDS,
    300,
  );
  const voiceMaxFileBytes = parsePositiveInteger(
    overrides.voiceMaxFileBytes ?? process.env.VOICE_MAX_FILE_BYTES,
    25 * 1024 * 1024,
  );
  const imageAnalysisTimeoutMs = parsePositiveInteger(
    overrides.imageAnalysisTimeoutMs ?? process.env.IMAGE_ANALYSIS_TIMEOUT_MS,
    20_000,
  );
  const imageMaxFileBytes = parsePositiveInteger(
    overrides.imageMaxFileBytes ?? process.env.IMAGE_MAX_FILE_BYTES,
    25 * 1024 * 1024,
  );
  const imageMaxEdgePixels = parsePositiveInteger(
    overrides.imageMaxEdgePixels ?? process.env.IMAGE_MAX_EDGE_PIXELS,
    4_096,
  );
  const spreadsheetReadEnabled = parseBoolean(
    overrides.spreadsheetReadEnabled ?? process.env.APP_SPREADSHEET_READ_ENABLED,
    runtimeProfile !== 'secondary',
  );
  const mirrorSyncEnabled = parseBoolean(
    overrides.mirrorSyncEnabled ?? process.env.APP_MIRROR_SYNC_ENABLED,
    runtimeProfile !== 'secondary',
  );

  return {
    projectRoot,
    runtimeProfile,
    stageName,
    envFilePath,
    runtimeRoot,
    logFilePath,
    lockFilePath,
    buildArtifactPath,
    packageJsonPath,
    runtimeStateFilePath,
    accessRegistryFilePath,
    superAdminRegistryFilePath,
    officialGroupWhitelistFilePath,
    dynamicPromptRegistryFilePath,
    dynamicPromptAuditFilePath,
    whatsappAuthDir,
    whatsappQrFilePath,
    whatsappTransportMode,
    botPrimaryNumber,
    superAdminNumbers,
    paintCommand,
    reconnectDelaysMs,
    openAiApiKey,
    openAiTextModel,
    openAiTranscribeModel,
    googleSheetsSpreadsheetId,
    googleServiceAccountEmail,
    googleServiceAccountKeyPath,
    mirrorSyncIntervalMs,
    mirrorFreshnessStaleAfterMs,
    aiSessionMaxTurns,
    aiRequestTimeoutMs,
    voiceTranscribeTimeoutMs,
    voiceMaxAudioSeconds,
    voiceMaxFileBytes,
    imageAnalysisTimeoutMs,
    imageMaxFileBytes,
    imageMaxEdgePixels,
    spreadsheetReadEnabled,
    mirrorSyncEnabled,
  };
}

function resolveFromProject(projectRoot: string, value: string): string {
  return resolve(projectRoot, value);
}

function parseReconnectDelays(source: string | undefined, fallback: number[]): number[] {
  if (!source) {
    return fallback;
  }

  const parsed = source
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 0);

  return parsed.length > 0 ? parsed : fallback;
}

function normalizeRuntimeProfile(value: string | null | undefined): RuntimeProfile {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'secondary' || normalized === 'bot2' ? 'secondary' : 'primary';
}

function normalizePhoneNumber(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  return digits.length > 0 ? digits : '6285655002277';
}

function parseBoolean(value: boolean | string | null | undefined, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeOptionalEnvValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveOptionalPathFromProject(projectRoot: string, value: string | null | undefined): string | null {
  const normalized = normalizeOptionalEnvValue(value);
  return normalized ? resolveFromProject(projectRoot, normalized) : null;
}

function parsePositiveInteger(value: string | number | null | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | number | null | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
