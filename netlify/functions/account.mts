import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { eq } from 'drizzle-orm';
import { database } from '../../db/index.js';
import { normalizeNickname, isUniqueConflict } from '../../db/nickname.js';
import { profiles } from '../../db/schema.js';

export default async (request: Request) => {
  const headers = { 'Cache-Control': 'no-store' };
  if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
  if (request.method === 'POST') {
    try { verifyRequestOrigin(request); } catch { return Response.json({ error: 'forbidden' }, { status: 403, headers }); }
  }
  const user = await getUser();
  if (!user || !user.confirmedAt) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  try {
    const db = database();
    if (request.method === 'GET') {
      const [profile] = await db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1);
      return Response.json({ profile: profile ?? null }, { headers });
    }
    if (Number(request.headers.get('content-length')) > 2048) return Response.json({ error: 'payload-too-large' }, { status: 413, headers });
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'invalid-json' }, { status: 400, headers }); }
    const normalized = normalizeNickname(body?.nickname);
    if (!normalized) return Response.json({ error: 'nickname-format' }, { status: 400, headers });
    const [profile] = await db.insert(profiles).values({ userId: user.id, ...normalized }).onConflictDoUpdate({ target: profiles.userId, set: normalized }).returning();
    return Response.json({ profile }, { headers });
  } catch (error) {
    return Response.json({ error: isUniqueConflict(error) ? 'nickname-busy' : 'temporarily-unavailable' }, { status: isUniqueConflict(error) ? 409 : 503, headers });
  }
};
