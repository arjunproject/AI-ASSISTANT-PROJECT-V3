import type {
  DynamicPromptAuditDocument,
  DynamicPromptMode,
  DynamicPromptRecord,
  DynamicPromptRegistryDocument,
  DynamicPromptTargetType,
  DynamicPromptTrigger,
  DynamicPromptTriggerType,
} from './dynamic-prompt-types.js';

const VALID_TARGET_TYPES: DynamicPromptTargetType[] = ['global', 'specific'];
const VALID_MODES: DynamicPromptMode[] = ['dm only', 'group only', 'dm+group'];
const VALID_TRIGGERS: DynamicPromptTriggerType[] = ['always', 'keyword', 'regex', 'intent', 'manual'];
const MAX_NAME_LENGTH = 120;
const MAX_CONTENT_LENGTH = 1_200;
const MIN_PRIORITY = 1;
const MAX_PRIORITY = 100;

export function buildEmptyDynamicPromptRegistry(): DynamicPromptRegistryDocument {
  return {
    prompts: [],
  };
}

export function buildEmptyDynamicPromptAuditDocument(): DynamicPromptAuditDocument {
  return {
    registrySnapshot: {},
    entries: [],
  };
}

export function normalizeDynamicPromptModeInput(value: string | null | undefined): DynamicPromptMode | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/gu, ' ')
    .replace(/\s*\+\s*/gu, '+')
    .replace(/\s+/gu, ' ');

  if (normalized === 'dm only') {
    return 'dm only';
  }
  if (normalized === 'group only') {
    return 'group only';
  }
  if (normalized === 'dm+group') {
    return 'dm+group';
  }

  return null;
}

export function normalizeDynamicPromptTargetTypeInput(value: string | null | undefined): DynamicPromptTargetType | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/gu, ' ');
  if (normalized === 'global') {
    return 'global';
  }
  if (normalized === 'specific' || normalized === 'spesifik') {
    return 'specific';
  }

  return null;
}

export function validateDynamicPromptRegistryDocument(
  input: unknown,
):
  | {
      ok: true;
      value: DynamicPromptRegistryDocument;
    }
  | {
      ok: false;
      error: string;
    } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      error: 'Dynamic prompt registry must contain an object.',
    };
  }

  const prompts = (input as { prompts?: unknown }).prompts;
  if (!Array.isArray(prompts)) {
    return {
      ok: false,
      error: 'Dynamic prompt registry must contain a prompts array.',
    };
  }

  const normalizedPrompts: Array<DynamicPromptRecord & { displayNumberMissing: boolean }> = [];
  const ids = new Set<string>();
  const explicitDisplayNumbers = new Set<number>();
  const ambiguityKeys = new Set<string>();

  for (const promptInput of prompts) {
    const validatedPrompt = validateDynamicPromptRecord(promptInput);
    if (!validatedPrompt.ok) {
      return validatedPrompt;
    }

    const prompt = validatedPrompt.value;
    if (ids.has(prompt.id)) {
      return {
        ok: false,
        error: `Dynamic prompt id must be unique: ${prompt.id}.`,
      };
    }
    ids.add(prompt.id);

    if (!prompt.displayNumberMissing) {
      if (explicitDisplayNumbers.has(prompt.displayNumber)) {
        return {
          ok: false,
          error: `Dynamic prompt displayNumber must be unique: ${prompt.displayNumber}.`,
        };
      }
      explicitDisplayNumbers.add(prompt.displayNumber);
    }

    const ambiguityKey = [
      prompt.name.toLocaleLowerCase('en-US'),
      prompt.targetType,
      prompt.targetMembers.join(','),
      prompt.mode,
      prompt.trigger.type,
      serializeTriggerValue(prompt.trigger.value),
    ].join('|');
    if (ambiguityKeys.has(ambiguityKey)) {
      return {
        ok: false,
        error: `Dynamic prompt is ambiguous and duplicated: ${prompt.name}.`,
      };
    }
    ambiguityKeys.add(ambiguityKey);
    normalizedPrompts.push(prompt);
  }

  let nextDisplayNumber = Math.max(0, ...explicitDisplayNumbers) + 1;
  const finalPrompts = normalizedPrompts.map(({ displayNumberMissing, ...prompt }) => {
    if (!displayNumberMissing) {
      return prompt;
    }

    while (explicitDisplayNumbers.has(nextDisplayNumber)) {
      nextDisplayNumber += 1;
    }
    const assignedDisplayNumber = nextDisplayNumber;
    explicitDisplayNumbers.add(assignedDisplayNumber);
    nextDisplayNumber += 1;

    return {
      ...prompt,
      displayNumber: assignedDisplayNumber,
    };
  });

  return {
    ok: true,
    value: {
      prompts: finalPrompts,
    },
  };
}

function validateDynamicPromptRecord(
  input: unknown,
):
  | {
      ok: true;
      value: DynamicPromptRecord & { displayNumberMissing: boolean };
    }
  | {
      ok: false;
      error: string;
    } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      error: 'Dynamic prompt record must contain an object.',
    };
  }

  const record = input as Record<string, unknown>;
  const id = normalizeSingleLine(record.id);
  const name = normalizeSingleLine(record.name);
  const content = normalizePromptContent(record.content);
  const createdBy = normalizeSingleLine(record.createdBy);
  const updatedBy = normalizeSingleLine(record.updatedBy);
  const createdByNumber = normalizeOptionalPhoneNumber(record.createdByNumber);
  const updatedByNumber = normalizeOptionalPhoneNumber(record.updatedByNumber);
  const createdAt = normalizeIsoString(record.createdAt);
  const updatedAt = normalizeIsoString(record.updatedAt);
  const lastUpdatedChatJid = normalizeOptionalSingleLine(record.lastUpdatedChatJid);
  const priority = normalizePriority(record.priority);
  const version = normalizePositiveInteger(record.version);
  const triggerValidation = validateDynamicPromptTrigger(record.trigger);
  const isActive = record.isActive;
  const displayNumber = normalizePositiveInteger(record.displayNumber);
  const targetShape = normalizePromptTargetShape(record);

  if (!id) {
    return {
      ok: false,
      error: 'Dynamic prompt id is required.',
    };
  }
  if (!name) {
    return {
      ok: false,
      error: `Dynamic prompt name is required: ${id}.`,
    };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `Dynamic prompt name is too long: ${id}.`,
    };
  }
  if (!content) {
    return {
      ok: false,
      error: `Dynamic prompt content is required: ${id}.`,
    };
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      error: `Dynamic prompt content is too long: ${id}.`,
    };
  }
  if (!createdBy || !updatedBy) {
    return {
      ok: false,
      error: `Dynamic prompt actor is required: ${id}.`,
    };
  }
  if (!createdAt || !updatedAt) {
    return {
      ok: false,
      error: `Dynamic prompt timestamps are invalid: ${id}.`,
    };
  }
  if (priority === null) {
    return {
      ok: false,
      error: `Dynamic prompt priority must be an integer 1-100: ${id}.`,
    };
  }
  if (version === null) {
    return {
      ok: false,
      error: `Dynamic prompt version must be a positive integer: ${id}.`,
    };
  }
  if (typeof isActive !== 'boolean') {
    return {
      ok: false,
      error: `Dynamic prompt isActive must be boolean: ${id}.`,
    };
  }
  if (!triggerValidation.ok) {
    return {
      ok: false,
      error: `${triggerValidation.error} (${id}).`,
    };
  }
  if (!targetShape.ok) {
    return {
      ok: false,
      error: `${targetShape.error} (${id}).`,
    };
  }

  return {
    ok: true,
    value: {
      id,
      displayNumber: displayNumber ?? 0,
      displayNumberMissing: displayNumber === null,
      name,
      content,
      targetType: targetShape.value.targetType,
      targetMembers: targetShape.value.targetMembers,
      mode: targetShape.value.mode,
      priority,
      trigger: triggerValidation.value,
      isActive,
      createdBy,
      createdByNumber,
      updatedBy,
      updatedByNumber,
      createdAt,
      updatedAt,
      version,
      lastUpdatedChatJid,
    },
  };
}

function normalizePromptTargetShape(
  record: Record<string, unknown>,
):
  | {
      ok: true;
      value: {
        targetType: DynamicPromptTargetType;
        targetMembers: string[];
        mode: DynamicPromptMode;
      };
    }
  | {
      ok: false;
      error: string;
    } {
  const targetType = normalizeDynamicPromptTargetTypeInput(asString(record.targetType));
  const mode = normalizeDynamicPromptModeInput(asString(record.mode));
  const targetMembers = normalizeTargetMembers(record.targetMembers);

  if (targetType && mode) {
    if (!VALID_TARGET_TYPES.includes(targetType)) {
      return {
        ok: false,
        error: 'Dynamic prompt targetType is invalid',
      };
    }
    if (!VALID_MODES.includes(mode)) {
      return {
        ok: false,
        error: 'Dynamic prompt mode is invalid',
      };
    }
    if (targetType === 'global' && targetMembers.length > 0) {
      return {
        ok: false,
        error: 'Dynamic prompt global targetMembers must be empty',
      };
    }
    if (targetType === 'specific' && targetMembers.length === 0) {
      return {
        ok: false,
        error: 'Dynamic prompt specific targetMembers must not be empty',
      };
    }

    return {
      ok: true,
      value: {
        targetType,
        targetMembers,
        mode,
      },
    };
  }

  const legacyScope = normalizeLegacyScope(record.scope);
  const legacyTarget = normalizeOptionalPhoneNumber(record.target);
  if (!legacyScope) {
    return {
      ok: false,
      error: 'Dynamic prompt scope/targetType is invalid',
    };
  }

  switch (legacyScope) {
    case 'global':
      if (legacyTarget !== null) {
        return {
          ok: false,
          error: 'Dynamic prompt global target must be empty',
        };
      }
      return {
        ok: true,
        value: {
          targetType: 'global',
          targetMembers: [],
          mode: 'dm+group',
        },
      };
    case 'sender':
      if (!legacyTarget) {
        return {
          ok: false,
          error: 'Dynamic prompt sender target is required',
        };
      }
      return {
        ok: true,
        value: {
          targetType: 'specific',
          targetMembers: [legacyTarget],
          mode: 'dm+group',
        },
      };
    case 'group':
      return {
        ok: true,
        value: {
          targetType: legacyTarget ? 'specific' : 'global',
          targetMembers: legacyTarget ? [legacyTarget] : [],
          mode: 'group only',
        },
      };
    case 'private':
      return {
        ok: true,
        value: {
          targetType: legacyTarget ? 'specific' : 'global',
          targetMembers: legacyTarget ? [legacyTarget] : [],
          mode: 'dm only',
        },
      };
    default:
      return {
        ok: false,
        error: `Dynamic prompt legacy scope is no longer supported: ${legacyScope}`,
      };
  }
}

function normalizeLegacyScope(value: unknown): 'global' | 'sender' | 'group' | 'private' | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'global' || normalized === 'sender' || normalized === 'group' || normalized === 'private') {
    return normalized;
  }

  return null;
}

function validateDynamicPromptTrigger(
  input: unknown,
):
  | {
      ok: true;
      value: DynamicPromptTrigger;
    }
  | {
      ok: false;
      error: string;
    } {
  if (input === undefined || input === null) {
    return {
      ok: true,
      value: {
        type: 'always',
        value: null,
      },
    };
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      error: 'Dynamic prompt trigger must contain an object',
    };
  }

  const trigger = input as Record<string, unknown>;
  const type = trigger.type;
  if (!VALID_TRIGGERS.includes(type as DynamicPromptTriggerType)) {
    return {
      ok: false,
      error: 'Dynamic prompt trigger type is invalid',
    };
  }

  const normalized = normalizeTriggerValue(type as DynamicPromptTriggerType, trigger.value);
  if (!normalized.ok) {
    return normalized;
  }

  return {
    ok: true,
    value: {
      type: type as DynamicPromptTriggerType,
      value: normalized.value,
    },
  };
}

function normalizeTriggerValue(
  type: DynamicPromptTriggerType,
  value: unknown,
):
  | {
      ok: true;
      value: string | string[] | null;
    }
  | {
      ok: false;
      error: string;
    } {
  if (type === 'always' || type === 'manual') {
    return {
      ok: true,
      value: null,
    };
  }

  if (type === 'keyword') {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    const normalizedValues = values
      .map((item) => normalizeSingleLine(item))
      .filter((item): item is string => Boolean(item));

    if (normalizedValues.length === 0) {
      return {
        ok: false,
        error: 'Dynamic prompt keyword trigger must contain at least one value',
      };
    }

    return {
      ok: true,
      value: normalizedValues,
    };
  }

  const normalizedValue = normalizeSingleLine(value);
  if (!normalizedValue) {
    return {
      ok: false,
      error: 'Dynamic prompt trigger value is required',
    };
  }

  if (type === 'regex') {
    try {
      void new RegExp(normalizedValue, 'iu');
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Dynamic prompt regex is invalid',
      };
    }
  }

  return {
    ok: true,
    value: normalizedValue,
  };
}

function normalizeTargetMembers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((item) => normalizeOptionalPhoneNumber(item))
      .filter((item): item is string => Boolean(item)),
  )].sort((left, right) => left.localeCompare(right, 'en-US'));
}

function normalizeSingleLine(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalSingleLine(value: unknown): string | null {
  return normalizeSingleLine(value) ?? null;
}

function normalizePromptContent(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .replace(/\r\n/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  return normalized.length > 0 ? normalized : null;
}

function normalizeIsoString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizePriority(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_PRIORITY && value <= MAX_PRIORITY
    ? value
    : null;
}

function normalizeOptionalPhoneNumber(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const digits = value.replace(/[^\d]/gu, '');
  return digits.length > 0 ? digits : null;
}

function serializeTriggerValue(value: string | string[] | null): string {
  if (value === null) {
    return '';
  }

  return Array.isArray(value) ? value.join('|') : value;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
