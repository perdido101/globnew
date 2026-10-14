import type { Category, ClusterView, SourceType } from '@gw/shared';
import { CATEGORIES, SOURCE_TYPES } from '@gw/shared';

/** Everything a user can tune; persisted to localStorage. */
export interface Settings {
  sourceTypes: SourceType[];
  categories: Category[];
  mutedOutlets: string[];
  mutedRegions: string[];
  minImportance: number;
  /** Only show items first seen within this many hours. */
  timeWindowH: number;
  includeGlobal: boolean;
  density: boolean;
  densityHours: number;
  graticule: boolean;
  cadenceSec: number;
  leftOpen: boolean;
  rightOpen: boolean;
  /** Pinned clusters never decay (stored whole so they survive reloads). */
  pins: Record<string, ClusterView>;
  focusRegion: string | null;
  paused: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sourceTypes: [...SOURCE_TYPES],
  categories: [...CATEGORIES],
  mutedOutlets: [],
  mutedRegions: [],
  minImportance: 0,
  timeWindowH: 24,
  includeGlobal: true,
  density: false,
  densityHours: 12,
  graticule: true,
  cadenceSec: 4.5,
  leftOpen: true,
  rightOpen: true,
  pins: {},
  focusRegion: null,
  paused: false,
};

export const SETTINGS_KEY = 'gw:settings:v1';
