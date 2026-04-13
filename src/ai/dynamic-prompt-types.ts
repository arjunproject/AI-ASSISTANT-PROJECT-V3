export type DynamicPromptTargetType = 'global' | 'specific';

export type DynamicPromptMode = 'dm only' | 'group only' | 'dm+group';

export type DynamicPromptTriggerType = 'always' | 'keyword' | 'regex' | 'intent' | 'manual';

export interface DynamicPromptTrigger {
  type: DynamicPromptTriggerType;
  value: string | string[] | null;
}

export interface DynamicPromptRecord {
  id: string;
  displayNumber: number;
  name: string;
  content: string;
  targetType: DynamicPromptTargetType;
  targetMembers: string[];
  mode: DynamicPromptMode;
  priority: number;
  trigger: DynamicPromptTrigger;
  isActive: boolean;
  createdBy: string;
  createdByNumber: string | null;
  updatedBy: string;
  updatedByNumber: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  lastUpdatedChatJid: string | null;
}

export interface DynamicPromptRegistryDocument {
  prompts: DynamicPromptRecord[];
}

export interface DynamicPromptAuditTargetSnapshot {
  targetType: DynamicPromptTargetType;
  targetMembers: string[];
}

export interface DynamicPromptAuditEntry {
  auditId: string;
  actor: string;
  actorNumber: string | null;
  chatJid: string | null;
  promptId: string;
  displayNumber: number;
  version: number;
  action: 'created' | 'updated' | 'retargeted' | 'activated' | 'deactivated' | 'removed';
  changedFields: string[];
  targetSnapshot: DynamicPromptAuditTargetSnapshot;
  modeSnapshot: DynamicPromptMode;
  statusSnapshot: 'on' | 'off';
  observedAt: string;
}

export interface DynamicPromptAuditDocument {
  registrySnapshot: Record<string, DynamicPromptAuditSnapshot>;
  entries: DynamicPromptAuditEntry[];
}

export interface DynamicPromptAuditSnapshot {
  id: string;
  displayNumber: number;
  name: string;
  content: string;
  targetType: DynamicPromptTargetType;
  targetMembers: string[];
  mode: DynamicPromptMode;
  priority: number;
  triggerType: DynamicPromptTriggerType;
  triggerValue: string | string[] | null;
  isActive: boolean;
  createdBy: string;
  createdByNumber: string | null;
  updatedBy: string;
  updatedByNumber: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  lastUpdatedChatJid: string | null;
}

export interface DynamicPromptInspection {
  ready: boolean;
  prompts: DynamicPromptRecord[];
  activeCount: number;
  lastAuditAt: string | null;
  error: string | null;
}

export interface DynamicPromptAssemblerContext {
  chatJid: string;
  senderJid: string | null;
  normalizedSender: string | null;
  isGroup: boolean;
  userText: string;
  manualPromptIds?: string[];
  intentTags?: string[];
  domainTag?: string | null;
}

export interface DynamicPromptAssembly {
  appliedPrompts: DynamicPromptRecord[];
  overlayText: string | null;
}
