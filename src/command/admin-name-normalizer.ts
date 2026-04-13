export type AdminNameNormalizationResult =
  | {
      ok: true;
      displayName: string;
      nameKey: string;
      reason: null;
    }
  | {
      ok: false;
      displayName: null;
      nameKey: null;
      reason: 'missing_name' | 'invalid_name';
    };

const RESERVED_NAME_KEYS = new Set(['admin', 'add', 'remove', 'list', 'on', 'off', 'status', 'help']);

export function normalizeAdminDisplayName(input: string | null | undefined): AdminNameNormalizationResult {
  const collapsed = collapseWhitespace(input ?? '');
  if (collapsed.length === 0) {
    return {
      ok: false,
      displayName: null,
      nameKey: null,
      reason: 'missing_name',
    };
  }

  const nameKey = collapsed.toLowerCase();
  if (RESERVED_NAME_KEYS.has(nameKey) || /^\d+$/u.test(nameKey)) {
    return {
      ok: false,
      displayName: null,
      nameKey: null,
      reason: 'invalid_name',
    };
  }

  return {
    ok: true,
    displayName: collapsed,
    nameKey,
    reason: null,
  };
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}
