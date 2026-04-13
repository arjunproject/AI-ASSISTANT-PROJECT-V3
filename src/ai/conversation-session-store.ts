import type {
  AiContextPreparation,
  AiConversationSessionStore,
  AiConversationTurn,
} from './types.js';

interface ConversationSession {
  chatJid: string;
  recentTurns: AiConversationTurn[];
  archivedSnippets: ArchivedContextSnippet[];
  updatedAt: string;
}

interface ArchivedContextSnippet {
  summary: string;
  updatedAt: string;
}

export function createAiConversationSessionStore(maxTurns: number): AiConversationSessionStore {
  const safeMaxTurns = Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : 6;
  const maxRecentTurns = Math.max(2, Math.min(safeMaxTurns * 2, 6));
  const sessions = new Map<string, ConversationSession>();

  return {
    prepareContext(chatJid, _userText) {
      const existing = sessions.get(chatJid);
      if (!existing) {
        return createEmptyPreparation();
      }

      const transcript = existing.recentTurns.slice(-maxRecentTurns);
      const archivedSummary = buildArchivedSummary(existing.archivedSnippets);
      const contextLoaded = transcript.length > 0 || Boolean(archivedSummary);

      return {
        summary: archivedSummary,
        transcript,
        contextLoaded,
        contextSource: transcript.length > 0 ? 'current' : archivedSummary ? 'archived' : 'none',
        archivedSnippetCount: existing.archivedSnippets.length,
      };
    },

    rememberExchange(chatJid, userText, assistantText, observedAt, _contextSource) {
      const existing = sessions.get(chatJid) ?? {
        chatJid,
        recentTurns: [],
        archivedSnippets: [],
        updatedAt: observedAt,
      };
      const sanitizedAssistantText = sanitizeAssistantTextForMemory(assistantText);

      const nextRecentTurns = [
        ...existing.recentTurns,
        { role: 'user' as const, text: userText, observedAt },
        ...(sanitizedAssistantText
          ? [
              {
                role: 'assistant' as const,
                text: sanitizedAssistantText,
                observedAt,
              },
            ]
          : []),
      ];

      const overflowCount = Math.max(0, nextRecentTurns.length - maxRecentTurns);
      const archivedTurns = overflowCount > 0 ? nextRecentTurns.slice(0, overflowCount) : [];
      const keptRecentTurns =
        overflowCount > 0 ? nextRecentTurns.slice(overflowCount) : nextRecentTurns;
      const archivedSnippets =
        archivedTurns.length > 0
          ? appendArchivedSnippet(existing.archivedSnippets, archivedTurns, observedAt)
          : existing.archivedSnippets;

      sessions.set(chatJid, {
        chatJid,
        recentTurns: keptRecentTurns,
        archivedSnippets,
        updatedAt: observedAt,
      });
      pruneSessions(sessions, 100);

      return {
        summaryUpdated: true,
        summary: buildArchivedSummary(archivedSnippets),
        activeConversationCount: sessions.size,
      };
    },

    getActiveConversationCount() {
      return sessions.size;
    },
  };
}

function createEmptyPreparation(): AiContextPreparation {
  return {
    summary: null,
    transcript: [],
    contextLoaded: false,
    contextSource: 'none',
    archivedSnippetCount: 0,
  };
}

function appendArchivedSnippet(
  snippets: ArchivedContextSnippet[],
  turns: AiConversationTurn[],
  observedAt: string,
): ArchivedContextSnippet[] {
  const summary = buildSnippetSummary(turns);
  if (!summary) {
    return snippets;
  }

  const lastSnippet = snippets[snippets.length - 1];
  const nextSnippets =
    lastSnippet?.summary === summary
      ? snippets
      : [...snippets, { summary, updatedAt: observedAt }];

  return nextSnippets.slice(-4);
}

function buildSnippetSummary(turns: AiConversationTurn[]): string | null {
  const userLines = turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => trimForSummary(turn.text, 80))
    .filter(Boolean);
  const assistantLines = turns
    .filter((turn) => turn.role === 'assistant')
    .map((turn) => trimForSummary(turn.text, 80))
    .filter(Boolean);

  if (userLines.length === 0 && assistantLines.length === 0) {
    return null;
  }

  const parts = [
    userLines.length > 0 ? `User: ${userLines.slice(-2).join(' / ')}` : null,
    assistantLines.length > 0 ? `Assistant: ${assistantLines.slice(-1)[0]}` : null,
  ].filter((part): part is string => Boolean(part));

  if (parts.length === 0) {
    return null;
  }

  return trimForSummary(parts.join(' | '), 220);
}

function buildArchivedSummary(snippets: ArchivedContextSnippet[]): string | null {
  if (snippets.length === 0) {
    return null;
  }

  const parts = snippets
    .slice(-2)
    .map((snippet, index) => `Konteks lama ${index + 1}: ${snippet.summary}`);

  return trimForSummary(parts.join(' || '), 320);
}

function sanitizeAssistantTextForMemory(text: string): string {
  const sanitized = text
    .replace(/\nSumber:\s[^\n]+/giu, '')
    .replace(/^```json\s*/iu, '')
    .replace(/^```\s*/iu, '')
    .replace(/```$/u, '')
    .trim();

  return containsInternalPayload(sanitized) || containsLegacyReadFallback(sanitized) ? '' : sanitized;
}

function containsInternalPayload(text: string): boolean {
  const trimmed = text.trim();
  if (
    /assistantText|selectedNos|selectionIntent|stockMotor|stockDisplayContract|relevantRecordCount|outputBlockCount|allRelevantBlocksIncluded|fullOutboundText|liveDataBlock|stockMotorCatalogBlock|valueCells/iu.test(
      trimmed,
    )
  ) {
    return true;
  }

  if (
    /\bkatalog stok motor\b|\bproses internal\b|\bsinkron terakhir\b|\bspreadsheet bisnis\b|\bdata bisnis saat ini\b/iu.test(
      trimmed,
    )
  ) {
    return true;
  }

  return (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    /assistantText|selectedNos|selectionIntent|stockMotor|stockDisplayContract|relevantRecordCount|outputBlockCount|allRelevantBlocksIncluded|fullOutboundText|liveDataBlock|stockMotorCatalogBlock|valueCells/iu.test(
      trimmed,
    );
}

function containsLegacyReadFallback(text: string): boolean {
  return /\b(?:belum bisa baca otomatis|belum otomatis bisa baca data pribadimu|kirim\/unggah cuplikan|kirim cuplikan|upload spreadsheet|hubungkan google sheets|hubungkan csv|hubungkan api|langsung masuk ke sistem eksternal|nggak bisa langsung masuk ke sistem eksternal)\b/iu.test(
    text.trim(),
  );
}

function trimForSummary(text: string, maxLength: number): string {
  const compact = text.trim().replace(/\s+/gu, ' ');
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

function pruneSessions(sessions: Map<string, ConversationSession>, maxSessions: number): void {
  if (sessions.size <= maxSessions) {
    return;
  }

  const oldest = [...sessions.values()]
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
    .slice(0, sessions.size - maxSessions);

  for (const session of oldest) {
    sessions.delete(session.chatJid);
  }
}
