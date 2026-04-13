import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Logger } from '../core/logger.js';
import { assembleDynamicPromptOverlay } from './dynamic-prompt-assembler.js';
import type {
  DynamicPromptAssemblerContext,
  DynamicPromptAssembly,
  DynamicPromptAuditDocument,
  DynamicPromptAuditEntry,
  DynamicPromptAuditSnapshot,
  DynamicPromptInspection,
  DynamicPromptRecord,
  DynamicPromptRegistryDocument,
} from './dynamic-prompt-types.js';
import {
  buildEmptyDynamicPromptAuditDocument,
  buildEmptyDynamicPromptRegistry,
  validateDynamicPromptRegistryDocument,
} from './dynamic-prompt-validator.js';

export interface DynamicPromptRegistry {
  inspect(): Promise<DynamicPromptInspection>;
  resolve(context: DynamicPromptAssemblerContext): Promise<DynamicPromptInspection & DynamicPromptAssembly>;
}

export function createDynamicPromptRegistry(dependencies: {
  registryFilePath: string;
  auditFilePath: string;
  logger: Logger;
}): DynamicPromptRegistry {
  const { registryFilePath, auditFilePath, logger } = dependencies;

  return {
    async inspect() {
      const loaded = await loadRegistry(registryFilePath, auditFilePath);
      if (!loaded.ready) {
        return {
          ready: false,
          prompts: [],
          activeCount: 0,
          lastAuditAt: loaded.lastAuditAt,
          error: loaded.error,
        };
      }

      if (loaded.auditEntryCount > 0) {
        logger.info('dynamic_prompt.audit_recorded', {
          filePath: auditFilePath,
          entryCount: loaded.auditEntryCount,
          lastAuditAt: loaded.lastAuditAt,
        });
      }

      return {
        ready: true,
        prompts: loaded.prompts,
        activeCount: loaded.prompts.filter((prompt) => prompt.isActive).length,
        lastAuditAt: loaded.lastAuditAt,
        error: null,
      };
    },

    async resolve(context) {
      const inspection = await this.inspect();
      if (!inspection.ready) {
        return {
          ...inspection,
          appliedPrompts: [],
          overlayText: null,
        };
      }

      const assembly = assembleDynamicPromptOverlay(inspection.prompts, context);
      return {
        ...inspection,
        ...assembly,
      };
    },
  };
}

export async function writeDynamicPromptRegistry(
  registryFilePath: string,
  prompts: DynamicPromptRecord[],
): Promise<void> {
  await mkdir(dirname(registryFilePath), { recursive: true });
  const documentValidation = validateDynamicPromptRegistryDocument({
    prompts,
  });
  if (!documentValidation.ok) {
    throw new Error(documentValidation.error);
  }

  await writeFile(registryFilePath, `${JSON.stringify(documentValidation.value, null, 2)}\n`, 'utf8');
}

export async function inspectDynamicPromptRegistryFiles(
  registryFilePath: string,
  auditFilePath: string,
): Promise<DynamicPromptInspection> {
  const loaded = await loadRegistry(registryFilePath, auditFilePath);
  if (!loaded.ready) {
    return {
      ready: false,
      prompts: [],
      activeCount: 0,
      lastAuditAt: loaded.lastAuditAt,
      error: loaded.error,
    };
  }

  return {
    ready: true,
    prompts: loaded.prompts,
    activeCount: loaded.prompts.filter((prompt) => prompt.isActive).length,
    lastAuditAt: loaded.lastAuditAt,
    error: null,
  };
}

interface LoadedRegistry {
  ready: boolean;
  prompts: DynamicPromptRecord[];
  lastAuditAt: string | null;
  auditEntryCount: number;
  error: string | null;
}

async function loadRegistry(registryFilePath: string, auditFilePath: string): Promise<LoadedRegistry> {
  const document = await readRegistryDocument(registryFilePath);
  if (!document.ok) {
    return {
      ready: false,
      prompts: [],
      lastAuditAt: null,
      auditEntryCount: 0,
      error: document.error,
    };
  }

  const audited = await syncDynamicPromptAuditLog(auditFilePath, document.value);
  if (!audited.ok) {
    return {
      ready: false,
      prompts: [],
      lastAuditAt: audited.lastAuditAt,
      auditEntryCount: 0,
      error: audited.error,
    };
  }

  return {
    ready: true,
    prompts: document.value.prompts,
    lastAuditAt: audited.lastAuditAt,
    auditEntryCount: audited.entryCount,
    error: null,
  };
}

async function readRegistryDocument(
  registryFilePath: string,
): Promise<
  | {
      ok: true;
      value: DynamicPromptRegistryDocument;
    }
  | {
      ok: false;
      error: string;
    }
> {
  await mkdir(dirname(registryFilePath), { recursive: true });

  try {
    const raw = await readFile(registryFilePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return validateDynamicPromptRegistryDocument(parsed);
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code === 'ENOENT') {
      const emptyRegistry = buildEmptyDynamicPromptRegistry();
      await writeFile(registryFilePath, `${JSON.stringify(emptyRegistry, null, 2)}\n`, 'utf8');
      return {
        ok: true,
        value: emptyRegistry,
      };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function syncDynamicPromptAuditLog(
  auditFilePath: string,
  registry: DynamicPromptRegistryDocument,
): Promise<
  | {
      ok: true;
      lastAuditAt: string | null;
      entryCount: number;
    }
  | {
      ok: false;
      lastAuditAt: string | null;
      error: string;
    }
> {
  await mkdir(dirname(auditFilePath), { recursive: true });

  const previousAudit = await readAuditDocument(auditFilePath);
  if (!previousAudit.ok) {
    return {
      ok: false,
      lastAuditAt: null,
      error: previousAudit.error,
    };
  }

  const nextAudit = previousAudit.value;
  const existingSnapshot = nextAudit.registrySnapshot;
  const observedAt = new Date().toISOString();
  const entries: DynamicPromptAuditEntry[] = [];
  const nextSnapshot: Record<string, DynamicPromptAuditSnapshot> = {};

  for (const prompt of registry.prompts) {
    const previous = existingSnapshot[prompt.id];
    const current = buildAuditSnapshot(prompt);
    nextSnapshot[prompt.id] = current;

    if (!previous) {
      entries.push({
        auditId: buildAuditId(prompt.id, observedAt, 'created'),
        actor: prompt.createdBy,
        actorNumber: prompt.createdByNumber,
        chatJid: prompt.lastUpdatedChatJid,
        promptId: prompt.id,
        displayNumber: prompt.displayNumber,
        version: prompt.version,
        action: 'created',
        changedFields: Object.keys(current),
        targetSnapshot: {
          targetType: current.targetType,
          targetMembers: current.targetMembers,
        },
        modeSnapshot: current.mode,
        statusSnapshot: current.isActive ? 'on' : 'off',
        observedAt,
      });
      continue;
    }

    const changedFields = collectChangedFields(previous, current);
    if (changedFields.length === 0) {
      continue;
    }

    const action =
      previous.isActive !== current.isActive
        ? (current.isActive ? 'activated' : 'deactivated')
        : previous.targetType !== current.targetType ||
            !isEqual(previous.targetMembers, current.targetMembers) ||
            previous.mode !== current.mode
          ? 'retargeted'
          : 'updated';

    entries.push({
      auditId: buildAuditId(prompt.id, observedAt, action),
      actor: prompt.updatedBy,
      actorNumber: prompt.updatedByNumber,
      chatJid: prompt.lastUpdatedChatJid,
      promptId: prompt.id,
      displayNumber: prompt.displayNumber,
      version: prompt.version,
      action,
      changedFields,
      targetSnapshot: {
        targetType: current.targetType,
        targetMembers: current.targetMembers,
      },
      modeSnapshot: current.mode,
      statusSnapshot: current.isActive ? 'on' : 'off',
      observedAt,
    });
  }

  for (const [promptId, previous] of Object.entries(existingSnapshot)) {
    if (nextSnapshot[promptId]) {
      continue;
    }

    entries.push({
      auditId: buildAuditId(promptId, observedAt, 'removed'),
      actor: previous.updatedBy,
      actorNumber: previous.updatedByNumber,
      chatJid: previous.lastUpdatedChatJid,
      promptId,
      displayNumber: previous.displayNumber,
      version: previous.version,
      action: 'removed',
      changedFields: ['removed'],
      targetSnapshot: {
        targetType: previous.targetType,
        targetMembers: previous.targetMembers,
      },
      modeSnapshot: previous.mode,
      statusSnapshot: 'off',
      observedAt,
    });
  }

  const finalAudit: DynamicPromptAuditDocument = {
    registrySnapshot: nextSnapshot,
    entries: [...nextAudit.entries, ...entries],
  };

  const lastAuditAt = entries.at(-1)?.observedAt ?? nextAudit.entries.at(-1)?.observedAt ?? null;
  if (entries.length === 0) {
    return {
      ok: true,
      lastAuditAt,
      entryCount: 0,
    };
  }

  await writeFile(auditFilePath, `${JSON.stringify(finalAudit, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    lastAuditAt,
    entryCount: entries.length,
  };
}

async function readAuditDocument(
  auditFilePath: string,
): Promise<
  | {
      ok: true;
      value: DynamicPromptAuditDocument;
    }
  | {
      ok: false;
      error: string;
    }
> {
  try {
    const raw = await readFile(auditFilePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        error: 'Dynamic prompt audit log must contain an object.',
      };
    }

    const audit = parsed as Partial<DynamicPromptAuditDocument>;
    if (!audit.registrySnapshot || typeof audit.registrySnapshot !== 'object' || Array.isArray(audit.registrySnapshot)) {
      return {
        ok: false,
        error: 'Dynamic prompt audit log must contain registrySnapshot.',
      };
    }
    if (!Array.isArray(audit.entries)) {
      return {
        ok: false,
        error: 'Dynamic prompt audit log must contain entries.',
      };
    }

    return {
      ok: true,
      value: audit as DynamicPromptAuditDocument,
    };
  } catch (error) {
    const typedError = error as NodeJS.ErrnoException;
    if (typedError.code === 'ENOENT') {
      const emptyAudit = buildEmptyDynamicPromptAuditDocument();
      await writeFile(auditFilePath, `${JSON.stringify(emptyAudit, null, 2)}\n`, 'utf8');
      return {
        ok: true,
        value: emptyAudit,
      };
    }

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildAuditSnapshot(prompt: DynamicPromptRecord): DynamicPromptAuditSnapshot {
  return {
    id: prompt.id,
    displayNumber: prompt.displayNumber,
    name: prompt.name,
    content: prompt.content,
    targetType: prompt.targetType,
    targetMembers: prompt.targetMembers,
    mode: prompt.mode,
    priority: prompt.priority,
    triggerType: prompt.trigger.type,
    triggerValue: prompt.trigger.value,
    isActive: prompt.isActive,
    createdBy: prompt.createdBy,
    createdByNumber: prompt.createdByNumber,
    updatedBy: prompt.updatedBy,
    updatedByNumber: prompt.updatedByNumber,
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
    version: prompt.version,
    lastUpdatedChatJid: prompt.lastUpdatedChatJid,
  };
}

function collectChangedFields(previous: DynamicPromptAuditSnapshot, current: DynamicPromptAuditSnapshot): string[] {
  const changedFields: string[] = [];

  for (const key of Object.keys(current) as Array<keyof DynamicPromptAuditSnapshot>) {
    if (!isEqual(previous[key], current[key])) {
      changedFields.push(String(key));
    }
  }

  return changedFields;
}

function buildAuditId(promptId: string, observedAt: string, action: DynamicPromptAuditEntry['action']): string {
  return `${promptId}:${action}:${observedAt}`;
}

function isEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
