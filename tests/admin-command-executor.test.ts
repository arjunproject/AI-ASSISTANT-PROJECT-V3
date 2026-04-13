import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import type { WAMessage } from '@whiskeysockets/baileys';

import { inspectDynamicAdminRegistry } from '../src/access/admin-registry.js';
import { writeOfficialGroupWhitelist } from '../src/access/official-group-whitelist.js';
import type { AccessDecision } from '../src/access/types.js';
import { createAdminCommandExecutor } from '../src/command/admin-command-executor.js';
import { loadAppConfig } from '../src/config/app-config.js';
import { createLogger } from '../src/core/logger.js';
import { createRuntimeStateStore } from '../src/runtime/runtime-state-store.js';
import type { RuntimeIdentityResolutionSnapshot } from '../src/whatsapp/types.js';
import { createTempRoot } from './test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
});

test('super admin can manage named dynamic admins and natural postfix commands honestly', async () => {
  const temp = await createTempRoot('stage-4-admin-naming-executor-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root, stageName: 'stage-4' });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const replies: string[] = [];
  const executor = createAdminCommandExecutor({
    config,
    logger,
    runtimeStateStore,
    async sendReply(_chatJid, text) {
      replies.push(text);
    },
  });

  const managerResolution = buildResolution('201507007785');
  const managerDecision = buildDecision('super_admin', 'active_dynamic_super_admin', true, '201507007785');
  const founderResolution = buildResolution('6285655002277', true);
  const founderDecision = buildDecision('super_admin', 'official_super_admin', true, '6285655002277', true);

  await executor.processAllowedMessage(buildMessage('Admin add Rahma 62588689668'), managerResolution, managerDecision);
  await executor.processAllowedMessage(buildMessage('admin add Rahmah 6281234567890', 'cmd-rahmah'), managerResolution, managerDecision);
  await executor.processAllowedMessage(buildMessage('admin status Rahma', 'cmd-status-name'), managerResolution, managerDecision);
  await executor.processAllowedMessage(buildMessage('admin rahma off', 'cmd-off-name'), founderResolution, founderDecision);
  await executor.processAllowedMessage(buildMessage('admin on rahmA', 'cmd-on-name'), managerResolution, managerDecision);
  await executor.processAllowedMessage(buildMessage('admin status 62588689668', 'cmd-status-number'), managerResolution, managerDecision);
  await executor.processAllowedMessage(buildMessage('admin off Rahma 62588689668', 'cmd-off-both'), founderResolution, founderDecision);
  await executor.processAllowedMessage(buildMessage('admin rahma on', 'cmd-on-postfix'), managerResolution, managerDecision);
  await executor.processAllowedMessage(buildMessage('admin status Rahmah', 'cmd-status-rahmah'), managerResolution, managerDecision);
  await executor.processAllowedMessage(buildMessage('admin rahma remove', 'cmd-remove-name'), founderResolution, founderDecision);

  const registry = await inspectDynamicAdminRegistry(config.accessRegistryFilePath);
  assert.equal(registry.admins.has('62588689668'), false);
  assert.equal(registry.admins.get('6281234567890')?.displayName, 'Rahmah');
  assert.equal(registry.admins.get('6281234567890')?.nameKey, 'rahmah');

  assert.equal(replies[0], 'ADMIN_ADDED Rahma');
  assert.equal(replies[1], 'ADMIN_ADDED Rahmah');
  assert.equal(replies[2], 'STATUS Rahma dm:on group:on');
  assert.equal(replies[3], 'ADMIN_OFF Rahma');
  assert.equal(replies[4], 'ADMIN_ON Rahma');
  assert.equal(replies[5], 'STATUS Rahma dm:on group:on');
  assert.equal(replies[6], 'ADMIN_OFF Rahma');
  assert.equal(replies[7], 'ADMIN_ON Rahma');
  assert.equal(replies[8], 'STATUS Rahmah dm:on group:on');
  assert.equal(replies[9], 'ADMIN_REMOVED Rahma');

  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.lastCommandName, 'admin.remove');
  assert.equal(snapshot.lastCommandAllowed, true);
  assert.equal(snapshot.lastCommandReason, 'admin_removed');
  assert.equal(snapshot.lastCommandSender, '6285655002277');

  const logContents = await readFile(config.logFilePath, 'utf8');
  assert.match(logContents, /command\.detected/);
  assert.match(logContents, /command\.normalized/);
  assert.match(logContents, /command\.executed/);
});

test('name uniqueness and mismatched name plus number are rejected honestly', async () => {
  const temp = await createTempRoot('stage-4-admin-naming-uniqueness-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root, stageName: 'stage-4' });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const replies: string[] = [];
  const executor = createAdminCommandExecutor({
    config,
    logger,
    runtimeStateStore,
    async sendReply(_chatJid, text) {
      replies.push(text);
    },
  });

  const resolution = buildResolution('6285655002277', true);
  const accessDecision = buildDecision('super_admin', 'official_super_admin', true, '6285655002277', true);

  const added = await executor.processAllowedMessage(
    buildMessage('Admin add Rahma 62588689668'),
    resolution,
    accessDecision,
  );
  const duplicateName = await executor.processAllowedMessage(
    buildMessage('Admin add rahma 6281234567890', 'cmd-duplicate-name'),
    resolution,
    accessDecision,
  );
  const mismatch = await executor.processAllowedMessage(
    buildMessage('Admin off Rahma 6280000000000', 'cmd-mismatch'),
    resolution,
    accessDecision,
  );
  const invalidNumber = await executor.processAllowedMessage(
    buildMessage('Admin add NamaBaru 0812-12', 'cmd-invalid-number'),
    resolution,
    accessDecision,
  );

  assert.equal(added.allowed, true);
  assert.equal(duplicateName.allowed, false);
  assert.equal(duplicateName.reason, 'name_already_exists');
  assert.equal(mismatch.allowed, false);
  assert.equal(mismatch.reason, 'target_mismatch');
  assert.equal(invalidNumber.allowed, false);
  assert.equal(invalidNumber.reason, 'invalid_number');

  assert.equal(replies[0], 'ADMIN_ADDED Rahma');
  assert.equal(replies[1], 'NAME_ALREADY_EXISTS Rahma');
  assert.equal(replies[2], 'TARGET_MISMATCH');
  assert.equal(replies[3], 'INVALID_NUMBER');

  const registry = await inspectDynamicAdminRegistry(config.accessRegistryFilePath);
  assert.equal(registry.admins.size, 1);
  assert.equal(registry.admins.get('62588689668')?.displayName, 'Rahma');
});

test('super admin can control DM and group access modes independently', async () => {
  const temp = await createTempRoot('stage-4-admin-access-mode-executor-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root, stageName: 'stage-4' });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const replies: string[] = [];
  const executor = createAdminCommandExecutor({
    config,
    logger,
    runtimeStateStore,
    async sendReply(_chatJid, text) {
      replies.push(text);
    },
  });

  const managerResolution = buildResolution('201507007785');
  const managerDecision = buildDecision('super_admin', 'active_dynamic_super_admin', true, '201507007785');
  const founderResolution = buildResolution('6285655002277', true);
  const founderDecision = buildDecision('super_admin', 'official_super_admin', true, '6285655002277', true);

  await executor.processAllowedMessage(buildMessage('Admin add Rara 201128840078'), managerResolution, managerDecision);
  await executor.processAllowedMessage(buildMessage('Admin DM off Rara', 'cmd-dm-off'), founderResolution, founderDecision);
  await executor.processAllowedMessage(buildMessage('Admin status Rara', 'cmd-status-dm-off'), managerResolution, managerDecision);
  await executor.processAllowedMessage(buildMessage('Admin Group off Rara', 'cmd-group-off'), founderResolution, founderDecision);
  await executor.processAllowedMessage(buildMessage('Admin status Rara', 'cmd-status-group-off'), managerResolution, managerDecision);
  await executor.processAllowedMessage(buildMessage('Admin Group on Rara', 'cmd-group-on'), managerResolution, managerDecision);
  await executor.processAllowedMessage(buildMessage('Admin DM on Rara', 'cmd-dm-on'), managerResolution, managerDecision);
  await executor.processAllowedMessage(buildMessage('Admin list', 'cmd-list'), managerResolution, managerDecision);

  assert.deepEqual(replies, [
    'ADMIN_ADDED Rara',
    'ADMIN_DM_OFF Rara',
    'STATUS Rara dm:off group:on',
    'ADMIN_GROUP_OFF Rara',
    'STATUS Rara dm:off group:off',
    'ADMIN_GROUP_ON Rara',
    'ADMIN_DM_ON Rara',
    'SUPER_ADMIN\n- Bot founder:on\n- Super Admin command:on\nADMIN\n- Rara dm:on group:on',
  ]);
});

test('founder can manage managed super admins while non-founder super admin cannot mutate authority', async () => {
  const temp = await createTempRoot('stage-4-super-admin-authority-executor-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root, stageName: 'stage-4' });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const replies: string[] = [];
  const executor = createAdminCommandExecutor({
    config,
    logger,
    runtimeStateStore,
    async sendReply(_chatJid, text) {
      replies.push(text);
    },
  });

  const founderResolution = buildResolution('6285655002277', true);
  const founderDecision = buildDecision('super_admin', 'official_super_admin', true, '6285655002277', true);
  const managerResolution = buildResolution('201507007785');
  const managerDecision = buildDecision('super_admin', 'active_dynamic_super_admin', true, '201507007785');

  await executor.processAllowedMessage(
    buildMessage('superadmin add Rina 628111222333', 'cmd-superadmin-add'),
    founderResolution,
    founderDecision,
  );
  await executor.processAllowedMessage(
    buildMessage('superadmin status Rina', 'cmd-superadmin-status'),
    managerResolution,
    managerDecision,
  );
  await executor.processAllowedMessage(
    buildMessage('superadmin list', 'cmd-superadmin-list'),
    managerResolution,
    managerDecision,
  );
  await executor.processAllowedMessage(
    buildMessage('superadmin off Rina', 'cmd-superadmin-off-blocked'),
    managerResolution,
    managerDecision,
  );
  await executor.processAllowedMessage(
    buildMessage('admin off Rina', 'cmd-admin-off-blocked'),
    managerResolution,
    managerDecision,
  );
  await executor.processAllowedMessage(
    buildMessage('superadmin off Rina', 'cmd-superadmin-off-founder'),
    founderResolution,
    founderDecision,
  );
  await executor.processAllowedMessage(
    buildMessage('superadmin status Rina', 'cmd-superadmin-status-off'),
    founderResolution,
    founderDecision,
  );
  await executor.processAllowedMessage(
    buildMessage('superadmin remove Rina', 'cmd-superadmin-remove-founder'),
    founderResolution,
    founderDecision,
  );

  assert.deepEqual(replies, [
    'SUPER_ADMIN_ADDED Rina',
    'SUPER_ADMIN_STATUS Rina role:manager active:on',
    'SUPER_ADMIN\n- Bot founder:on\n- Rina command:on\n- Super Admin command:on',
    'FOUNDER_ONLY',
    'FOUNDER_ONLY',
    'SUPER_ADMIN_OFF Rina',
    'SUPER_ADMIN_STATUS Rina role:manager active:off',
    'SUPER_ADMIN_REMOVED Rina',
  ]);

  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.lastCommandName, 'superadmin.remove');
  assert.equal(snapshot.lastCommandAllowed, true);
  assert.equal(snapshot.lastCommandReason, 'super_admin_removed');
  assert.equal(snapshot.lastCommandSender, '6285655002277');
});

test('super admin identity stays protected from dynamic admin naming collisions', async () => {
  const temp = await createTempRoot('stage-4-admin-naming-super-admin-protected-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root, stageName: 'stage-4' });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const replies: string[] = [];
  const executor = createAdminCommandExecutor({
    config,
    logger,
    runtimeStateStore,
    async sendReply(_chatJid, text) {
      replies.push(text);
    },
  });

  const resolution = buildResolution('201507007785');
  const accessDecision = buildDecision('super_admin', 'active_dynamic_super_admin', true, '201507007785');

  const byNumber = await executor.processAllowedMessage(
    buildMessage('Admin add RahmaBot 6285655002277', 'cmd-super-admin-by-number'),
    resolution,
    accessDecision,
  );
  const byName = await executor.processAllowedMessage(
    buildMessage('Admin add Bot 628111222333', 'cmd-super-admin-by-name'),
    resolution,
    accessDecision,
  );

  assert.equal(byNumber.allowed, false);
  assert.equal(byNumber.reason, 'super_admin_protected');
  assert.equal(byName.allowed, false);
  assert.equal(byName.reason, 'super_admin_protected');
  assert.deepEqual(replies, ['SUPER_ADMIN_PROTECTED', 'SUPER_ADMIN_PROTECTED']);

  const registry = await inspectDynamicAdminRegistry(config.accessRegistryFilePath);
  assert.equal(registry.admins.size, 0);
});

test('active dynamic admin is still rejected honestly when trying admin command', async () => {
  const temp = await createTempRoot('stage-4-admin-naming-admin-rejected-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root, stageName: 'stage-4' });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const replies: string[] = [];
  const executor = createAdminCommandExecutor({
    config,
    logger,
    runtimeStateStore,
    async sendReply(_chatJid, text) {
      replies.push(text);
    },
  });

  const superAdminResolution = buildResolution('201507007785');
  const superAdminDecision = buildDecision('super_admin', 'active_dynamic_super_admin', true, '201507007785');
  await executor.processAllowedMessage(
    buildMessage('Admin add Rahma 62588689668', 'seed-admin'),
    superAdminResolution,
    superAdminDecision,
  );

  const resolution = buildResolution('62588689668');
  const accessDecision = buildDecision('admin', 'active_dynamic_admin', true, '62588689668');
  const result = await executor.processAllowedMessage(
    buildMessage('admin list', 'admin-msg-1'),
    resolution,
    accessDecision,
  );

  assert.equal(result.handled, true);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'forbidden_role');
  assert.equal(replies.at(-1), 'FORBIDDEN_ROLE');

  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.lastCommandName, 'admin.list');
  assert.equal(snapshot.lastCommandAllowed, false);
  assert.equal(snapshot.lastCommandReason, 'forbidden_role');
});

test('super admin can manage dynamic prompts through official whatsapp commands', async () => {
  const temp = await createTempRoot('stage-5-prompt-command-executor-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root, stageName: 'stage-5' });
  await writeOfficialGroupWhitelist(config.officialGroupWhitelistFilePath, {
    groupJid: '120363408735885184@g.us',
    groupName: 'ARJUN MOTOR PROJECT',
    inviteLink: 'https://chat.whatsapp.com/official',
    isActive: true,
    createdAt: '2026-04-11T00:00:00.000Z',
    updatedAt: '2026-04-11T00:00:00.000Z',
    source: 'test',
  });

  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const replies: string[] = [];
  const executor = createAdminCommandExecutor({
    config,
    logger,
    runtimeStateStore,
    async sendReply(_chatJid, text) {
      replies.push(text);
    },
  });

  const resolution = buildResolution('201507007785');
  const accessDecision = buildDecision('super_admin', 'active_dynamic_super_admin', true, '201507007785');

  await executor.processAllowedMessage(buildMessage('Prompt add', 'prompt-add-open'), resolution, accessDecision);
  await executor.processAllowedMessage(buildMessage([
    '• Nama prompt: Gaya Emoji',
    '• Isi prompt: Jawab singkat penuh emoji.',
    '• Target: Global',
    '• Daftar target:',
    '• Mode: dm+group',
    '• Priority: 10',
    '• Status: on',
  ].join('\n'), 'prompt-add-submit'), resolution, accessDecision);
  await executor.processAllowedMessage(buildMessage('Prompt list', 'prompt-list-1'), resolution, accessDecision);
  await executor.processAllowedMessage(buildMessage('Prompt show 1', 'prompt-show-1'), resolution, accessDecision);
  await executor.processAllowedMessage(buildMessage('Prompt edit 1', 'prompt-edit-open'), resolution, accessDecision);
  await executor.processAllowedMessage(buildMessage([
    'Prompt 1',
    '• Nama prompt: Gaya Emoji',
    '• Isi prompt: Jawab singkat, padat, jelas.',
    '• Target: spesifik',
    '• Daftar target: 628111222333',
    '• Mode: group only',
    '• Priority: 15',
    '• Status: on',
  ].join('\n'), 'prompt-edit-submit'), resolution, accessDecision);
  await executor.processAllowedMessage(buildMessage('Prompt off 1', 'prompt-off-1'), resolution, accessDecision);
  await executor.processAllowedMessage(buildMessage('Prompt on 1', 'prompt-on-1'), resolution, accessDecision);
  await executor.processAllowedMessage(buildMessage('Prompt edit 1', 'prompt-edit-open-2'), resolution, accessDecision);
  await executor.processAllowedMessage(buildMessage([
    'Prompt 1',
    '• Nama prompt: Gaya Emoji',
    '• Isi prompt: Jawab singkat, padat, jelas.',
    '• Target: Global',
    '• Daftar target:',
    '• Mode: dm only',
    '• Priority: 15',
    '• Status: on',
  ].join('\n'), 'prompt-edit-submit-2'), resolution, accessDecision);
  await executor.processAllowedMessage(buildMessage('Prompt remove 1', 'prompt-remove-1'), resolution, accessDecision);

  assert.equal(replies[0], [
    '• Nama prompt:',
    '• Isi prompt:',
    '• Target: Global/spesifik',
    '• Daftar target:',
    '• Mode: dm only/group only/dm+group',
    '• Priority:',
    '• Status: on/off',
  ].join('\n'));
  assert.equal(replies[1], 'PROMPT_ADDED 1 Gaya Emoji');
  assert.match(replies[2] ?? '', /^PROMPT\n1\. Gaya Emoji \| on \| global \| dm\+group \| p10$/);
  assert.match(replies[3] ?? '', /^PROMPT 1\nNama: Gaya Emoji/);
  assert.match(replies[3] ?? '', /Target: global/);
  assert.equal(replies[4], [
    'Prompt 1',
    '• Nama prompt: Gaya Emoji',
    '• Isi prompt: Jawab singkat penuh emoji.',
    '• Target: Global',
    '• Daftar target: ',
    '• Mode: dm+group',
    '• Priority: 10',
    '• Status: on',
  ].join('\n'));
  assert.equal(replies[5], 'PROMPT_UPDATED 1 Gaya Emoji');
  assert.equal(replies[6], 'PROMPT_OFF 1');
  assert.equal(replies[7], 'PROMPT_ON 1');
  assert.match(replies[8] ?? '', /^Prompt 1\n• Nama prompt: Gaya Emoji/);
  assert.equal(replies[9], 'PROMPT_UPDATED 1 Gaya Emoji');
  assert.equal(replies[10], 'PROMPT_REMOVED 1 Gaya Emoji');

  const promptRegistry = JSON.parse(await readFile(config.dynamicPromptRegistryFilePath, 'utf8')) as {
    prompts: Array<{ id: string }>;
  };
  assert.deepEqual(promptRegistry.prompts, []);

  const promptAudit = JSON.parse(await readFile(config.dynamicPromptAuditFilePath, 'utf8')) as {
    entries: Array<{ action: string; targetSnapshot: { targetType: string }; modeSnapshot: string }>;
  };
  assert.deepEqual(
    promptAudit.entries.map((entry) => entry.action),
    ['created', 'retargeted', 'deactivated', 'activated', 'retargeted', 'updated', 'removed'],
  );
  assert.equal(promptAudit.entries[1]?.targetSnapshot.targetType, 'specific');
  assert.equal(promptAudit.entries[1]?.modeSnapshot, 'group only');
  assert.equal(promptAudit.entries[4]?.targetSnapshot.targetType, 'global');
  assert.equal(promptAudit.entries[4]?.modeSnapshot, 'dm only');

  const snapshot = runtimeStateStore.getSnapshot();
  assert.equal(snapshot.lastCommandName, 'prompt.remove');
  assert.equal(snapshot.lastCommandAllowed, true);
  assert.equal(snapshot.lastCommandReason, 'prompt_removed');
  assert.equal(snapshot.dynamicPromptRegistryReady, true);
  assert.equal(snapshot.activeDynamicPromptCount, 0);
});

test('prompt commands stay super-admin-only', async () => {
  const temp = await createTempRoot('stage-5-prompt-command-forbidden-');
  cleanups.push(temp.cleanup);

  const config = loadAppConfig({ projectRoot: temp.root, stageName: 'stage-5' });
  const logger = createLogger(config.logFilePath);
  const runtimeStateStore = await createRuntimeStateStore(config);
  const replies: string[] = [];
  const executor = createAdminCommandExecutor({
    config,
    logger,
    runtimeStateStore,
    async sendReply(_chatJid, text) {
      replies.push(text);
    },
  });

  const resolution = buildResolution('62588689668');
  const accessDecision = buildDecision('admin', 'active_dynamic_admin', true, '62588689668');
  const result = await executor.processAllowedMessage(
    buildMessage('Prompt list', 'prompt-admin-forbidden'),
    resolution,
    accessDecision,
  );

  assert.equal(result.handled, true);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'forbidden_role');
  assert.equal(replies[0], 'FORBIDDEN_ROLE');
});

function buildMessage(text: string, id = 'cmd-msg-1'): WAMessage {
  return {
    key: {
      id,
      remoteJid: '18687553736945@lid',
      fromMe: false,
    },
    message: {
      conversation: text,
    },
  } as WAMessage;
}

function buildResolution(
  normalizedSender: string,
  isFromSelf = false,
): RuntimeIdentityResolutionSnapshot {
  return {
    observedAt: '2026-04-10T00:00:00.000Z',
    chatJid: isFromSelf ? '18687553736945@lid' : `${normalizedSender}@s.whatsapp.net`,
    senderJid: `${normalizedSender}@s.whatsapp.net`,
    normalizedSender,
    senderPn: normalizedSender,
    senderLid: null,
    botNumber: '6285655002277',
    botJid: '6285655002277@s.whatsapp.net',
    botLid: '18687553736945@lid',
    remoteJid: isFromSelf ? '18687553736945@lid' : `${normalizedSender}@s.whatsapp.net`,
    participant: null,
    keyParticipant: null,
    contextParticipant: null,
    explicitSenderPn: null,
    isFromSelf,
    isGroup: false,
    source: isFromSelf ? 'self' : 'remote_jid',
  };
}

function buildDecision(
  role: AccessDecision['role'],
  reason: AccessDecision['reason'],
  isAllowed: boolean,
  normalizedSender: string,
  isFromSelf = false,
): AccessDecision {
  return {
    evaluatedAt: '2026-04-10T00:00:00.000Z',
    isAllowed,
    role,
    reason,
    chatContextType: 'dm',
    chatAccessAllowed: true,
    chatAccessReason: 'direct_message',
    normalizedSender,
    senderJid: `${normalizedSender}@s.whatsapp.net`,
    chatJid: isFromSelf ? '18687553736945@lid' : `${normalizedSender}@s.whatsapp.net`,
    isFromSelf,
    isGroup: false,
  };
}
