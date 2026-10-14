import { describe, expect, it } from 'vitest';
import { geoDataDir, geoDataPresent } from '../src/geo/download.js';
import { getGazetteer, stripDateline } from '../src/geo/gazetteer.js';

// The gazetteer needs the GeoNames files (`pnpm geo:download`, or the server fetches them on first start).
const d = geoDataPresent() ? describe : describe.skip;

d('gazetteer geolocation', () => {
  const g = () => getGazetteer(geoDataDir());
  const loc = (title: string, body = '', hint?: string) => g().locate(title, body, hint);

  it.each([
    ['Russian drone strike hits apartment block in Kharkiv', 'Kharkiv', 'UA', 'city'],
    ['Wildfires force evacuations near Athens as heatwave grips Greece', 'Athens', 'GR', 'city'],
    ['Protesters clash with police in Nairobi over tax bill', 'Nairobi', 'KE', 'city'],
    ['Floods in Valencia leave thousands without power', 'Valencia', 'ES', 'city'],
    ['Election results in Georgia spark protests in Tbilisi', 'Tbilisi', 'GE', 'city'],
    ['Typhoon makes landfall in the Philippines', 'Philippines', 'PH', 'country'],
    ['Israeli strikes kill dozens in Gaza, health officials say', 'Gaza', 'PS', 'region'],
  ])('%s → %s', (title, place, country, precision) => {
    const r = loc(title);
    expect(r?.place).toBe(place);
    expect(r?.country).toBe(country);
    expect(r?.precision).toBe(precision);
  });

  it('reads non-Latin scripts', () => {
    expect(loc('Πυρκαγιά στην Αθήνα')?.country).toBe('GR');
    expect(loc('Взрывы прогремели в Одессе')?.place).toBe('Odesa');
  });

  it('locates where the story happens, not the outlet dateline', () => {
    const r = loc('Hyundai Motor expands production capacity in India', 'SEOUL, Oct. 15 (Yonhap) -- Hyundai Motor Co. said on Wednesday', 'KR');
    expect(r?.country).toBe('IN');
  });

  it('headline places outweigh body mentions and demonyms', () => {
    expect(loc('Somalia quarantines man who came into contact with Kenyan Ebola victim', 'He travelled from Nairobi')?.country).toBe('SO');
  });

  it.each([
    'Washington Post layoffs hit newsroom',
    'Reading list: the best books of the year',
    'Mobile phone ban in schools',
    'Sydney Sweeney stars in new film',
    'BlackRock, Pimco Tap Counsel Over Virgin Media-Tied Deal',
    '⚡ Зеленский призвал Маска включить Starlink «Думаю, это было бы правильно»',
  ])('does not invent a location: %s', (title) => {
    expect(loc(title)).toBeNull();
  });

  it('country-only matches carry lower confidence than city matches', () => {
    expect(loc('Japan summons ambassador')!.confidence).toBeLessThanOrEqual(0.8);
    expect(loc('Wildfires force evacuations near Athens as heatwave grips Greece')!.confidence).toBeGreaterThan(0.85);
  });
});

describe('stripDateline', () => {
  it('removes wire-style datelines', () => {
    expect(stripDateline('SEOUL, Oct. 15 (Yonhap) -- North Korea fired')).toBe('North Korea fired');
    expect(stripDateline('LONDON (Reuters) - Britain said')).toBe('Britain said');
    expect(stripDateline('Officials in Paris said')).toBe('Officials in Paris said');
  });
});
