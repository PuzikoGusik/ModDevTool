import { eq } from 'drizzle-orm';
import { database } from '../../db/index.js';
import { normalizeNickname } from '../../db/nickname.js';
import { profiles } from '../../db/schema.js';

export default async (request: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET' } });
  const normalized = normalizeNickname(new URL(request.url).searchParams.get('nickname'));
  if (!normalized) return Response.json({ error: 'nickname-format' }, { status: 400, headers });
  try {
    const [existing] = await database().select({ userId: profiles.userId }).from(profiles).where(eq(profiles.nicknameKey, normalized.nicknameKey)).limit(1);
    return Response.json({ available: !existing }, { headers });
  } catch {
    return Response.json({ error: 'temporarily-unavailable' }, { status: 503, headers });
  }
};
