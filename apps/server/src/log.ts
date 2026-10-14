import pino from 'pino';
import { env } from './config.js';

export const log = pino({
  level: env.logLevel,
  transport: process.stdout.isTTY ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } : undefined,
});
