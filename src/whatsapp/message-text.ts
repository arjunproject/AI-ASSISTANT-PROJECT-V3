export function extractMessageText(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 5) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const directText =
    asNonEmptyString(record.conversation) ??
    asNestedString(record.extendedTextMessage, 'text') ??
    asNestedString(record.imageMessage, 'caption') ??
    asNestedString(record.videoMessage, 'caption') ??
    asNestedString(record.documentMessage, 'caption') ??
    asNestedString(record.buttonsResponseMessage, 'selectedDisplayText') ??
    asNestedString(record.listResponseMessage, 'title') ??
    asNestedString(record.templateButtonReplyMessage, 'selectedDisplayText');

  if (directText) {
    return directText;
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object') {
      const nestedMessage = (nested as Record<string, unknown>).message ?? nested;
      const nestedText = extractMessageText(nestedMessage, depth + 1);
      if (nestedText) {
        return nestedText;
      }
    }
  }

  return null;
}

export function extractCommandMessageText(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 5) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const directText =
    asNonEmptyString(record.conversation) ??
    asNestedString(record.extendedTextMessage, 'text') ??
    asNestedString(record.buttonsResponseMessage, 'selectedDisplayText') ??
    asNestedString(record.listResponseMessage, 'title') ??
    asNestedString(record.templateButtonReplyMessage, 'selectedDisplayText');

  if (directText) {
    return directText;
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object') {
      const nestedMessage = (nested as Record<string, unknown>).message ?? nested;
      const nestedText = extractCommandMessageText(nestedMessage, depth + 1);
      if (nestedText) {
        return nestedText;
      }
    }
  }

  return null;
}

export function extractMessageTextPreview(value: unknown, maxLength = 120): string | null {
  const text = extractMessageText(value);
  if (!text) {
    return null;
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function asNestedString(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return asNonEmptyString((value as Record<string, unknown>)[key]);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
