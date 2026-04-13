import type { WAMessage } from '@whiskeysockets/baileys';

import { extractCommandMessageText } from '../whatsapp/message-text.js';
import { findAdminCommandDefinition, findPromptCommandDefinition } from './command-registry.js';
import type { CommandParseResult } from './types.js';

const POSTFIX_ACTIONS = new Set(['status', 'on', 'off', 'remove']);
const PREFIXES = ['admin', 'prompt', 'superadmin'] as const;

export function parseAdminCommandMessage(message: WAMessage): CommandParseResult {
  return parseCommandMessage(message, 'admin');
}

export function parseSuperAdminCommandMessage(message: WAMessage): CommandParseResult {
  return parseCommandMessage(message, 'superadmin');
}

export function parsePromptCommandMessage(message: WAMessage): CommandParseResult {
  return parseCommandMessage(message, 'prompt');
}

export function parseOfficialCommandMessage(message: WAMessage): CommandParseResult {
  const adminResult = parseAdminCommandMessage(message);
  if (adminResult.kind !== 'not_command') {
    return adminResult;
  }

  const superAdminResult = parseSuperAdminCommandMessage(message);
  if (superAdminResult.kind !== 'not_command') {
    return superAdminResult;
  }

  return parsePromptCommandMessage(message);
}

function parseCommandMessage(message: WAMessage, prefix: typeof PREFIXES[number]): CommandParseResult {
  const rawText = extractCommandMessageText(message.message);
  if (!rawText) {
    return {
      kind: 'not_command',
      rawText: null,
      normalizedText: null,
    };
  }

  const rawCommandText = sanitizeAdminCommandText(rawText);
  const normalizedText = normalizeAdminCommandText(rawText);
  if (!normalizedText) {
    return {
      kind: 'not_command',
      rawText,
      normalizedText: null,
    };
  }

  const tokens = normalizedText.split(' ').filter((token) => token.length > 0);
  const rawTokens = rawCommandText.split(' ').filter((token) => token.length > 0);
  if (tokens[0] !== prefix) {
    return {
      kind: 'not_command',
      rawText,
      normalizedText,
    };
  }

  if (tokens.length < 2) {
    return {
      kind: 'invalid_command',
      rawText,
      normalizedText,
    };
  }

  let canonical: string | null = null;
  let argsText: string | null = null;
  let rawArgsText: string | null = null;

  const actionFirstMatch = findActionFirstMatch(tokens, rawTokens, prefix);
  const actionFirstDefinition = actionFirstMatch
    ? findCommandDefinition(actionFirstMatch.canonical)
    : null;
  if (actionFirstDefinition) {
    canonical = actionFirstDefinition.canonical;
    argsText = actionFirstMatch?.argsText ?? null;
    rawArgsText = actionFirstMatch?.rawArgsText ?? null;
  } else if (prefix === 'admin') {
    const actionLastToken = tokens.at(-1) ?? null;
    const actionLastDefinition =
      actionLastToken && POSTFIX_ACTIONS.has(actionLastToken)
        ? findAdminCommandDefinition(`admin ${actionLastToken}`)
        : null;
    if (actionLastDefinition && tokens.length >= 3) {
      canonical = actionLastDefinition.canonical;
      argsText = tokens.slice(1, -1).join(' ').trim() || null;
      rawArgsText = rawTokens.slice(1, -1).join(' ').trim() || null;
    }
  }

  const definition = canonical ? findCommandDefinition(canonical) : null;
  if (!definition) {
    return {
      kind: 'invalid_command',
      rawText,
      normalizedText,
    };
  }

  return {
    kind: 'command',
      parsed: {
        definition,
        rawText,
        normalizedText,
        argsText,
        rawArgsText,
      },
    };
}

export function normalizeAdminCommandText(value: string): string {
  return sanitizeAdminCommandText(value).toLowerCase();
}

function sanitizeAdminCommandText(value: string): string {
  return value
    .trim()
    .replace(/^\/+/u, '')
    .replace(/[_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    ;
}

function findActionFirstMatch(
  tokens: string[],
  rawTokens: string[],
  prefix: typeof PREFIXES[number],
): {
  canonical: string;
  argsText: string | null;
  rawArgsText: string | null;
} | null {
  for (let tokenCount = Math.min(tokens.length, 4); tokenCount >= 2; tokenCount -= 1) {
    const canonical = tokens.slice(0, tokenCount).join(' ');
    if (!findCommandDefinition(canonical)) {
      continue;
    }

    if (!canonical.startsWith(`${prefix} `)) {
      continue;
    }

    return {
      canonical,
      argsText: tokens.slice(tokenCount).join(' ').trim() || null,
      rawArgsText: rawTokens.slice(tokenCount).join(' ').trim() || null,
    };
  }

  return null;
}

function findCommandDefinition(canonical: string) {
  return findAdminCommandDefinition(canonical) ?? findPromptCommandDefinition(canonical);
}
