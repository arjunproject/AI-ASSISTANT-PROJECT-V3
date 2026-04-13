import type { AppConfig } from '../config/app-config.js';
import { inspectGoogleSheetsConfig } from '../config/google-sheets-config.js';
import type { Logger } from '../core/logger.js';
import { createLogger } from '../core/logger.js';
import {
  ProcessLockConflictError,
  ProcessLockMalformedError,
  acquireProcessLock,
} from '../core/process-lock.js';
import { syncGoogleSheetsMirror } from '../google/google-sheets-mirror-sync.js';
import { startBaileysTransport } from '../whatsapp/baileys-transport.js';
import { createRuntimeStateStore, type RuntimeStateStore } from './runtime-state-store.js';

export interface RuntimeTransportController {
  stop(reason?: string): Promise<void>;
  untilStopped: Promise<void>;
}

export interface RuntimeTransportContext {
  config: AppConfig;
  logger: Logger;
  runtimeStateStore: RuntimeStateStore;
}

export type RuntimeTransportFactory = (
  context: RuntimeTransportContext,
) => Promise<RuntimeTransportController>;

export interface RuntimeMirrorSyncController {
  stop(): Promise<void>;
}

export type RuntimeMirrorSyncFactory = (
  context: RuntimeTransportContext,
) => Promise<RuntimeMirrorSyncController>;

export interface RuntimeController {
  pid: number;
  stop(reason?: string): Promise<void>;
  untilStopped: Promise<void>;
}

export async function startRuntime(
  config: AppConfig,
  dependencies: {
    transportFactory?: RuntimeTransportFactory;
    mirrorSyncFactory?: RuntimeMirrorSyncFactory;
  } = {},
): Promise<RuntimeController> {
  const logger = createLogger(config.logFilePath);
  const lock = await acquireRuntimeLock(config, logger);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const transportFactory = dependencies.transportFactory ?? startBaileysTransport;
  const mirrorSyncFactory = dependencies.mirrorSyncFactory ?? startRuntimeMirrorSync;

  let transport: RuntimeTransportController;
  try {
    transport = await transportFactory({
      config,
      logger,
      runtimeStateStore,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await runtimeStateStore.update({
      connectionState: 'failed_closed',
      socketState: 'closed',
      syncState: 'degraded',
      companionOnline: false,
      appStateSyncReady: false,
      deviceActivityState: 'unknown',
      messageFlowState: 'degraded',
      lastError: message,
    });
    await lock.release();
    logger.error('runtime.error', {
      message,
      error,
    });
    throw error;
  }

  const mirrorSyncController = await mirrorSyncFactory({
    config,
    logger,
    runtimeStateStore,
  });

  logger.info('runtime.start', {
    stageName: config.stageName,
    runtimePid: process.pid,
    processLockOwner: lock.ownerPid,
    logFilePath: config.logFilePath,
  });

  let stopped = false;
  let resolveStopped: () => void = () => {};
  const untilStopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const keepAliveTimer = setInterval(() => undefined, 60_000);

  const stopFromSignal = (signal: string) => {
    void stop(signal).then(() => {
      process.exit(0);
    });
  };
  const handleSigint = () => stopFromSignal('SIGINT');
  const handleSigterm = () => stopFromSignal('SIGTERM');

  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);

  async function stop(reason = 'manual'): Promise<void> {
    if (stopped) {
      return untilStopped;
    }
    stopped = true;
    clearInterval(keepAliveTimer);
    process.off('SIGINT', handleSigint);
    process.off('SIGTERM', handleSigterm);

    await mirrorSyncController.stop();
    await transport.stop(reason);
    await runtimeStateStore.syncDerivedState();
    await runtimeStateStore.update({
      connectionState: 'idle',
      socketState: 'idle',
      syncState: 'idle',
      receivedPendingNotifications: false,
      companionOnline: false,
      appStateSyncReady: false,
      deviceActivityState: 'unknown',
      messageFlowState: 'idle',
      qrState: 'not_requested',
      qrOpenedInPaint: false,
    });
    await lock.release();
    logger.info('lock.released', {
      processLockOwner: process.pid,
      lockFilePath: config.lockFilePath,
    });
    logger.info('runtime.stop', {
      stageName: config.stageName,
      runtimePid: process.pid,
      reason,
    });
    resolveStopped();
  }

  return {
    pid: process.pid,
    stop,
    untilStopped,
  };
}

async function acquireRuntimeLock(
  config: AppConfig,
  logger: ReturnType<typeof createLogger>,
) {
  try {
    const lock = await acquireProcessLock(config.lockFilePath, config.stageName);
    logger.info('lock.acquired', {
      processLockOwner: lock.ownerPid,
      lockFilePath: lock.path,
    });
    return lock;
  } catch (error) {
    if (error instanceof ProcessLockConflictError || error instanceof ProcessLockMalformedError) {
      logger.error('lock.rejected', {
        message: error.message,
        lockFilePath: config.lockFilePath,
      });
    }
    throw error;
  }
}

async function startRuntimeMirrorSync(
  context: RuntimeTransportContext,
): Promise<RuntimeMirrorSyncController> {
  const { config, logger, runtimeStateStore } = context;
  const googleSheetsInspection = await inspectGoogleSheetsConfig(config);

  if (!googleSheetsInspection.ready) {
    await runtimeStateStore.update({
      mirrorSyncReady: false,
      lastMirrorSyncError: googleSheetsInspection.error,
      mirrorFreshnessState: 'error',
    });

    return {
      async stop() {
        return undefined;
      },
    };
  }

  await runtimeStateStore.update({
    mirrorSyncReady: false,
    lastMirrorSyncError: null,
    mirrorFreshnessState: 'unknown',
  });

  let stopped = false;
  let activeSync: Promise<void> | null = null;
  let intervalHandle: NodeJS.Timeout | null = null;

  const runSync = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    if (activeSync) {
      await activeSync;
      return;
    }

    activeSync = (async () => {
      try {
        const result = await syncGoogleSheetsMirror(config, { logger });
        await runtimeStateStore.update({
          mirrorSyncReady: true,
          lastMirrorSyncAt: result.syncedAt,
          lastMirrorSyncError: null,
          mirrorFreshnessState: 'fresh',
        });
        await runtimeStateStore.syncDerivedState();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await runtimeStateStore.update({
          mirrorSyncReady: false,
          lastMirrorSyncError: message,
          mirrorFreshnessState: 'error',
        });
        await runtimeStateStore.syncDerivedState();
      } finally {
        activeSync = null;
      }
    })();

    await activeSync;
  };

  await runSync();

  if (config.mirrorSyncIntervalMs > 0) {
    intervalHandle = setInterval(() => {
      void runSync();
    }, config.mirrorSyncIntervalMs);
  }

  return {
    async stop() {
      stopped = true;
      if (intervalHandle) {
        clearInterval(intervalHandle);
      }
      if (activeSync) {
        await activeSync;
      }
    },
  };
}
