import { describe, expect, it } from 'vitest';
import { parseRobots, robotsAllows } from '../src/http/robots.js';
import { bestEventPerUrl, parseEventsCsv, parseGdeltDate } from '../src/ingest/gdelt.js';
import { canonicalUrl, normalise } from '../src/ingest/normalise.js';
import { redditVelocity } from '../src/ingest/reddit.js';
import { parseFeed } from '../src/ingest/rss.js';
import { parseTelegramPage, parseViews, telegramTitle } from '../src/ingest/telegram.js';
import { classify, detectBreaking } from '../src/pipeline/classify.js';
import { snippet } from '../src/util/text.js';

describe('RSS/Atom parsing', () => {
  it('reads RSS 2.0 with media:content', () => {
    const xml = `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel><language>en</language>
      <item><title>Storm hits coast</title><link>https://x.com/a?utm_source=rss</link><description><![CDATA[<p>Big <b>storm</b></p>]]></description>
      <pubDate>Tue, 14 Oct 2026 10:00:00 GMT</pubDate><media:content url="https://x.com/i.jpg" medium="image" width="800"/></item></channel></rss>`;
    const [it] = parseFeed(xml);
    expect(it!.title).toBe('Storm hits coast');
    expect(it!.summary).toBe('Big storm');
    expect(it!.imageUrl).toBe('https://x.com/i.jpg');
    expect(it!.publishedAt?.toISOString()).toBe('2026-10-14T10:00:00.000Z');
  });

  it('reads Atom', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Hello world</title><link rel="alternate" href="https://y.com/1"/><updated>2026-10-14T09:00:00Z</updated><summary>Sum</summary></entry></feed>`;
    expect(parseFeed(xml)[0]).toMatchObject({ url: 'https://y.com/1', title: 'Hello world' });
  });
});

describe('normalisation', () => {
  it('canonicalises URLs (tracking params, fragments)', () => {
    expect(canonicalUrl('http://Example.com/a/?utm_source=x&id=2#top')).toBe('https://example.com/a/?id=2');
  });

  it('never stores more than a short snippet', () => {
    const long = 'word '.repeat(400);
    expect(snippet(long).length).toBeLessThanOrEqual(200);
    const n = normalise(
      { id: 's', type: 'news', name: 'Src', weight: 0.8, enabled: true },
      { url: 'https://e.com/x', title: 'A long enough headline', summary: long, publishedAt: new Date() },
    );
    expect(n!.snippet.length).toBeLessThanOrEqual(200);
  });

  it('clamps future dates (mislabelled feed time zones) to now', () => {
    const now = new Date();
    const n = normalise({ id: 's', type: 'news', name: 'Src', weight: 0.8, enabled: true }, { url: 'https://e.com/y', title: 'Some headline here', publishedAt: new Date(now.getTime() + 9 * 3600_000) }, now);
    expect(n!.publishedAt).toBe(now.toISOString());
  });

  it('marks Telegram items unverified', () => {
    const n = normalise({ id: 't', type: 'telegram', name: 'Chan', weight: 0.5, enabled: true }, { url: 'https://t.me/c/1', title: 'Something happened today', publishedAt: new Date() });
    expect(n!.verified).toBe(false);
  });
});

describe('Telegram web preview', () => {
  const html = `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="chan/42">
    <a class="tgme_widget_message_photo_wrap" style="width:800px;background-image:url('https://cdn.t/x.jpg')"></a>
    <div class="tgme_widget_message_text">Explosions reported in Kharkiv. Air defence active<br>More soon</div>
    <span class="tgme_widget_message_views">12.3K</span>
    <a class="tgme_widget_message_date" href="https://t.me/chan/42"><time datetime="2026-10-14T13:50:47+00:00">13:50</time></a></div></div>`;
  it('parses text, time, views, image and permalink', () => {
    const [m] = parseTelegramPage(html);
    expect(m).toMatchObject({ post: 'chan/42', views: 12300, image: 'https://cdn.t/x.jpg', permalink: 'https://t.me/chan/42' });
    expect(m!.date.toISOString()).toBe('2026-10-14T13:50:47.000Z');
    expect(telegramTitle(m!.text)).toBe('Explosions reported in Kharkiv.');
  });
  it('parses view counts', () => {
    expect(parseViews('881')).toBe(881);
    expect(parseViews('1.2M')).toBe(1_200_000);
  });
});

describe('engagement velocity', () => {
  it('is score per minute since posting', () => {
    const now = Date.now();
    expect(redditVelocity(600, (now - 60 * 60_000) / 1000, now)).toBeCloseTo(10);
  });
});

describe('GDELT', () => {
  it('parses seendate', () => {
    expect(parseGdeltDate('20261014T203000Z')?.toISOString()).toBe('2026-10-14T20:30:00.000Z');
  });
  it('parses the events export and keeps the most specific location per URL', () => {
    const row = (geoType: number, name: string, lat: number, lon: number, mentions: number) => {
      const f = Array(61).fill('');
      f[31] = String(mentions);
      f[51] = String(geoType);
      f[52] = name;
      f[56] = String(lat);
      f[57] = String(lon);
      f[59] = '20261014211500';
      f[60] = 'https://news.example/story';
      return f.join('\t');
    };
    const ev = parseEventsCsv([row(1, 'Ukraine', 49, 32, 10), row(4, 'Kharkiv, Kharkivs\'ka Oblast, Ukraine', 49.98, 36.25, 4)].join('\n'));
    const best = bestEventPerUrl(ev).get('https://news.example/story');
    expect(best?.place).toBe('Kharkiv');
  });
});

describe('classification', () => {
  it.each([
    ['Missile strike kills five as troops advance on front line', 'conflict'],
    ['Magnitude 6.4 earthquake strikes off coast, tsunami warning issued', 'disaster'],
    ['Central bank raises interest rates as inflation climbs', 'economy'],
    ['Champions League: late goal sends holders through', 'sports'],
    ['Parliament passes election reform bill', 'politics'],
  ])('%s → %s', (title, cat) => {
    expect(classify(title).category).toBe(cat);
  });
  it('detects breaking language', () => {
    expect(detectBreaking('BREAKING: Explosion at port')).toBe(true);
    expect(detectBreaking('Analysis: what comes next')).toBe(false);
  });
});

describe('robots.txt', () => {
  it('applies the * group with longest-match allow/disallow', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: OtherBot\nDisallow: /', 'GlobalWire');
    expect(robotsAllows(rules, '/news')).toBe(true);
    expect(robotsAllows(rules, '/private/x')).toBe(false);
    expect(robotsAllows(rules, '/private/ok/1')).toBe(true);
  });
});
