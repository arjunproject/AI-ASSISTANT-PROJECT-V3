export type PromptDraftMode = 'add' | 'edit';

export interface PromptDraftSession {
  mode: PromptDraftMode;
  chatJid: string;
  actorNumber: string;
  promptId: string | null;
  displayNumber: number | null;
  createdAt: string;
  expiresAt: string;
}

export interface PromptDraftStore {
  begin(session: PromptDraftSession): void;
  clear(chatJid: string, actorNumber: string): void;
  consume(
    chatJid: string,
    actorNumber: string,
    nowIso?: string,
  ):
    | {
        status: 'active';
        session: PromptDraftSession;
      }
    | {
        status: 'expired';
        session: PromptDraftSession;
      }
    | {
        status: 'none';
      };
}

export function createPromptDraftSessionStore(): PromptDraftStore {
  const sessions = new Map<string, PromptDraftSession>();

  return {
    begin(session) {
      sessions.set(buildKey(session.chatJid, session.actorNumber), session);
    },

    clear(chatJid, actorNumber) {
      sessions.delete(buildKey(chatJid, actorNumber));
    },

    consume(chatJid, actorNumber, nowIso = new Date().toISOString()) {
      const key = buildKey(chatJid, actorNumber);
      const session = sessions.get(key);
      if (!session) {
        return {
          status: 'none',
        };
      }

      if (Date.parse(session.expiresAt) <= Date.parse(nowIso)) {
        sessions.delete(key);
        return {
          status: 'expired',
          session,
        };
      }

      return {
        status: 'active',
        session,
      };
    },
  };
}

function buildKey(chatJid: string, actorNumber: string): string {
  return `${chatJid}::${actorNumber}`;
}
