import type { WAMessage } from '@whiskeysockets/baileys';

import type { AppConfig } from '../config/app-config.js';
import type { Logger } from '../core/logger.js';
import type { RuntimeStateStore } from '../runtime/runtime-state-store.js';
import type { RuntimeIdentityResolutionSnapshot } from '../whatsapp/types.js';
import { inspectDynamicAdminRegistry } from './admin-registry.js';
import { inspectOfficialGroupWhitelist } from './official-group-whitelist.js';
import { getFounderSuperAdminNumber, getManagedSeedSuperAdminProfiles } from './super-admin-seed.js';
import { inspectManagedSuperAdminRegistry } from './super-admin-registry.js';
import { evaluateAccessPolicy } from './access-policy.js';
import type { AccessDecision } from './types.js';

export interface AccessController {
  evaluateMessageAccess(
    message: WAMessage,
    resolvedIdentity: RuntimeIdentityResolutionSnapshot | null,
  ): Promise<AccessDecision>;
}

export function createAccessController(dependencies: {
  config: AppConfig;
  logger: Logger;
  runtimeStateStore: RuntimeStateStore;
}): AccessController {
  const { config, logger, runtimeStateStore } = dependencies;

  return {
    async evaluateMessageAccess(message, resolvedIdentity) {
      const registry = await inspectDynamicAdminRegistry(config.accessRegistryFilePath);
      const managedSuperAdmins = await inspectManagedSuperAdminRegistry({
        registryFilePath: config.superAdminRegistryFilePath,
        seededProfiles: getManagedSeedSuperAdminProfiles(config.superAdminNumbers),
      });
      const officialGroup = await inspectOfficialGroupWhitelist(config.officialGroupWhitelistFilePath);
      const decision = evaluateAccessPolicy(resolvedIdentity, {
        founderSuperAdminNumber: getFounderSuperAdminNumber(config.superAdminNumbers),
        managedSuperAdmins,
        registry,
        officialGroup,
      });
      const messageId = message.key?.id ?? null;

      if (!registry.ready && registry.error) {
        logger.warn('access.error', {
          messageId,
          senderJid: resolvedIdentity?.senderJid ?? null,
          normalizedSender: resolvedIdentity?.normalizedSender ?? null,
          message: registry.error,
          registryFilePath: config.accessRegistryFilePath,
        });
      }

      if (!officialGroup.ready && officialGroup.error) {
        logger.warn('access.error', {
          messageId,
          senderJid: resolvedIdentity?.senderJid ?? null,
          normalizedSender: resolvedIdentity?.normalizedSender ?? null,
          chatJid: resolvedIdentity?.chatJid ?? null,
          message: officialGroup.error,
          whitelistFilePath: config.officialGroupWhitelistFilePath,
        });
      }

      if (!managedSuperAdmins.ready && managedSuperAdmins.error) {
        logger.warn('access.error', {
          messageId,
          senderJid: resolvedIdentity?.senderJid ?? null,
          normalizedSender: resolvedIdentity?.normalizedSender ?? null,
          message: managedSuperAdmins.error,
          registryFilePath: config.superAdminRegistryFilePath,
        });
      }

      await runtimeStateStore.update({
        accessGateReady: registry.ready && managedSuperAdmins.ready && officialGroup.ready,
        activeDynamicAdminCount: registry.activeCount,
        superAdminCount: 1 + managedSuperAdmins.activeCount,
        officialGroupWhitelistReady: officialGroup.ready,
        officialGroupJid: officialGroup.group?.groupJid ?? null,
        officialGroupName: officialGroup.group?.groupName ?? null,
        lastAccessDecisionAt: decision.evaluatedAt,
        lastAccessDecisionRole: decision.role,
        lastAccessDecisionReason: decision.reason,
        lastAccessDecisionAllowed: decision.isAllowed,
        lastAccessDecisionSender: decision.normalizedSender ?? decision.senderJid,
        lastGroupAccessDecisionAt: decision.evaluatedAt,
        lastGroupAccessDecisionAllowed: decision.chatAccessAllowed,
        lastGroupAccessDecisionSender: decision.normalizedSender ?? decision.senderJid,
        lastGroupAccessDecisionChatJid: decision.chatJid,
        lastGroupAccessDecisionReason: decision.chatAccessReason,
      });

      logger.info('access.evaluated', {
        messageId,
        isAllowed: decision.isAllowed,
        role: decision.role,
        reason: decision.reason,
        chatContextType: decision.chatContextType,
        chatAccessAllowed: decision.chatAccessAllowed,
        chatAccessReason: decision.chatAccessReason,
        normalizedSender: decision.normalizedSender,
        senderJid: decision.senderJid,
        chatJid: decision.chatJid,
        isFromSelf: decision.isFromSelf,
        isGroup: decision.isGroup,
      });

      logger.info(decision.isAllowed ? 'access.allowed' : 'access.denied', {
        messageId,
        role: decision.role,
        reason: decision.reason,
        chatContextType: decision.chatContextType,
        chatAccessAllowed: decision.chatAccessAllowed,
        chatAccessReason: decision.chatAccessReason,
        normalizedSender: decision.normalizedSender,
        senderJid: decision.senderJid,
        chatJid: decision.chatJid,
        isFromSelf: decision.isFromSelf,
        isGroup: decision.isGroup,
      });

      return decision;
    },
  };
}
