import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getOfficialSuperAdminProfiles,
  getOfficialSuperAdminSeed,
  OFFICIAL_SUPER_ADMIN_NUMBERS,
} from '../src/access/super-admin-seed.js';

test('super admin seed falls back to official source when overrides are invalid', () => {
  const seed = getOfficialSuperAdminSeed(['+', 'abc', '']);

  assert.deepEqual(seed, [...OFFICIAL_SUPER_ADMIN_NUMBERS]);
});

test('super admin seed normalizes valid overrides without inventing bot numbers', () => {
  const seed = getOfficialSuperAdminSeed(['+62 811 222 333', '201507007785']);

  assert.deepEqual(seed, ['62811222333', '201507007785']);
});

test('super admin profiles expose stable labels for runtime display', () => {
  const profiles = getOfficialSuperAdminProfiles();

  assert.deepEqual(
    profiles.map((profile) => profile.displayName),
    ['Bot', 'Super Admin'],
  );
  assert.deepEqual(
    profiles.map((profile) => profile.nameKey),
    ['bot', 'super admin'],
  );
});
