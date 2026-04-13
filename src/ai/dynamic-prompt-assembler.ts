import type {
  DynamicPromptAssemblerContext,
  DynamicPromptAssembly,
  DynamicPromptMode,
  DynamicPromptRecord,
} from './dynamic-prompt-types.js';

const MAX_OVERLAY_CHARS = 1_600;

export function assembleDynamicPromptOverlay(
  prompts: DynamicPromptRecord[],
  context: DynamicPromptAssemblerContext,
): DynamicPromptAssembly {
  const matched = prompts
    .filter((prompt) => prompt.isActive)
    .filter((prompt) => matchesTarget(prompt, context))
    .filter((prompt) => matchesMode(prompt.mode, context))
    .filter((prompt) => matchesTrigger(prompt, context))
    .sort(comparePromptsDeterministically);

  const appliedPrompts: DynamicPromptRecord[] = [];
  const overlayParts: string[] = [];
  let totalLength = 0;

  for (const prompt of matched) {
    const part = `[${prompt.name}] ${prompt.content}`.trim();
    const nextLength = totalLength + (overlayParts.length > 0 ? 2 : 0) + part.length;
    if (nextLength > MAX_OVERLAY_CHARS) {
      break;
    }

    overlayParts.push(part);
    appliedPrompts.push(prompt);
    totalLength = nextLength;
  }

  return {
    appliedPrompts,
    overlayText: overlayParts.length > 0 ? overlayParts.join('\n\n') : null,
  };
}

function matchesTarget(prompt: DynamicPromptRecord, context: DynamicPromptAssemblerContext): boolean {
  if (prompt.targetType === 'global') {
    return true;
  }

  return Boolean(
    context.normalizedSender &&
    prompt.targetMembers.includes(context.normalizedSender),
  );
}

function matchesMode(mode: DynamicPromptMode, context: DynamicPromptAssemblerContext): boolean {
  if (mode === 'dm+group') {
    return true;
  }

  if (mode === 'dm only') {
    return !context.isGroup;
  }

  return context.isGroup;
}

function matchesTrigger(prompt: DynamicPromptRecord, context: DynamicPromptAssemblerContext): boolean {
  const text = context.userText.toLocaleLowerCase('en-US');

  switch (prompt.trigger.type) {
    case 'always':
      return true;
    case 'manual':
      return Boolean(context.manualPromptIds?.includes(prompt.id));
    case 'keyword':
      return Array.isArray(prompt.trigger.value)
        ? prompt.trigger.value.some((keyword) => text.includes(keyword.toLocaleLowerCase('en-US')))
        : false;
    case 'regex':
      return typeof prompt.trigger.value === 'string'
        ? new RegExp(prompt.trigger.value, 'iu').test(context.userText)
        : false;
    case 'intent':
      return typeof prompt.trigger.value === 'string'
        ? Boolean(context.intentTags?.includes(prompt.trigger.value))
        : false;
    default:
      return false;
  }
}

function comparePromptsDeterministically(left: DynamicPromptRecord, right: DynamicPromptRecord): number {
  const specificityOrder = getSpecificityRank(left) - getSpecificityRank(right);
  if (specificityOrder !== 0) {
    return specificityOrder;
  }

  const priorityOrder = right.priority - left.priority;
  if (priorityOrder !== 0) {
    return priorityOrder;
  }

  const updatedAtOrder = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (updatedAtOrder !== 0) {
    return updatedAtOrder;
  }

  const displayNumberOrder = left.displayNumber - right.displayNumber;
  if (displayNumberOrder !== 0) {
    return displayNumberOrder;
  }

  return left.id.localeCompare(right.id, 'en-US');
}

function getSpecificityRank(prompt: DynamicPromptRecord): number {
  if (prompt.targetType === 'specific' && prompt.mode !== 'dm+group') {
    return 0;
  }
  if (prompt.targetType === 'specific') {
    return 1;
  }
  if (prompt.mode !== 'dm+group') {
    return 2;
  }
  return 3;
}
