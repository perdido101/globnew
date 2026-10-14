# Decisions & defaults

Choices made while building, so they can be revisited. Tunables mentioned here live in `config.yaml`.

## Sources

**Verification (2026-10-14).** Each RSS/Atom feed in `sources.yaml` was fetched and passed only if it returned
HTTP 200, parsed as RSS/RDF/Atom and had ≥ 5 items dated in the last 7 days. 69 feeds from 63 outlets passed
(global 15, Europe 9, Middle East 6, Asia 17, Africa 7, Americas 8, Oceania 7).

**Dropped or replaced**

| Outlet | Reason | Replacement |
| --- | --- | --- |
| CNN International | All `rss.cnn.com` feeds are frozen (newest items 2023–2024); `cnn.com/services/rss` is HTML | — |
| Associated Press | No public feed; every apnews.com feed URL is a Cloudflare 403 challenge; `feeds.apnews.com` gone | UPI, France 24, DW |
| Reuters | Public RSS discontinued in 2020 | UPI, Anadolu, Bloomberg, WSJ |
| Times of Israel | Cloudflare 403 on all feed URLs | Jerusalem Post, Haaretz |
| Ekathimerini (English) | Cloudflare 403 | Kathimerini (Greek) `/infeeds/rss/nx-rss-feed.xml` |
| CBC World | Connection reset from our egress (likely datacenter blocking); may work elsewhere | The Globe and Mail, Global News |
| The East African, Rappler | 403 | Daily Nation (same publisher), Inquirer, Philstar |
| Brazil Reports | Only 2 items in 7 days | The Rio Times |
| VOA, RFE/RL, Spiegel International, TRT World, News24, AllAfrica, Daily Star BD | Stale, empty, 404 or unreachable | — |
| Balkan Insight | Feed works, but its robots.txt disallows `/feed/` for generic crawlers | Listed in `sources.yaml` with `enabled: false` |

URL corrections that were needed: WSJ moved to `feeds.content.dowjones.io` (the old `feeds.a.dj.com` is frozen);
Mail & Guardian is `/rss/`; Kyiv Independent is `/news-archive/rss/`; Korea Herald is `/rss/newsAll`.

Bloomberg, FT and WSJ feeds carry public headlines only (articles are paywalled) — we only ever show headline + link.

Some feeds (Korea Herald, Inquirer, JPost) label local times as UTC, so items look hours in the future.
Normalisation clamps future timestamps to "now".

**GDELT.** The GEO 2.0 API has been retired (404). Coordinates come from GDELT 2.0's 15-minute **events export**
(`lastupdate.txt` → `export.CSV.zip`: ActionGeo lat/lon + source URL). Each update we take the 25 most-mentioned
geolocated (sub-country) events and title them from the article's Open Graph tags; DOC 2.0 API articles are added
when the API isn't rate-limiting (it often returns 429 from shared IPs) and get coordinates when their URL appears in
the events file. FIPS country codes are mapped to ISO via GeoNames. GDELT's weight is 0.4 (vs 0.6–1.0 for curated RSS).

**Reddit.** Official OAuth (application-only `client_credentials`) when credentials are set: `new` + `rising`,
ranked by **upvote velocity = score / minutes since posting** (min 5 min), surfaced only above `minVelocity`
(per-subreddit overrides in `sources.yaml`), honouring `x-ratelimit-*` headers. Without credentials Reddit blocks
unauthenticated JSON (403), so we fall back to the public `rising` RSS (spaced ≥ 7 s apart). RSS has no scores, so
items get a nominal velocity equal to the threshold — "rising" already selects fast-growing posts. A post that links
to an article is stored under the article URL so it clusters with outlet coverage; the subreddit shows as a badge.

**Telegram.** Public web previews (`t.me/s/<channel>`), parsed with cheerio; view velocity = views / minutes since
posting. Verified channels: bbcrussian, kyivindependent_official, nexta_live, UkraineNow, insiderpaper, disclosetv,
france24_en, AJENews_Official, guardian, wartranslated, meduzalive, DDGeopolitics, intelslava, rybar. Pro-Kremlin
(intelslava, rybar) and conspiracy-leaning (disclosetv) channels are listed but **disabled** by default.
**Every** Telegram item is tagged UNVERIFIED (even official outlet channels — the spec asks for this and the channel
itself can't be authenticated from a web preview). Clusters made only of unverified items get a 15% score discount.

**Politeness.** One shared User-Agent naming the project; robots.txt is checked (cached 6 h) for RSS feeds, Telegram
previews and Open Graph page fetches. Official APIs/data dumps (Reddit OAuth, GDELT) are not robots-checked — they are
API endpoints with their own published rate limits, which we respect. Backoff: `base × 2^(failures−1)`, ±20% jitter,
capped at 1 h, honouring `Retry-After`; never faster than the source's normal interval. After 6 consecutive failures
a source is flagged **dead** (still retried hourly). A news feed that answers but never yields items is flagged dead too.

## Pipeline

- **Metadata only.** Title, ≤ 200-char snippet, image URL, outlet, author handle, URL, timestamps, engagement.
  Open Graph enrichment reads at most the first 400 KB and only keeps `<head>` tags. No article bodies are stored or shown.
- **Images** are proxied: fetched once, resized to 240×160 WebP with `sharp`, cached on disk (pruned after 3 days),
  served from `/img/<hmac>?u=…`. The HMAC stops the proxy being used as an open relay.
- **Geolocation order:** GDELT coordinates → offline gazetteer → LLM. The gazetteer (GeoNames cities ≥ 15k,
  countries, admin-1 regions, non-Latin names for cities ≥ 50k, plus curated aliases/demonyms) favours headline
  mentions over body mentions, strips wire datelines ("SEOUL (Yonhap) —", which name the bureau, not the story),
  treats outlet country only as a tie-breaker, and refuses ambiguous single words (Reading, Mobile, Deal…), person-like
  uses ("Sydney Sweeney"), outlet names ("Washington Post", "Times of Israel") and small towns without context.
  Items with no confident location go to the **Global lane** (feed tab), not the globe.
- **LLM** (`ANTHROPIC_API_KEY`): only asked when the gazetteer has no location / low confidence (< 0.6) or the
  keyword classifier is unsure. Requests are batched (20 items or 4 s), use structured JSON output, are cached in
  Postgres by `sha1(title + snippet)`, capped at `maxCallsPerHour`, and time out to heuristics after 45 s. Auth or
  rate-limit errors pause enrichment instead of failing the pipeline. Default model is `claude-opus-5-5` at `effort: low`;
  `claude-haiku-5-5` in `config.yaml` is far cheaper for this bulk extraction if cost matters.
- **Clustering** uses title token similarity (blend of Jaccard and overlap coefficient over unigrams + bigrams, with
  light stemming) through an inverted index, plus location proximity (a lower threshold within 400 km; never merge
  > 1500 km apart) and an 18 h window. Embeddings were not used: they would require another model call per item, and
  title similarity + geography handles cross-outlet rewrites well in tests. Same-URL items always merge.
- **Score (0–100)** = weighted mix of log-scaled outlet count, lead source weight, engagement velocity, breaking,
  category weight and recency (2 h half-life); the LLM's importance hint, when present, is blended in at 40%.

## Flow

- **Per-session release queues.** Every client session runs its own scheduler over the shared cluster pool, so
  filters, mutes, focus mode and pause decide *what is released* (no gaps or bursts when you filter). Session state
  survives reconnects for 15 min (id in `sessionStorage`), so a reconnect doesn't replay.
- Default cadence 4.5 s ± 35% jitter; highest score first among clusters first seen in the last 6 h.
- Breaking (score ≥ 60) or very high scores (≥ 85) jump the queue, at most once every 15 s.
- New sessions are seeded with the best 14 recent clusters so the globe is never empty.
- Up to 12 cards; older releases collapse to dots and decay after a TTL scaled by importance (20 min → 3 h).
  Decay runs on the client, so **pins** (stored in `localStorage`) never decay.
- A cluster that gains outlets sends an `update` to sessions that already have it: the card's "+N sources" changes in
  place, no new card.

## UI

- Cards are DOM overlays positioned every animation frame from `globe.getScreenCoords`; far-side cards fade out
  using the camera/horizon angle. Placement is greedy by priority (selected → pinned → importance + recency) over
  10 candidate slots (leader length × left/right), avoiding other cards and markers, with hysteresis so cards keep
  their slot while the globe rotates. Markers closer than 30 px collapse into a count bubble; clicking zooms in and
  expands the group.
- Category palette is deliberately desaturated; amber (`#F2A93B`) is reserved for focus, selection and breaking.
- Fonts (Inter, JetBrains Mono) and country outlines (Natural Earth 110m via `world-atlas`) are bundled — no CDN calls.
- The detail drawer's map snippet is an inline SVG equirectangular projection (no tile server).
- Time window, importance threshold and mutes also apply client-side instantly to what's already on screen.

## Performance

Checked in headless Chromium with 600 synthetic clusters on the client. Our own JavaScript costs ~4 ms per marker
re-sync (only when data changes) and ~0.3 ms per frame for card layout; over a 4 s profile, app code accounted for
~25 ms. Frame rate is therefore bound by WebGL (≈600 point meshes + polygons), which is comfortably 60 fps on any
discrete/integrated GPU. The test machine only had software GL, so absolute fps there is meaningless. Marker datums
are reused between syncs so unchanged markers aren't rebuilt; the globe pauses rendering in hidden tabs.

## Known limitations

- Reddit without credentials has no real upvote velocity (see above), and Reddit/GDELT may rate-limit shared IPs.
- Greek/Cyrillic place matching is exact-name with light de-inflection for large places; heavily inflected forms of
  small towns rely on the LLM fallback.
- GDELT event titles depend on the article exposing `og:title`.
- Search covers the in-memory window (48 h).
