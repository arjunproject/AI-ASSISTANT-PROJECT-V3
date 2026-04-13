import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { clearSessionStore, inspectSessionStore, seedSessionCreds } from '../src/whatsapp/session-store.js';
import { createTempRoot } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('session store is persistent in a single local auth directory', async () => {
  const temp = await createTempRoot('stage-1-session-store-');
  cleanups.push(temp.cleanup);

  const authDir = join(temp.root, '.runtime', 'whatsapp', 'auth');
  const initial = await inspectSessionStore(authDir);
  assert.equal(initial.ready, true);
  assert.equal(initial.present, false);

  await seedSessionCreds(authDir, { registrationId: 12345 });
  const persisted = await inspectSessionStore(authDir);
  assert.equal(persisted.ready, true);
  assert.equal(persisted.present, true);

  await clearSessionStore(authDir);
  const cleared = await inspectSessionStore(authDir);
  assert.equal(cleared.ready, true);
  assert.equal(cleared.present, false);
});

test('session store inspection rejects corrupted creds.json honestly', async () => {
  const temp = await createTempRoot('stage-1-session-store-invalid-');
  cleanups.push(temp.cleanup);

  const authDir = join(temp.root, '.runtime', 'whatsapp', 'auth');
  await mkdir(authDir, { recursive: true });
  await writeFile(join(authDir, 'creds.json'), '{ broken-json', 'utf8');

  const inspection = await inspectSessionStore(authDir);
  assert.equal(inspection.ready, false);
  assert.equal(inspection.present, true);
  assert.match(inspection.error ?? '', /JSON/);
});
