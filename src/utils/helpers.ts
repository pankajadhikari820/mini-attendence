import type { LanguageCode } from '../types';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

export function buildOrgPrefix(orgName: string): string {
  const cleaned = orgName.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (cleaned.slice(0, 3) || 'ORG').padEnd(3, 'X');
}

export function formatMemberId(prefix: string, role: 'manager' | 'member', num: number): string {
  const rolePart = role === 'manager' ? 'MGR' : 'MEM';
  return `${prefix}-${rolePart}-${String(num).padStart(4, '0')}`;
}

export function getOrgDateString(timezone = 'Asia/Kolkata', dateObj = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(dateObj);
  } catch {
    return dateObj.toISOString().slice(0, 10);
  }
}

export function getOrgTimeHHMM(timezone = 'Asia/Kolkata', dateObj = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(dateObj);
  } catch {
    return dateObj.toTimeString().slice(0, 5);
  }
}

export function isAfterLateTime(currentHHMM: string, lateAfter: string): boolean {
  if (!lateAfter || !/^\d{2}:\d{2}$/.test(lateAfter)) return false;
  return currentHHMM > lateAfter;
}

export function getDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GEOLOCATION_UNSUPPORTED'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  });
}

export function playBeep(success = true): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = success ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(success ? 880 : 280, ctx.currentTime);
    if (success) {
      osc.frequency.setValueAtTime(1174, ctx.currentTime + 0.08);
    }
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
  } catch {
    // AudioContext may be blocked before interaction
  }
}

export function triggerVibration(success = true): void {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(success ? [80] : [120, 60, 120]);
    }
  } catch {
    // Ignore unsupported vibration
  }
}

export function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function eachDateBetween(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return dates;
  }
  const cur = new Date(start);
  let guard = 0;
  while (cur <= end && guard < 90) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard++;
  }
  return dates;
}

export function getPastDates(days: number, timezone = 'Asia/Kolkata'): string[] {
  const todayStr = getOrgDateString(timezone);
  const base = new Date(`${todayStr}T00:00:00Z`);
  const list: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i);
    list.push(d.toISOString().slice(0, 10));
  }
  return list;
}

export function formatLocaleDate(
  dateStr: string,
  lang: LanguageCode,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
): string {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', options).format(d);
}

export function formatLocaleTime(date: Date | null | undefined, lang: LanguageCode): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatLocaleNumber(num: number, lang: LanguageCode): string {
  return new Intl.NumberFormat(lang === 'hi' ? 'hi-IN' : 'en-IN').format(num);
}

export function getFirebaseErrorKey(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  const msg = (error as { message?: string })?.message || '';
  if (!navigator.onLine || code === 'auth/network-request-failed' || code === 'unavailable') {
    return 'errors.noInternet';
  }
  switch (code) {
    case 'auth/email-already-in-use':
      return 'errors.emailInUse';
    case 'auth/invalid-email':
      return 'errors.invalidEmail';
    case 'auth/weak-password':
      return 'errors.weakPassword';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'errors.wrongCredentials';
    case 'auth/too-many-requests':
      return 'errors.tooManyRequests';
    case 'permission-denied':
      return 'errors.permissionDenied';
    default:
      if (msg.includes('permission') || msg.includes('PERMISSION_DENIED')) {
        return 'errors.permissionDenied';
      }
      return 'errors.generic';
  }
}

export function getDefaultRoleLabels(type: string): { manager: string; member: string } {
  switch (type) {
    case 'College':
      return { manager: 'Teacher', member: 'Student' };
    case 'School':
      return { manager: 'Teacher', member: 'Student' };
    case 'Coaching':
      return { manager: 'Faculty', member: 'Student' };
    case 'Company':
      return { manager: 'Team Lead', member: 'Employee' };
    default:
      return { manager: 'Manager', member: 'Member' };
  }
}
