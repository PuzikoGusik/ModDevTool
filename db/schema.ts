import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const profiles = pgTable('account_profiles', {
  userId: text('user_id').primaryKey(),
  nickname: text('nickname').notNull(),
  nicknameKey: text('nickname_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
