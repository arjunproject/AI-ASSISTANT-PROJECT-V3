import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import { inspectDynamicAdminRegistry, writeDynamicAdminRegistry } from '../src/access/admin-registry.js';
import { createTempRoot } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('dynamic admin registry is ready and empty when file is absent', async () => {
  const temp = await createTempRoot('stage-3-admin-registry-empty-');
  cleanups.push(temp.cleanup);
  const registryPath = join(temp.root, '.runtime', 'access', 'admin-registry.json');

  const inspection = await inspectDynamicAdminRegistry(registryPath);

  assert.equal(inspection.ready, true);
  assert.equal(inspection.activeCount, 0);
  assert.equal(inspection.admins.size, 0);
  assert.equal(inspection.error, null);
});

test('dynamic admin registry reads active and inactive records honestly', async () => {
  const temp = await createTempRoot('stage-3-admin-registry-read-');
  cleanups.push(temp.cleanup);
  const registryPath = join(temp.root, '.runtime', 'access', 'admin-registry.json');

  await writeDynamicAdminRegistry(registryPath, [
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
    {
      normalizedPhoneNumber: '628444555666',
      displayName: 'Rahmah',
      nameKey: 'rahmah',
      dmAccessEnabled: false,
      groupAccessEnabled: false,
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z',
      source: 'manual_seed',
    },
  ]);

  const inspection = await inspectDynamicAdminRegistry(registryPath);

  assert.equal(inspection.ready, true);
  assert.equal(inspection.activeCount, 1);
  assert.equal(inspection.admins.get('628111222333')?.dmAccessEnabled, true);
  assert.equal(inspection.admins.get('628111222333')?.groupAccessEnabled, true);
  assert.equal(inspection.admins.get('628111222333')?.displayName, 'Rahma');
  assert.equal(inspection.adminsByNameKey.get('rahma')?.normalizedPhoneNumber, '628111222333');
  assert.equal(inspection.admins.get('628444555666')?.dmAccessEnabled, false);
  assert.equal(inspection.admins.get('628444555666')?.groupAccessEnabled, false);
});

test('dynamic admin registry fails closed when file is corrupted', async () => {
  const temp = await createTempRoot('stage-3-admin-registry-broken-');
  cleanups.push(temp.cleanup);
  const registryDir = join(temp.root, '.runtime', 'access');
  const registryPath = join(registryDir, 'admin-registry.json');
  await mkdir(registryDir, { recursive: true });
  await writeFile(registryPath, '{ broken-json', 'utf8');

  const inspection = await inspectDynamicAdminRegistry(registryPath);

  assert.equal(inspection.ready, false);
  assert.equal(inspection.activeCount, 0);
  assert.equal(inspection.admins.size, 0);
  assert.match(inspection.error ?? '', /Unexpected token|Expected property name/);
});

test('dynamic admin registry migrates legacy records without displayName and nameKey honestly', async () => {
  const temp = await createTempRoot('stage-4-admin-registry-legacy-');
  cleanups.push(temp.cleanup);
  const registryDir = join(temp.root, '.runtime', 'access');
  const registryPath = join(registryDir, 'admin-registry.json');
  await mkdir(registryDir, { recursive: true });
  await writeFile(
    registryPath,
    `${JSON.stringify(
      {
        admins: [
          {
            normalizedPhoneNumber: '628111222333',
            dmAccessEnabled: true,
            groupAccessEnabled: true,
            createdAt: '2026-04-10T00:00:00.000Z',
            updatedAt: '2026-04-10T00:00:00.000Z',
            source: 'legacy_seed',
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const inspection = await inspectDynamicAdminRegistry(registryPath);

  assert.equal(inspection.ready, true);
  assert.equal(inspection.admins.get('628111222333')?.displayName, '628111222333');
  assert.equal(inspection.admins.get('628111222333')?.nameKey, '628111222333');
});

test('dynamic admin registry migrates legacy isActive into DM and group access honestly', async () => {
  const temp = await createTempRoot('stage-4-admin-registry-legacy-access-');
  cleanups.push(temp.cleanup);
  const registryDir = join(temp.root, '.runtime', 'access');
  const registryPath = join(registryDir, 'admin-registry.json');
  await mkdir(registryDir, { recursive: true });
  await writeFile(
    registryPath,
    `${JSON.stringify(
      {
        admins: [
          {
            normalizedPhoneNumber: '628111222333',
            displayName: 'Rahma',
            nameKey: 'rahma',
            isActive: false,
            createdAt: '2026-04-10T00:00:00.000Z',
            updatedAt: '2026-04-10T00:00:00.000Z',
            source: 'legacy_seed',
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const inspection = await inspectDynamicAdminRegistry(registryPath);

  assert.equal(inspection.ready, true);
  assert.equal(inspection.admins.get('628111222333')?.dmAccessEnabled, false);
  assert.equal(inspection.admins.get('628111222333')?.groupAccessEnabled, false);
});

test('dynamic admin registry fails closed when two records reuse the same nameKey', async () => {
  const temp = await createTempRoot('stage-4-admin-registry-duplicate-name-');
  cleanups.push(temp.cleanup);
  const registryDir = join(temp.root, '.runtime', 'access');
  const registryPath = join(registryDir, 'admin-registry.json');
  await mkdir(registryDir, { recursive: true });
  await writeFile(
    registryPath,
    `${JSON.stringify(
      {
        admins: [
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
          {
            normalizedPhoneNumber: '628444555666',
            displayName: 'rahmA',
            nameKey: 'rahma',
            dmAccessEnabled: true,
            groupAccessEnabled: true,
            createdAt: '2026-04-10T00:00:00.000Z',
            updatedAt: '2026-04-10T00:00:00.000Z',
            source: 'manual_seed',
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const inspection = await inspectDynamicAdminRegistry(registryPath);

  assert.equal(inspection.ready, false);
  assert.match(inspection.error ?? '', /duplicate name rahma/i);
});
