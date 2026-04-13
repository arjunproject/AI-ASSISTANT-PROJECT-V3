import type { AppConfig } from '../config/app-config.js';
import type { RuntimeStateStore } from '../runtime/runtime-state-store.js';
import { inspectOfficialGroupWhitelist } from '../access/official-group-whitelist.js';
import { inspectDynamicAdminRegistry } from '../access/admin-registry.js';
import { getOfficialSuperAdminProfiles } from '../access/super-admin-seed.js';
import { inspectDynamicPromptRegistryFiles, writeDynamicPromptRegistry } from '../ai/dynamic-prompt-registry.js';
import {
  normalizeDynamicPromptModeInput,
  normalizeDynamicPromptTargetTypeInput,
  validateDynamicPromptRegistryDocument,
} from '../ai/dynamic-prompt-validator.js';
import type {
  DynamicPromptInspection,
  DynamicPromptMode,
  DynamicPromptRecord,
  DynamicPromptTargetType,
} from '../ai/dynamic-prompt-types.js';
import { normalizeCommandTargetNumber } from './number-normalizer.js';
import { createPromptDraftSessionStore, type PromptDraftMode } from './prompt-draft-session-store.js';
import { resolveAdminTarget } from './admin-target-resolver.js';
import type { CommandExecutionReason } from './types.js';

const PROMPT_DRAFT_TIMEOUT_MS = 15 * 60 * 1000;

const TEMPLATE_FIELD_ORDER = [
  'nama prompt',
  'isi prompt',
  'target',
  'daftar target',
  'mode',
  'priority',
  'status',
] as const;

type TemplateFieldName = typeof TEMPLATE_FIELD_ORDER[number];

export interface PromptCommandActorContext {
  actor: string;
  actorNumber: string;
  chatJid: string;
}

export interface PromptCommandOutcome {
  allowed: boolean;
  reason: CommandExecutionReason;
  replyText: string;
}

export interface PromptDraftOutcome extends PromptCommandOutcome {
  handled: boolean;
  commandName: 'prompt.add' | 'prompt.edit' | null;
}

export interface PromptCommandService {
  listPrompts(): Promise<PromptCommandOutcome>;
  showPrompt(rawInput: string | null): Promise<PromptCommandOutcome>;
  beginAddDraft(actorContext: PromptCommandActorContext): Promise<PromptCommandOutcome>;
  beginEditDraft(actorContext: PromptCommandActorContext, rawInput: string | null): Promise<PromptCommandOutcome>;
  activatePrompt(actorContext: PromptCommandActorContext, rawInput: string | null): Promise<PromptCommandOutcome>;
  deactivatePrompt(actorContext: PromptCommandActorContext, rawInput: string | null): Promise<PromptCommandOutcome>;
  removePrompt(actorContext: PromptCommandActorContext, rawInput: string | null): Promise<PromptCommandOutcome>;
  handleDraftReply(actorContext: PromptCommandActorContext, rawText: string | null): Promise<PromptDraftOutcome>;
}

interface ParsedPromptTemplate {
  name: string;
  content: string;
  targetType: DynamicPromptTargetType;
  targetMembers: string[];
  mode: DynamicPromptMode;
  priority: number;
  isActive: boolean;
}

interface NumberedPrompt {
  number: number;
  prompt: DynamicPromptRecord;
}

export function createPromptCommandService(dependencies: {
  config: AppConfig;
  runtimeStateStore: RuntimeStateStore;
}): PromptCommandService {
  const { config, runtimeStateStore } = dependencies;
  const draftStore = createPromptDraftSessionStore();
  const superAdminProfiles = getOfficialSuperAdminProfiles(config.superAdminNumbers);

  return {
    async listPrompts() {
      const inspected = await inspectRegistry();
      if (!inspected.ok) {
        return inspected.outcome;
      }

      const ordered = orderPrompts(inspected.inspection.prompts);
      if (ordered.length === 0) {
        return {
          allowed: true,
          reason: 'prompt_list_reported',
          replyText: 'PROMPT\n- empty',
        };
      }

      return {
        allowed: true,
        reason: 'prompt_list_reported',
        replyText: [
          'PROMPT',
          ...ordered.map(({ number, prompt }) =>
            `${number}. ${prompt.name} | ${prompt.isActive ? 'on' : 'off'} | ${prompt.targetType} | ${prompt.mode} | p${prompt.priority}`),
        ].join('\n'),
      };
    },

    async showPrompt(rawInput) {
      const selected = await findPromptByNumber(rawInput);
      if (!selected.ok) {
        return selected.outcome;
      }

      const { number, prompt } = selected;
      return {
        allowed: true,
        reason: 'prompt_detail_reported',
        replyText: [
          `PROMPT ${number}`,
          `Nama: ${prompt.name}`,
          `Isi: ${prompt.content}`,
          `Target: ${prompt.targetType}`,
          `Daftar target: ${prompt.targetMembers.length > 0 ? prompt.targetMembers.join(', ') : '-'}`,
          `Mode: ${prompt.mode}`,
          `Priority: ${prompt.priority}`,
          `Status: ${prompt.isActive ? 'on' : 'off'}`,
          `Version: ${prompt.version}`,
        ].join('\n'),
      };
    },

    async beginAddDraft(actorContext) {
      const inspected = await inspectRegistry();
      if (!inspected.ok) {
        return inspected.outcome;
      }

      draftStore.begin({
        mode: 'add',
        chatJid: actorContext.chatJid,
        actorNumber: actorContext.actorNumber,
        promptId: null,
        displayNumber: null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + PROMPT_DRAFT_TIMEOUT_MS).toISOString(),
      });

      return {
        allowed: true,
        reason: 'prompt_add_template_reported',
        replyText: buildEmptyPromptTemplate(),
      };
    },

    async beginEditDraft(actorContext, rawInput) {
      const selected = await findPromptByNumber(rawInput);
      if (!selected.ok) {
        return selected.outcome;
      }

      draftStore.begin({
        mode: 'edit',
        chatJid: actorContext.chatJid,
        actorNumber: actorContext.actorNumber,
        promptId: selected.prompt.id,
        displayNumber: selected.number,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + PROMPT_DRAFT_TIMEOUT_MS).toISOString(),
      });

      return {
        allowed: true,
        reason: 'prompt_edit_template_reported',
        replyText: buildFilledPromptTemplate(selected.number, selected.prompt),
      };
    },

    async activatePrompt(actorContext, rawInput) {
      return togglePrompt(actorContext, rawInput, true);
    },

    async deactivatePrompt(actorContext, rawInput) {
      return togglePrompt(actorContext, rawInput, false);
    },

    async removePrompt(actorContext, rawInput) {
      const inspected = await inspectRegistry();
      if (!inspected.ok) {
        return inspected.outcome;
      }

      const selected = findNumberedPrompt(inspected.inspection.prompts, rawInput);
      if (!selected.ok) {
        return selected.outcome;
      }

      const preparedRemovedPrompt: DynamicPromptRecord = {
        ...selected.prompt,
        updatedBy: actorContext.actor,
        updatedByNumber: actorContext.actorNumber,
        updatedAt: new Date().toISOString(),
        version: selected.prompt.version + 1,
        lastUpdatedChatJid: actorContext.chatJid,
      };
      const preparedPrompts = inspected.inspection.prompts.map((prompt) =>
        prompt.id === selected.prompt.id ? preparedRemovedPrompt : prompt,
      );
      const prepared = await persistPrompts(preparedPrompts);
      if (!prepared.ok) {
        return prepared.outcome;
      }

      const nextPrompts = prepared.inspection.prompts.filter((prompt) => prompt.id !== selected.prompt.id);
      const persisted = await persistPrompts(nextPrompts);
      if (!persisted.ok) {
        return persisted.outcome;
      }

      return {
        allowed: true,
        reason: 'prompt_removed',
        replyText: `PROMPT_REMOVED ${selected.number} ${selected.prompt.name}`,
      };
    },

    async handleDraftReply(actorContext, rawText) {
      const draftState = draftStore.consume(actorContext.chatJid, actorContext.actorNumber);
      if (draftState.status === 'none') {
        return {
          handled: false,
          commandName: null,
          allowed: false,
          reason: 'prompt_invalid_template',
          replyText: '',
        };
      }

      if (draftState.status === 'expired') {
        return {
          handled: true,
          commandName: draftState.session.mode === 'add' ? 'prompt.add' : 'prompt.edit',
          allowed: false,
          reason: 'prompt_draft_expired',
          replyText: 'PROMPT_DRAFT_EXPIRED',
        };
      }

      const inspected = await inspectRegistry();
      if (!inspected.ok) {
        return {
          handled: true,
          commandName: draftState.session.mode === 'add' ? 'prompt.add' : 'prompt.edit',
          allowed: false,
          reason: inspected.outcome.reason,
          replyText: inspected.outcome.replyText,
        };
      }

      const parsedTemplate = await parsePromptTemplate(rawText, actorContext.chatJid);
      if (!parsedTemplate.ok) {
        return {
          handled: true,
          commandName: draftState.session.mode === 'add' ? 'prompt.add' : 'prompt.edit',
          allowed: false,
          reason: parsedTemplate.outcome.reason,
          replyText: parsedTemplate.outcome.replyText,
        };
      }

      if (draftState.session.mode === 'add') {
        const now = new Date().toISOString();
        const nextPrompt: DynamicPromptRecord = {
          id: buildPromptId(parsedTemplate.prompt.name, now, inspected.inspection.prompts),
          displayNumber: getNextDisplayNumber(inspected.inspection.prompts),
          name: parsedTemplate.prompt.name,
          content: parsedTemplate.prompt.content,
          targetType: parsedTemplate.prompt.targetType,
          targetMembers: parsedTemplate.prompt.targetMembers,
          mode: parsedTemplate.prompt.mode,
          priority: parsedTemplate.prompt.priority,
          trigger: { type: 'always', value: null },
          isActive: parsedTemplate.prompt.isActive,
          createdBy: actorContext.actor,
          createdByNumber: actorContext.actorNumber,
          updatedBy: actorContext.actor,
          updatedByNumber: actorContext.actorNumber,
          createdAt: now,
          updatedAt: now,
          version: 1,
          lastUpdatedChatJid: actorContext.chatJid,
        };

        const persisted = await persistPrompts([...inspected.inspection.prompts, nextPrompt]);
        if (!persisted.ok) {
          return {
            handled: true,
            commandName: 'prompt.add',
            allowed: false,
            reason: persisted.outcome.reason,
            replyText: persisted.outcome.replyText,
          };
        }

        draftStore.clear(actorContext.chatJid, actorContext.actorNumber);
        const selected = findNumberedPromptById(persisted.inspection.prompts, nextPrompt.id);
        return {
          handled: true,
          commandName: 'prompt.add',
          allowed: true,
          reason: 'prompt_added',
          replyText: `PROMPT_ADDED ${selected.number} ${selected.prompt.name}`,
        };
      }

      const currentPrompt = inspected.inspection.prompts.find((prompt) => prompt.id === draftState.session.promptId);
      if (!currentPrompt) {
        draftStore.clear(actorContext.chatJid, actorContext.actorNumber);
        return {
          handled: true,
          commandName: 'prompt.edit',
          allowed: false,
          reason: 'prompt_not_found',
          replyText: 'PROMPT_NOT_FOUND',
        };
      }

      const nextPrompt: DynamicPromptRecord = {
        ...currentPrompt,
        name: parsedTemplate.prompt.name,
        content: parsedTemplate.prompt.content,
        targetType: parsedTemplate.prompt.targetType,
        targetMembers: parsedTemplate.prompt.targetMembers,
        mode: parsedTemplate.prompt.mode,
        priority: parsedTemplate.prompt.priority,
        isActive: parsedTemplate.prompt.isActive,
        updatedBy: actorContext.actor,
        updatedByNumber: actorContext.actorNumber,
        updatedAt: new Date().toISOString(),
        version: currentPrompt.version + 1,
        lastUpdatedChatJid: actorContext.chatJid,
      };

      const persisted = await persistPromptUpdate(nextPrompt);
      if (!persisted.ok) {
        return {
          handled: true,
          commandName: 'prompt.edit',
          allowed: false,
          reason: persisted.outcome.reason,
          replyText: persisted.outcome.replyText,
        };
      }

      draftStore.clear(actorContext.chatJid, actorContext.actorNumber);
      return {
        handled: true,
        commandName: 'prompt.edit',
        allowed: true,
        reason: 'prompt_updated',
        replyText: `PROMPT_UPDATED ${nextPrompt.displayNumber} ${persisted.prompt.name}`,
      };
    },
  };

  async function togglePrompt(
    actorContext: PromptCommandActorContext,
    rawInput: string | null,
    isActive: boolean,
  ): Promise<PromptCommandOutcome> {
    const selected = await findPromptByNumber(rawInput);
    if (!selected.ok) {
      return selected.outcome;
    }

    if (selected.prompt.isActive === isActive) {
      return {
        allowed: true,
        reason: isActive ? 'prompt_already_active' : 'prompt_already_inactive',
        replyText: isActive ? `PROMPT_ON ${selected.number}` : `PROMPT_OFF ${selected.number}`,
      };
    }

    const nextPrompt: DynamicPromptRecord = {
      ...selected.prompt,
      isActive,
      updatedBy: actorContext.actor,
      updatedByNumber: actorContext.actorNumber,
      updatedAt: new Date().toISOString(),
      version: selected.prompt.version + 1,
      lastUpdatedChatJid: actorContext.chatJid,
    };

    const persisted = await persistPromptUpdate(nextPrompt);
    if (!persisted.ok) {
      return persisted.outcome;
    }

    return {
      allowed: true,
      reason: isActive ? 'prompt_activated' : 'prompt_deactivated',
      replyText: isActive ? `PROMPT_ON ${selected.number}` : `PROMPT_OFF ${selected.number}`,
    };
  }

  async function inspectRegistry(): Promise<
    | { ok: true; inspection: DynamicPromptInspection }
    | { ok: false; outcome: PromptCommandOutcome }
  > {
    const inspection = await inspectDynamicPromptRegistryFiles(
      config.dynamicPromptRegistryFilePath,
      config.dynamicPromptAuditFilePath,
    );

    if (!inspection.ready) {
      await runtimeStateStore.syncDerivedState();
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_registry_not_ready',
          replyText: 'PROMPT_REGISTRY_NOT_READY',
        },
      };
    }

    return {
      ok: true,
      inspection,
    };
  }

  async function findPromptByNumber(rawInput: string | null): Promise<
    | ({ ok: true } & NumberedPrompt)
    | { ok: false; outcome: PromptCommandOutcome }
  > {
    const inspected = await inspectRegistry();
    if (!inspected.ok) {
      return inspected;
    }

    return findNumberedPrompt(inspected.inspection.prompts, rawInput);
  }

  async function persistPromptUpdate(nextPrompt: DynamicPromptRecord): Promise<
    | { ok: true; prompt: DynamicPromptRecord }
    | { ok: false; outcome: PromptCommandOutcome }
  > {
    const inspected = await inspectRegistry();
    if (!inspected.ok) {
      return inspected;
    }

    const nextPrompts = inspected.inspection.prompts.map((prompt) => prompt.id === nextPrompt.id ? nextPrompt : prompt);
    const persisted = await persistPrompts(nextPrompts);
    if (!persisted.ok) {
      return persisted;
    }

    const prompt = persisted.inspection.prompts.find((candidate) => candidate.id === nextPrompt.id);
    if (!prompt) {
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_not_found',
          replyText: 'PROMPT_NOT_FOUND',
        },
      };
    }

    return {
      ok: true,
      prompt,
    };
  }

  async function persistPrompts(prompts: DynamicPromptRecord[]): Promise<
    | { ok: true; inspection: DynamicPromptInspection }
    | { ok: false; outcome: PromptCommandOutcome }
  > {
    const validation = validateDynamicPromptRegistryDocument({ prompts });
    if (!validation.ok) {
      return {
        ok: false,
        outcome: mapValidationErrorToOutcome(validation.error),
      };
    }

    try {
      await writeDynamicPromptRegistry(config.dynamicPromptRegistryFilePath, validation.value.prompts);
    } catch (error) {
      await runtimeStateStore.syncDerivedState();
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_registry_not_ready',
          replyText: error instanceof Error ? error.message : 'PROMPT_REGISTRY_NOT_READY',
        },
      };
    }

    await runtimeStateStore.syncDerivedState();
    const inspection = await inspectDynamicPromptRegistryFiles(
      config.dynamicPromptRegistryFilePath,
      config.dynamicPromptAuditFilePath,
    );
    if (!inspection.ready) {
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_registry_not_ready',
          replyText: 'PROMPT_REGISTRY_NOT_READY',
        },
      };
    }

    return {
      ok: true,
      inspection,
    };
  }

  async function parsePromptTemplate(
    rawText: string | null,
    chatJid: string,
  ): Promise<
    | { ok: true; prompt: ParsedPromptTemplate }
    | { ok: false; outcome: PromptCommandOutcome }
  > {
    const extracted = extractPromptTemplateFields(rawText);
    if (!extracted.ok) {
      return {
        ok: false,
        outcome: extracted.outcome,
      };
    }

    const targetType = normalizeDynamicPromptTargetTypeInput(extracted.fields.target);
    if (!targetType) {
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_invalid_target',
          replyText: 'PROMPT_INVALID_TARGET',
        },
      };
    }

    const mode = normalizeDynamicPromptModeInput(extracted.fields.mode);
    if (!mode) {
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_invalid_mode',
          replyText: 'PROMPT_INVALID_MODE',
        },
      };
    }

    const priority = parsePromptPriority(extracted.fields.priority);
    if (priority === null) {
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_invalid_priority',
          replyText: 'PROMPT_INVALID_PRIORITY',
        },
      };
    }

    const isActive = parsePromptIsActive(extracted.fields.status);
    if (isActive === null) {
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_invalid_status',
          replyText: 'PROMPT_INVALID_STATUS',
        },
      };
    }

    const name = extracted.fields['nama prompt'].trim();
    if (!name) {
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_invalid_name',
          replyText: 'PROMPT_INVALID_NAME',
        },
      };
    }

    const content = extracted.fields['isi prompt'].trim();
    if (!content) {
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_invalid_content',
          replyText: 'PROMPT_INVALID_CONTENT',
        },
      };
    }

    if (mode !== 'dm only') {
      const officialGroup = await inspectOfficialGroupWhitelist(config.officialGroupWhitelistFilePath);
      if (!officialGroup.ready) {
        await runtimeStateStore.syncDerivedState();
        return {
          ok: false,
          outcome: {
            allowed: false,
            reason: 'official_group_not_ready',
            replyText: 'OFFICIAL_GROUP_NOT_READY',
          },
        };
      }
    }

    const resolvedTargets = await resolvePromptTargets(targetType, extracted.fields['daftar target']);
    if (!resolvedTargets.ok) {
      return resolvedTargets;
    }

    return {
      ok: true,
      prompt: {
        name,
        content,
        targetType,
        targetMembers: resolvedTargets.targetMembers,
        mode,
        priority,
        isActive,
      },
    };
  }

  async function resolvePromptTargets(
    targetType: DynamicPromptTargetType,
    rawTargetList: string,
  ): Promise<
    | { ok: true; targetMembers: string[] }
    | { ok: false; outcome: PromptCommandOutcome }
  > {
    const tokens = splitTargetTokens(rawTargetList);
    if (targetType === 'global') {
      if (tokens.length > 0) {
        return {
          ok: false,
          outcome: {
            allowed: false,
            reason: 'prompt_invalid_target',
            replyText: 'PROMPT_INVALID_TARGET',
          },
        };
      }

      return {
        ok: true,
        targetMembers: [],
      };
    }

    if (tokens.length === 0) {
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_invalid_target',
          replyText: 'PROMPT_INVALID_TARGET',
        },
      };
    }

    const adminRegistry = await inspectDynamicAdminRegistry(config.accessRegistryFilePath);
    if (!adminRegistry.ready) {
      await runtimeStateStore.syncDerivedState();
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'registry_not_ready',
          replyText: 'REGISTRY_NOT_READY',
        },
      };
    }

    const resolvedTargets = new Set<string>();
    for (const token of tokens) {
      const byNumber = normalizeCommandTargetNumber(token);
      if (byNumber.ok && byNumber.normalized) {
        resolvedTargets.add(byNumber.normalized);
        continue;
      }

      const resolved = resolveAdminTarget({
        rawInput: token,
        registryRecords: adminRegistry.admins,
        superAdminProfiles,
      });
      if (!resolved.ok) {
        return {
          ok: false,
          outcome: {
            allowed: false,
            reason: 'prompt_invalid_target',
            replyText: 'PROMPT_INVALID_TARGET',
          },
        };
      }

      resolvedTargets.add(resolved.target.normalizedPhoneNumber);
    }

    return {
      ok: true,
      targetMembers: [...resolvedTargets].sort((left, right) => left.localeCompare(right, 'en-US')),
    };
  }
}

function orderPrompts(prompts: DynamicPromptRecord[]): NumberedPrompt[] {
  return [...prompts]
    .sort((left, right) => left.displayNumber - right.displayNumber)
    .map((prompt) => ({
      number: prompt.displayNumber,
      prompt,
    }));
}

function findNumberedPrompt(
  prompts: DynamicPromptRecord[],
  rawInput: string | null,
):
  | ({ ok: true } & NumberedPrompt)
  | { ok: false; outcome: PromptCommandOutcome } {
  const number = parsePromptNumber(rawInput);
  if (number === null) {
    return {
      ok: false,
      outcome: {
        allowed: false,
        reason: 'prompt_invalid_number',
        replyText: 'PROMPT_INVALID_NUMBER',
      },
    };
  }

  const selected = orderPrompts(prompts).find((item) => item.number === number);
  if (!selected) {
    return {
      ok: false,
      outcome: {
        allowed: false,
        reason: 'prompt_not_found',
        replyText: 'PROMPT_NOT_FOUND',
      },
    };
  }

  return {
    ok: true,
    ...selected,
  };
}

function findNumberedPromptById(prompts: DynamicPromptRecord[], promptId: string): NumberedPrompt {
  const found = orderPrompts(prompts).find((item) => item.prompt.id === promptId);
  if (!found) {
    throw new Error(`Prompt id not found after persist: ${promptId}.`);
  }

  return found;
}

function parsePromptNumber(rawInput: string | null): number | null {
  const trimmed = rawInput?.trim() ?? '';
  if (!/^\d+$/u.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePromptPriority(input: string | null): number | null {
  const trimmed = input?.trim() ?? '';
  if (!/^\d+$/u.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}

function parsePromptIsActive(input: string | null): boolean | null {
  const normalized = input?.trim().toLowerCase() ?? '';
  if (normalized === 'on' || normalized === 'true') {
    return true;
  }
  if (normalized === 'off' || normalized === 'false') {
    return false;
  }

  return null;
}

function splitTargetTokens(rawTargetList: string): string[] {
  const normalized = rawTargetList
    .replace(/\r\n/gu, '\n')
    .split(/[\n,;]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== '-' && item !== '--');

  return [...new Set(normalized)];
}

function extractPromptTemplateFields(
  rawText: string | null,
):
  | {
      ok: true;
      fields: Record<TemplateFieldName, string>;
    }
  | {
      ok: false;
      outcome: PromptCommandOutcome;
    } {
  const text = rawText?.replace(/\r\n/gu, '\n').trim() ?? '';
  if (!text) {
    return {
      ok: false,
      outcome: {
        allowed: false,
        reason: 'prompt_invalid_template',
        replyText: 'PROMPT_INVALID_TEMPLATE',
      },
    };
  }

  const buffers = new Map<TemplateFieldName, string[]>();
  let currentField: TemplateFieldName | null = null;

  for (const line of text.split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    if (/^prompt\s+\d+$/iu.test(trimmedLine)) {
      currentField = null;
      continue;
    }

    const strippedLine = trimmedLine.replace(/^[•*-]\s*/u, '');
    const matched = /^([^:]+):\s*(.*)$/u.exec(strippedLine);
    if (matched) {
      const fieldName = normalizeTemplateFieldName(matched[1] ?? '');
      if (!fieldName) {
        return {
          ok: false,
          outcome: {
            allowed: false,
            reason: 'prompt_invalid_template',
            replyText: 'PROMPT_INVALID_TEMPLATE',
          },
        };
      }

      currentField = fieldName;
      buffers.set(fieldName, [(matched[2] ?? '').trim()]);
      continue;
    }

    if (!currentField) {
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_invalid_template',
          replyText: 'PROMPT_INVALID_TEMPLATE',
        },
      };
    }

    const existing = buffers.get(currentField) ?? [];
    existing.push(trimmedLine);
    buffers.set(currentField, existing);
  }

  const fields = {} as Record<TemplateFieldName, string>;
  for (const fieldName of TEMPLATE_FIELD_ORDER) {
    const rawValue = buffers.get(fieldName);
    if (!rawValue) {
      return {
        ok: false,
        outcome: {
          allowed: false,
          reason: 'prompt_invalid_template',
          replyText: 'PROMPT_INVALID_TEMPLATE',
        },
      };
    }

    fields[fieldName] = rawValue.join('\n').trim();
  }

  return {
    ok: true,
    fields,
  };
}

function normalizeTemplateFieldName(value: string): TemplateFieldName | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/gu, ' ');
  return TEMPLATE_FIELD_ORDER.includes(normalized as TemplateFieldName)
    ? normalized as TemplateFieldName
    : null;
}

function buildEmptyPromptTemplate(): string {
  return [
    '• Nama prompt:',
    '• Isi prompt:',
    '• Target: Global/spesifik',
    '• Daftar target:',
    '• Mode: dm only/group only/dm+group',
    '• Priority:',
    '• Status: on/off',
  ].join('\n');
}

function buildFilledPromptTemplate(number: number, prompt: DynamicPromptRecord): string {
  return [
    `Prompt ${number}`,
    `• Nama prompt: ${prompt.name}`,
    `• Isi prompt: ${prompt.content}`,
    `• Target: ${prompt.targetType === 'global' ? 'Global' : 'spesifik'}`,
    `• Daftar target: ${prompt.targetMembers.length > 0 ? prompt.targetMembers.join(', ') : ''}`,
    `• Mode: ${prompt.mode}`,
    `• Priority: ${prompt.priority}`,
    `• Status: ${prompt.isActive ? 'on' : 'off'}`,
  ].join('\n');
}

function getNextDisplayNumber(prompts: DynamicPromptRecord[]): number {
  return Math.max(0, ...prompts.map((prompt) => prompt.displayNumber)) + 1;
}

function buildPromptId(name: string, createdAt: string, prompts: DynamicPromptRecord[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 32) || 'prompt';
  const timestamp = createdAt.replace(/[^\d]/gu, '').slice(0, 14);
  const initialId = `prompt-${timestamp}-${base}`;
  const existingIds = new Set(prompts.map((prompt) => prompt.id));

  if (!existingIds.has(initialId)) {
    return initialId;
  }

  let sequence = 2;
  while (existingIds.has(`${initialId}-${sequence}`)) {
    sequence += 1;
  }

  return `${initialId}-${sequence}`;
}

function mapValidationErrorToOutcome(error: string): PromptCommandOutcome {
  if (/name is required/i.test(error) || /name is too long/i.test(error) || /duplicated/i.test(error)) {
    return {
      allowed: false,
      reason: 'prompt_invalid_name',
      replyText: 'PROMPT_INVALID_NAME',
    };
  }
  if (/content is required/i.test(error) || /content is too long/i.test(error)) {
    return {
      allowed: false,
      reason: 'prompt_invalid_content',
      replyText: 'PROMPT_INVALID_CONTENT',
    };
  }
  if (/priority/i.test(error)) {
    return {
      allowed: false,
      reason: 'prompt_invalid_priority',
      replyText: 'PROMPT_INVALID_PRIORITY',
    };
  }
  if (/mode/i.test(error)) {
    return {
      allowed: false,
      reason: 'prompt_invalid_mode',
      replyText: 'PROMPT_INVALID_MODE',
    };
  }
  if (/target/i.test(error)) {
    return {
      allowed: false,
      reason: 'prompt_invalid_target',
      replyText: 'PROMPT_INVALID_TARGET',
    };
  }

  return {
    allowed: false,
    reason: 'prompt_registry_not_ready',
    replyText: 'PROMPT_REGISTRY_NOT_READY',
  };
}
