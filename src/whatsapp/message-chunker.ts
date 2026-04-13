const DEFAULT_MAX_WHATSAPP_TEXT_LENGTH = 3_500;

export function splitOutgoingText(
  text: string,
  maxLength: number = DEFAULT_MAX_WHATSAPP_TEXT_LENGTH,
): string[] {
  const normalized = normalizeOutgoingText(text);
  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const blocks = splitPrimaryBlocks(normalized);
  const expandedBlocks = blocks.flatMap((block) => splitOversizedBlock(block, maxLength));

  return combineBlocks(expandedBlocks, maxLength);
}

function normalizeOutgoingText(text: string): string {
  return String(text ?? '')
    .replace(/\r\n/gu, '\n')
    .replace(/\u0000/gu, '')
    .trim();
}

function splitPrimaryBlocks(text: string): string[] {
  const blocks = text
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return blocks.length > 0 ? blocks : [text];
}

function splitOversizedBlock(block: string, maxLength: number): string[] {
  if (block.length <= maxLength) {
    return [block];
  }

  const lines = block
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length > 1) {
    return combineWithSeparator(
      lines.flatMap((line) => splitOversizedLine(line, maxLength)),
      '\n',
      maxLength,
    );
  }

  return splitOversizedLine(block, maxLength);
}

function splitOversizedLine(line: string, maxLength: number): string[] {
  if (line.length <= maxLength) {
    return [line];
  }

  const sentences = line.match(/[^.!?\n]+(?:[.!?]+|$)/gu)?.map((part) => part.trim()) ?? [];
  if (sentences.length > 1) {
    return combineWithSeparator(
      sentences.flatMap((sentence) => splitByWords(sentence, maxLength)),
      ' ',
      maxLength,
    );
  }

  return splitByWords(line, maxLength);
}

function splitByWords(text: string, maxLength: number): string[] {
  const words = text.split(/\s+/u).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [text.slice(0, maxLength)];
  }

  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(...splitHard(word, maxLength));
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = word;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitHard(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }
  return chunks;
}

function combineBlocks(blocks: string[], maxLength: number): string[] {
  return combineWithSeparator(blocks, '\n\n', maxLength);
}

function combineWithSeparator(
  units: string[],
  separator: string,
  maxLength: number,
): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const unit of units) {
    const normalizedUnit = unit.trim();
    if (normalizedUnit.length === 0) {
      continue;
    }

    if (normalizedUnit.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(...splitHard(normalizedUnit, maxLength));
      continue;
    }

    const next = current ? `${current}${separator}${normalizedUnit}` : normalizedUnit;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = normalizedUnit;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [''];
}

export const WHATSAPP_TEXT_CHUNK_LIMIT = DEFAULT_MAX_WHATSAPP_TEXT_LENGTH;
