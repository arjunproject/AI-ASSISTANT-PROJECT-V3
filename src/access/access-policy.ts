import type { RuntimeIdentityResolutionSnapshot } from '../whatsapp/types.js';
import type { DynamicAdminRegistryInspection } from './admin-registry.js';
import type { OfficialGroupWhitelistInspection } from './official-group-whitelist.js';
import type { AccessDecision, AccessReason, AccessRole, ChatAccessReason, ChatContextType } from './types.js';

export function evaluateAccessPolicy(
  resolvedIdentity: RuntimeIdentityResolutionSnapshot | null,
  dependencies: {
    superAdminNumbers: string[];
    registry: DynamicAdminRegistryInspection;
    officialGroup: OfficialGroupWhitelistInspection;
  },
): AccessDecision {
  const evaluatedAt = new Date().toISOString();
  const chatAccess = evaluateChatAccess(resolvedIdentity, dependencies.officialGroup);

  if (!resolvedIdentity) {
    return buildDecision({
      evaluatedAt,
      isAllowed: false,
      role: 'non_admin',
      reason: 'unresolved_sender',
      chatContextType: chatAccess.chatContextType,
      chatAccessAllowed: chatAccess.chatAccessAllowed,
      chatAccessReason: chatAccess.chatAccessReason,
      normalizedSender: null,
      senderJid: null,
      chatJid: null,
      isFromSelf: false,
      isGroup: false,
    });
  }

  if (!resolvedIdentity.normalizedSender) {
    return buildDecision({
      evaluatedAt,
      isAllowed: false,
      role: 'non_admin',
      reason: 'invalid_sender',
      chatContextType: chatAccess.chatContextType,
      chatAccessAllowed: chatAccess.chatAccessAllowed,
      chatAccessReason: chatAccess.chatAccessReason,
      normalizedSender: null,
      senderJid: resolvedIdentity.senderJid,
      chatJid: resolvedIdentity.chatJid,
      isFromSelf: resolvedIdentity.isFromSelf,
      isGroup: resolvedIdentity.isGroup,
    });
  }

  if (dependencies.superAdminNumbers.includes(resolvedIdentity.normalizedSender)) {
    if (!chatAccess.chatAccessAllowed) {
      return buildDecision({
        evaluatedAt,
        isAllowed: false,
        role: 'super_admin',
        reason: mapChatAccessReasonToAccessReason(chatAccess.chatAccessReason),
        chatContextType: chatAccess.chatContextType,
        chatAccessAllowed: chatAccess.chatAccessAllowed,
        chatAccessReason: chatAccess.chatAccessReason,
        normalizedSender: resolvedIdentity.normalizedSender,
        senderJid: resolvedIdentity.senderJid,
        chatJid: resolvedIdentity.chatJid,
        isFromSelf: resolvedIdentity.isFromSelf,
        isGroup: resolvedIdentity.isGroup,
      });
    }

    return buildDecision({
      evaluatedAt,
      isAllowed: true,
      role: 'super_admin',
      reason: 'official_super_admin',
      chatContextType: chatAccess.chatContextType,
      chatAccessAllowed: chatAccess.chatAccessAllowed,
      chatAccessReason: chatAccess.chatAccessReason,
      normalizedSender: resolvedIdentity.normalizedSender,
      senderJid: resolvedIdentity.senderJid,
      chatJid: resolvedIdentity.chatJid,
      isFromSelf: resolvedIdentity.isFromSelf,
      isGroup: resolvedIdentity.isGroup,
    });
  }

  const dynamicAdmin = dependencies.registry.admins.get(resolvedIdentity.normalizedSender);
  if (dynamicAdmin) {
    if (!chatAccess.chatAccessAllowed) {
      return buildDecision({
        evaluatedAt,
        isAllowed: false,
        role: 'admin',
        reason: mapChatAccessReasonToAccessReason(chatAccess.chatAccessReason),
        chatContextType: chatAccess.chatContextType,
        chatAccessAllowed: chatAccess.chatAccessAllowed,
        chatAccessReason: chatAccess.chatAccessReason,
        normalizedSender: resolvedIdentity.normalizedSender,
        senderJid: resolvedIdentity.senderJid,
        chatJid: resolvedIdentity.chatJid,
        isFromSelf: resolvedIdentity.isFromSelf,
        isGroup: resolvedIdentity.isGroup,
      });
    }

    const isDmAllowed = chatAccess.chatContextType === 'dm' && dynamicAdmin.dmAccessEnabled;
    const isGroupAllowed = chatAccess.chatContextType === 'official_group' && dynamicAdmin.groupAccessEnabled;
    if (isDmAllowed || isGroupAllowed) {
      return buildDecision({
        evaluatedAt,
        isAllowed: true,
        role: 'admin',
        reason: 'active_dynamic_admin',
        chatContextType: chatAccess.chatContextType,
        chatAccessAllowed: chatAccess.chatAccessAllowed,
        chatAccessReason: chatAccess.chatAccessReason,
        normalizedSender: resolvedIdentity.normalizedSender,
        senderJid: resolvedIdentity.senderJid,
        chatJid: resolvedIdentity.chatJid,
        isFromSelf: resolvedIdentity.isFromSelf,
        isGroup: resolvedIdentity.isGroup,
      });
    }

    return buildDecision({
      evaluatedAt,
      isAllowed: false,
      role: 'admin',
      reason: chatAccess.chatContextType === 'dm' ? 'dm_access_disabled' : 'group_access_disabled',
      chatContextType: chatAccess.chatContextType,
      chatAccessAllowed: chatAccess.chatAccessAllowed,
      chatAccessReason: chatAccess.chatAccessReason,
      normalizedSender: resolvedIdentity.normalizedSender,
      senderJid: resolvedIdentity.senderJid,
      chatJid: resolvedIdentity.chatJid,
      isFromSelf: resolvedIdentity.isFromSelf,
      isGroup: resolvedIdentity.isGroup,
    });
  }

  return buildDecision({
    evaluatedAt,
    isAllowed: false,
    role: 'non_admin',
    reason: 'not_in_whitelist',
    chatContextType: chatAccess.chatContextType,
    chatAccessAllowed: chatAccess.chatAccessAllowed,
    chatAccessReason: chatAccess.chatAccessReason,
    normalizedSender: resolvedIdentity.normalizedSender,
    senderJid: resolvedIdentity.senderJid,
    chatJid: resolvedIdentity.chatJid,
    isFromSelf: resolvedIdentity.isFromSelf,
    isGroup: resolvedIdentity.isGroup,
  });
}

function buildDecision(input: {
  evaluatedAt: string;
  isAllowed: boolean;
  role: AccessRole;
  reason: AccessReason;
  chatContextType: ChatContextType;
  chatAccessAllowed: boolean;
  chatAccessReason: ChatAccessReason;
  normalizedSender: string | null;
  senderJid: string | null;
  chatJid: string | null;
  isFromSelf: boolean;
  isGroup: boolean;
}): AccessDecision {
  return input;
}

function evaluateChatAccess(
  resolvedIdentity: RuntimeIdentityResolutionSnapshot | null,
  officialGroup: OfficialGroupWhitelistInspection,
): {
  chatContextType: ChatContextType;
  chatAccessAllowed: boolean;
  chatAccessReason: ChatAccessReason;
} {
  if (!resolvedIdentity?.isGroup) {
    return {
      chatContextType: 'dm',
      chatAccessAllowed: true,
      chatAccessReason: 'direct_message',
    };
  }

  if (!officialGroup.ready || !officialGroup.group) {
    return {
      chatContextType: 'other_group',
      chatAccessAllowed: false,
      chatAccessReason: 'official_group_whitelist_not_ready',
    };
  }

  if (resolvedIdentity.chatJid === officialGroup.group.groupJid) {
    return {
      chatContextType: 'official_group',
      chatAccessAllowed: true,
      chatAccessReason: 'official_group',
    };
  }

  return {
    chatContextType: 'other_group',
    chatAccessAllowed: false,
    chatAccessReason: 'group_not_whitelisted',
  };
}

function mapChatAccessReasonToAccessReason(reason: ChatAccessReason): AccessReason {
  switch (reason) {
    case 'official_group':
    case 'direct_message':
      return 'official_super_admin';
    case 'group_not_whitelisted':
      return 'group_not_whitelisted';
    case 'official_group_whitelist_not_ready':
      return 'official_group_whitelist_not_ready';
  }
}
