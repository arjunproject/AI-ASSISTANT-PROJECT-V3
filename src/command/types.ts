import type { AccessRole } from '../access/types.js';

export type AdminCommandName =
  | 'superadmin.add'
  | 'superadmin.remove'
  | 'superadmin.list'
  | 'superadmin.on'
  | 'superadmin.off'
  | 'superadmin.status'
  | 'superadmin.help'
  | 'admin.add'
  | 'admin.remove'
  | 'admin.list'
  | 'admin.on'
  | 'admin.off'
  | 'admin.dm.on'
  | 'admin.dm.off'
  | 'admin.group.on'
  | 'admin.group.off'
  | 'admin.status'
  | 'admin.help'
  | 'prompt.list'
  | 'prompt.show'
  | 'prompt.add'
  | 'prompt.edit'
  | 'prompt.on'
  | 'prompt.off'
  | 'prompt.remove';

export type CommandExecutionReason =
  | 'super_admin_added'
  | 'super_admin_removed'
  | 'super_admin_activated'
  | 'super_admin_deactivated'
  | 'founder_only'
  | 'admin_added'
  | 'admin_removed'
  | 'admin_activated'
  | 'admin_deactivated'
  | 'admin_dm_enabled'
  | 'admin_dm_disabled'
  | 'admin_group_enabled'
  | 'admin_group_disabled'
  | 'list_reported'
  | 'status_reported'
  | 'help_reported'
  | 'already_active'
  | 'already_inactive'
  | 'already_dm_enabled'
  | 'already_dm_disabled'
  | 'already_group_enabled'
  | 'already_group_disabled'
  | 'admin_not_found'
  | 'name_already_exists'
  | 'forbidden_role'
  | 'unknown_command'
  | 'invalid_name'
  | 'invalid_number'
  | 'missing_name'
  | 'missing_number'
  | 'super_admin_protected'
  | 'target_ambiguous'
  | 'target_mismatch'
  | 'registry_not_ready'
  | 'prompt_registry_not_ready'
  | 'prompt_added'
  | 'prompt_updated'
  | 'prompt_retargeted'
  | 'prompt_activated'
  | 'prompt_deactivated'
  | 'prompt_removed'
  | 'prompt_list_reported'
  | 'prompt_detail_reported'
  | 'prompt_add_template_reported'
  | 'prompt_edit_template_reported'
  | 'prompt_not_found'
  | 'prompt_invalid_number'
  | 'prompt_invalid_name'
  | 'prompt_invalid_content'
  | 'prompt_invalid_priority'
  | 'prompt_invalid_mode'
  | 'prompt_invalid_target'
  | 'prompt_invalid_status'
  | 'prompt_invalid_template'
  | 'prompt_draft_expired'
  | 'official_group_not_ready'
  | 'prompt_already_active'
  | 'prompt_already_inactive'
  | 'internal_error';

export interface AdminCommandDefinition {
  name: AdminCommandName;
  canonical: string;
  usage: string;
  description: string;
  requiresTarget: boolean;
}

export interface ParsedAdminCommand {
  definition: AdminCommandDefinition;
  rawText: string;
  normalizedText: string;
  argsText: string | null;
  rawArgsText: string | null;
}

export type CommandParseResult =
  | {
      kind: 'not_command';
      rawText: string | null;
      normalizedText: string | null;
    }
  | {
      kind: 'invalid_command';
      rawText: string;
      normalizedText: string;
    }
  | {
      kind: 'command';
      parsed: ParsedAdminCommand;
    };

export type CommandTargetNormalizationResult =
  | {
      ok: true;
      normalized: string;
      reason: null;
    }
  | {
      ok: false;
      normalized: null;
      reason: 'missing_number' | 'invalid_number';
    };

export interface CommandResult {
  handled: boolean;
  commandName: AdminCommandName | null;
  allowed: boolean | null;
  reason: CommandExecutionReason | null;
  replyText: string | null;
}

export interface CommandStatePatch {
  commandRegistryReady: boolean;
  lastCommandAt: string;
  lastCommandName: AdminCommandName | null;
  lastCommandAllowed: boolean;
  lastCommandReason: CommandExecutionReason;
  lastCommandSender: string | null;
}

export interface CommandExecutionContext {
  commandName: AdminCommandName | null;
  senderRole: AccessRole;
  normalizedSender: string | null;
  senderJid: string | null;
  chatJid: string | null;
  isFromSelf: boolean;
  isGroup: boolean;
  messageId: string | null;
}
