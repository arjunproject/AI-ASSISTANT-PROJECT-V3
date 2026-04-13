import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ProcessLockRecord {
  pid: number;
  stageName: string;
  createdAt: string;
}

export interface ProcessLockInspection {
  exists: boolean;
  ownerPid: number | null;
  isOwnerRunning: boolean;
  createdAt: string | null;
  stageName: string | null;
  error: string | null;
}

export interface ProcessLockHandle {
  path: string;
  ownerPid: number;
  release(): Promise<void>;
}

export class ProcessLockConflictError extends Error {
  readonly code = 'PROCESS_LOCK_CONFLICT';

  constructor(
    readonly lockFilePath: string,
    readonly ownerPid: number | null,
  ) {
    super(
      ownerPid === null
        ? `Runtime lock already exists at ${lockFilePath}, but owner pid could not be read.`
        : `Runtime lock already held by pid ${ownerPid} at ${lockFilePath}.`,
    );
    this.name = 'ProcessLockConflictError';
  }
}

export class ProcessLockMalformedError extends Error {
  readonly code = 'PROCESS_LOCK_MALFORMED';

  constructor(
    readonly lockFilePath: string,
    readonly reason: string,
  ) {
    super(`Runtime lock at ${lockFilePath} is malformed: ${reason}`);
    this.name = 'ProcessLockMalformedError';
  }
}

export async function acquireProcessLock(
  lockFilePath: string,
  stageName: string,
  allowStaleCleanup = true,
): Promise<ProcessLockHandle> {
  await mkdir(dirname(lockFilePath), { recursive: true });

  try {
    const handle = await open(lockFilePath, 'wx');
    const record: ProcessLockRecord = {
      pid: process.pid,
      stageName,
      createdAt: new Date().toISOString(),
    };

    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await handle.close();

    return {
      path: lockFilePath,
      ownerPid: record.pid,
      async release() {
        const inspection = await inspectProcessLock(lockFilePath);
        if (!inspection.exists) {
          return;
        }
        if (inspection.ownerPid !== process.pid) {
          return;
        }
        await rm(lockFilePath, { force: true });
      },
    };
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code !== 'EEXIST') {
      throw error;
    }

    const inspection = await inspectProcessLock(lockFilePath);
    if (inspection.error) {
      throw new ProcessLockMalformedError(lockFilePath, inspection.error);
    }

    if (inspection.exists && inspection.ownerPid !== null && !inspection.isOwnerRunning && allowStaleCleanup) {
      await rm(lockFilePath, { force: true });
      return acquireProcessLock(lockFilePath, stageName, false);
    }

    throw new ProcessLockConflictError(lockFilePath, inspection.ownerPid);
  }
}

export async function inspectProcessLock(lockFilePath: string): Promise<ProcessLockInspection> {
  try {
    const raw = await readFile(lockFilePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProcessLockRecord>;
    const pidValue = parsed.pid;
    const stageName = parsed.stageName;
    const createdAt = parsed.createdAt;

    if (!Number.isInteger(pidValue) || (pidValue ?? 0) <= 0) {
      return malformedInspection('pid is missing or invalid.');
    }
    if (typeof stageName !== 'string' || stageName.length === 0) {
      return malformedInspection('stageName is missing or invalid.');
    }
    if (typeof createdAt !== 'string' || createdAt.length === 0) {
      return malformedInspection('createdAt is missing or invalid.');
    }
    const pid = pidValue as number;

    return {
      exists: true,
      ownerPid: pid,
      isOwnerRunning: isPidRunning(pid),
      createdAt,
      stageName,
      error: null,
    };
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code === 'ENOENT') {
      return {
        exists: false,
        ownerPid: null,
        isOwnerRunning: false,
        createdAt: null,
        stageName: null,
        error: null,
      };
    }
    if (error instanceof SyntaxError) {
      return malformedInspection('JSON parse failed.');
    }

    return malformedInspection(typedError.message);
  }
}

export function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    return typedError.code === 'EPERM';
  }
}

function malformedInspection(reason: string): ProcessLockInspection {
  return {
    exists: true,
    ownerPid: null,
    isOwnerRunning: false,
    createdAt: null,
    stageName: null,
    error: reason,
  };
}
