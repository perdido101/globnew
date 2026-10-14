export const CATEGORIES = [
  'conflict',
  'politics',
  'disaster',
  'economy',
  'tech',
  'health',
  'society',
  'climate',
  'sports',
  'culture',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  conflict: 'Conflict & Security',
  politics: 'Politics',
  disaster: 'Disaster & Weather',
  economy: 'Economy & Markets',
  tech: 'Tech & Science',
  health: 'Health',
  society: 'Society',
  climate: 'Climate & Environment',
  sports: 'Sports',
  culture: 'Culture',
};

/** Muted, desaturated palette — never saturated rainbow. */
export const CATEGORY_COLORS: Record<Category, string> = {
  conflict: '#B5655B', // dusty red
  politics: '#6F8FB3', // steel blue
  disaster: '#C8975A', // muted ochre
  economy: '#8FA37A', // sage
  tech: '#7E8CC0', // slate periwinkle
  health: '#5F9E98', // slate teal
  society: '#A88BA6', // dusty mauve
  climate: '#6E9C7A', // moss
  sports: '#C2B183', // sand
  culture: '#9A8C7C', // taupe
};

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}
