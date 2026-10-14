import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { fetchText } from '../http/fetch.js';
import type { SourceDef } from '../sources/config.js';
import type { Ingester, RawItem } from './types.js';

/** "12.3K" → 12300, "1.2M" → 1200000 */
export function parseViews(s: string): number {
  const m = /([\d.,]+)\s*([KM]?)/i.exec(s.trim());
  if (!m) return 0;
  const n = parseFloat(m[1]!.replace(',', '.'));
  const mult = m[2]?.toUpperCase() === 'M' ? 1e6 : m[2]?.toUpperCase() === 'K' ? 1e3 : 1;
  return Math.round(n * mult);
}

export function telegramVelocity(views: number, postedAt: Date, now = Date.now()): number {
  const minutes = Math.max(5, (now - postedAt.getTime()) / 60_000);
  return views / minutes;
}

function bgImage(style: string | undefined): string | null {
  if (!style) return null;
  const m = /background-image:\s*url\(['"]?([^'")]+)['"]?\)/i.exec(style);
  return m ? m[1]! : null;
}

export interface TelegramMessage {
  post: string;
  text: string;
  date: Date;
  views: number;
  image: string | null;
  permalink: string;
}

export function parseTelegramPage(html: string): TelegramMessage[] {
  const $ = cheerio.load(html);
  const out: TelegramMessage[] = [];
  $('.tgme_widget_message[data-post]').each((_, el) => {
    const $el = $(el);
    const post = $el.attr('data-post') ?? '';
    const $text = $el.find('.tgme_widget_message_text').first();
    $text.find('br').replaceWith('\n');
    const text = $text.text().trim();
    const dt = $el.find('.tgme_widget_message_date time').attr('datetime') ?? $el.find('time[datetime]').attr('datetime');
    if (!post || !dt) return;
    const date = new Date(dt);
    if (Number.isNaN(date.getTime())) return;
    const views = parseViews($el.find('.tgme_widget_message_views').first().text() || '0');
    const image =
      bgImage($el.find('.tgme_widget_message_photo_wrap').first().attr('style')) ??
      bgImage($el.find('.tgme_widget_message_video_thumb').first().attr('style')) ??
      bgImage($el.find('.link_preview_image').first().attr('style')) ??
      null;
    out.push({ post, text, date, views, image, permalink: `https://t.me/${post}` });
  });
  return out;
}

/** Headline = first line / sentence of the message, trimmed. */
export function telegramTitle(text: string): string {
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.replace(/[^\p{L}\p{N}]/gu, '').length > 8) ?? '';
  const sentence = /^(.{20,160}?[.!?])(\s|$)/u.exec(firstLine)?.[1] ?? firstLine;
  return sentence.length > 160 ? sentence.slice(0, 157).replace(/\s+\S*$/, '') + '…' : sentence;
}

export const telegramIngester: Ingester = {
  async fetch(source: SourceDef): Promise<RawItem[]> {
    const handle = source.handle!.replace(/^@/, '');
    const html = await fetchText(`https://t.me/s/${encodeURIComponent(handle)}`, { maxBytes: 3_000_000 });
    const msgs = parseTelegramPage(html);
    if (msgs.length === 0 && !html.includes('tgme_channel_info')) throw new Error('No public preview for channel');
    const minVelocity = source.minVelocity ?? config.telegram.minVelocity;
    const maxAgeMs = config.telegram.maxPostAgeHours * 3600_000;
    const out: RawItem[] = [];
    for (const m of msgs) {
      if (!m.text || Date.now() - m.date.getTime() > maxAgeMs) continue;
      const velocity = telegramVelocity(m.views, m.date);
      if (velocity < minVelocity) continue;
      const title = telegramTitle(m.text);
      if (!title) continue;
      out.push({
        url: m.permalink,
        title,
        summary: m.text.slice(title.length).replace(/^[\s.…:—–-]+/, '').replace(/🔗.*$/gmu, '').trim(),
        imageUrl: m.image,
        publishedAt: m.date,
        author: `@${handle}`,
        outlet: source.name,
        engagement: { views: m.views, velocity: Math.round(velocity * 10) / 10 },
        hintText: m.text.slice(0, 600),
      });
    }
    return out;
  },
};
