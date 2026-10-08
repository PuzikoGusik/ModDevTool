import type { UserSignupEvent, UserDeletedEvent } from '@netlify/functions';
import { eq } from 'drizzle-orm';
import { database } from '../../db/index.js';
import { normalizeNickname } from '../../db/nickname.js';
import { profiles } from '../../db/schema.js';

export default {
  async userSignup(event: UserSignupEvent) {
    const raw = event.user.userMetadata?.nickname;
    if (raw === undefined && event.user.appMetadata?.provider === 'google') return;
    const normalized = normalizeNickname(raw);
    if (!normalized) return event.deny();
    try {
      const [claimed] = await database().insert(profiles).values({ userId: event.user.id, ...normalized }).onConflictDoNothing().returning({ userId: profiles.userId });
      if (!claimed) {
        const [existing] = await database().select().from(profiles).where(eq(profiles.userId, event.user.id)).limit(1);
        if (!existing || existing.nicknameKey !== normalized.nicknameKey) return event.deny();
      }
    } catch { return event.deny(); }
  },
  async userDeleted(event: UserDeletedEvent) {
    await database().delete(profiles).where(eq(profiles.userId, event.user.id));
  },
};
