import type { AiGatewayWebSearchSource } from './types.js';

export function formatWebSearchReply(text: string, sources: AiGatewayWebSearchSource[]): string {
  const trimmed = text.trim();
  const sourceLine = buildSourceLine(sources);
  if (!sourceLine) {
    return trimmed;
  }

  return `${trimmed}\nSumber: ${sourceLine}`;
}

function buildSourceLine(sources: AiGatewayWebSearchSource[]): string | null {
  const uniqueValues = [...new Set(
    sources
      .map((source) => source.url?.trim() || source.label?.trim() || source.title?.trim() || '')
      .filter((value) => value.length > 0),
  )].slice(0, 2);

  if (uniqueValues.length === 0) {
    return null;
  }

  return uniqueValues.join(', ');
}
