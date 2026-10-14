const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const IconPause = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" {...s}>
    <path d="M4 2.5v7M8 2.5v7" />
  </svg>
);
export const IconPlay = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" {...s}>
    <path d="M3.5 2.5l6 3.5-6 3.5z" />
  </svg>
);
export const IconSearch = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" {...s}>
    <circle cx="5.5" cy="5.5" r="4" />
    <path d="M8.5 8.5l3.2 3.2" />
  </svg>
);
export const IconPanelLeft = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" {...s}>
    <rect x="1.5" y="1.5" width="10" height="10" rx="1" />
    <path d="M5 1.5v10" />
  </svg>
);
export const IconPanelRight = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" {...s}>
    <rect x="1.5" y="1.5" width="10" height="10" rx="1" />
    <path d="M8 1.5v10" />
  </svg>
);
export const IconTarget = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" {...s}>
    <circle cx="6.5" cy="6.5" r="4.5" />
    <path d="M6.5 0.5v3M6.5 9.5v3M0.5 6.5h3M9.5 6.5h3" />
  </svg>
);
export const IconClose = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" {...s}>
    <path d="M3 3l6 6M9 3l-6 6" />
  </svg>
);
export const IconExternal = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" {...s}>
    <path d="M4.5 2H2v7h7V6.5M6.5 1.5h3v3M9.5 1.5L5 6" />
  </svg>
);
export const IconPin = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" {...s}>
    <path d="M7.5 1.5l3 3-2 1-2 2 .5 2.5-1 1-2-2L1.5 11.5M3 6.5l2.5-2.5 2-2" />
  </svg>
);
export const IconMore = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <circle cx="2.5" cy="6" r="1" />
    <circle cx="6" cy="6" r="1" />
    <circle cx="9.5" cy="6" r="1" />
  </svg>
);
