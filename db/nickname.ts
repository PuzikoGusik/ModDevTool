export function normalizeNickname(value: unknown) {
  if (typeof value !== 'string') return null;
  const nickname = value.normalize('NFKC').trim().replace(/ +/g, ' ');
  if (!/^[A-Za-zА-Яа-яЁё0-9_ -]{3,20}$/.test(nickname)) return null;
  return { nickname, nicknameKey: nickname.toLowerCase() };
}

export function isUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: string; cause?: unknown };
  return record.code === '23505' || isUniqueConflict(record.cause);
}
