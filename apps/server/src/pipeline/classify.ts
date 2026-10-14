import type { Category } from '@gw/shared';

/** Keyword rules: [category, weight, regex]. Matched on lower-cased title (×2) and snippet. */
const RULES: [Category, number, RegExp][] = [
  ['conflict', 3, /\b(war|wars|missile|missiles|drone|drones|airstrike|air strike|strikes? on|shelling|troops|military|army|soldiers?|ceasefire|cease-fire|offensive|militants?|insurgents?|terror|terrorist|bomb|bombing|explosion|blast|gunmen|shooting|killed|attack|attacks|hostages?|invasion|frontline|front line|nato|missile|artillery|navy|warship|rebels?|jihadist|idf|hamas|hezbollah|houthis?|wagner|weapons?|nuclear test|sanctions on|coup)\b/],
  ['conflict', 2, /(πόλεμ|βομβ|επίθεσ|στρατ|войн|удар|обстрел|атак|ракет|дрон|війн|обстріл)/],
  ['politics', 3, /\b(election|elections|vote|voting|voters|ballot|parliament|senate|congress|president|prime minister|pm|minister|government|cabinet|opposition|party|parties|referendum|coalition|lawmakers?|legislation|bill|impeach|diplomat|diplomatic|summit|treaty|talks|negotiations|policy|campaign|poll|polls|supreme court|court rules|ruling|judge|resign|resigns|protest|protests|protesters)\b/],
  ['politics', 2, /(εκλογ|κυβέρν|βουλ|υπουργ|πρωθυπουργ|выбор|правительств|президент|парламент|вибор|уряд|президент)/],
  ['disaster', 4, /\b(earthquake|quake|tsunami|hurricane|typhoon|cyclone|tornado|flood|floods|flooding|landslide|wildfire|wildfires|bushfire|volcano|eruption|storm|blizzard|heatwave|heat wave|drought|avalanche|evacuat\w*|disaster|death toll|rescue|rescuers|collapse|derail\w*|plane crash|crash kills|sinks|capsiz\w*|fire kills|magnitude)\b/],
  ['disaster', 3, /(σεισμ|πυρκαγι|πλημμ|κακοκαιρ|землетрясен|наводнен|пожар|землетрус|повін)/],
  ['economy', 3, /\b(economy|economic|inflation|gdp|recession|interest rates?|central bank|fed|ecb|stocks?|shares|markets?|bond|bonds|yields?|oil prices?|currency|tariffs?|trade|exports?|imports?|budget|debt|bank|banks|banking|earnings|profit|revenue|merger|acquisition|ipo|unemployment|jobs report|wages|imf|world bank|crypto|bitcoin|investors?|layoffs)\b/],
  ['tech', 3, /\b(ai|artificial intelligence|tech|technology|software|chip|chips|semiconductor|apple|google|microsoft|meta|openai|anthropic|nvidia|tesla|spacex|nasa|rocket|satellite|space agency|spacecraft|cyber|cyberattack|hack|hackers|data breach|smartphone|internet|scientists?|research|study finds|physics|astronom\w*|telescope|robot\w*|quantum)\b/],
  ['health', 3, /\b(health|hospital|hospitals|virus|outbreak|pandemic|epidemic|vaccine|vaccines|disease|cholera|measles|ebola|mpox|covid|bird flu|h5n1|world health organi[sz]ation|cancer|drug|drugs|medical|doctors|patients|nurses|mental health|overdose|malaria|dengue)\b/],
  ['climate', 3, /\b(climate|emissions|carbon|net zero|renewable|solar|wind power|fossil fuels?|coal|cop\d+|global warming|biodiversity|deforestation|pollution|environment\w*|glacier|sea level|wildlife|species|conservation|plastic|smog)\b/],
  ['sports', 4, /\b(football|soccer|cricket|tennis|nba|nfl|olympics?|world cup|champions league|premier league|la liga|grand prix|formula one|f1|rugby|golf|marathon|match|tournament|coach|striker|goalkeeper|playoffs?|medal|athlete|fifa|uefa|wimbledon|super bowl)\b/],
  ['culture', 3, /\b(film|movie|cinema|music|album|concert|festival|art|artist|museum|exhibition|book|novel|author|theatre|theater|actor|actress|singer|celebrity|fashion|heritage|unesco|oscar|grammy|eurovision|tv series|netflix)\b/],
  ['society', 2, /\b(police|crime|arrest|arrested|trial|sentenced|prison|murder|migrants?|refugees?|asylum|immigration|education|school|schools|students?|university|housing|poverty|rights|women|lgbt\w*|religion|church|pope|strike|strikers|union|workers|transport|traffic|population|families|children)\b/],
];

export interface Classification {
  category: Category;
  confidence: number;
  scores: Partial<Record<Category, number>>;
}

export function classify(title: string, body = ''): Classification {
  const t = title.toLowerCase();
  const b = body.toLowerCase();
  const scores: Partial<Record<Category, number>> = {};
  for (const [cat, w, re] of RULES) {
    const g = new RegExp(re.source, 'g');
    const inTitle = t.match(g)?.length ?? 0;
    const inBody = b.match(g)?.length ?? 0;
    if (inTitle || inBody) scores[cat] = (scores[cat] ?? 0) + w * (2 * Math.min(inTitle, 3) + Math.min(inBody, 3));
  }
  const ranked = (Object.entries(scores) as [Category, number][]).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { category: 'society', confidence: 0.2, scores };
  const [top, topScore] = ranked[0]!;
  const second = ranked[1]?.[1] ?? 0;
  const confidence = Math.min(0.9, 0.35 + (topScore - second) / (topScore + 4));
  return { category: top, confidence: Math.round(confidence * 100) / 100, scores };
}

const BREAKING = /\b(breaking|just in|developing|urgent|alert|live:|flash)\b|^\s*(live|breaking)\b|έκτακτο|срочно|терміново|⚡|🔴|🚨/i;

export function detectBreaking(title: string, body = ''): boolean {
  return BREAKING.test(title) || /^(breaking|urgent|срочно|терміново|έκτακτο)/i.test(body.trim());
}
