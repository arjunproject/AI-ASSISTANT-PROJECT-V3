import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { getManagedSeedSuperAdminProfiles } from '../src/access/super-admin-seed.js';
import {
  inspectManagedSuperAdminRegistry,
  upsertManagedSuperAdminRecord,
  writeManagedSuperAdminRegistry,
} from '../src/access/super-admin-registry.js';
import { createTempRoot } from './test-helpers.js';

test('managed super admin registry seeds manager defaults when file does not exist', async () => {
  const temp = await createTempRoot('stage-5-super-admin-registry-seed-');
  try {
    const registryPath = join(temp.root, '.runtime', 'access', 'super-admin-registry.json');
    const inspection = await inspectManagedSuperAdminRegistry({
      registryFilePath: registryPath,
      seededProfiles: getManagedSeedSuperAdminProfiles(),
    });

    assert.equal(inspection.ready, true);
    assert.equal(inspection.activeCount, 1);
    assert.equal(inspection.superAdmins.get('201507007785')?.displayName, 'Super Admin');
    assert.equal(inspection.superAdmins.get('201507007785')?.isActive, true);
  } finally {
    await temp.cleanup();
  }
});

test('managed super admin registry persists founder-managed changes honestly', async () => {
  const temp = await createTempRoot('stage-5-super-admin-registry-write-');
  try {
    const registryPath = join(temp.root, '.runtime', 'access', 'super-admin-registry.json');
    const initial = await inspectManagedSuperAdminRegistry({
      registryFilePath: registryPath,
      seededProfiles: getManagedSeedSuperAdminProfiles(),
    });
    const nextRecord = {
      normalizedPhoneNumber: '628111222333',
      displayName: 'Rina',
      nameKey: 'rina',
      isActive: true,
      createdAt: '2026-04-10T00:00:00.000Z',
      updatedAt: '2026-04-10T00:00:00.000Z',
      source: 'test',
    };
    await writeManagedSuperAdminRegistry(
      registryPath,
      upsertManagedSuperAdminRecord([...initial.superAdmins.values()], nextRecord),
    );

    const inspection = await inspectManagedSuperAdminRegistry({
      registryFilePath: registryPath,
      seededProfiles: getManagedSeedSuperAdminProfiles(),
    });

    assert.equal(inspection.ready, true);
    assert.equal(inspection.activeCount, 2);
    assert.equal(inspection.superAdmins.get('628111222333')?.displayName, 'Rina');
  } finally {
    await temp.cleanup();
  }
});
