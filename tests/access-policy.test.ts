import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { DynamicAdminRegistryInspection } from '../src/access/admin-registry.js';
import type { OfficialGroupWhitelistInspection } from '../src/access/official-group-whitelist.js';
import type { ManagedSuperAdminRegistryInspection } from '../src/access/super-admin-registry.js';
import { evaluateAccessPolicy } from '../src/access/access-policy.js';
import type { RuntimeIdentityResolutionSnapshot } from '../src/whatsapp/types.js';

test('access policy always allows active managed super admin in DM', () => {
  const decision = evaluateAccessPolicy(
    buildIdentity({
      normalizedSender: '201507007785',
      senderJid: '201507007785@s.whatsapp.net',
      isFromSelf: false,
      isGroup: false,
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: managedSuperAdminsWith('201507007785', true),
      registry: emptyRegistry(),
      officialGroup: officialGroup(),
    },
  );

  assert.equal(decision.isAllowed, true);
  assert.equal(decision.role, 'super_admin');
  assert.equal(decision.reason, 'active_dynamic_super_admin');
  assert.equal(decision.chatContextType, 'dm');
});

test('access policy allows active managed super admin in official group and denies other groups', () => {
  const allowed = evaluateAccessPolicy(
    buildIdentity({
      chatJid: '120363408735885184@g.us',
      remoteJid: '120363408735885184@g.us',
      participant: '201507007785@s.whatsapp.net',
      senderJid: '201507007785@s.whatsapp.net',
      normalizedSender: '201507007785',
      isGroup: true,
      source: 'participant',
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: managedSuperAdminsWith('201507007785', true),
      registry: emptyRegistry(),
      officialGroup: officialGroup(),
    },
  );
  const denied = evaluateAccessPolicy(
    buildIdentity({
      chatJid: '120363000000000000@g.us',
      remoteJid: '120363000000000000@g.us',
      participant: '201507007785@s.whatsapp.net',
      senderJid: '201507007785@s.whatsapp.net',
      normalizedSender: '201507007785',
      isGroup: true,
      source: 'participant',
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: managedSuperAdminsWith('201507007785', true),
      registry: emptyRegistry(),
      officialGroup: officialGroup(),
    },
  );

  assert.equal(allowed.isAllowed, true);
  assert.equal(allowed.reason, 'active_dynamic_super_admin');
  assert.equal(allowed.chatAccessReason, 'official_group');

  assert.equal(denied.isAllowed, false);
  assert.equal(denied.role, 'super_admin');
  assert.equal(denied.reason, 'group_not_whitelisted');
  assert.equal(denied.chatAccessReason, 'group_not_whitelisted');
});

test('access policy allows active managed super admin and denies inactive one honestly', () => {
  const allowed = evaluateAccessPolicy(
    buildIdentity({
      normalizedSender: '628111222333',
      senderJid: '628111222333@s.whatsapp.net',
      isGroup: false,
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: managedSuperAdminsWith('628111222333', true),
      registry: emptyRegistry(),
      officialGroup: officialGroup(),
    },
  );

  const denied = evaluateAccessPolicy(
    buildIdentity({
      normalizedSender: '628111222333',
      senderJid: '628111222333@s.whatsapp.net',
      isGroup: false,
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: managedSuperAdminsWith('628111222333', false),
      registry: emptyRegistry(),
      officialGroup: officialGroup(),
    },
  );

  assert.equal(allowed.isAllowed, true);
  assert.equal(allowed.role, 'super_admin');
  assert.equal(allowed.reason, 'active_dynamic_super_admin');

  assert.equal(denied.isAllowed, false);
  assert.equal(denied.role, 'non_admin');
  assert.equal(denied.reason, 'not_in_whitelist');
});

test('access policy allows dynamic admin in DM and official group when both access modes are enabled', () => {
  const dmDecision = evaluateAccessPolicy(
    buildIdentity({
      normalizedSender: '628111222333',
      senderJid: '628111222333@s.whatsapp.net',
      isGroup: false,
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: emptyManagedSuperAdmins(),
      registry: registryWith('628111222333', { dm: true, group: true }),
      officialGroup: officialGroup(),
    },
  );
  const groupDecision = evaluateAccessPolicy(
    buildIdentity({
      chatJid: '120363408735885184@g.us',
      remoteJid: '120363408735885184@g.us',
      participant: '628111222333@s.whatsapp.net',
      senderJid: '628111222333@s.whatsapp.net',
      normalizedSender: '628111222333',
      isGroup: true,
      source: 'participant',
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: emptyManagedSuperAdmins(),
      registry: registryWith('628111222333', { dm: true, group: true }),
      officialGroup: officialGroup(),
    },
  );

  assert.equal(dmDecision.isAllowed, true);
  assert.equal(dmDecision.reason, 'active_dynamic_admin');
  assert.equal(groupDecision.isAllowed, true);
  assert.equal(groupDecision.reason, 'active_dynamic_admin');
});

test('access policy denies DM when dynamic admin DM mode is disabled but group mode stays enabled', () => {
  const dmDecision = evaluateAccessPolicy(
    buildIdentity({
      normalizedSender: '628111222333',
      senderJid: '628111222333@s.whatsapp.net',
      isGroup: false,
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: emptyManagedSuperAdmins(),
      registry: registryWith('628111222333', { dm: false, group: true }),
      officialGroup: officialGroup(),
    },
  );
  const groupDecision = evaluateAccessPolicy(
    buildIdentity({
      chatJid: '120363408735885184@g.us',
      remoteJid: '120363408735885184@g.us',
      participant: '628111222333@s.whatsapp.net',
      senderJid: '628111222333@s.whatsapp.net',
      normalizedSender: '628111222333',
      isGroup: true,
      source: 'participant',
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: emptyManagedSuperAdmins(),
      registry: registryWith('628111222333', { dm: false, group: true }),
      officialGroup: officialGroup(),
    },
  );

  assert.equal(dmDecision.isAllowed, false);
  assert.equal(dmDecision.role, 'admin');
  assert.equal(dmDecision.reason, 'dm_access_disabled');

  assert.equal(groupDecision.isAllowed, true);
  assert.equal(groupDecision.reason, 'active_dynamic_admin');
});

test('access policy denies official group when dynamic admin group mode is disabled', () => {
  const decision = evaluateAccessPolicy(
    buildIdentity({
      chatJid: '120363408735885184@g.us',
      remoteJid: '120363408735885184@g.us',
      participant: '628111222333@s.whatsapp.net',
      senderJid: '628111222333@s.whatsapp.net',
      normalizedSender: '628111222333',
      isGroup: true,
      source: 'participant',
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: emptyManagedSuperAdmins(),
      registry: registryWith('628111222333', { dm: true, group: false }),
      officialGroup: officialGroup(),
    },
  );

  assert.equal(decision.isAllowed, false);
  assert.equal(decision.role, 'admin');
  assert.equal(decision.reason, 'group_access_disabled');
});

test('access policy denies non-admin outside whitelist honestly', () => {
  const decision = evaluateAccessPolicy(
    buildIdentity({
      normalizedSender: '628999888777',
      senderJid: '628999888777@s.whatsapp.net',
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: emptyManagedSuperAdmins(),
      registry: emptyRegistry(),
      officialGroup: officialGroup(),
    },
  );

  assert.equal(decision.isAllowed, false);
  assert.equal(decision.role, 'non_admin');
  assert.equal(decision.reason, 'not_in_whitelist');
});

test('access policy denies unresolved sender honestly', () => {
  const decision = evaluateAccessPolicy(null, {
    founderSuperAdminNumber: '6285655002277',
    managedSuperAdmins: emptyManagedSuperAdmins(),
    registry: emptyRegistry(),
    officialGroup: officialGroup(),
  });

  assert.equal(decision.isAllowed, false);
  assert.equal(decision.role, 'non_admin');
  assert.equal(decision.reason, 'unresolved_sender');
});

test('access policy denies invalid sender honestly', () => {
  const decision = evaluateAccessPolicy(
    buildIdentity({
      normalizedSender: null,
      senderJid: '233775120281687@lid',
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: emptyManagedSuperAdmins(),
      registry: emptyRegistry(),
      officialGroup: officialGroup(),
    },
  );

  assert.equal(decision.isAllowed, false);
  assert.equal(decision.role, 'non_admin');
  assert.equal(decision.reason, 'invalid_sender');
});

test('access policy fails closed when official group whitelist is not ready', () => {
  const decision = evaluateAccessPolicy(
    buildIdentity({
      chatJid: '120363408735885184@g.us',
      remoteJid: '120363408735885184@g.us',
      participant: '628111222333@s.whatsapp.net',
      senderJid: '628111222333@s.whatsapp.net',
      normalizedSender: '628111222333',
      isGroup: true,
      source: 'participant',
    }),
    {
      founderSuperAdminNumber: '6285655002277',
      managedSuperAdmins: emptyManagedSuperAdmins(),
      registry: registryWith('628111222333', { dm: true, group: true }),
      officialGroup: {
        ready: false,
        filePath: 'memory',
        group: null,
        error: 'Official group whitelist file is missing.',
      },
    },
  );

  assert.equal(decision.isAllowed, false);
  assert.equal(decision.reason, 'official_group_whitelist_not_ready');
  assert.equal(decision.chatAccessReason, 'official_group_whitelist_not_ready');
});

function buildIdentity(
  overrides: Partial<RuntimeIdentityResolutionSnapshot>,
): RuntimeIdentityResolutionSnapshot {
  return {
    observedAt: '2026-04-10T00:00:00.000Z',
    chatJid: '628111222333@s.whatsapp.net',
    senderJid: '628111222333@s.whatsapp.net',
    normalizedSender: '628111222333',
    senderPn: '628111222333',
    senderLid: null,
    botNumber: '6285655002277',
    botJid: '6285655002277@s.whatsapp.net',
    botLid: '18687553736945@lid',
    remoteJid: '628111222333@s.whatsapp.net',
    participant: null,
    keyParticipant: null,
    contextParticipant: null,
    explicitSenderPn: null,
    isFromSelf: false,
    isGroup: false,
    source: 'remote_jid',
    ...overrides,
  };
}

function emptyManagedSuperAdmins(): ManagedSuperAdminRegistryInspection {
  return {
    ready: true,
    filePath: 'memory',
    activeCount: 0,
    superAdmins: new Map(),
    superAdminsByNameKey: new Map(),
    error: null,
  };
}

function managedSuperAdminsWith(
  normalizedPhoneNumber: string,
  isActive: boolean,
): ManagedSuperAdminRegistryInspection {
  const record = {
    normalizedPhoneNumber,
    displayName: normalizedPhoneNumber,
    nameKey: normalizedPhoneNumber,
    isActive,
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
    source: 'test',
  };

  return {
    ready: true,
    filePath: 'memory',
    activeCount: isActive ? 1 : 0,
    superAdmins: new Map([[normalizedPhoneNumber, record]]),
    superAdminsByNameKey: new Map([[record.nameKey, record]]),
    error: null,
  };
}

function emptyRegistry(): DynamicAdminRegistryInspection {
  return {
    ready: true,
    filePath: 'memory',
    activeCount: 0,
    admins: new Map(),
    adminsByNameKey: new Map(),
    error: null,
  };
}

function registryWith(
  normalizedPhoneNumber: string,
  access: { dm: boolean; group: boolean },
): DynamicAdminRegistryInspection {
  const record = {
    normalizedPhoneNumber,
    displayName: normalizedPhoneNumber,
    nameKey: normalizedPhoneNumber,
    dmAccessEnabled: access.dm,
    groupAccessEnabled: access.group,
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
    source: 'test',
  };

  return {
    ready: true,
    filePath: 'memory',
    activeCount: access.dm || access.group ? 1 : 0,
    admins: new Map([[normalizedPhoneNumber, record]]),
    adminsByNameKey: new Map([[record.nameKey, record]]),
    error: null,
  };
}

function officialGroup(): OfficialGroupWhitelistInspection {
  return {
    ready: true,
    filePath: 'memory',
    group: {
      groupJid: '120363408735885184@g.us',
      groupName: 'ARJUN MOTOR PROJECT',
      inviteLink: 'https://chat.whatsapp.com/HYzFzg2J0qE6LUcTOVzlp3',
      isActive: true,
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
      source: 'test',
    },
    error: null,
  };
}
