import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { createTempRoot, waitFor } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];
const children: Array<ReturnType<typeof spawn>> = [];

afterEach(async () => {
  while (children.length > 0) {
    const child = children.pop();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  }

  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('second runtime process is rejected by the process lock with an honest error', async () => {
  const temp = await createTempRoot('stage-1-runtime-conflict-');
  cleanups.push(temp.cleanup);

  const runtimeRoot = join(temp.root, '.runtime');
  const env = {
    ...process.env,
    APP_STAGE_NAME: 'stage-1',
    APP_RUNTIME_ROOT: runtimeRoot,
    APP_SPREADSHEET_READ_ENABLED: 'false',
    APP_MIRROR_SYNC_ENABLED: 'false',
  };
  const cwd = process.cwd();

  const primary = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/fake-runtime-entry.ts'], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(primary);

  await waitFor(async () => {
    try {
      await access(join(runtimeRoot, 'lock', 'runtime.lock.json'));
      return true;
    } catch {
      return false;
    }
  }, 10_000);

  const secondary = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/fake-runtime-entry.ts'], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const secondaryStdout: Buffer[] = [];
  const secondaryStderr: Buffer[] = [];
  secondary.stdout.on('data', (chunk) => secondaryStdout.push(Buffer.from(chunk)));
  secondary.stderr.on('data', (chunk) => secondaryStderr.push(Buffer.from(chunk)));

  const secondaryExit = await new Promise<number | null>((resolve) => {
    secondary.once('exit', (code) => resolve(code));
  });

  assert.equal(secondaryExit, 1);

  const combinedOutput = `${Buffer.concat(secondaryStdout).toString('utf8')}${Buffer.concat(
    secondaryStderr,
  ).toString('utf8')}`;
  assert.match(combinedOutput, /Runtime lock already held by pid/);
});
