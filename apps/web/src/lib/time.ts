export function relTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`;
  return `${Math.floor(h / 24)}d`;
}

export function utcHHMM(d: Date | number | string): string {
  const x = new Date(d);
  return `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`;
}

export function utcClock(d = new Date()): string {
  return `${utcHHMM(d)}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
}

export function fmtCoord(lat: number, lng: number): string {
  const la = `${Math.abs(lat).toFixed(2).padStart(5, '0')}°${lat >= 0 ? 'N' : 'S'}`;
  const lo = `${Math.abs(lng).toFixed(2).padStart(6, '0')}°${lng >= 0 ? 'E' : 'W'}`;
  return `${la} ${lo}`;
}
