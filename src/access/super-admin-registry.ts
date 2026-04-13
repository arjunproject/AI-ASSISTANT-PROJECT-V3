import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ManagedSuperAdminRecord } from './types.js';
import { collapseWhitespace, normalizeAdminDisplayName } from '../command/admin-name-normalizer.js';
import type { OfficialSuperAdminProfile } from './super-admin-seed.js';

export interface ManagedSuperAdminRegistryInspection {
  ready: boolean;
  filePath: string;
  activeCount: number;
  superAdmins: Map<string, ManagedSuperAdminRecord>;
  superAdminsByNameKey: Map<string, ManagedSuperAdminRecord>;
  error: string | null;
}

export async function inspectManagedSuperAdminRegistry(input: {
  registryFilePath: string;
  seededProfiles: OfficialSuperAdminProfile[];
}): Promise<ManagedSuperAdminRegistryInspection> {
  try {
    await mkdir(dirname(input.registryFilePath), { recursive: true });

    if (!(await fileExists(input.registryFilePath))) {
      const seededRecords = input.seededProfiles.map((profile) => buildSeedRecord(profile));
      return buildInspection(input.registryFilePath, seededRecords);
    }

    const raw = await readFile(input.registryFilePath, 'utf8');
    const parsed = JSON.parse(raw) as { superAdmins?: unknown };
    const source = Array.isArray(parsed.superAdmins) ? parsed.superAdmins : [];
    const records = source.map((entry) => validateManagedSuperAdminRecord(entry));
    return buildInspection(input.registryFilePath, records);
  } catch (error) {
    return {
      ready: false,
      filePath: input.registryFilePath,
      activeCount: 0,
      superAdmins: new Map(),
      superAdminsByNameKey: new Map(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function writeManagedSuperAdminRegistry(
  registryFilePath: string,
  records: ManagedSuperAdminRecord[],
): Promise<void> {
  await mkdir(dirname(registryFilePath), { recursive: true });
  const payload = {
    superAdmins: records.map((record) => ({
      normalizedPhoneNumber: normalizePhoneNumber(record.normalizedPhoneNumber),
      displayName: collapseWhitespace(record.displayName),
      nameKey: collapseWhitespace(record.nameKey).toLowerCase(),
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      source: record.source,
    })),
  };
  await writeFile(registryFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function upsertManagedSuperAdminRecord(
  records: ManagedSuperAdminRecord[],
  nextRecord: ManagedSuperAdminRecord,
): ManagedSuperAdminRecord[] {
  const withoutTarget = records.filter((record) => record.normalizedPhoneNumber !== nextRecord.normalizedPhoneNumber);
  return [...withoutTarget, nextRecord].sort((left, right) =>
    left.displayName.toLowerCase().localeCompare(right.displayName.toLowerCase()),
  );
}

function buildInspection(
  filePath: string,
  records: ManagedSuperAdminRecord[],
): ManagedSuperAdminRegistryInspection {
  const superAdmins = new Map<string, ManagedSuperAdminRecord>();
  const superAdminsByNameKey = new Map<string, ManagedSuperAdminRecord>();

  for (const record of records) {
    if (superAdmins.has(record.normalizedPhoneNumber)) {
      throw new Error(`Managed super admin registry contains duplicate phone ${record.normalizedPhoneNumber}.`);
    }
    if (superAdminsByNameKey.has(record.nameKey)) {
      throw new Error(`Managed super admin registry contains duplicate name ${record.nameKey}.`);
    }
    superAdmins.set(record.normalizedPhoneNumber, record);
    superAdminsByNameKey.set(record.nameKey, record);
  }

  return {
    ready: true,
    filePath,
    activeCount: records.filter((record) => record.isActive).length,
    superAdmins,
    superAdminsByNameKey,
    error: null,
  };
}

function validateManagedSuperAdminRecord(input: unknown): ManagedSuperAdminRecord {
  if (!input || typeof input !== 'object') {
    throw new Error('Managed super admin registry contains a non-object record.');
  }

  const record = input as Record<string, unknown>;
  const normalizedPhoneNumber = normalizePhoneNumber(asString(record.normalizedPhoneNumber));
  const rawDisplayName = asString(record.displayName);
  const rawNameKey = asString(record.nameKey);
  const isActive = typeof record.isActive === 'boolean' ? record.isActive : null;
  const createdAt = asString(record.createdAt);
  const updatedAt = asString(record.updatedAt);
  const source = asString(record.source);

  if (!normalizedPhoneNumber) {
    throw new Error('Managed super admin registry record is missing a valid normalizedPhoneNumber.');
  }

  if (isActive === null || !createdAt || !updatedAt || !source) {
    throw new Error(`Managed super admin registry record ${normalizedPhoneNumber} is incomplete.`);
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
    throw new Error(`Managed super admin registry record ${normalizedPhoneNumber} has invalid displayName.`);
  }

  if (rawNameKey && rawNameKey !== derivedNameKey) {
    throw new Error(`Managed super admin registry record ${normalizedPhoneNumber} has inconsistent nameKey.`);
  }

  return {
    normalizedPhoneNumber,
    displayName,
    nameKey: derivedNameKey,
    isActive,
    createdAt,
    updatedAt,
    source,
  };
}

function buildSeedRecord(profile: OfficialSuperAdminProfile): ManagedSuperAdminRecord {
  const seededAt = '2026-04-10T00:00:00.000Z';
  return {
    normalizedPhoneNumber: profile.normalizedPhoneNumber,
    displayName: profile.displayName,
    nameKey: profile.nameKey,
    isActive: true,
    createdAt: seededAt,
    updatedAt: seededAt,
    source: 'official_seed',
  };
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
