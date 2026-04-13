import test from 'node:test';
import assert from 'node:assert/strict';

import { getOfficialSuperAdminProfiles } from '../src/access/super-admin-seed.js';
import type { DynamicAdminRecord } from '../src/access/types.js';
import { parseAdminAddTarget, resolveAdminTarget } from '../src/command/admin-target-resolver.js';

test('admin target resolver parses add target with name and number honestly', () => {
  const parsed = parseAdminAddTarget('Rahma +62 812-1737-5459');

  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.target.displayName, 'Rahma');
    assert.equal(parsed.target.nameKey, 'rahma');
    assert.equal(parsed.target.normalizedPhoneNumber, '6281217375459');
  }
});

test('admin target resolver resolves by name, number, and combined name plus number', () => {
  const records = new Map<string, DynamicAdminRecord>([
    [
      '6281217375459',
      buildRecord('6281217375459', 'Rahma', true),
    ],
  ]);
  const superAdmins = getOfficialSuperAdminProfiles();

  const byName = resolveAdminTarget({
    rawInput: 'Rahma',
    registryRecords: records,
    superAdminProfiles: superAdmins,
  });
  const byNumber = resolveAdminTarget({
    rawInput: '+62 812-1737-5459',
    registryRecords: records,
    superAdminProfiles: superAdmins,
  });
  const byBoth = resolveAdminTarget({
    rawInput: 'rahma 6281217375459',
    registryRecords: records,
    superAdminProfiles: superAdmins,
  });

  assert.equal(byName.ok, true);
  assert.equal(byNumber.ok, true);
  assert.equal(byBoth.ok, true);
});

test('admin target resolver rejects mismatched name and number honestly', () => {
  const records = new Map<string, DynamicAdminRecord>([
    [
      '6281217375459',
      buildRecord('6281217375459', 'Rahma', true),
    ],
  ]);

  const resolved = resolveAdminTarget({
    rawInput: 'Rahma 6280000000000',
    registryRecords: records,
    superAdminProfiles: getOfficialSuperAdminProfiles(),
  });

  assert.deepEqual(resolved, {
    ok: false,
    reason: 'target_mismatch',
  });
});

function buildRecord(
  normalizedPhoneNumber: string,
  displayName: string,
  isActive: boolean,
): DynamicAdminRecord {
  return {
    normalizedPhoneNumber,
    displayName,
    nameKey: displayName.toLowerCase(),
    dmAccessEnabled: isActive,
    groupAccessEnabled: isActive,
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
    source: 'manual_seed',
  };
}
