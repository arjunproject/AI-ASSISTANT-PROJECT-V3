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
    prepareContext(chatJid, userText) {
      const existing = sessions.get(chatJid);
      if (!existing) {
        return createEmptyPreparation();
      }

      const transcript = existing.recentTurns.slice(-maxRecentTurns);
      const archivedSummary = buildArchivedSummary(existing.archivedSnippets);
      const contextRelevance = decideContextRelevance(userText, transcript, archivedSummary);
      const selectedTranscript = contextRelevance.includeTranscript
        ? selectRelevantTranscript(userText, transcript)
        : [];
      const selectedSummary = contextRelevance.includeSummary ? archivedSummary : null;
      const contextLoaded = selectedTranscript.length > 0 || Boolean(selectedSummary);

      return {
        summary: selectedSummary,
        transcript: selectedTranscript,
        contextLoaded,
        contextSource: selectedTranscript.length > 0 ? 'current' : selectedSummary ? 'archived' : 'none',
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

function decideContextRelevance(
  userText: string,
  transcript: AiConversationTurn[],
  archivedSummary: string | null,
): {
  includeTranscript: boolean;
  includeSummary: boolean;
} {
  if (transcript.length === 0 && !archivedSummary) {
    return {
      includeTranscript: false,
      includeSummary: false,
    };
  }

  const normalizedUserText = normalizeForContextDecision(userText);
  const isFreshImageHandoff = isImageDerivedInput(userText);
  const explicitReference = hasExplicitContextReference(normalizedUserText);
  const shortFollowUp = isShortContextDependentFollowUp(normalizedUserText);
  const transcriptText = transcript.map((turn) => turn.text).join(' ');
  const transcriptOverlap = hasMeaningfulTokenOverlap(normalizedUserText, transcriptText);
  const summaryOverlap = archivedSummary
    ? hasMeaningfulTokenOverlap(normalizedUserText, archivedSummary)
    : false;

  if (isFreshImageHandoff && !explicitReference) {
    return {
      includeTranscript: false,
      includeSummary: false,
    };
  }

  if (explicitReference || shortFollowUp) {
    return {
      includeTranscript: transcript.length > 0,
      includeSummary: Boolean(archivedSummary && (explicitReference || summaryOverlap)),
    };
  }

  if (transcriptOverlap || summaryOverlap) {
    return {
      includeTranscript: transcriptOverlap && transcript.length > 0,
      includeSummary: summaryOverlap,
    };
  }

  return {
    includeTranscript: false,
    includeSummary: false,
  };
}

function selectRelevantTranscript(
  userText: string,
  transcript: AiConversationTurn[],
): AiConversationTurn[] {
  if (transcript.length <= 2) {
    return transcript;
  }

  const normalizedUserText = normalizeForContextDecision(userText);
  if (prefersLatestExchange(normalizedUserText)) {
    return selectLatestExchange(transcript);
  }

  if (!hasMeaningfulTokenOverlap(normalizedUserText, transcript.map((turn) => turn.text).join(' '))) {
    return selectLatestExchange(transcript);
  }

  const selectedIndexes = new Set<number>();
  transcript.forEach((turn, index) => {
    if (!hasMeaningfulTokenOverlap(normalizedUserText, turn.text)) {
      return;
    }

    selectedIndexes.add(index);
    if (turn.role === 'user' && transcript[index + 1]?.role === 'assistant') {
      selectedIndexes.add(index + 1);
    }
    if (turn.role === 'assistant' && transcript[index - 1]?.role === 'user') {
      selectedIndexes.add(index - 1);
    }
  });

  const selectedTranscript = [...selectedIndexes]
    .sort((left, right) => left - right)
    .map((index) => transcript[index])
    .filter((turn): turn is AiConversationTurn => Boolean(turn));

  return selectedTranscript.length > 0 ? selectedTranscript : transcript;
}

function isImageDerivedInput(text: string): boolean {
  return /(?:^|\n)\s*(?:pesan gambar terbaru|caption user|isi gambar|pertanyaan\/caption user|observasi visual gambar terbaru)\s*:/iu.test(
    text,
  );
}

function hasExplicitContextReference(text: string): boolean {
  return /\b(?:tadi|sebelumnya|sebelum(?:nya)?|barusan|kemarin|lanjut|lanjutkan|lagi|konteks|maksudku|tersebut|balik\s+ke|kembali\s+ke|yang\s+(?:tadi|ini|itu|no|nomor)|no\s*\d+|nomor\s*\d+|record\s*\d+|baris\s*\d+|gambar\s+(?:tadi|sebelumnya)|foto\s+(?:tadi|sebelumnya))\b/iu.test(
    text,
  );
}

function isShortContextDependentFollowUp(text: string): boolean {
  const tokenCount = countContextTokens(text);
  if (tokenCount === 0 || tokenCount > 8 || looksLikeStandaloneShortQuestion(text)) {
    return false;
  }

  return /\b(?:ini|itu|dia|mereka|yg|yang|harganya|rupiahnya|totalnya|rinciannya|detailnya|kalo|kalau)\b/iu.test(
    text,
  );
}

function looksLikeStandaloneShortQuestion(text: string): boolean {
  return (
    /\bberapa\s+(?:hasil|jumlah)\b/iu.test(text) ||
    /\b\d+\s*(?:x|\*|kali|tambah|plus|kurang|bagi|dibagi)\s*\d+\b/iu.test(text)
  );
}

function prefersLatestExchange(text: string): boolean {
  return /\b(?:terbaru|terakhir|barusan|baru\s+ini|yang\s+ini|ini\s+tadi|ini\s+barusan)\b/iu.test(
    text,
  );
}

function hasMeaningfulTokenOverlap(leftText: string, rightText: string): boolean {
  const leftTokens = extractMeaningfulTokens(leftText);
  if (leftTokens.size === 0) {
    return false;
  }

  const rightTokens = extractMeaningfulTokens(rightText);
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      return true;
    }
  }

  return false;
}

function normalizeForContextDecision(text: string): string {
  return text
    .toLocaleLowerCase('id-ID')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

function countContextTokens(text: string): number {
  return extractRawContextTokens(text).length;
}

function extractMeaningfulTokens(text: string): Set<string> {
  return new Set(
    extractRawContextTokens(text)
      .filter((token) => token.length >= 3 || /\d/u.test(token))
      .filter((token) => !CONTEXT_STOP_WORDS.has(token)),
  );
}

function extractRawContextTokens(text: string): string[] {
  return normalizeForContextDecision(text)
    .replace(
      /(?:pesan gambar terbaru|caption user|isi gambar|pertanyaan\/caption user|observasi visual gambar terbaru|tugas jawaban)\s*:/giu,
      ' ',
    )
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

const CONTEXT_STOP_WORDS = new Set([
  'ada',
  'aja',
  'aku',
  'atau',
  'apa',
  'bisa',
  'buat',
  'caption',
  'cek',
  'dari',
  'data',
  'dan',
  'di',
  'dong',
  'foto',
  'gak',
  'gambar',
  'ini',
  'itu',
  'jadi',
  'jawaban',
  'kalau',
  'kalo',
  'kamu',
  'ke',
  'kok',
  'lagi',
  'loh',
  'mau',
  'nya',
  'observasi',
  'pakai',
  'pake',
  'pertanyaan',
  'saja',
  'sama',
  'saya',
  'soal',
  'tadi',
  'tentang',
  'terbaru',
  'the',
  'tolong',
  'tugas',
  'untuk',
  'user',
  'visual',
  'yang',
]);

function selectLatestExchange(transcript: AiConversationTurn[]): AiConversationTurn[] {
  if (transcript.length <= 2) {
    return transcript;
  }

  const lastUserIndex = findLastIndex(transcript, (turn) => turn.role === 'user');
  if (lastUserIndex < 0) {
    return transcript.slice(-2);
  }

  const selected: AiConversationTurn[] = [transcript[lastUserIndex]!];
  const maybeAssistant = transcript[lastUserIndex + 1];
  if (maybeAssistant?.role === 'assistant') {
    selected.push(maybeAssistant);
  } else if (lastUserIndex > 0 && transcript[lastUserIndex - 1]?.role === 'assistant') {
    selected.unshift(transcript[lastUserIndex - 1]!);
  }

  return selected;
}

function findLastIndex<T>(values: T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) {
      return index;
    }
  }

  return -1;
}

function sanitizeAssistantTextForMemory(text: string): string {
  const sanitized = stripTemplateClosingForMemory(
    text
    .replace(/\nSumber:\s[^\n]+/giu, '')
    .replace(/^```json\s*/iu, '')
    .replace(/^```\s*/iu, '')
    .replace(/```$/u, '')
    .trim(),
  );

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

function stripTemplateClosingForMemory(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  while (paragraphs.length > 0 && isTemplateClosingParagraph(paragraphs[paragraphs.length - 1]!)) {
    paragraphs.pop();
  }

  return paragraphs.join('\n\n').trim();
}

function isTemplateClosingParagraph(paragraph: string): boolean {
  const normalized = paragraph.trim();
  if (normalized.length === 0 || normalized.length > 220) {
    return false;
  }

  const startsLikeOffer =
    /^(?:kalau|jika|bila)(?:\s+\w+){0,3}\s+(?:mau|ingin|perlu)\b/iu.test(normalized) ||
    /^(?:mau|ingin|perlu)\s+(?:aku|saya)\b/iu.test(normalized);
  const hasOfferVerb =
    /\b(?:aku|saya)\s+bisa\b/iu.test(normalized) ||
    /\b(?:tinggal|coba)\s+bilang\b/iu.test(normalized) ||
    /\bberi\s+tahu\b/iu.test(normalized);
  const hasTemplateTarget =
    /\b(?:detail|rincian|filter|sheet|file|excel|csv|api|kolom|baris|versi lain|hal lain)\b/iu.test(
      normalized,
    );

  return startsLikeOffer && hasOfferVerb && hasTemplateTarget;
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
