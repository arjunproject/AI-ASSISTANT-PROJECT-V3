import type { proto, WAMessage, WAMessageKey } from '@whiskeysockets/baileys';

const DEFAULT_MAX_ENTRIES = 250;

export interface RuntimeMessageStore {
  remember(message: WAMessage): void;
  rememberProto(key: WAMessageKey, payload: proto.IMessage | null | undefined): void;
  getMessage(key: WAMessageKey): Promise<proto.IMessage | undefined>;
  clear(): void;
}

export function createRuntimeMessageStore(maxEntries = DEFAULT_MAX_ENTRIES): RuntimeMessageStore {
  const entries = new Map<string, proto.IMessage>();

  return {
    remember(message) {
      rememberProto(message.key, message.message);
    },
    rememberProto,
    async getMessage(key) {
      for (const candidate of buildKeys(key)) {
        const payload = entries.get(candidate);
        if (payload) {
          return payload;
        }
      }

      return undefined;
    },
    clear() {
      entries.clear();
    },
  };

  function rememberProto(key: WAMessageKey, payload: proto.IMessage | null | undefined): void {
    if (!key?.id || !payload) {
      return;
    }

    for (const candidate of buildKeys(key)) {
      if (entries.has(candidate)) {
        entries.delete(candidate);
      }
      entries.set(candidate, payload);
    }

    while (entries.size > maxEntries) {
      const firstKey = entries.keys().next().value;
      if (!firstKey) {
        break;
      }
      entries.delete(firstKey);
    }
  }
}

function buildKeys(key: WAMessageKey): string[] {
  const messageId = key.id ?? '';
  const remoteJid = key.remoteJid ?? '';
  const participant = key.participant ?? '';
  const fromMe = key.fromMe ? '1' : '0';

  return [
    `${messageId}|${remoteJid}|${participant}|${fromMe}`,
    `${messageId}|${remoteJid}|${participant}|*`,
    `${messageId}|${remoteJid}||${fromMe}`,
    `${messageId}|${remoteJid}||*`,
    `${messageId}|||${fromMe}`,
    `${messageId}|||*`,
  ];
}
