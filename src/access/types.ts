export type AccessRole = 'super_admin' | 'admin' | 'non_admin';

export type AccessReason =
  | 'official_super_admin'
  | 'active_dynamic_super_admin'
  | 'active_dynamic_admin'
  | 'dm_access_disabled'
  | 'group_access_disabled'
  | 'group_not_whitelisted'
  | 'official_group_whitelist_not_ready'
  | 'not_in_whitelist'
  | 'unresolved_sender'
  | 'invalid_sender';

export type ChatAccessReason =
  | 'direct_message'
  | 'official_group'
  | 'group_not_whitelisted'
  | 'official_group_whitelist_not_ready';

export type ChatContextType = 'dm' | 'official_group' | 'other_group';

export interface DynamicAdminRecord {
  normalizedPhoneNumber: string;
  displayName: string;
  nameKey: string;
  dmAccessEnabled: boolean;
  groupAccessEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  source: string;
}

export interface ManagedSuperAdminRecord {
  normalizedPhoneNumber: string;
  displayName: string;
  nameKey: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  source: string;
}

export interface OfficialGroupWhitelistRecord {
  groupJid: string;
  groupName: string;
  inviteLink: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  source: string;
}

export interface AccessDecision {
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
}
