import type { DynamicAdminRecord } from '../access/types.js';
import type { OfficialSuperAdminProfile } from '../access/super-admin-seed.js';
import { normalizeCommandTargetNumber } from './number-normalizer.js';
import { collapseWhitespace, normalizeAdminDisplayName } from './admin-name-normalizer.js';

export interface ParsedAdminTargetInput {
  rawInput: string | null;
  normalizedPhoneNumber: string | null;
  displayName: string | null;
  nameKey: string | null;
  lookupMode: 'name' | 'number' | 'name_number' | null;
}

interface ParsedAdminAddTargetInput extends ParsedAdminTargetInput {
  normalizedPhoneNumber: string;
  displayName: string;
  nameKey: string;
  lookupMode: 'name_number';
}

type ParsedLookupTargetInput =
  | {
      rawInput: string;
      normalizedPhoneNumber: string;
      displayName: null;
      nameKey: null;
      lookupMode: 'number';
    }
  | {
      rawInput: string;
      normalizedPhoneNumber: null;
      displayName: string;
      nameKey: string;
      lookupMode: 'name';
    }
  | {
      rawInput: string;
      normalizedPhoneNumber: string;
      displayName: string;
      nameKey: string;
      lookupMode: 'name_number';
    };

export type ParsedAdminTargetResult =
  | {
      ok: true;
      target: ParsedAdminAddTargetInput;
    }
  | {
      ok: false;
      reason: 'missing_name' | 'invalid_name' | 'missing_number' | 'invalid_number';
    };

export interface ResolvedAdminTarget {
  kind: 'dynamic_admin' | 'super_admin';
  displayName: string;
  nameKey: string;
  normalizedPhoneNumber: string;
  dmAccessEnabled: boolean;
  groupAccessEnabled: boolean;
  isActive: boolean;
  resolvedBy: 'name' | 'number' | 'name_number';
  record: DynamicAdminRecord | null;
  superAdmin: OfficialSuperAdminProfile | null;
}

export type ResolvedAdminTargetResult =
  | {
      ok: true;
      target: ResolvedAdminTarget;
    }
  | {
      ok: false;
      reason: 'admin_not_found' | 'target_mismatch' | 'target_ambiguous' | 'missing_name' | 'invalid_name' | 'missing_number' | 'invalid_number';
    };

export function parseAdminAddTarget(rawInput: string | null | undefined): ParsedAdminTargetResult {
  const parsed = splitTargetInput(rawInput);
  if (parsed.normalizedPhoneNumber === null) {
    return {
      ok: false,
      reason: parsed.rawInput ? 'invalid_number' : 'missing_number',
    };
  }

  const normalizedName = normalizeAdminDisplayName(parsed.rawName);
  if (!normalizedName.ok) {
    return {
      ok: false,
      reason: normalizedName.reason,
    };
  }

  return {
    ok: true,
    target: {
      rawInput: parsed.rawInput,
      normalizedPhoneNumber: parsed.normalizedPhoneNumber,
      displayName: normalizedName.displayName,
      nameKey: normalizedName.nameKey,
      lookupMode: 'name_number',
    },
  };
}

export function resolveAdminTarget(input: {
  rawInput: string | null | undefined;
  registryRecords: Map<string, DynamicAdminRecord>;
  superAdminProfiles: OfficialSuperAdminProfile[];
}): ResolvedAdminTargetResult {
  const parsed = parseLookupTarget(input.rawInput);
  if (!parsed.ok) {
    return parsed;
  }

  const dynamicMatches = findDynamicMatches(parsed.target, input.registryRecords);
  const superAdminMatches = findSuperAdminMatches(parsed.target, input.superAdminProfiles);
  const totalMatches = dynamicMatches.length + superAdminMatches.length;

  if (totalMatches === 0) {
    return {
      ok: false,
      reason:
        parsed.target.lookupMode === 'name_number'
          ? 'target_mismatch'
          : 'admin_not_found',
    };
  }

  if (totalMatches > 1) {
    return {
      ok: false,
      reason: 'target_ambiguous',
    };
  }

  const dynamicMatch = dynamicMatches[0];
  if (dynamicMatch) {
    return {
      ok: true,
      target: {
        kind: 'dynamic_admin',
        displayName: dynamicMatch.displayName,
        nameKey: dynamicMatch.nameKey,
        normalizedPhoneNumber: dynamicMatch.normalizedPhoneNumber,
        dmAccessEnabled: dynamicMatch.dmAccessEnabled,
        groupAccessEnabled: dynamicMatch.groupAccessEnabled,
        isActive: dynamicMatch.dmAccessEnabled || dynamicMatch.groupAccessEnabled,
        resolvedBy: parsed.target.lookupMode ?? 'number',
        record: dynamicMatch,
        superAdmin: null,
      },
    };
  }

  const superAdminMatch = superAdminMatches[0]!;
  return {
    ok: true,
    target: {
      kind: 'super_admin',
      displayName: superAdminMatch.displayName,
      nameKey: superAdminMatch.nameKey,
      normalizedPhoneNumber: superAdminMatch.normalizedPhoneNumber,
      dmAccessEnabled: true,
      groupAccessEnabled: true,
      isActive: true,
      resolvedBy: parsed.target.lookupMode ?? 'number',
      record: null,
      superAdmin: superAdminMatch,
    },
  };
}

type LookupTargetParseResult =
  | {
      ok: true;
      target: ParsedLookupTargetInput;
    }
  | {
      ok: false;
      reason: 'admin_not_found' | 'target_mismatch' | 'target_ambiguous' | 'missing_name' | 'invalid_name' | 'missing_number' | 'invalid_number';
    };

function parseLookupTarget(rawInput: string | null | undefined): LookupTargetParseResult {
  const parsed = splitTargetInput(rawInput);
  if (!parsed.rawInput) {
    return {
      ok: false,
      reason: 'admin_not_found',
    };
  }

  if (parsed.normalizedPhoneNumber) {
    if (!parsed.rawName) {
      return {
        ok: true,
        target: {
          rawInput: parsed.rawInput,
          normalizedPhoneNumber: parsed.normalizedPhoneNumber,
          displayName: null,
          nameKey: null,
          lookupMode: 'number',
        },
      };
    }

    const normalizedName = normalizeAdminDisplayName(parsed.rawName);
    if (!normalizedName.ok) {
      return {
        ok: false,
        reason: normalizedName.reason,
      };
    }

    return {
      ok: true,
      target: {
        rawInput: parsed.rawInput,
        normalizedPhoneNumber: parsed.normalizedPhoneNumber,
        displayName: normalizedName.displayName,
        nameKey: normalizedName.nameKey,
        lookupMode: 'name_number',
      },
    };
  }

  const normalizedName = normalizeAdminDisplayName(parsed.rawInput);
  if (!normalizedName.ok) {
    return {
      ok: false,
      reason: normalizedName.reason,
    };
  }

  return {
    ok: true,
    target: {
      rawInput: parsed.rawInput,
      normalizedPhoneNumber: null,
      displayName: normalizedName.displayName,
      nameKey: normalizedName.nameKey,
      lookupMode: 'name',
    },
  };
}

function splitTargetInput(rawInput: string | null | undefined): {
  rawInput: string | null;
  rawName: string | null;
  normalizedPhoneNumber: string | null;
} {
  const collapsed = collapseWhitespace(rawInput ?? '');
  if (collapsed.length === 0) {
    return {
      rawInput: null,
      rawName: null,
      normalizedPhoneNumber: null,
    };
  }

  const numberOnly = normalizeCommandTargetNumber(collapsed);
  if (numberOnly.ok) {
    return {
      rawInput: collapsed,
      rawName: null,
      normalizedPhoneNumber: numberOnly.normalized,
    };
  }

  const tokens = collapsed.split(' ');
  for (let startIndex = 1; startIndex < tokens.length; startIndex += 1) {
    const rawNumber = tokens.slice(startIndex).join(' ');
    const normalized = normalizeCommandTargetNumber(rawNumber);
    if (!normalized.ok) {
      continue;
    }

    const rawName = collapseWhitespace(tokens.slice(0, startIndex).join(' '));
    if (rawName.length === 0) {
      continue;
    }

    return {
      rawInput: collapsed,
      rawName,
      normalizedPhoneNumber: normalized.normalized,
    };
  }

  return {
    rawInput: collapsed,
    rawName: collapsed,
    normalizedPhoneNumber: null,
  };
}

function findDynamicMatches(
  target: ParsedAdminTargetInput,
  registryRecords: Map<string, DynamicAdminRecord>,
): DynamicAdminRecord[] {
  if (target.lookupMode === 'number') {
    const record = target.normalizedPhoneNumber ? registryRecords.get(target.normalizedPhoneNumber) ?? null : null;
    return record ? [record] : [];
  }

  if (target.lookupMode === 'name') {
    return [...registryRecords.values()].filter((record) => record.nameKey === target.nameKey);
  }

  if (target.lookupMode === 'name_number') {
    const recordByNumber = target.normalizedPhoneNumber
      ? registryRecords.get(target.normalizedPhoneNumber) ?? null
      : null;
    if (!recordByNumber) {
      return [];
    }

    return recordByNumber.nameKey === target.nameKey ? [recordByNumber] : [];
  }

  return [];
}

function findSuperAdminMatches(
  target: ParsedAdminTargetInput,
  superAdminProfiles: OfficialSuperAdminProfile[],
): OfficialSuperAdminProfile[] {
  if (target.lookupMode === 'number') {
    return superAdminProfiles.filter((profile) => profile.normalizedPhoneNumber === target.normalizedPhoneNumber);
  }

  if (target.lookupMode === 'name') {
    return superAdminProfiles.filter((profile) => profile.nameKey === target.nameKey);
  }

  if (target.lookupMode === 'name_number') {
    return superAdminProfiles.filter(
      (profile) =>
        profile.normalizedPhoneNumber === target.normalizedPhoneNumber &&
        profile.nameKey === target.nameKey,
    );
  }

  return [];
}
