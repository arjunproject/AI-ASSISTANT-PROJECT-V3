import type { AdminCommandDefinition } from './types.js';

const ADMIN_COMMAND_REGISTRY: readonly AdminCommandDefinition[] = [
  {
    name: 'admin.add',
    canonical: 'admin add',
    usage: 'Admin add <nama> <nomor>',
    description: 'Tambah admin dinamis aktif.',
    requiresTarget: true,
  },
  {
    name: 'admin.remove',
    canonical: 'admin remove',
    usage: 'Admin remove <nama|nomor|nama nomor>',
    description: 'Hapus admin dinamis.',
    requiresTarget: true,
  },
  {
    name: 'admin.list',
    canonical: 'admin list',
    usage: 'Admin list',
    description: 'Lihat super admin dan admin dinamis.',
    requiresTarget: false,
  },
  {
    name: 'admin.on',
    canonical: 'admin on',
    usage: 'Admin on <nama|nomor|nama nomor>',
    description: 'Aktifkan akses DM dan grup resmi admin dinamis.',
    requiresTarget: true,
  },
  {
    name: 'admin.off',
    canonical: 'admin off',
    usage: 'Admin off <nama|nomor|nama nomor>',
    description: 'Nonaktifkan akses DM dan grup resmi admin dinamis.',
    requiresTarget: true,
  },
  {
    name: 'admin.dm.on',
    canonical: 'admin dm on',
    usage: 'Admin DM on <nama|nomor|nama nomor>',
    description: 'Aktifkan akses DM admin dinamis.',
    requiresTarget: true,
  },
  {
    name: 'admin.dm.off',
    canonical: 'admin dm off',
    usage: 'Admin DM off <nama|nomor|nama nomor>',
    description: 'Nonaktifkan akses DM admin dinamis.',
    requiresTarget: true,
  },
  {
    name: 'admin.group.on',
    canonical: 'admin group on',
    usage: 'Admin Group on <nama|nomor|nama nomor>',
    description: 'Aktifkan akses grup resmi admin dinamis.',
    requiresTarget: true,
  },
  {
    name: 'admin.group.off',
    canonical: 'admin group off',
    usage: 'Admin Group off <nama|nomor|nama nomor>',
    description: 'Nonaktifkan akses grup resmi admin dinamis.',
    requiresTarget: true,
  },
  {
    name: 'admin.status',
    canonical: 'admin status',
    usage: 'Admin status <nama|nomor|nama nomor>',
    description: 'Lihat status satu nomor.',
    requiresTarget: true,
  },
  {
    name: 'admin.help',
    canonical: 'admin help',
    usage: 'Admin help',
    description: 'Lihat command resmi.',
    requiresTarget: false,
  },
] as const;

const PROMPT_COMMAND_REGISTRY: readonly AdminCommandDefinition[] = [
  {
    name: 'prompt.list',
    canonical: 'prompt list',
    usage: 'Prompt list',
    description: 'Lihat daftar prompt dinamis.',
    requiresTarget: false,
  },
  {
    name: 'prompt.show',
    canonical: 'prompt show',
    usage: 'Prompt show <nomor>',
    description: 'Lihat detail satu prompt.',
    requiresTarget: true,
  },
  {
    name: 'prompt.add',
    canonical: 'prompt add',
    usage: 'Prompt add',
    description: 'Buka template tambah prompt.',
    requiresTarget: false,
  },
  {
    name: 'prompt.edit',
    canonical: 'prompt edit',
    usage: 'Prompt edit <nomor>',
    description: 'Buka template edit prompt.',
    requiresTarget: true,
  },
  {
    name: 'prompt.on',
    canonical: 'prompt on',
    usage: 'Prompt on <nomor>',
    description: 'Aktifkan prompt dinamis.',
    requiresTarget: true,
  },
  {
    name: 'prompt.off',
    canonical: 'prompt off',
    usage: 'Prompt off <nomor>',
    description: 'Nonaktifkan prompt dinamis.',
    requiresTarget: true,
  },
  {
    name: 'prompt.remove',
    canonical: 'prompt remove',
    usage: 'Prompt remove <nomor>',
    description: 'Hapus prompt dinamis.',
    requiresTarget: true,
  },
] as const;

const ADMIN_COMMAND_REGISTRY_BY_CANONICAL = new Map(
  ADMIN_COMMAND_REGISTRY.map((definition) => [definition.canonical, definition]),
);

const PROMPT_COMMAND_REGISTRY_BY_CANONICAL = new Map(
  PROMPT_COMMAND_REGISTRY.map((definition) => [definition.canonical, definition]),
);

export function getAdminCommandRegistry(): readonly AdminCommandDefinition[] {
  return ADMIN_COMMAND_REGISTRY;
}

export function getPromptCommandRegistry(): readonly AdminCommandDefinition[] {
  return PROMPT_COMMAND_REGISTRY;
}

export function getOfficialCommandRegistry(): readonly AdminCommandDefinition[] {
  return [...ADMIN_COMMAND_REGISTRY, ...PROMPT_COMMAND_REGISTRY];
}

export function findAdminCommandDefinition(canonical: string): AdminCommandDefinition | null {
  return ADMIN_COMMAND_REGISTRY_BY_CANONICAL.get(canonical) ?? null;
}

export function findPromptCommandDefinition(canonical: string): AdminCommandDefinition | null {
  return PROMPT_COMMAND_REGISTRY_BY_CANONICAL.get(canonical) ?? null;
}

export function buildAdminHelpText(): string {
  return [
    'Admin help:',
    ...getOfficialCommandRegistry().map((definition) => `- ${definition.usage}`),
  ].join('\n');
}
