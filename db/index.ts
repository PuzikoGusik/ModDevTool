import { drizzle } from 'drizzle-orm/netlify-db';
import * as schema from './schema.js';

export function database() {
  return drizzle({ schema });
}
