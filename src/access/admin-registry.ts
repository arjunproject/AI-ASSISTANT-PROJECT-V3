import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { DynamicAdminRecord } from './types.js';
import { collapseWhitespace, normalizeAdminDisplayName } from '../command/admin-name-normalizer.js';

export interface DynamicAdminRegistryInspection {
  ready: boolean;
  filePath: string;
  activeCount: number;
  admins: Map<string, DynamicAdminRecord>;
  adminsByNameKey: Map<string, DynamicAdminRecord>;
  error: string | null;
}

export async function inspectDynamicAdminRegistry(
  registryFilePath: string,
): Promise<DynamicAdminRegistryInspection> {
  try {
    await mkdir(dirname(registryFilePath), { recursive: true });

    if (!(await fileExists(registryFilePath))) {
      return {
        ready: true,
        filePath: registryFilePath,
        activeCount: 0,
        admins: new Map(),
        adminsByNameKey: new Map(),
        error: null,
      };
    }

    const raw = await readFile(registryFilePath, 'utf8');
    const parsed = JSON.parse(raw) as { admins?: unknown };
    const input = Array.isArray(parsed.admins) ? parsed.admins : [];
    const admins = new Map<string, DynamicAdminRecord>();
    const adminsByNameKey = new Map<string, DynamicAdminRecord>();

    for (const entry of input) {
      const record = validateDynamicAdminRecord(entry);
      if (admins.has(record.normalizedPhoneNumber)) {
        throw new Error(`Dynamic admin registry contains duplicate phone ${record.normalizedPhoneNumber}.`);
      }
      if (adminsByNameKey.has(record.nameKey)) {
        throw new Error(`Dynamic admin registry contains duplicate name ${record.nameKey}.`);
      }
      admins.set(record.normalizedPhoneNumber, record);
      adminsByNameKey.set(record.nameKey, record);
    }

    return {
      ready: true,
      filePath: registryFilePath,
      activeCount: [...admins.values()].filter((record) => hasAnyAccessEnabled(record)).length,
      admins,
      adminsByNameKey,
      error: null,
    };
  } catch (error) {
    return {
      ready: false,
      filePath: registryFilePath,
      activeCount: 0,
      admins: new Map(),
      adminsByNameKey: new Map(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function writeDynamicAdminRegistry(
  registryFilePath: string,
  records: DynamicAdminRecord[],
): Promise<void> {
  await mkdir(dirname(registryFilePath), { recursive: true });
  const payload = {
    admins: records.map((record) => ({
      normalizedPhoneNumber: normalizePhoneNumber(record.normalizedPhoneNumber),
      displayName: collapseWhitespace(record.displayName),
      nameKey: collapseWhitespace(record.nameKey).toLowerCase(),
      dmAccessEnabled: record.dmAccessEnabled,
      groupAccessEnabled: record.groupAccessEnabled,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      source: record.source,
    })),
  };
  await writeFile(registryFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function validateDynamicAdminRecord(input: unknown): DynamicAdminRecord {
  if (!input || typeof input !== 'object') {
    throw new Error('Dynamic admin registry contains a non-object record.');
  }

  const record = input as Record<string, unknown>;
  const normalizedPhoneNumber = normalizePhoneNumber(asString(record.normalizedPhoneNumber));
  const rawDisplayName = asString(record.displayName);
  const rawNameKey = asString(record.nameKey);
  const legacyIsActive = typeof record.isActive === 'boolean' ? record.isActive : null;
  const dmAccessEnabled =
    typeof record.dmAccessEnabled === 'boolean' ? record.dmAccessEnabled : legacyIsActive;
  const groupAccessEnabled =
    typeof record.groupAccessEnabled === 'boolean' ? record.groupAccessEnabled : legacyIsActive;
  const createdAt = asString(record.createdAt);
  const updatedAt = asString(record.updatedAt);
  const source = asString(record.source);

  if (!normalizedPhoneNumber) {
    throw new Error('Dynamic admin registry record is missing a valid normalizedPhoneNumber.');
  }

  if (dmAccessEnabled === null || groupAccessEnabled === null) {
    throw new Error(
      `Dynamic admin registry record ${normalizedPhoneNumber} is missing dmAccessEnabled/groupAccessEnabled.`,
    );
  }

  if (!createdAt || !updatedAt || !source) {
    throw new Error(`Dynamic admin registry record ${normalizedPhoneNumber} is incomplete.`);
  }

  const migratedDisplayName = rawDisplayName ?? rawNameKey ?? normalizedPhoneNumber;
  const normalizedName = normalizeAdminDisplayName(migratedDisplayName);
  const isLegacyNumericIdentity = migratedDisplayName === normalizedPhoneNumber;
  const displayName = isLegacyNumericIdentity
    ? normalizedPhoneNumber
    : normalizedName.ok
      ? normalizedName.displayName
      : null;
  const derivedNameKey = isLegacyNumericIdentity
    ? normalizedPhoneNumber
    : normalizedName.ok
      ? normalizedName.nameKey
      : null;

  if (!displayName || !derivedNameKey) {
    throw new Error(`Dynamic admin registry record ${normalizedPhoneNumber} has invalid displayName.`);
  }

  if (rawNameKey && rawNameKey !== derivedNameKey) {
    throw new Error(`Dynamic admin registry record ${normalizedPhoneNumber} has inconsistent nameKey.`);
  }

  return {
    normalizedPhoneNumber,
    displayName,
    nameKey: derivedNameKey,
    dmAccessEnabled,
    groupAccessEnabled,
    createdAt,
    updatedAt,
    source,
  };
}

export function hasAnyAccessEnabled(record: DynamicAdminRecord): boolean {
  return record.dmAccessEnabled || record.groupAccessEnabled;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizePhoneNumber(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/[^\d]/g, '');
  return digits.length > 0 ? digits : null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
