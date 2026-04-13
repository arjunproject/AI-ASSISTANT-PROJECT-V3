import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { writeDynamicAdminRegistry } from '../src/access/admin-registry.js';
import { writeDynamicPromptRegistry } from '../src/ai/dynamic-prompt-registry.js';
import { writeOfficialGroupWhitelist } from '../src/access/official-group-whitelist.js';
import { loadAppConfig } from '../src/config/app-config.js';
import { collectHealthReport } from '../src/core/health-service.js';
import { acquireProcessLock } from '../src/core/process-lock.js';
import {
  buildDefaultGoogleSheetsMirrorAuthorityState,
  writeGoogleSheetsMirrorIndex,
  writeGoogleSheetsMirrorSheet,
  type GoogleSheetsMirrorIndex,
  type GoogleSheetsMirrorSheet,
} from '../src/google/google-sheets-mirror.js';
import { seedSessionCreds } from '../src/whatsapp/session-store.js';
import type { RuntimeStateSnapshot } from '../src/whatsapp/types.js';
import { createTempRoot, seedBuildArtifact, seedPackageJson, seedRuntimeState } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('health stays honest when build artifacts are missing', async () => {
  const temp = await createTempRoot('stage-4-health-missing-build-');
  cleanups.push(temp.cleanup);
  await seedPackageJson(temp.root);
  await seedOfficialGroup(temp.root);
  await seedRuntimeState(temp.root, createState(temp.root, {}));

  const config = loadAppConfig({ projectRoot: temp.root, stageName: 'stage-4' });
  const health = await collectHealthReport(config);

  assert.equal(health.runtimePid, null);
  assert.equal(health.processLockOwner, null);
  assert.equal(health.nodeReady, true);
  assert.equal(health.npmScriptsReady, true);
  assert.equal(health.buildReady, false);
  assert.equal(health.stageName, 'stage-4');
  assert.equal(health.whatsappTransportMode, 'baileys-local-auth-qr');
  assert.equal(health.connectionState, 'idle');
  assert.equal(health.socketState, 'idle');
  assert.equal(health.syncState, 'idle');
  assert.equal(health.sessionStoreReady, true);
  assert.equal(health.sessionPresent, false);
  assert.equal(health.inboundReady, false);
  assert.equal(health.accessGateReady, true);
  assert.equal(health.commandRegistryReady, true);
  assert.equal(health.aiGatewayReady, false);
  assert.equal(health.voiceGatewayReady, false);
  assert.equal(health.imageGatewayReady, false);
  assert.equal(health.googleSheetsReady, false);
  assert.match(health.lastGoogleSheetsError ?? '', /GOOGLE_SHEETS_SPREADSHEET_ID is missing/);
  assert.equal(health.dynamicPromptRegistryReady, true);
  assert.equal(health.activeDynamicPromptCount, 0);
  assert.equal(health.webSearchReady, false);
  assert.equal(health.aiModelName, null);
  assert.equal(health.superAdminCount, 2);
  assert.equal(health.activeDynamicAdminCount, 0);
  assert.equal(health.qrState, 'not_requested');
  assert.equal(health.overallStatus, 'blocked');
  assert.match(health.lastError ?? '', /Build artifact is missing/);
});

test('health becomes ready when runtime, access gate, sync, flow, inbound proof, and command registry are present', async () => {
  const temp = await createTempRoot('stage-4-health-ready-');
  cleanups.push(temp.cleanup);
  const freshMirrorSyncAt = new Date().toISOString();
  await seedPackageJson(temp.root);
  await seedBuildArtifact(temp.root);
  await seedOfficialGroup(temp.root);
  await seedSessionCreds(join(temp.root, '.runtime', 'whatsapp', 'auth'), {
    registrationId: 12345,
  });
  await writeDynamicAdminRegistry(join(temp.root, '.runtime', 'access', 'admin-registry.json'), [
    {
      normalizedPhoneNumber: '628111222333',
      displayName: 'Rahma',
      nameKey: 'rahma',
      dmAccessEnabled: true,
      groupAccessEnabled: true,
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z',
      source: 'manual_seed',
    },
  ]);
  await writeDynamicPromptRegistry(join(temp.root, '.runtime', 'ai', 'dynamic-prompts.json'), [
    {
      id: 'prompt-1',
      displayNumber: 1,
      name: 'Overlay',
      content: 'Jawab ringkas.',
      targetType: 'global',
      targetMembers: [],
      mode: 'dm+group',
      priority: 1,
      trigger: {
        type: 'always',
        value: null,
      },
      isActive: true,
      createdBy: 'system',
      createdByNumber: '201507007785',
      updatedBy: 'system',
      updatedByNumber: '201507007785',
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z',
      version: 1,
      lastUpdatedChatJid: '201507007785@s.whatsapp.net',
    },
  ]);
  const keyDir = join(temp.root, 'keys');
  await mkdir(keyDir, { recursive: true });
  const serviceAccountKeyPath = join(keyDir, 'service-account.json');
  await writeFile(
    serviceAccountKeyPath,
    JSON.stringify({
      type: 'service_account',
      client_email: 'arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
    }),
    'utf8',
  );
  await seedRuntimeState(
    temp.root,
    createState(temp.root, {
      connectionState: 'connected',
      socketState: 'open',
      syncState: 'healthy',
      sessionPresent: true,
      receivedPendingNotifications: true,
      companionOnline: true,
      appStateSyncReady: true,
      deviceActivityState: 'active',
      messageFlowState: 'usable',
      qrState: 'cleared',
      lastConnectAt: '2026-04-10T00:00:00.000Z',
      lastSyncAt: '2026-04-10T00:00:00.000Z',
      inboundReady: true,
      lastInboundMessageAt: '2026-04-10T00:00:10.000Z',
      lastInboundMessageId: 'ABCD1234',
      lastInboundSender: '201507007785@s.whatsapp.net',
      lastInboundNormalizedSender: '201507007785',
      lastInboundChatJid: '201507007785@s.whatsapp.net',
      lastInboundWasFromSelf: false,
      lastInboundWasGroup: false,
      accessGateReady: true,
      officialGroupWhitelistReady: true,
      officialGroupJid: '120363408735885184@g.us',
      officialGroupName: 'ARJUN MOTOR PROJECT',
      lastAccessDecisionAt: '2026-04-10T00:00:10.100Z',
      lastAccessDecisionRole: 'super_admin',
      lastAccessDecisionReason: 'official_super_admin',
      lastAccessDecisionAllowed: true,
      lastAccessDecisionSender: '201507007785',
      lastGroupAccessDecisionAt: '2026-04-10T00:00:10.100Z',
      lastGroupAccessDecisionAllowed: true,
      lastGroupAccessDecisionSender: '201507007785',
      lastGroupAccessDecisionChatJid: '201507007785@s.whatsapp.net',
      lastGroupAccessDecisionReason: 'direct_message',
      commandRegistryReady: true,
      lastCommandAt: '2026-04-10T00:00:10.200Z',
      lastCommandName: 'admin.list',
      lastCommandAllowed: true,
      lastCommandReason: 'list_reported',
      lastCommandSender: '201507007785',
      dynamicPromptRegistryReady: true,
      activeDynamicPromptCount: 1,
      lastDynamicPromptAppliedAt: '2026-04-10T00:00:10.250Z',
      lastDynamicPromptAuditAt: '2026-04-10T00:00:10.150Z',
      lastDynamicPromptError: null,
      lastContextUpdatedAt: '2026-04-10T00:00:10.300Z',
      activeDynamicAdminCount: 1,
      superAdminCount: 2,
      mirrorSyncReady: true,
      lastMirrorSyncAt: freshMirrorSyncAt,
      lastMirrorSyncError: null,
      mirrorFreshnessState: 'fresh',
      lastOutboundMessageAt: '2026-04-10T00:00:05.000Z',
      lastMessageFlowAt: '2026-04-10T00:00:10.000Z',
      lastProbeAt: '2026-04-10T00:00:01.000Z',
    }),
  );
  const lock = await acquireProcessLock(join(temp.root, '.runtime', 'lock', 'runtime.lock.json'), 'stage-4');

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-4',
    buildArtifactPath: join(temp.root, 'dist', 'src', 'index.js'),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    googleSheetsSpreadsheetId: '1BCITr0ihBrTRr3qraW3jLObbW3Enbz-Io6Ki-9cRMvg',
    googleServiceAccountEmail: 'arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
    googleServiceAccountKeyPath: serviceAccountKeyPath,
  });
  const health = await collectHealthReport(config);

  assert.equal(health.runtimePid, process.pid);
  assert.equal(health.processLockOwner, process.pid);
  assert.equal(health.buildReady, true);
  assert.equal(health.connectionState, 'connected');
  assert.equal(health.socketState, 'open');
  assert.equal(health.syncState, 'healthy');
  assert.equal(health.sessionPresent, true);
  assert.equal(health.inboundReady, true);
  assert.equal(health.accessGateReady, true);
  assert.equal(health.officialGroupWhitelistReady, true);
  assert.equal(health.officialGroupJid, '120363408735885184@g.us');
  assert.equal(health.officialGroupName, 'ARJUN MOTOR PROJECT');
  assert.equal(health.commandRegistryReady, true);
  assert.equal(health.aiGatewayReady, true);
  assert.equal(health.voiceGatewayReady, true);
  assert.equal(health.imageGatewayReady, true);
  assert.equal(health.googleSheetsReady, true);
  assert.equal(health.lastGoogleSheetsError, null);
  assert.equal(health.mirrorSyncReady, true);
  assert.equal(health.lastMirrorSyncAt, freshMirrorSyncAt);
  assert.equal(health.lastMirrorSyncError, null);
  assert.equal(health.mirrorFreshnessState, 'fresh');
  assert.equal(health.dynamicPromptRegistryReady, true);
  assert.equal(health.activeDynamicPromptCount, 1);
  assert.equal(health.lastDynamicPromptAppliedAt, '2026-04-10T00:00:10.250Z');
  assert.equal(health.lastDynamicPromptAuditAt !== null, true);
  assert.equal(health.webSearchReady, true);
  assert.equal(health.aiModelName, 'test-model');
  assert.equal(health.lastAccessDecisionRole, 'super_admin');
  assert.equal(health.lastAccessDecisionReason, 'official_super_admin');
  assert.equal(health.lastAccessDecisionAllowed, true);
  assert.equal(health.lastAccessDecisionSender, '201507007785');
  assert.equal(health.lastCommandName, 'admin.list');
  assert.equal(health.lastCommandAllowed, true);
  assert.equal(health.lastCommandReason, 'list_reported');
  assert.equal(health.lastCommandSender, '201507007785');
  assert.equal(health.lastContextUpdatedAt, '2026-04-10T00:00:10.300Z');
  assert.equal(health.activeDynamicAdminCount, 1);
  assert.equal(health.superAdminCount, 2);
  assert.equal(health.overallStatus, 'ready');
  assert.equal(health.lastError, null);

  await lock.release();
});

test('health stays degraded while socket is open but companion sync is not healthy yet', async () => {
  const temp = await createTempRoot('stage-4-health-sync-pending-');
  cleanups.push(temp.cleanup);
  await seedPackageJson(temp.root);
  await seedBuildArtifact(temp.root);
  await seedOfficialGroup(temp.root);
  await seedSessionCreds(join(temp.root, '.runtime', 'whatsapp', 'auth'), {
    registrationId: 12345,
  });
  await seedRuntimeState(
    temp.root,
    createState(temp.root, {
      connectionState: 'connecting',
      socketState: 'open',
      syncState: 'awaiting_history',
      sessionPresent: true,
      receivedPendingNotifications: true,
      deviceActivityState: 'passive',
      messageFlowState: 'idle',
      qrState: 'cleared',
    }),
  );
  const lock = await acquireProcessLock(join(temp.root, '.runtime', 'lock', 'runtime.lock.json'), 'stage-4');

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-4',
    buildArtifactPath: join(temp.root, 'dist', 'src', 'index.js'),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });
  const health = await collectHealthReport(config);

  assert.equal(health.connectionState, 'connecting');
  assert.equal(health.socketState, 'open');
  assert.equal(health.syncState, 'awaiting_history');
  assert.equal(health.receivedPendingNotifications, true);
  assert.equal(health.companionOnline, false);
  assert.equal(health.appStateSyncReady, false);
  assert.equal(health.deviceActivityState, 'passive');
  assert.equal(health.messageFlowState, 'idle');
  assert.equal(health.inboundReady, false);
  assert.equal(health.overallStatus, 'degraded');

  await lock.release();
});

test('health stays degraded when mirror is stale even if WhatsApp transport is otherwise healthy', async () => {
  const temp = await createTempRoot('stage-6-health-mirror-stale-');
  cleanups.push(temp.cleanup);
  await seedPackageJson(temp.root);
  await seedBuildArtifact(temp.root);
  await seedOfficialGroup(temp.root);
  await seedSessionCreds(join(temp.root, '.runtime', 'whatsapp', 'auth'), {
    registrationId: 12345,
  });
  await seedRuntimeState(
    temp.root,
    createState(temp.root, {
      connectionState: 'connected',
      socketState: 'open',
      syncState: 'healthy',
      sessionPresent: true,
      receivedPendingNotifications: true,
      companionOnline: true,
      appStateSyncReady: true,
      deviceActivityState: 'active',
      messageFlowState: 'usable',
      qrState: 'cleared',
      inboundReady: true,
      googleSheetsReady: true,
      lastMirrorSyncAt: '2026-04-10T00:00:00.000Z',
      lastMirrorSyncError: null,
      mirrorSyncReady: true,
      mirrorFreshnessState: 'stale',
    }),
  );
  const keyDir = join(temp.root, 'keys');
  await mkdir(keyDir, { recursive: true });
  const serviceAccountKeyPath = join(keyDir, 'service-account.json');
  await writeFile(
    serviceAccountKeyPath,
    JSON.stringify({
      type: 'service_account',
      client_email: 'arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
    }),
    'utf8',
  );
  const lock = await acquireProcessLock(join(temp.root, '.runtime', 'lock', 'runtime.lock.json'), 'stage-6');

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-6',
    buildArtifactPath: join(temp.root, 'dist', 'src', 'index.js'),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    googleSheetsSpreadsheetId: 'spreadsheet-1',
    googleServiceAccountEmail: 'arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
    googleServiceAccountKeyPath: serviceAccountKeyPath,
  });
  const health = await collectHealthReport(config);

  assert.equal(health.googleSheetsReady, true);
  assert.equal(health.mirrorSyncReady, false);
  assert.equal(health.mirrorFreshnessState, 'stale');
  assert.equal(health.overallStatus, 'degraded');
  assert.match(health.lastError ?? '', /Mirror is stale/i);

  await lock.release();
});

test('health stays degraded when mirror authority is in conflict even if sync freshness is still fresh', async () => {
  const temp = await createTempRoot('stage-6-health-mirror-conflict-');
  cleanups.push(temp.cleanup);
  await seedPackageJson(temp.root);
  await seedBuildArtifact(temp.root);
  await seedOfficialGroup(temp.root);
  await seedSessionCreds(join(temp.root, '.runtime', 'whatsapp', 'auth'), {
    registrationId: 12345,
  });
  await seedRuntimeState(
    temp.root,
    createState(temp.root, {
      connectionState: 'connected',
      socketState: 'open',
      syncState: 'healthy',
      sessionPresent: true,
      receivedPendingNotifications: true,
      companionOnline: true,
      appStateSyncReady: true,
      deviceActivityState: 'active',
      messageFlowState: 'usable',
      qrState: 'cleared',
      inboundReady: true,
      googleSheetsReady: true,
      mirrorSyncReady: true,
      lastMirrorSyncAt: new Date().toISOString(),
      lastMirrorSyncError: null,
      mirrorFreshnessState: 'fresh',
      syncAuthorityMode: 'conflict',
      activeWriteSessionId: 'session-1',
      activeWriteScope: ['STOK MOTOR!H4:H4'],
      activeWriteSource: 'mirror_write_contract',
      writeSessionStatus: 'conflict',
      lastAuthoritativeSource: 'mirror_write_contract',
      lastAuthorityConflictReason: 'Manual live change conflicted with active mirror write scope at H4.',
    }),
  );
  await seedMirrorAuthorityState(temp.root, {
    ...buildDefaultGoogleSheetsMirrorAuthorityState(new Date().toISOString()),
    syncAuthorityMode: 'conflict',
    activeWriteSessionId: 'session-1',
    activeWriteScope: ['STOK MOTOR!H4:H4'],
    activeWriteSource: 'mirror_write_contract',
    writeSessionStatus: 'conflict',
    lastAuthoritativeSource: 'mirror_write_contract',
    lastAuthorityConflictReason: 'Manual live change conflicted with active mirror write scope at H4.',
  });
  const keyDir = join(temp.root, 'keys');
  await mkdir(keyDir, { recursive: true });
  const serviceAccountKeyPath = join(keyDir, 'service-account.json');
  await writeFile(
    serviceAccountKeyPath,
    JSON.stringify({
      type: 'service_account',
      client_email: 'arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
    }),
    'utf8',
  );
  const lock = await acquireProcessLock(join(temp.root, '.runtime', 'lock', 'runtime.lock.json'), 'stage-6');

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-6',
    buildArtifactPath: join(temp.root, 'dist', 'src', 'index.js'),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
    googleSheetsSpreadsheetId: 'spreadsheet-1',
    googleServiceAccountEmail: 'arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
    googleServiceAccountKeyPath: serviceAccountKeyPath,
  });
  const health = await collectHealthReport(config);

  assert.equal(health.syncAuthorityMode, 'conflict');
  assert.equal(health.writeSessionStatus, 'conflict');
  assert.equal(health.overallStatus, 'degraded');
  assert.match(health.lastError ?? '', /conflicted/i);

  await lock.release();
});

test('health stays degraded when transport is healthy but inbound proof has not happened yet', async () => {
  const temp = await createTempRoot('stage-4-health-no-inbound-');
  cleanups.push(temp.cleanup);
  await seedPackageJson(temp.root);
  await seedBuildArtifact(temp.root);
  await seedOfficialGroup(temp.root);
  await seedSessionCreds(join(temp.root, '.runtime', 'whatsapp', 'auth'), {
    registrationId: 12345,
  });
  await seedRuntimeState(
    temp.root,
    createState(temp.root, {
      connectionState: 'connected',
      socketState: 'open',
      syncState: 'healthy',
      sessionPresent: true,
      receivedPendingNotifications: true,
      companionOnline: true,
      appStateSyncReady: true,
      deviceActivityState: 'active',
      messageFlowState: 'usable',
      qrState: 'cleared',
      accessGateReady: true,
      lastConnectAt: '2026-04-10T00:00:00.000Z',
      lastSyncAt: '2026-04-10T00:00:00.000Z',
      lastOutboundMessageAt: '2026-04-10T00:00:05.000Z',
      lastMessageFlowAt: '2026-04-10T00:00:05.000Z',
      inboundReady: false,
    }),
  );
  const lock = await acquireProcessLock(join(temp.root, '.runtime', 'lock', 'runtime.lock.json'), 'stage-4');

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-4',
    buildArtifactPath: join(temp.root, 'dist', 'src', 'index.js'),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });
  const health = await collectHealthReport(config);

  assert.equal(health.deviceActivityState, 'active');
  assert.equal(health.messageFlowState, 'usable');
  assert.equal(health.inboundReady, false);
  assert.equal(health.overallStatus, 'degraded');

  await lock.release();
});

test('health becomes blocked when access registry is not ready', async () => {
  const temp = await createTempRoot('stage-4-health-access-broken-');
  cleanups.push(temp.cleanup);
  await seedPackageJson(temp.root);
  await seedBuildArtifact(temp.root);
  await seedOfficialGroup(temp.root);
  await seedSessionCreds(join(temp.root, '.runtime', 'whatsapp', 'auth'), {
    registrationId: 12345,
  });
  await seedRuntimeState(
    temp.root,
    createState(temp.root, {
      connectionState: 'connected',
      socketState: 'open',
      syncState: 'healthy',
      sessionPresent: true,
      receivedPendingNotifications: true,
      companionOnline: true,
      appStateSyncReady: true,
      deviceActivityState: 'active',
      messageFlowState: 'usable',
      inboundReady: true,
      accessGateReady: false,
      lastError: 'Dynamic admin registry contains a non-object record.',
    }),
  );
  const lock = await acquireProcessLock(join(temp.root, '.runtime', 'lock', 'runtime.lock.json'), 'stage-4');
  const accessDir = join(temp.root, '.runtime', 'access');
  await mkdir(accessDir, { recursive: true });
  await writeFile(join(accessDir, 'admin-registry.json'), '{ broken-json', 'utf8');
  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-4',
    buildArtifactPath: join(temp.root, 'dist', 'src', 'index.js'),
    accessRegistryFilePath: join(temp.root, '.runtime', 'access', 'admin-registry.json'),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });

  const health = await collectHealthReport(config);

  assert.equal(health.accessGateReady, false);
  assert.equal(health.commandRegistryReady, false);
  assert.equal(health.overallStatus, 'blocked');
  assert.match(health.lastError ?? '', /JSON|Expected property name|Unexpected token/);

  await lock.release();
});

test('health becomes blocked when dynamic prompt registry is not ready', async () => {
  const temp = await createTempRoot('stage-5-health-dynamic-prompt-broken-');
  cleanups.push(temp.cleanup);
  await seedPackageJson(temp.root);
  await seedBuildArtifact(temp.root);
  await seedOfficialGroup(temp.root);
  await seedSessionCreds(join(temp.root, '.runtime', 'whatsapp', 'auth'), {
    registrationId: 12345,
  });
  await seedRuntimeState(
    temp.root,
    createState(temp.root, {
      connectionState: 'connected',
      socketState: 'open',
      syncState: 'healthy',
      sessionPresent: true,
      receivedPendingNotifications: true,
      companionOnline: true,
      appStateSyncReady: true,
      deviceActivityState: 'active',
      messageFlowState: 'usable',
      inboundReady: true,
    }),
  );
  const lock = await acquireProcessLock(join(temp.root, '.runtime', 'lock', 'runtime.lock.json'), 'stage-5');
  await mkdir(join(temp.root, '.runtime', 'ai'), { recursive: true });
  await writeFile(join(temp.root, '.runtime', 'ai', 'dynamic-prompts.json'), '{ broken-json', 'utf8');

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
    buildArtifactPath: join(temp.root, 'dist', 'src', 'index.js'),
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });

  const health = await collectHealthReport(config);

  assert.equal(health.dynamicPromptRegistryReady, false);
  assert.equal(health.overallStatus, 'blocked');
  assert.match(health.lastError ?? '', /Unexpected token|Expected property name|JSON/i);

  await lock.release();
});

function createState(
  root: string,
  overrides: Partial<RuntimeStateSnapshot>,
): RuntimeStateSnapshot {
  return {
    stageName: 'stage-4',
    whatsappTransportMode: 'baileys-local-auth-qr',
    connectionState: 'idle',
    socketState: 'idle',
    syncState: 'idle',
    sessionStoreReady: true,
    sessionPresent: false,
    receivedPendingNotifications: false,
    companionOnline: false,
    appStateSyncReady: false,
    deviceActivityState: 'unknown',
    messageFlowState: 'idle',
    qrState: 'not_requested',
    qrFilePath: join(root, '.runtime', 'whatsapp', 'qr', 'login-qr.png'),
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
    officialGroupWhitelistReady: true,
    officialGroupJid: '120363408735885184@g.us',
    officialGroupName: 'ARJUN MOTOR PROJECT',
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
    aiGatewayReady: true,
    aiModelName: 'test-model',
    lastAiRequestAt: null,
    lastAiReplyAt: null,
    lastAiSender: null,
    lastAiChatJid: null,
    lastAiError: null,
    voiceGatewayReady: true,
    lastVoiceMessageAt: null,
    lastVoiceTranscriptionAt: null,
    lastVoiceSender: null,
    lastVoiceChatJid: null,
    lastVoiceError: null,
    lastVoiceTranscriptPreview: null,
    lastVoiceDurationSeconds: null,
    lastVoiceInputMode: null,
    imageGatewayReady: true,
    lastImageMessageAt: null,
    lastImageAnalysisAt: null,
    lastImageSender: null,
    lastImageChatJid: null,
    lastImageError: null,
    lastImageCaptionPreview: null,
    lastImageInputMode: null,
    googleSheetsReady: false,
    lastGoogleSheetsError: null,
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
    webSearchReady: true,
    lastWebSearchAt: null,
    lastWebSearchQuery: null,
    lastWebSearchUsed: false,
    lastWebSearchError: null,
    lastWebSearchResultCount: 0,
    lastContextUpdatedAt: null,
    activeConversationCount: 0,
    activeDynamicAdminCount: 0,
    superAdminCount: 2,
    lastDecryptIssue: null,
    lastDecryptIssueAt: null,
    lastSessionIssue: null,
    lastSessionIssueAt: null,
    lastMessageFlowError: null,
    recentIdentityResolutions: [],
    lastError: null,
    ...overrides,
  };
}

async function seedOfficialGroup(root: string): Promise<void> {
  await writeOfficialGroupWhitelist(join(root, '.runtime', 'access', 'official-group-whitelist.json'), {
    groupJid: '120363408735885184@g.us',
    groupName: 'ARJUN MOTOR PROJECT',
    inviteLink: 'https://chat.whatsapp.com/HYzFzg2J0qE6LUcTOVzlp3',
    isActive: true,
    createdAt: '2026-04-11T00:00:00.000Z',
    updatedAt: '2026-04-11T00:00:00.000Z',
    source: 'test_seed',
  });
}

async function seedMirrorAuthorityState(
  root: string,
  authorityState: GoogleSheetsMirrorIndex['authorityState'],
): Promise<void> {
  const config = loadAppConfig({ projectRoot: root });
  const sheets: GoogleSheetsMirrorSheet[] = [
    createEmptyMirrorSheet('STOK MOTOR', 0),
    createEmptyMirrorSheet('PENGELUARAN HARIAN', 1215570505),
    createEmptyMirrorSheet('TOTAL ASET', 1573138266),
  ];

  for (const sheet of sheets) {
    await writeGoogleSheetsMirrorSheet(config, sheet);
  }

  const index: GoogleSheetsMirrorIndex = {
    spreadsheetId: 'spreadsheet-1',
    spreadsheetTitle: 'ARJUN MOTOR PROJECT',
    syncedAt: authorityState.updatedAt ?? '2026-04-10T00:00:00.000Z',
    mirrorMode: 'value-only-sparse',
    sheetCount: sheets.length,
    mirrorCellCount: 0,
    sheets: sheets.map((sheet) => ({
      sheetName: sheet.sheetName,
      sheetId: sheet.sheetId,
      fileName:
        sheet.sheetName === 'STOK MOTOR'
          ? 'stok-motor.json'
          : sheet.sheetName === 'PENGELUARAN HARIAN'
            ? 'pengeluaran-harian.json'
            : 'total-aset.json',
      syncedAt: sheet.syncedAt,
      discoveryMode: sheet.discoveryMode,
      lastDiscoveryRange: sheet.lastDiscoveryRange,
      nonEmptyRowCount: sheet.nonEmptyRowCount,
      nonEmptyCellCount: sheet.nonEmptyCellCount,
      lastDataRow: sheet.lastDataRow,
    })),
    authorityState,
  };

  await writeGoogleSheetsMirrorIndex(config, index);
}

function createEmptyMirrorSheet(
  sheetName: GoogleSheetsMirrorSheet['sheetName'],
  sheetId: number,
): GoogleSheetsMirrorSheet {
  return {
    spreadsheetId: 'spreadsheet-1',
    spreadsheetTitle: 'ARJUN MOTOR PROJECT',
    sheetName,
    sheetId,
    syncedAt: '2026-04-10T00:00:00.000Z',
    mirrorMode: 'value-only-sparse',
    discoveryMode: sheetName === 'STOK MOTOR' ? 'column-b-cutoff' : 'used-range-sparse',
    lastDiscoveryRange: null,
    headerSnapshot: [],
    nonEmptyRowCount: 0,
    nonEmptyCellCount: 0,
    lastDataRow: 0,
    valueCells: [],
    pendingMutations: [],
  };
}
