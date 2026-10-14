import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config.js';
import * as schema from './schema.js';

export const sql = postgres(env.databaseUrl, { max: 8, onnotice: () => {} });
export const db = drizzle(sql, { schema });
export type DB = typeof db;
