export const OFFICIAL_SUPER_ADMIN_NUMBERS = ['6285655002277', '201507007785'] as const;
const OFFICIAL_SUPER_ADMIN_LABELS = ['Bot', 'Super Admin'] as const;

export interface OfficialSuperAdminProfile {
  normalizedPhoneNumber: string;
  displayName: string;
  nameKey: string;
}

export function getOfficialSuperAdminSeed(overrides?: string[]): string[] {
  const source = overrides && overrides.length > 0 ? overrides : [...OFFICIAL_SUPER_ADMIN_NUMBERS];
  const normalized = source
    .map(normalizePhoneNumber)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  return normalized.length > 0 ? [...new Set(normalized)] : [...OFFICIAL_SUPER_ADMIN_NUMBERS];
}

export function getOfficialSuperAdminProfiles(overrides?: string[]): OfficialSuperAdminProfile[] {
  const numbers = getOfficialSuperAdminSeed(overrides);
  return numbers.map((normalizedPhoneNumber, index) => {
    const displayName = OFFICIAL_SUPER_ADMIN_LABELS[index] ?? `Super Admin ${index + 1}`;
    return {
      normalizedPhoneNumber,
      displayName,
      nameKey: normalizeNameKey(displayName),
    };
  });
}

function normalizePhoneNumber(value: string): string | null {
  const digits = value.replace(/[^\d]/g, '');
  return digits.length > 0 ? digits : null;
}

function normalizeNameKey(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLowerCase();
}
