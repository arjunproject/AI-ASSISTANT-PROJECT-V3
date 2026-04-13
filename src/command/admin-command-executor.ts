import type { WAMessage } from '@whiskeysockets/baileys';

import { inspectDynamicAdminRegistry, writeDynamicAdminRegistry } from '../access/admin-registry.js';
import {
  getFounderSuperAdminNumber,
  getManagedSeedSuperAdminProfiles,
  getOfficialSuperAdminProfiles,
  type OfficialSuperAdminProfile,
} from '../access/super-admin-seed.js';
import {
  inspectManagedSuperAdminRegistry,
  upsertManagedSuperAdminRecord,
  writeManagedSuperAdminRegistry,
} from '../access/super-admin-registry.js';
import type { AccessDecision, DynamicAdminRecord, ManagedSuperAdminRecord } from '../access/types.js';
import type { AppConfig } from '../config/app-config.js';
import type { Logger } from '../core/logger.js';
import type { RuntimeStateStore } from '../runtime/runtime-state-store.js';
import type { RuntimeIdentityResolutionSnapshot } from '../whatsapp/types.js';
import { parseAdminAddTarget, resolveAdminTarget } from './admin-target-resolver.js';
import { buildAdminHelpText } from './command-registry.js';
import { parseOfficialCommandMessage } from './command-parser.js';
import { createPromptCommandService } from './prompt-command-service.js';
import type {
  AdminCommandName,
  CommandExecutionContext,
  CommandExecutionReason,
  CommandResult,
  CommandStatePatch,
} from './types.js';

export interface AdminCommandExecutor {
  processAllowedMessage(
    message: WAMessage,
    resolvedIdentity: RuntimeIdentityResolutionSnapshot | null,
    accessDecision: AccessDecision,
  ): Promise<CommandResult>;
}

export function createAdminCommandExecutor(dependencies: {
  config: AppConfig;
  logger: Logger;
  runtimeStateStore: RuntimeStateStore;
  sendReply(chatJid: string, text: string, quotedMessage: WAMessage): Promise<void>;
}): AdminCommandExecutor {
  const { config, logger, runtimeStateStore, sendReply } = dependencies;
  const officialSuperAdminProfiles = getOfficialSuperAdminProfiles(config.superAdminNumbers);
  const founderSuperAdminNumber = getFounderSuperAdminNumber(config.superAdminNumbers);
  const founderSuperAdminProfile = officialSuperAdminProfiles[0] ?? null;
  const promptCommandService = createPromptCommandService({
    config,
    runtimeStateStore,
  });

  return {
    async processAllowedMessage(message, resolvedIdentity, accessDecision) {
      const parseResult = parseOfficialCommandMessage(message);
      if (accessDecision.role === 'super_admin' && parseResult.kind !== 'command') {
        const draftOutcome = await promptCommandService.handleDraftReply(
          {
            actor: accessDecision.normalizedSender ?? accessDecision.senderJid ?? 'unknown',
            actorNumber: accessDecision.normalizedSender ?? accessDecision.senderJid ?? 'unknown',
            chatJid: accessDecision.chatJid ?? accessDecision.senderJid ?? 'unknown-chat',
          },
          parseResult.rawText,
        );

        if (draftOutcome.handled) {
          const context = buildContext(message, accessDecision);
          const handledPromptCommandName = draftOutcome.commandName ?? 'prompt.add';
          if (draftOutcome.allowed) {
            return executeCommand({
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              registryReady: true,
              commandName: handledPromptCommandName,
              reason: draftOutcome.reason,
              replyText: draftOutcome.replyText,
            });
          }

          return rejectCommand({
            runtimeStateStore,
            logger,
            message,
            context,
            sendReply,
            registryReady: true,
            commandName: handledPromptCommandName,
            reason: draftOutcome.reason,
            replyText: draftOutcome.replyText,
          });
        }
      }

      if (parseResult.kind === 'not_command') {
        return {
          handled: false,
          commandName: null,
          allowed: null,
          reason: null,
          replyText: null,
        };
      }

      const context = buildContext(message, accessDecision);
      const commandName = parseResult.kind === 'command' ? parseResult.parsed.definition.name : null;
      const rawText = parseResult.kind === 'command' ? parseResult.parsed.rawText : parseResult.rawText;
      const normalizedText =
        parseResult.kind === 'command' ? parseResult.parsed.normalizedText : parseResult.normalizedText;
      logger.info('command.detected', {
        messageId: context.messageId,
        commandName,
        rawText,
        normalizedText,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        chatJid: context.chatJid,
        role: context.senderRole,
        isFromSelf: context.isFromSelf,
        isGroup: context.isGroup,
      });

      if (parseResult.kind === 'invalid_command') {
        return rejectCommand({
          runtimeStateStore,
          logger,
          message,
          context,
          sendReply,
          registryReady: true,
          commandName: null,
          reason: accessDecision.role === 'super_admin' ? 'unknown_command' : 'forbidden_role',
          replyText:
            accessDecision.role === 'super_admin'
              ? 'UNKNOWN_COMMAND'
              : 'FORBIDDEN_ROLE',
        });
      }

      const { parsed } = parseResult;
      logger.info('command.normalized', {
        messageId: context.messageId,
        commandName: parsed.definition.name,
        canonicalCommand: parsed.definition.canonical,
        normalizedText: parsed.normalizedText,
        argsText: parsed.argsText,
        rawArgsText: parsed.rawArgsText,
        senderJid: context.senderJid,
        normalizedSender: context.normalizedSender,
        chatJid: context.chatJid,
        role: context.senderRole,
      });

      if (accessDecision.role !== 'super_admin') {
        return rejectCommand({
          runtimeStateStore,
          logger,
          message,
          context,
          sendReply,
          registryReady: true,
          commandName: parsed.definition.name,
          reason: 'forbidden_role',
          replyText: 'FORBIDDEN_ROLE',
        });
      }

      if (isPromptCommandName(parsed.definition.name)) {
        try {
          const promptActor = context.normalizedSender ?? context.senderJid ?? 'unknown';
          const promptOutcome = await handlePromptCommand({
            promptCommandName: parsed.definition.name,
            promptCommandService,
            actorContext: {
              actor: promptActor,
              actorNumber: context.normalizedSender ?? context.senderJid ?? promptActor,
              chatJid: context.chatJid ?? context.senderJid ?? 'unknown-chat',
            },
            argsText: parsed.rawArgsText ?? parsed.argsText,
          });

          if (promptOutcome.allowed) {
            return executeCommand({
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              registryReady: true,
              commandName: parsed.definition.name,
              reason: promptOutcome.reason,
              replyText: promptOutcome.replyText,
            });
          }

          return rejectCommand({
            runtimeStateStore,
            logger,
            message,
            context,
            sendReply,
            registryReady: true,
            commandName: parsed.definition.name,
            reason: promptOutcome.reason,
            replyText: promptOutcome.replyText,
          });
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          logger.error('command.error', {
            messageId: context.messageId,
            commandName: parsed.definition.name,
            senderJid: context.senderJid,
            normalizedSender: context.normalizedSender,
            chatJid: context.chatJid,
            message: messageText,
            error,
          });
          return rejectCommand({
            runtimeStateStore,
            logger,
            message,
            context,
            sendReply,
            registryReady: true,
            commandName: parsed.definition.name,
            reason: 'internal_error',
            replyText: 'INTERNAL_ERROR',
          });
        }
      }

      const registry = await inspectDynamicAdminRegistry(config.accessRegistryFilePath);
      const managedSuperAdmins = await inspectManagedSuperAdminRegistry({
        registryFilePath: config.superAdminRegistryFilePath,
        seededProfiles: getManagedSeedSuperAdminProfiles(config.superAdminNumbers),
      });
      const superAdminProfiles = buildActiveSuperAdminProfiles(founderSuperAdminProfile, managedSuperAdmins);
      await runtimeStateStore.update({
        commandRegistryReady: registry.ready && managedSuperAdmins.ready,
      });

      if (!registry.ready || !managedSuperAdmins.ready) {
        logger.warn('command.error', {
          messageId: context.messageId,
          commandName: parsed.definition.name,
          senderJid: context.senderJid,
          normalizedSender: context.normalizedSender,
          chatJid: context.chatJid,
          message: registry.error ?? managedSuperAdmins.error,
          registryFilePath: !registry.ready ? config.accessRegistryFilePath : config.superAdminRegistryFilePath,
        });
        return rejectCommand({
          runtimeStateStore,
          logger,
          message,
          context,
          sendReply,
          registryReady: false,
          commandName: parsed.definition.name,
          reason: 'registry_not_ready',
          replyText: 'REGISTRY_NOT_READY',
        });
      }

      if (isFounderOnlyCommand(parsed.definition.name) && !isFounderActor(context.normalizedSender, founderSuperAdminNumber)) {
        return rejectCommand({
          runtimeStateStore,
          logger,
          message,
          context,
          sendReply,
          registryReady: true,
          commandName: parsed.definition.name,
          reason: 'founder_only',
          replyText: 'FOUNDER_ONLY',
        });
      }

      try {
        switch (parsed.definition.name) {
          case 'superadmin.help':
            return executeCommand({
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              registryReady: true,
              commandName: parsed.definition.name,
              reason: 'help_reported',
              replyText: buildSuperAdminHelpText(),
            });
          case 'superadmin.list':
            return executeCommand({
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              registryReady: true,
              commandName: parsed.definition.name,
              reason: 'list_reported',
              replyText: buildSuperAdminListReply(founderSuperAdminProfile, [...managedSuperAdmins.superAdmins.values()]),
            });
          case 'superadmin.status':
            return handleManagedSuperAdminStatusCommand({
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              targetInput: parsed.rawArgsText ?? parsed.argsText,
              founderSuperAdminProfile,
              managedSuperAdminRecords: managedSuperAdmins.superAdmins,
            });
          case 'superadmin.add':
            return handleManagedSuperAdminAddCommand({
              config,
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              targetInput: parsed.rawArgsText ?? parsed.argsText,
              founderSuperAdminProfile,
              managedSuperAdminRecords: managedSuperAdmins.superAdmins,
              managedSuperAdminRecordsByNameKey: managedSuperAdmins.superAdminsByNameKey,
              registryRecords: registry.admins,
              registryRecordsByNameKey: registry.adminsByNameKey,
            });
          case 'superadmin.on':
          case 'superadmin.off':
          case 'superadmin.remove':
            return handleManagedSuperAdminUpdateCommand({
              action: parsed.definition.name,
              config,
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              targetInput: parsed.rawArgsText ?? parsed.argsText,
              founderSuperAdminProfile,
              managedSuperAdminRecords: managedSuperAdmins.superAdmins,
            });
          case 'admin.help':
            return executeCommand({
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              registryReady: true,
              commandName: parsed.definition.name,
              reason: 'help_reported',
              replyText: buildAdminHelpText(),
            });
          case 'admin.list':
            return executeCommand({
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              registryReady: true,
              commandName: parsed.definition.name,
              reason: 'list_reported',
              replyText: buildAdminListReply(founderSuperAdminProfile, [...managedSuperAdmins.superAdmins.values()], [...registry.admins.values()]),
            });
          case 'admin.status':
            return handleStatusCommand({
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              targetInput: parsed.rawArgsText ?? parsed.argsText,
              registryRecords: registry.admins,
              superAdminProfiles,
            });
          case 'admin.dm.on':
          case 'admin.dm.off':
          case 'admin.group.on':
          case 'admin.group.off':
            return handleScopedAccessCommand({
              action: parsed.definition.name,
              config,
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              targetInput: parsed.rawArgsText ?? parsed.argsText,
              registryRecords: registry.admins,
              superAdminProfiles,
            });
          case 'admin.add':
            return handleAddCommand({
              config,
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              targetInput: parsed.rawArgsText ?? parsed.argsText,
              registryRecords: registry.admins,
              registryRecordsByNameKey: registry.adminsByNameKey,
              superAdminProfiles,
            });
          case 'admin.on':
          case 'admin.off':
          case 'admin.remove':
            return handleRegistryUpdateCommand({
              action: parsed.definition.name,
              config,
              runtimeStateStore,
              logger,
              message,
              context,
              sendReply,
              targetInput: parsed.rawArgsText ?? parsed.argsText,
              registryRecords: registry.admins,
              superAdminProfiles,
            });
        }

        return rejectCommand({
          runtimeStateStore,
          logger,
          message,
          context,
          sendReply,
          registryReady: true,
          commandName: parsed.definition.name,
          reason: 'unknown_command',
          replyText: 'UNKNOWN_COMMAND',
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        logger.error('command.error', {
          messageId: context.messageId,
          commandName: parsed.definition.name,
          senderJid: context.senderJid,
          normalizedSender: context.normalizedSender,
          chatJid: context.chatJid,
          message: messageText,
          error,
        });
        return rejectCommand({
          runtimeStateStore,
          logger,
          message,
          context,
          sendReply,
          registryReady: true,
          commandName: parsed.definition.name,
          reason: 'internal_error',
          replyText: 'INTERNAL_ERROR',
        });
      }
    },
  };
}

async function handleAddCommand(input: {
  config: AppConfig;
  runtimeStateStore: RuntimeStateStore;
  logger: Logger;
  message: WAMessage;
  context: CommandExecutionContext;
  sendReply(chatJid: string, text: string, quotedMessage: WAMessage): Promise<void>;
  targetInput: string | null;
  registryRecords: Map<string, DynamicAdminRecord>;
  registryRecordsByNameKey: Map<string, DynamicAdminRecord>;
  superAdminProfiles: ReturnType<typeof getOfficialSuperAdminProfiles>;
}): Promise<CommandResult> {
  const parsedTarget = parseAdminAddTarget(input.targetInput);
  if (!parsedTarget.ok) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: 'admin.add',
      reason: parsedTarget.reason,
      replyText: buildRejectedReply(parsedTarget.reason),
    });
  }

  const target = parsedTarget.target;
  const normalizedPhoneNumber = target.normalizedPhoneNumber;
  const displayName = target.displayName;
  const nameKey = target.nameKey;
  if (
    input.superAdminProfiles.some(
      (profile) =>
        profile.normalizedPhoneNumber === normalizedPhoneNumber || profile.nameKey === nameKey,
    )
  ) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: 'admin.add',
      reason: 'super_admin_protected',
      replyText: 'SUPER_ADMIN_PROTECTED',
    });
  }

  const existingByName = input.registryRecordsByNameKey.get(nameKey) ?? null;
  if (existingByName && existingByName.normalizedPhoneNumber !== normalizedPhoneNumber) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: 'admin.add',
      reason: 'name_already_exists',
      replyText: `NAME_ALREADY_EXISTS ${existingByName.displayName}`,
    });
  }

  const existingByNumber = input.registryRecords.get(normalizedPhoneNumber) ?? null;
  if (existingByNumber && existingByNumber.nameKey !== nameKey) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: 'admin.add',
      reason: 'target_mismatch',
      replyText: 'TARGET_MISMATCH',
    });
  }

  const now = new Date().toISOString();
  const nextRecord: DynamicAdminRecord = existingByNumber
    ? {
        ...existingByNumber,
        dmAccessEnabled: true,
        groupAccessEnabled: true,
        updatedAt: now,
        source: 'admin_command',
      }
    : {
        normalizedPhoneNumber,
        displayName,
        nameKey,
        dmAccessEnabled: true,
        groupAccessEnabled: true,
        createdAt: now,
        updatedAt: now,
        source: 'admin_command',
      };

  const nextRecords = upsertRecord([...input.registryRecords.values()], nextRecord);
  await writeDynamicAdminRegistry(input.config.accessRegistryFilePath, nextRecords);
  await input.runtimeStateStore.syncDerivedState();

  return executeCommand({
    runtimeStateStore: input.runtimeStateStore,
    logger: input.logger,
    message: input.message,
    context: input.context,
    sendReply: input.sendReply,
    registryReady: true,
    commandName: 'admin.add',
    reason:
      existingByNumber && existingByNumber.dmAccessEnabled && existingByNumber.groupAccessEnabled
        ? 'already_active'
        : existingByNumber
          ? 'admin_activated'
          : 'admin_added',
    replyText: existingByNumber ? `ADMIN_ON ${existingByNumber.displayName}` : `ADMIN_ADDED ${displayName}`,
  });
}

async function handleManagedSuperAdminAddCommand(input: {
  config: AppConfig;
  runtimeStateStore: RuntimeStateStore;
  logger: Logger;
  message: WAMessage;
  context: CommandExecutionContext;
  sendReply(chatJid: string, text: string, quotedMessage: WAMessage): Promise<void>;
  targetInput: string | null;
  founderSuperAdminProfile: OfficialSuperAdminProfile | null;
  managedSuperAdminRecords: Map<string, ManagedSuperAdminRecord>;
  managedSuperAdminRecordsByNameKey: Map<string, ManagedSuperAdminRecord>;
  registryRecords: Map<string, DynamicAdminRecord>;
  registryRecordsByNameKey: Map<string, DynamicAdminRecord>;
}): Promise<CommandResult> {
  const parsedTarget = parseAdminAddTarget(input.targetInput);
  if (!parsedTarget.ok) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: 'superadmin.add',
      reason: parsedTarget.reason,
      replyText: buildRejectedReply(parsedTarget.reason),
    });
  }

  const target = parsedTarget.target;
  const normalizedPhoneNumber = target.normalizedPhoneNumber;
  const displayName = target.displayName;
  const nameKey = target.nameKey;

  if (
    (input.founderSuperAdminProfile &&
      (input.founderSuperAdminProfile.normalizedPhoneNumber === normalizedPhoneNumber ||
        input.founderSuperAdminProfile.nameKey === nameKey))
  ) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: 'superadmin.add',
      reason: 'super_admin_protected',
      replyText: 'SUPER_ADMIN_PROTECTED',
    });
  }

  const existingManagedByName = input.managedSuperAdminRecordsByNameKey.get(nameKey) ?? null;
  if (existingManagedByName && existingManagedByName.normalizedPhoneNumber !== normalizedPhoneNumber) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: 'superadmin.add',
      reason: 'name_already_exists',
      replyText: `NAME_ALREADY_EXISTS ${existingManagedByName.displayName}`,
    });
  }

  const existingManagedByNumber = input.managedSuperAdminRecords.get(normalizedPhoneNumber) ?? null;
  if (existingManagedByNumber && existingManagedByNumber.nameKey !== nameKey) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: 'superadmin.add',
      reason: 'target_mismatch',
      replyText: 'TARGET_MISMATCH',
    });
  }

  const existingAdminByName = input.registryRecordsByNameKey.get(nameKey) ?? null;
  if (existingAdminByName && existingAdminByName.normalizedPhoneNumber !== normalizedPhoneNumber) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: 'superadmin.add',
      reason: 'name_already_exists',
      replyText: `NAME_ALREADY_EXISTS ${existingAdminByName.displayName}`,
    });
  }

  const existingAdminByNumber = input.registryRecords.get(normalizedPhoneNumber) ?? null;
  if (existingAdminByNumber && existingAdminByNumber.nameKey !== nameKey) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: 'superadmin.add',
      reason: 'target_mismatch',
      replyText: 'TARGET_MISMATCH',
    });
  }

  const now = new Date().toISOString();
  const nextRecord: ManagedSuperAdminRecord = existingManagedByNumber
    ? {
        ...existingManagedByNumber,
        displayName,
        nameKey,
        isActive: true,
        updatedAt: now,
        source: 'super_admin_command',
      }
    : {
        normalizedPhoneNumber,
        displayName,
        nameKey,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        source: 'super_admin_command',
      };

  const nextRecords = upsertManagedSuperAdminRecord([...input.managedSuperAdminRecords.values()], nextRecord);
  await writeManagedSuperAdminRegistry(input.config.superAdminRegistryFilePath, nextRecords);
  await input.runtimeStateStore.syncDerivedState();

  return executeCommand({
    runtimeStateStore: input.runtimeStateStore,
    logger: input.logger,
    message: input.message,
    context: input.context,
    sendReply: input.sendReply,
    registryReady: true,
    commandName: 'superadmin.add',
    reason:
      existingManagedByNumber?.isActive
        ? 'already_active'
        : existingManagedByNumber
          ? 'super_admin_activated'
          : 'super_admin_added',
    replyText: existingManagedByNumber ? `SUPER_ADMIN_ON ${displayName}` : `SUPER_ADMIN_ADDED ${displayName}`,
  });
}

async function handleManagedSuperAdminStatusCommand(input: {
  runtimeStateStore: RuntimeStateStore;
  logger: Logger;
  message: WAMessage;
  context: CommandExecutionContext;
  sendReply(chatJid: string, text: string, quotedMessage: WAMessage): Promise<void>;
  targetInput: string | null;
  founderSuperAdminProfile: OfficialSuperAdminProfile | null;
  managedSuperAdminRecords: Map<string, ManagedSuperAdminRecord>;
}): Promise<CommandResult> {
  const resolved = resolveAdminTarget({
    rawInput: input.targetInput,
    registryRecords: new Map(),
    superAdminProfiles: buildAllSuperAdminProfiles(input.founderSuperAdminProfile, input.managedSuperAdminRecords),
  });
  if (!resolved.ok || resolved.target.kind !== 'super_admin') {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: 'superadmin.status',
      reason: resolved.ok ? 'admin_not_found' : resolved.reason,
      replyText: buildRejectedReply(resolved.ok ? 'admin_not_found' : resolved.reason),
    });
  }

  const isFounder = input.founderSuperAdminProfile?.normalizedPhoneNumber === resolved.target.normalizedPhoneNumber;
  const isActive = isFounder ? true : (input.managedSuperAdminRecords.get(resolved.target.normalizedPhoneNumber)?.isActive ?? false);
  const roleLabel = isFounder ? 'founder' : 'manager';

  return executeCommand({
    runtimeStateStore: input.runtimeStateStore,
    logger: input.logger,
    message: input.message,
    context: input.context,
    sendReply: input.sendReply,
    registryReady: true,
    commandName: 'superadmin.status',
    reason: 'status_reported',
    replyText: `SUPER_ADMIN_STATUS ${resolved.target.displayName} role:${roleLabel} active:${isActive ? 'on' : 'off'}`,
  });
}

async function handleManagedSuperAdminUpdateCommand(input: {
  action: 'superadmin.on' | 'superadmin.off' | 'superadmin.remove';
  config: AppConfig;
  runtimeStateStore: RuntimeStateStore;
  logger: Logger;
  message: WAMessage;
  context: CommandExecutionContext;
  sendReply(chatJid: string, text: string, quotedMessage: WAMessage): Promise<void>;
  targetInput: string | null;
  founderSuperAdminProfile: OfficialSuperAdminProfile | null;
  managedSuperAdminRecords: Map<string, ManagedSuperAdminRecord>;
}): Promise<CommandResult> {
  const resolved = resolveAdminTarget({
    rawInput: input.targetInput,
    registryRecords: new Map(),
    superAdminProfiles: buildAllSuperAdminProfiles(input.founderSuperAdminProfile, input.managedSuperAdminRecords),
  });
  if (!resolved.ok || resolved.target.kind !== 'super_admin') {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: input.action,
      reason: resolved.ok ? 'admin_not_found' : resolved.reason,
      replyText: buildRejectedReply(resolved.ok ? 'admin_not_found' : resolved.reason),
    });
  }

  if (input.founderSuperAdminProfile?.normalizedPhoneNumber === resolved.target.normalizedPhoneNumber) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: input.action,
      reason: 'super_admin_protected',
      replyText: 'SUPER_ADMIN_PROTECTED',
    });
  }

  const current = input.managedSuperAdminRecords.get(resolved.target.normalizedPhoneNumber);
  if (!current) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: input.action,
      reason: 'admin_not_found',
      replyText: 'ADMIN_NOT_FOUND',
    });
  }

  const records = [...input.managedSuperAdminRecords.values()];
  const now = new Date().toISOString();
  let nextRecords = records;
  let reason: CommandExecutionReason;
  let replyText: string;

  if (input.action === 'superadmin.on') {
    const nextRecord = current.isActive
      ? current
      : {
          ...current,
          isActive: true,
          updatedAt: now,
          source: 'super_admin_command',
        };
    nextRecords = upsertManagedSuperAdminRecord(records, nextRecord);
    reason = current.isActive ? 'already_active' : 'super_admin_activated';
    replyText = `SUPER_ADMIN_ON ${current.displayName}`;
  } else if (input.action === 'superadmin.off') {
    const nextRecord = current.isActive
      ? {
          ...current,
          isActive: false,
          updatedAt: now,
          source: 'super_admin_command',
        }
      : current;
    nextRecords = upsertManagedSuperAdminRecord(records, nextRecord);
    reason = current.isActive ? 'super_admin_deactivated' : 'already_inactive';
    replyText = `SUPER_ADMIN_OFF ${current.displayName}`;
  } else {
    nextRecords = records.filter((record) => record.normalizedPhoneNumber !== current.normalizedPhoneNumber);
    reason = 'super_admin_removed';
    replyText = `SUPER_ADMIN_REMOVED ${current.displayName}`;
  }

  await writeManagedSuperAdminRegistry(input.config.superAdminRegistryFilePath, nextRecords);
  await input.runtimeStateStore.syncDerivedState();

  return executeCommand({
    runtimeStateStore: input.runtimeStateStore,
    logger: input.logger,
    message: input.message,
    context: input.context,
    sendReply: input.sendReply,
    registryReady: true,
    commandName: input.action,
    reason,
    replyText,
  });
}

async function handleStatusCommand(input: {
  runtimeStateStore: RuntimeStateStore;
  logger: Logger;
  message: WAMessage;
  context: CommandExecutionContext;
  sendReply(chatJid: string, text: string, quotedMessage: WAMessage): Promise<void>;
  targetInput: string | null;
  registryRecords: Map<string, DynamicAdminRecord>;
  superAdminProfiles: ReturnType<typeof getOfficialSuperAdminProfiles>;
}): Promise<CommandResult> {
  const resolved = resolveAdminTarget({
    rawInput: input.targetInput,
    registryRecords: input.registryRecords,
    superAdminProfiles: input.superAdminProfiles,
  });
  if (!resolved.ok) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: 'admin.status',
      reason: resolved.reason,
      replyText: buildRejectedReply(resolved.reason),
    });
  }

  return executeCommand({
    runtimeStateStore: input.runtimeStateStore,
    logger: input.logger,
    message: input.message,
    context: input.context,
    sendReply: input.sendReply,
    registryReady: true,
    commandName: 'admin.status',
    reason: 'status_reported',
    replyText: `STATUS ${resolved.target.displayName} ${formatAccessModes(resolved.target)}`,
  });
}

async function handleRegistryUpdateCommand(input: {
  action: 'admin.on' | 'admin.off' | 'admin.remove';
  config: AppConfig;
  runtimeStateStore: RuntimeStateStore;
  logger: Logger;
  message: WAMessage;
  context: CommandExecutionContext;
  sendReply(chatJid: string, text: string, quotedMessage: WAMessage): Promise<void>;
  targetInput: string | null;
  registryRecords: Map<string, DynamicAdminRecord>;
  superAdminProfiles: ReturnType<typeof getOfficialSuperAdminProfiles>;
}): Promise<CommandResult> {
  const resolved = resolveAdminTarget({
    rawInput: input.targetInput,
    registryRecords: input.registryRecords,
    superAdminProfiles: input.superAdminProfiles,
  });
  if (!resolved.ok) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: input.action,
      reason: resolved.reason,
      replyText: buildRejectedReply(resolved.reason),
    });
  }

  if (resolved.target.kind === 'super_admin') {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: input.action,
      reason: 'super_admin_protected',
      replyText: 'SUPER_ADMIN_PROTECTED',
    });
  }

  const records = [...input.registryRecords.values()];
  const current = resolved.target.record!;
  const now = new Date().toISOString();
  let nextRecords = records;
  let reason: CommandExecutionReason;
  let replyText: string;

  if (input.action === 'admin.on') {
    const nextRecord = current.dmAccessEnabled && current.groupAccessEnabled
      ? current
      : {
          ...current,
          dmAccessEnabled: true,
          groupAccessEnabled: true,
          updatedAt: now,
          source: 'admin_command',
        };
    nextRecords = upsertRecord(records, nextRecord);
    reason = current.dmAccessEnabled && current.groupAccessEnabled ? 'already_active' : 'admin_activated';
    replyText = `ADMIN_ON ${current.displayName}`;
  } else if (input.action === 'admin.off') {
    const nextRecord = current.dmAccessEnabled || current.groupAccessEnabled
      ? {
          ...current,
          dmAccessEnabled: false,
          groupAccessEnabled: false,
          updatedAt: now,
          source: 'admin_command',
        }
      : current;
    nextRecords = upsertRecord(records, nextRecord);
    reason = current.dmAccessEnabled || current.groupAccessEnabled ? 'admin_deactivated' : 'already_inactive';
    replyText = `ADMIN_OFF ${current.displayName}`;
  } else {
    nextRecords = records.filter((record) => record.normalizedPhoneNumber !== current.normalizedPhoneNumber);
    reason = 'admin_removed';
    replyText = `ADMIN_REMOVED ${current.displayName}`;
  }

  await writeDynamicAdminRegistry(input.config.accessRegistryFilePath, nextRecords);
  await input.runtimeStateStore.syncDerivedState();

  return executeCommand({
    runtimeStateStore: input.runtimeStateStore,
    logger: input.logger,
    message: input.message,
    context: input.context,
    sendReply: input.sendReply,
    registryReady: true,
    commandName: input.action,
    reason,
    replyText,
  });
}

async function handleScopedAccessCommand(input: {
  action: 'admin.dm.on' | 'admin.dm.off' | 'admin.group.on' | 'admin.group.off';
  config: AppConfig;
  runtimeStateStore: RuntimeStateStore;
  logger: Logger;
  message: WAMessage;
  context: CommandExecutionContext;
  sendReply(chatJid: string, text: string, quotedMessage: WAMessage): Promise<void>;
  targetInput: string | null;
  registryRecords: Map<string, DynamicAdminRecord>;
  superAdminProfiles: ReturnType<typeof getOfficialSuperAdminProfiles>;
}): Promise<CommandResult> {
  const resolved = resolveAdminTarget({
    rawInput: input.targetInput,
    registryRecords: input.registryRecords,
    superAdminProfiles: input.superAdminProfiles,
  });
  if (!resolved.ok) {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: input.action,
      reason: resolved.reason,
      replyText: buildRejectedReply(resolved.reason),
    });
  }

  if (resolved.target.kind === 'super_admin') {
    return rejectCommand({
      runtimeStateStore: input.runtimeStateStore,
      logger: input.logger,
      message: input.message,
      context: input.context,
      sendReply: input.sendReply,
      registryReady: true,
      commandName: input.action,
      reason: 'super_admin_protected',
      replyText: 'SUPER_ADMIN_PROTECTED',
    });
  }

  const records = [...input.registryRecords.values()];
  const current = resolved.target.record!;
  const now = new Date().toISOString();
  let nextRecord = current;
  let reason: CommandExecutionReason;
  let replyText: string;

  if (input.action === 'admin.dm.on') {
    nextRecord = current.dmAccessEnabled
      ? current
      : {
          ...current,
          dmAccessEnabled: true,
          updatedAt: now,
          source: 'admin_command',
        };
    reason = current.dmAccessEnabled ? 'already_dm_enabled' : 'admin_dm_enabled';
    replyText = `ADMIN_DM_ON ${current.displayName}`;
  } else if (input.action === 'admin.dm.off') {
    nextRecord = current.dmAccessEnabled
      ? {
          ...current,
          dmAccessEnabled: false,
          updatedAt: now,
          source: 'admin_command',
        }
      : current;
    reason = current.dmAccessEnabled ? 'admin_dm_disabled' : 'already_dm_disabled';
    replyText = `ADMIN_DM_OFF ${current.displayName}`;
  } else if (input.action === 'admin.group.on') {
    nextRecord = current.groupAccessEnabled
      ? current
      : {
          ...current,
          groupAccessEnabled: true,
          updatedAt: now,
          source: 'admin_command',
        };
    reason = current.groupAccessEnabled ? 'already_group_enabled' : 'admin_group_enabled';
    replyText = `ADMIN_GROUP_ON ${current.displayName}`;
  } else {
    nextRecord = current.groupAccessEnabled
      ? {
          ...current,
          groupAccessEnabled: false,
          updatedAt: now,
          source: 'admin_command',
        }
      : current;
    reason = current.groupAccessEnabled ? 'admin_group_disabled' : 'already_group_disabled';
    replyText = `ADMIN_GROUP_OFF ${current.displayName}`;
  }

  const nextRecords = upsertRecord(records, nextRecord);
  await writeDynamicAdminRegistry(input.config.accessRegistryFilePath, nextRecords);
  await input.runtimeStateStore.syncDerivedState();

  return executeCommand({
    runtimeStateStore: input.runtimeStateStore,
    logger: input.logger,
    message: input.message,
    context: input.context,
    sendReply: input.sendReply,
    registryReady: true,
    commandName: input.action,
    reason,
    replyText,
  });
}

async function executeCommand(input: {
  runtimeStateStore: RuntimeStateStore;
  logger: Logger;
  message: WAMessage;
  context: CommandExecutionContext;
  sendReply(chatJid: string, text: string, quotedMessage: WAMessage): Promise<void>;
  registryReady: boolean;
  commandName: AdminCommandName;
  reason: CommandExecutionReason;
  replyText: string;
}): Promise<CommandResult> {
  await updateCommandState(input.runtimeStateStore, {
    commandRegistryReady: input.registryReady,
    lastCommandAt: new Date().toISOString(),
    lastCommandName: input.commandName,
    lastCommandAllowed: true,
    lastCommandReason: input.reason,
    lastCommandSender: input.context.normalizedSender ?? input.context.senderJid,
  });

  await sendReplySafely(input.sendReply, input.context.chatJid, input.replyText, input.message, input.logger, {
    messageId: input.context.messageId,
    commandName: input.commandName,
    senderJid: input.context.senderJid,
    normalizedSender: input.context.normalizedSender,
    chatJid: input.context.chatJid,
  });

  input.logger.info('command.executed', {
    messageId: input.context.messageId,
    commandName: input.commandName,
    reason: input.reason,
    senderJid: input.context.senderJid,
    normalizedSender: input.context.normalizedSender,
    chatJid: input.context.chatJid,
    role: input.context.senderRole,
    isFromSelf: input.context.isFromSelf,
    isGroup: input.context.isGroup,
  });

  return {
    handled: true,
    commandName: input.commandName,
    allowed: true,
    reason: input.reason,
    replyText: input.replyText,
  };
}

async function rejectCommand(input: {
  runtimeStateStore: RuntimeStateStore;
  logger: Logger;
  message: WAMessage;
  context: CommandExecutionContext;
  sendReply(chatJid: string, text: string, quotedMessage: WAMessage): Promise<void>;
  registryReady: boolean;
  commandName: AdminCommandName | null;
  reason: CommandExecutionReason;
  replyText: string;
}): Promise<CommandResult> {
  await updateCommandState(input.runtimeStateStore, {
    commandRegistryReady: input.registryReady,
    lastCommandAt: new Date().toISOString(),
    lastCommandName: input.commandName,
    lastCommandAllowed: false,
    lastCommandReason: input.reason,
    lastCommandSender: input.context.normalizedSender ?? input.context.senderJid,
  });

  await sendReplySafely(input.sendReply, input.context.chatJid, input.replyText, input.message, input.logger, {
    messageId: input.context.messageId,
    commandName: input.commandName,
    senderJid: input.context.senderJid,
    normalizedSender: input.context.normalizedSender,
    chatJid: input.context.chatJid,
  });

  input.logger.info('command.rejected', {
    messageId: input.context.messageId,
    commandName: input.commandName,
    reason: input.reason,
    senderJid: input.context.senderJid,
    normalizedSender: input.context.normalizedSender,
    chatJid: input.context.chatJid,
    role: input.context.senderRole,
    isFromSelf: input.context.isFromSelf,
    isGroup: input.context.isGroup,
  });

  return {
    handled: true,
    commandName: input.commandName,
    allowed: false,
    reason: input.reason,
    replyText: input.replyText,
  };
}

async function updateCommandState(runtimeStateStore: RuntimeStateStore, patch: CommandStatePatch): Promise<void> {
  await runtimeStateStore.update(patch);
}

async function sendReplySafely(
  sendReply: (chatJid: string, text: string, quotedMessage: WAMessage) => Promise<void>,
  chatJid: string | null,
  text: string,
  quotedMessage: WAMessage,
  logger: Logger,
  contextPatch: Record<string, unknown>,
): Promise<void> {
  if (!chatJid) {
    logger.error('command.error', {
      message: 'Command reply could not be sent because chatJid is missing.',
      ...contextPatch,
    });
    return;
  }

  try {
    await sendReply(chatJid, text, quotedMessage);
  } catch (error) {
    logger.error('command.error', {
      message: error instanceof Error ? error.message : String(error),
      error,
      ...contextPatch,
    });
  }
}

function buildContext(message: WAMessage, accessDecision: AccessDecision): CommandExecutionContext {
  return {
    commandName: null,
    senderRole: accessDecision.role,
    normalizedSender: accessDecision.normalizedSender,
    senderJid: accessDecision.senderJid,
    chatJid: accessDecision.chatJid,
    isFromSelf: accessDecision.isFromSelf,
    isGroup: accessDecision.isGroup,
    messageId: message.key?.id ?? null,
  };
}

function buildAdminListReply(
  founderSuperAdminProfile: OfficialSuperAdminProfile | null,
  managedSuperAdminRecords: ManagedSuperAdminRecord[],
  records: DynamicAdminRecord[],
): string {
  const dynamicAdminLines =
    records.length === 0
      ? ['- empty']
      : [...records]
          .sort((left, right) => left.displayName.toLowerCase().localeCompare(right.displayName.toLowerCase()))
          .map((record) => `- ${record.displayName} ${formatAccessModes(record)}`);

  return [
    'SUPER_ADMIN',
    ...(founderSuperAdminProfile ? [`- ${founderSuperAdminProfile.displayName} founder:on`] : []),
    ...managedSuperAdminRecords
      .sort((left, right) => left.displayName.toLowerCase().localeCompare(right.displayName.toLowerCase()))
      .map((record) => `- ${record.displayName} command:${record.isActive ? 'on' : 'off'}`),
    'ADMIN',
    ...dynamicAdminLines,
  ].join('\n');
}

function buildSuperAdminListReply(
  founderSuperAdminProfile: OfficialSuperAdminProfile | null,
  managedSuperAdminRecords: ManagedSuperAdminRecord[],
): string {
  return [
    'SUPER_ADMIN',
    ...(founderSuperAdminProfile ? [`- ${founderSuperAdminProfile.displayName} founder:on`] : []),
    ...managedSuperAdminRecords
      .sort((left, right) => left.displayName.toLowerCase().localeCompare(right.displayName.toLowerCase()))
      .map((record) => `- ${record.displayName} command:${record.isActive ? 'on' : 'off'}`),
  ].join('\n');
}

function buildSuperAdminHelpText(): string {
  return [
    'SuperAdmin help:',
    '- SuperAdmin list',
    '- SuperAdmin status <nama|nomor|nama nomor>',
    '- SuperAdmin add <nama> <nomor>',
    '- SuperAdmin on <nama|nomor|nama nomor>',
    '- SuperAdmin off <nama|nomor|nama nomor>',
    '- SuperAdmin remove <nama|nomor|nama nomor>',
  ].join('\n');
}

function buildRejectedReply(reason: CommandExecutionReason): string {
  switch (reason) {
    case 'forbidden_role':
      return 'FORBIDDEN_ROLE';
    case 'unknown_command':
      return 'UNKNOWN_COMMAND';
    case 'invalid_number':
      return 'INVALID_NUMBER';
    case 'missing_number':
      return 'MISSING_NUMBER';
    case 'invalid_name':
      return 'INVALID_NAME';
    case 'missing_name':
      return 'MISSING_NAME';
    case 'name_already_exists':
      return 'NAME_ALREADY_EXISTS';
    case 'admin_not_found':
      return 'ADMIN_NOT_FOUND';
    case 'target_mismatch':
      return 'TARGET_MISMATCH';
    case 'target_ambiguous':
      return 'TARGET_AMBIGUOUS';
    case 'super_admin_protected':
      return 'SUPER_ADMIN_PROTECTED';
    case 'founder_only':
      return 'FOUNDER_ONLY';
    case 'registry_not_ready':
      return 'REGISTRY_NOT_READY';
    case 'prompt_registry_not_ready':
      return 'PROMPT_REGISTRY_NOT_READY';
    case 'prompt_invalid_number':
      return 'PROMPT_INVALID_NUMBER';
    case 'prompt_invalid_name':
      return 'PROMPT_INVALID_NAME';
    case 'prompt_invalid_content':
      return 'PROMPT_INVALID_CONTENT';
    case 'prompt_invalid_priority':
      return 'PROMPT_INVALID_PRIORITY';
    case 'prompt_invalid_mode':
      return 'PROMPT_INVALID_MODE';
    case 'prompt_invalid_target':
      return 'PROMPT_INVALID_TARGET';
    case 'prompt_invalid_status':
      return 'PROMPT_INVALID_STATUS';
    case 'prompt_invalid_template':
      return 'PROMPT_INVALID_TEMPLATE';
    case 'prompt_not_found':
      return 'PROMPT_NOT_FOUND';
    case 'prompt_draft_expired':
      return 'PROMPT_DRAFT_EXPIRED';
    case 'official_group_not_ready':
      return 'OFFICIAL_GROUP_NOT_READY';
    default:
      return 'INTERNAL_ERROR';
  }
}

function buildActiveSuperAdminProfiles(
  founderSuperAdminProfile: OfficialSuperAdminProfile | null,
  managedSuperAdmins: {
    superAdmins: Map<string, ManagedSuperAdminRecord>;
  },
): OfficialSuperAdminProfile[] {
  return buildAllSuperAdminProfiles(founderSuperAdminProfile, managedSuperAdmins.superAdmins).filter((profile) =>
    founderSuperAdminProfile?.normalizedPhoneNumber === profile.normalizedPhoneNumber ||
    managedSuperAdmins.superAdmins.get(profile.normalizedPhoneNumber)?.isActive,
  );
}

function buildAllSuperAdminProfiles(
  founderSuperAdminProfile: OfficialSuperAdminProfile | null,
  managedSuperAdminRecords: Map<string, ManagedSuperAdminRecord>,
): OfficialSuperAdminProfile[] {
  return [
    ...(founderSuperAdminProfile ? [founderSuperAdminProfile] : []),
    ...[...managedSuperAdminRecords.values()].map((record) => ({
      normalizedPhoneNumber: record.normalizedPhoneNumber,
      displayName: record.displayName,
      nameKey: record.nameKey,
    })),
  ];
}

function isFounderOnlyCommand(commandName: AdminCommandName): boolean {
  return [
    'superadmin.add',
    'superadmin.on',
    'superadmin.off',
    'superadmin.remove',
    'admin.off',
    'admin.remove',
    'admin.dm.off',
    'admin.group.off',
  ].includes(commandName);
}

function isFounderActor(
  normalizedSender: string | null,
  founderSuperAdminNumber: string,
): boolean {
  return normalizedSender === founderSuperAdminNumber;
}

function upsertRecord(records: DynamicAdminRecord[], nextRecord: DynamicAdminRecord): DynamicAdminRecord[] {
  const withoutTarget = records.filter((record) => record.normalizedPhoneNumber !== nextRecord.normalizedPhoneNumber);
  return [...withoutTarget, nextRecord].sort((left, right) =>
    left.displayName.toLowerCase().localeCompare(right.displayName.toLowerCase()),
  );
}

function formatAccessModes(input: {
  dmAccessEnabled: boolean;
  groupAccessEnabled: boolean;
}): string {
  return `dm:${input.dmAccessEnabled ? 'on' : 'off'} group:${input.groupAccessEnabled ? 'on' : 'off'}`;
}

async function handlePromptCommand(input: {
  promptCommandName: Extract<AdminCommandName, `prompt.${string}`>;
  promptCommandService: ReturnType<typeof createPromptCommandService>;
  actorContext: {
    actor: string;
    actorNumber: string;
    chatJid: string;
  };
  argsText: string | null;
}) {
  switch (input.promptCommandName) {
    case 'prompt.list':
      return input.promptCommandService.listPrompts();
    case 'prompt.show':
      return input.promptCommandService.showPrompt(input.argsText);
    case 'prompt.add':
      return input.promptCommandService.beginAddDraft(input.actorContext);
    case 'prompt.edit':
      return input.promptCommandService.beginEditDraft(input.actorContext, input.argsText);
    case 'prompt.on':
      return input.promptCommandService.activatePrompt(input.actorContext, input.argsText);
    case 'prompt.off':
      return input.promptCommandService.deactivatePrompt(input.actorContext, input.argsText);
    case 'prompt.remove':
      return input.promptCommandService.removePrompt(input.actorContext, input.argsText);
  }
}

function isPromptCommandName(name: AdminCommandName): name is Extract<AdminCommandName, `prompt.${string}`> {
  return name.startsWith('prompt.');
}
