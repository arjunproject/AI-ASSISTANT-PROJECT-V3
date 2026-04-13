import type { CommandTargetNormalizationResult } from './types.js';

const MIN_PHONE_LENGTH = 10;
const MAX_PHONE_LENGTH = 15;
const ALLOWED_JID_SUFFIXES = new Set(['s.whatsapp.net', 'c.us']);

export function normalizeCommandTargetNumber(input: string | null | undefined): CommandTargetNormalizationResult {
  const trimmed = input?.trim() ?? '';
  if (trimmed.length === 0) {
    return {
      ok: false,
      normalized: null,
      reason: 'missing_number',
    };
  }

  let candidate = trimmed;
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex >= 0) {
    const localPart = trimmed.slice(0, atIndex).trim();
    const suffix = trimmed.slice(atIndex + 1).trim().toLowerCase();
    if (!ALLOWED_JID_SUFFIXES.has(suffix)) {
      return {
        ok: false,
        normalized: null,
        reason: 'invalid_number',
      };
    }
    candidate = localPart;
  }

  candidate = candidate
    .replace(/^[+]+/u, '')
    .replace(/^00/u, '')
    .replace(/[()\s\-._]/gu, '');

  if (!/^\d+$/u.test(candidate)) {
    return {
      ok: false,
      normalized: null,
      reason: 'invalid_number',
    };
  }

  if (candidate.startsWith('0')) {
    return {
      ok: false,
      normalized: null,
      reason: 'invalid_number',
    };
  }

  if (candidate.length < MIN_PHONE_LENGTH || candidate.length > MAX_PHONE_LENGTH) {
    return {
      ok: false,
      normalized: null,
      reason: 'invalid_number',
    };
  }

  return {
    ok: true,
    normalized: candidate,
    reason: null,
  };
}
