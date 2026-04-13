import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  ProcessLockConflictError,
  acquireProcessLock,
  inspectProcessLock,
} from '../src/core/process-lock.js';
import { createTempRoot } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('runtime lock rejects a second acquisition and reports the owner pid honestly', async () => {
  const temp = await createTempRoot('stage-1-lock-');
  cleanups.push(temp.cleanup);

  const lockFilePath = join(temp.root, '.runtime', 'lock', 'runtime.lock.json');
  const firstLock = await acquireProcessLock(lockFilePath, 'stage-1');
  const inspection = await inspectProcessLock(lockFilePath);

  assert.equal(inspection.exists, true);
  assert.equal(inspection.ownerPid, process.pid);
  assert.equal(inspection.isOwnerRunning, true);

  await assert.rejects(
    acquireProcessLock(lockFilePath, 'stage-1'),
    (error: unknown) =>
      error instanceof ProcessLockConflictError &&
      error.ownerPid === process.pid &&
      error.message.includes(String(process.pid)),
  );

  await firstLock.release();
});
