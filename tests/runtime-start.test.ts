import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';

import { loadAppConfig } from '../src/config/app-config.js';
import { inspectProcessLock } from '../src/core/process-lock.js';
import { createRuntimeStateStore, readRuntimeStateSnapshot } from '../src/runtime/runtime-state-store.js';
import {
  startRuntime,
  type RuntimeMirrorSyncController,
  type RuntimeMirrorSyncFactory,
  type RuntimeTransportFactory,
} from '../src/runtime/runtime-service.js';
import { createTempRoot, seedRuntimeState, waitFor } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('runtime starts, writes lock and state, then stops cleanly', async () => {
  const temp = await createTempRoot('stage-1-runtime-start-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-1',
  });
  const transportFactory: RuntimeTransportFactory = async ({ runtimeStateStore }) => {
    await runtimeStateStore.syncDerivedState();
    await runtimeStateStore.update({
      connectionState: 'connected',
      lastConnectAt: '2026-04-10T00:00:00.000Z',
      qrState: 'cleared',
      qrOpenedInPaint: false,
      lastError: null,
    });

    let resolveStopped: () => void = () => {};
    const untilStopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });

    return {
      untilStopped,
      async stop() {
        await runtimeStateStore.update({
          connectionState: 'idle',
          qrState: 'not_requested',
        });
        resolveStopped();
      },
    };
  };
  const mirrorSyncFactory: RuntimeMirrorSyncFactory = async (): Promise<RuntimeMirrorSyncController> => ({
    async stop() {
      return undefined;
    },
  });

  const runtime = await startRuntime(config, { transportFactory, mirrorSyncFactory });

  try {
    await waitFor(async () => {
      try {
        await access(config.lockFilePath);
        await access(config.logFilePath);
        await access(config.runtimeStateFilePath);
        return true;
      } catch {
        return false;
      }
    });

    const lockInspection = await inspectProcessLock(config.lockFilePath);
    assert.equal(lockInspection.ownerPid, process.pid);
    assert.equal(lockInspection.isOwnerRunning, true);

    const logContents = await readFile(config.logFilePath, 'utf8');
    assert.match(logContents, /runtime\.start/);
    assert.match(logContents, /lock\.acquired/);
    const stateSnapshot = await readRuntimeStateSnapshot(config, true);
    assert.equal(stateSnapshot.connectionState, 'connected');
    assert.equal(stateSnapshot.qrState, 'cleared');
  } finally {
    await runtime.stop('test');
  }

  const finalLogContents = await readFile(config.logFilePath, 'utf8');
  assert.match(finalLogContents, /runtime\.stop/);
  assert.match(finalLogContents, /lock\.released/);

  const releasedInspection = await inspectProcessLock(config.lockFilePath);
  assert.equal(releasedInspection.exists, false);
});

test('runtime official path starts mirror sync controller without needing a separate script', async () => {
  const temp = await createTempRoot('stage-6-runtime-mirror-sync-');
  cleanups.push(temp.cleanup);
  const keyDir = `${temp.root}\\keys`;
  await mkdir(keyDir, { recursive: true });
  const serviceAccountKeyPath = `${keyDir}\\service-account.json`;
  await writeFile(
    serviceAccountKeyPath,
    JSON.stringify({
      type: 'service_account',
      client_email: 'arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
    }),
    'utf8',
  );
  const freshMirrorSyncAt = new Date().toISOString();

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-6',
    googleSheetsSpreadsheetId: 'spreadsheet-1',
    googleServiceAccountEmail: 'arjun-motor-sync@arjun-motor-project.iam.gserviceaccount.com',
    googleServiceAccountKeyPath: serviceAccountKeyPath,
  });
  let mirrorSyncStarts = 0;
  const transportFactory: RuntimeTransportFactory = async ({ runtimeStateStore }) => {
    await runtimeStateStore.syncDerivedState();
    await runtimeStateStore.update({
      connectionState: 'connected',
      socketState: 'open',
      syncState: 'healthy',
      receivedPendingNotifications: true,
      companionOnline: true,
      appStateSyncReady: true,
      deviceActivityState: 'active',
      messageFlowState: 'usable',
      inboundReady: true,
      qrState: 'cleared',
      qrOpenedInPaint: false,
      lastError: null,
    });

    let resolveStopped: () => void = () => {};
    const untilStopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });

    return {
      untilStopped,
      async stop() {
        resolveStopped();
      },
    };
  };
  const mirrorSyncFactory: RuntimeMirrorSyncFactory = async ({ runtimeStateStore }) => {
    mirrorSyncStarts += 1;
    await runtimeStateStore.update({
      mirrorSyncReady: true,
      lastMirrorSyncAt: freshMirrorSyncAt,
      lastMirrorSyncError: null,
      mirrorFreshnessState: 'fresh',
    });

    return {
      async stop() {
        return undefined;
      },
    };
  };

  const runtime = await startRuntime(config, { transportFactory, mirrorSyncFactory });

  try {
    await waitFor(async () => {
      const stateSnapshot = await readRuntimeStateSnapshot(config, true);
      return stateSnapshot.mirrorSyncReady === true;
    });

    const stateSnapshot = await readRuntimeStateSnapshot(config, true);
    assert.equal(mirrorSyncStarts, 1);
    assert.equal(stateSnapshot.mirrorSyncReady, true);
    assert.equal(stateSnapshot.lastMirrorSyncAt, freshMirrorSyncAt);
    assert.equal(stateSnapshot.lastMirrorSyncError, null);
    assert.equal(stateSnapshot.mirrorFreshnessState, 'fresh');
  } finally {
    await runtime.stop('test');
  }
});

test('runtime state store removes legacy fields that are no longer part of the official snapshot', async () => {
  const temp = await createTempRoot('stage-5-runtime-state-sanitize-');
  cleanups.push(temp.cleanup);

  await seedRuntimeState(temp.root, {
    stageName: 'stage-5',
    whatsappTransportMode: 'baileys-local-auth-qr',
    connectionState: 'connected',
    lastContextResetAt: '2026-04-10T21:28:48.445Z',
    lastError: null,
  });

  const config = loadAppConfig({
    projectRoot: temp.root,
    stageName: 'stage-5',
  });

  await createRuntimeStateStore(config);

  const rawState = JSON.parse(await readFile(config.runtimeStateFilePath, 'utf8')) as Record<string, unknown>;
  assert.equal('lastContextResetAt' in rawState, false);
  assert.equal(rawState.connectionState, 'idle');
});

test('secondary runtime skips mirror sync startup even when a mirror factory override is supplied', async () => {
  const temp = await createTempRoot('stage-7-runtime-secondary-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({
    projectRoot: temp.root,
    runtimeProfile: 'secondary',
    openAiApiKey: 'test-key',
    openAiTextModel: 'test-model',
  });

  let mirrorSyncStarts = 0;
  const transportFactory: RuntimeTransportFactory = async ({ runtimeStateStore }) => {
    await runtimeStateStore.syncDerivedState();
    await runtimeStateStore.update({
      connectionState: 'connected',
      socketState: 'open',
      syncState: 'healthy',
      receivedPendingNotifications: true,
      companionOnline: true,
      appStateSyncReady: true,
      deviceActivityState: 'active',
      messageFlowState: 'usable',
      inboundReady: true,
      qrState: 'cleared',
      qrOpenedInPaint: false,
      lastError: null,
    });

    let resolveStopped: () => void = () => {};
    const untilStopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });

    return {
      untilStopped,
      async stop() {
        resolveStopped();
      },
    };
  };
  const mirrorSyncFactory: RuntimeMirrorSyncFactory = async () => {
    mirrorSyncStarts += 1;
    return {
      async stop() {
        return undefined;
      },
    };
  };

  const runtime = await startRuntime(config, { transportFactory, mirrorSyncFactory });

  try {
    await waitFor(async () => {
      const stateSnapshot = await readRuntimeStateSnapshot(config, true);
      return stateSnapshot.connectionState === 'connected';
    });

    const stateSnapshot = await readRuntimeStateSnapshot(config, true);
    assert.equal(mirrorSyncStarts, 0);
    assert.equal(stateSnapshot.googleSheetsReady, false);
    assert.equal(stateSnapshot.mirrorSyncReady, false);
    assert.equal(stateSnapshot.mirrorFreshnessState, 'unknown');
  } finally {
    await runtime.stop('test');
  }
});
