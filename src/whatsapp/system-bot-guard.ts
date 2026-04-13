function normalizePhoneNumber(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/[^\d]/g, '');
  return digits.length > 0 ? digits : null;
}

export function listSiblingBotNumbers(botPrimaryNumber: string, superAdminNumbers: string[]): string[] {
  const ownNumber = normalizePhoneNumber(botPrimaryNumber);
  const siblingNumbers = superAdminNumbers
    .map((value) => normalizePhoneNumber(value))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .filter((value) => value !== ownNumber);

  return [...new Set(siblingNumbers)];
}

export function isSiblingBotSender(
  normalizedSender: string | null,
  botPrimaryNumber: string,
  superAdminNumbers: string[],
): boolean {
  const senderNumber = normalizePhoneNumber(normalizedSender);
  if (!senderNumber) {
    return false;
  }

  return listSiblingBotNumbers(botPrimaryNumber, superAdminNumbers).includes(senderNumber);
}
