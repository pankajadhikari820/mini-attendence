import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  AttendanceAttempt,
  AttendanceRecord,
  AttendanceSession,
  AttendanceStatus,
  Organization,
  UserProfile,
} from '../types';
import {
  generateSessionToken,
  generateSixDigitCode,
  getFlatEarthDistanceMeters,
  getOrgDateString,
  getOrgTimeHHMM,
  getOrCreateDeviceId,
  isAfterLateTime,
} from '../utils/helpers';
import { buildAttendanceDocId } from './attendanceService';

/**
 * Starts a new Live Attendance Session and atomically initializes its
 * owner-only `sessionSecrets/{sessionId}` document with a 128-bit crypto token
 * and 6-digit live code valid for strictly 10 seconds on the Firestore server clock.
 */
export async function startAttendanceSession(params: {
  org: Organization;
  owner: UserProfile;
  title: string;
  durationMinutes: number;
  lat: number;
  lng: number;
  radius: number;
}): Promise<{ session: AttendanceSession; token: string; code: string }> {
  const sessionRef = doc(collection(db, 'sessions'));
  const sessionId = sessionRef.id;

  const token = generateSessionToken();
  const code = generateSixDigitCode();
  const cosLat = Math.cos((params.lat * Math.PI) / 180);
  const endsAtDate = new Date(Date.now() + params.durationMinutes * 60 * 1000);
  const endsAt = Timestamp.fromDate(endsAtDate);
  const locationCheckEnabled = params.org.location?.enabled ?? true;

  const sessionPayload = {
    orgId: params.org.id,
    ownerUid: params.owner.uid,
    ownerName: params.owner.name,
    ownerRole: params.owner.role === 'admin' ? ('admin' as const) : ('manager' as const),
    title: params.title.trim(),
    status: 'open' as const,
    durationMinutes: params.durationMinutes,
    locationCheckEnabled,
    location: {
      lat: params.lat,
      lng: params.lng,
      cosLat,
      radius: Math.max(20, Math.min(500, Math.round(params.radius))),
    },
    markedCount: 0,
    startedAt: serverTimestamp(),
    endsAt,
  };

  const batch = writeBatch(db);
  batch.set(sessionRef, sessionPayload);
  batch.set(doc(db, 'sessionSecrets', sessionId), {
    ownerUid: params.owner.uid,
    orgId: params.org.id,
    active: true,
    token,
    prevToken: '',
    code,
    prevCode: '',
    rotationSeq: 1,
    tokenUpdatedAt: serverTimestamp(),
  });
  await batch.commit();

  return {
    session: {
      ...sessionPayload,
      id: sessionId,
      startedAt: Timestamp.now(),
    },
    token,
    code,
  };
}

/**
 * Rotates the live session's QR token & 6-digit code every 10 seconds.
 * Immediately overwrites and invalidates the previous token on the server.
 */
export async function rotateSessionSecret(params: {
  sessionId: string;
}): Promise<{ token: string; code: string }> {
  const token = generateSessionToken();
  const code = generateSixDigitCode();

  await updateDoc(doc(db, 'sessionSecrets', params.sessionId), {
    active: true,
    token,
    prevToken: '',
    code,
    prevCode: '',
    rotationSeq: increment(1),
    tokenUpdatedAt: serverTimestamp(),
  });

  return { token, code };
}

export async function extendAttendanceSession(
  sessionId: string,
  currentEndsAt: Timestamp | null | undefined,
  extraMinutes = 10
): Promise<Timestamp> {
  const baseMs = Math.max(Date.now(), currentEndsAt?.toMillis?.() ?? Date.now());
  const nextEndsAt = Timestamp.fromDate(new Date(baseMs + extraMinutes * 60 * 1000));
  await updateDoc(doc(db, 'sessions', sessionId), {
    endsAt: nextEndsAt,
    status: 'open',
  });
  return nextEndsAt;
}

/**
 * Stops a live attendance session and immediately invalidates its active secret
 * atomically so no further QR scans can succeed.
 */
export async function closeAttendanceSession(sessionId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'sessions', sessionId), {
    status: 'closed',
    closedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'sessionSecrets', sessionId), {
    active: false,
    token: '',
    prevToken: '',
    code: '',
    prevCode: '',
    tokenUpdatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function fetchOpenSessionByOwner(
  orgId: string,
  ownerUid: string
): Promise<AttendanceSession | null> {
  const snap = await getDocs(
    query(
      collection(db, 'sessions'),
      where('orgId', '==', orgId),
      where('ownerUid', '==', ownerUid),
      where('status', '==', 'open')
    )
  );
  const nowMs = Date.now();
  const active = snap.docs
    .map((d) => ({ ...(d.data() as Omit<AttendanceSession, 'id'>), id: d.id }))
    .filter((s) => (s.endsAt?.toMillis?.() ?? 0) > nowMs)
    .sort((a, b) => (b.startedAt?.toMillis?.() ?? 0) - (a.startedAt?.toMillis?.() ?? 0));

  return active[0] || null;
}

export function getDirectParentUid(profile: UserProfile, org: Organization): string | null {
  if (profile.role === 'member') return profile.managerId || null;
  if (profile.role === 'manager') return org.adminUid || null;
  return null;
}

export function isAuthorizedForSession(
  profile: UserProfile,
  org: Organization,
  session: AttendanceSession
): boolean {
  if (profile.status !== 'active') return false;
  if (session.orgId !== org.id || profile.orgId !== org.id) return false;
  if (session.ownerRole === 'admin' && profile.role === 'manager') return true;
  if (
    session.ownerRole === 'manager' &&
    profile.role === 'member' &&
    profile.managerId === session.ownerUid
  ) {
    return true;
  }
  return false;
}

/**
 * Finds the active open session of the logged-in user's direct parent
 * (Member -> their Manager, Manager -> Org Admin).
 */
export async function findActiveParentSession(
  profile: UserProfile,
  org: Organization
): Promise<AttendanceSession | null> {
  const parentUid = getDirectParentUid(profile, org);
  if (!parentUid) return null;
  return fetchOpenSessionByOwner(org.id, parentUid);
}

/**
 * Real-time subscription to the direct parent's active live session.
 * Automatically updates when a Live Session starts or stops.
 */
export function subscribeActiveParentSession(
  profile: UserProfile,
  org: Organization,
  callback: (session: AttendanceSession | null) => void,
  onError?: () => void
): () => void {
  const parentUid = getDirectParentUid(profile, org);
  if (!parentUid) {
    callback(null);
    return () => {};
  }

  const q = query(
    collection(db, 'sessions'),
    where('orgId', '==', org.id),
    where('ownerUid', '==', parentUid),
    where('status', '==', 'open')
  );

  return onSnapshot(
    q,
    (snap) => {
      const nowMs = Date.now();
      const active = snap.docs
        .map((d) => ({ ...(d.data() as Omit<AttendanceSession, 'id'>), id: d.id }))
        .filter((s) => (s.endsAt?.toMillis?.() ?? 0) > nowMs)
        .sort((a, b) => (b.startedAt?.toMillis?.() ?? 0) - (a.startedAt?.toMillis?.() ?? 0));
      callback(active[0] || null);
    },
    () => {
      callback(null);
      onError?.();
    }
  );
}

export type ResolvedSessionResult =
  | { status: 'ok'; session: AttendanceSession }
  | { status: 'closed' | 'unauthorized' | 'not_found' | 'network' };

/**
 * Resolves a scanned sessionId directly from Firestore so that scanning an ended,
 * unauthorized, or non-existent session QR returns an accurate, clear error.
 */
export async function resolveScannedSession(
  scannedSessionId: string,
  profile: UserProfile,
  org: Organization
): Promise<ResolvedSessionResult> {
  if (!navigator.onLine) return { status: 'network' };
  try {
    const snap = await getDoc(doc(db, 'sessions', scannedSessionId));
    if (!snap.exists()) {
      return { status: 'not_found' };
    }
    const sess = { ...(snap.data() as Omit<AttendanceSession, 'id'>), id: snap.id };
    if (!isAuthorizedForSession(profile, org, sess)) {
      return { status: 'unauthorized' };
    }
    if (sess.status !== 'open' || (sess.endsAt?.toMillis?.() ?? 0) <= Date.now()) {
      return { status: 'closed' };
    }
    return { status: 'ok', session: sess };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'permission-denied') {
      return { status: 'unauthorized' };
    }
    if (code === 'unavailable' || !navigator.onLine) {
      return { status: 'network' };
    }
    return { status: 'not_found' };
  }
}

export function subscribeSession(
  sessionId: string,
  callback: (session: AttendanceSession | null) => void
): () => void {
  return onSnapshot(doc(db, 'sessions', sessionId), (snap) => {
    if (!snap.exists()) {
      callback(null);
    } else {
      callback({ ...(snap.data() as Omit<AttendanceSession, 'id'>), id: snap.id });
    }
  });
}

export function subscribeSessionAttendance(
  orgId: string,
  sessionId: string,
  callback: (records: AttendanceRecord[]) => void
): () => void {
  const q = query(
    collection(db, 'attendance'),
    where('orgId', '==', orgId),
    where('sessionId', '==', sessionId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ ...(d.data() as AttendanceRecord), id: d.id }))
        .sort((a, b) => (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0));
      callback(list);
    },
    () => callback([])
  );
}

export function subscribeSessionAttempts(
  orgId: string,
  sessionId: string,
  callback: (attempts: AttendanceAttempt[]) => void
): () => void {
  const q = query(
    collection(db, 'attempts'),
    where('orgId', '==', orgId),
    where('sessionId', '==', sessionId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ ...(d.data() as AttendanceAttempt), id: d.id }))
        .sort((a, b) => (b.time?.toMillis?.() ?? 0) - (a.time?.toMillis?.() ?? 0));
      callback(list);
    },
    () => callback([])
  );
}

export async function logFailedAttempt(params: {
  orgId: string;
  sessionId: string;
  ownerUid: string;
  person: UserProfile;
  reason: string;
  distance: number | null;
}): Promise<void> {
  try {
    await addDoc(collection(db, 'attempts'), {
      orgId: params.orgId,
      sessionId: params.sessionId,
      ownerUid: params.ownerUid,
      personUid: params.person.uid,
      personName: params.person.name,
      personId: params.person.memberId || '',
      reason: params.reason,
      distance: params.distance,
      time: serverTimestamp(),
    });
  } catch {
    // Logging failure should never block user feedback
  }
}

export type SelfMarkErrorCode =
  | 'errExpired'
  | 'errInvalidCode'
  | 'errOutsideArea'
  | 'errSessionClosed'
  | 'errAlreadyMarked'
  | 'errDeviceUsed'
  | 'errWrongSession'
  | 'errUnauthorized'
  | 'errNetwork'
  | 'generic';

export interface SelfMarkResult {
  ok: boolean;
  errorCode?: SelfMarkErrorCode;
  status?: AttendanceStatus;
  timeStr?: string;
  distanceMeters?: number;
}

/**
 * Atomic self-marking flow using a Firestore Transaction + strict backend Security Rules:
 * - Atomically checks session status, duplicate attendance, and device lock inside `runTransaction`.
 * - Writes `attendance/{orgId}_{date}_{personUid}` and `sessionDevices/{sessionId}_{deviceId}`
 *   together to prevent race conditions and duplicate entries.
 * - Backend `firestore.rules` authoritatively validates role hierarchy, orgId, open session,
 *   exact current token/code within strictly 10 seconds on `request.time`, GPS radius, and device lock.
 */
export async function submitSelfAttendance(params: {
  org: Organization;
  profile: UserProfile;
  session: AttendanceSession;
  method: 'live_qr' | 'live_code';
  token?: string;
  code?: string;
  lat: number;
  lng: number;
  accuracy: number;
}): Promise<SelfMarkResult> {
  const { org, profile, session, method, lat, lng, accuracy } = params;

  if (!navigator.onLine) {
    return { ok: false, errorCode: 'errNetwork' };
  }

  if (!isAuthorizedForSession(profile, org, session)) {
    return { ok: false, errorCode: 'errUnauthorized' };
  }

  const distanceMeters = getFlatEarthDistanceMeters(
    lat,
    lng,
    session.location.lat,
    session.location.lng,
    session.location.cosLat
  );

  // Fast client pre-check for immediate feedback + attempt logging (enforced again on server)
  if (session.status !== 'open' || (session.endsAt?.toMillis?.() ?? 0) <= Date.now()) {
    return { ok: false, errorCode: 'errSessionClosed' };
  }

  if (session.locationCheckEnabled && distanceMeters > session.location.radius) {
    await logFailedAttempt({
      orgId: org.id,
      sessionId: session.id,
      ownerUid: session.ownerUid,
      person: profile,
      reason: 'outside_radius',
      distance: distanceMeters,
    });
    return { ok: false, errorCode: 'errOutsideArea', distanceMeters };
  }

  const date = getOrgDateString(org.timezone || 'Asia/Kolkata');
  const currentHHMM = getOrgTimeHHMM(org.timezone || 'Asia/Kolkata');
  const attendanceDocId = buildAttendanceDocId(org.id, date, profile.uid);
  const deviceId = getOrCreateDeviceId();
  const deviceDocId = `${session.id}_${deviceId}`;

  const status: AttendanceStatus = isAfterLateTime(currentHHMM, org.lateAfter)
    ? 'late'
    : 'present';

  const sessionRef = doc(db, 'sessions', session.id);
  const attendanceRef = doc(db, 'attendance', attendanceDocId);
  const deviceRef = doc(db, 'sessionDevices', deviceDocId);

  try {
    await runTransaction(db, async (tx) => {
      const [sessSnap, attSnap, devSnap] = await Promise.all([
        tx.get(sessionRef),
        tx.get(attendanceRef),
        tx.get(deviceRef),
      ]);

      if (!sessSnap.exists()) {
        throw new Error('TX_SESSION_CLOSED');
      }
      const liveSess = sessSnap.data() as AttendanceSession;
      if (liveSess.status !== 'open' || (liveSess.endsAt?.toMillis?.() ?? 0) <= Date.now()) {
        throw new Error('TX_SESSION_CLOSED');
      }

      if (attSnap.exists()) {
        throw new Error('TX_ALREADY_MARKED');
      }

      if (devSnap.exists()) {
        throw new Error('TX_DEVICE_USED');
      }

      tx.set(deviceRef, {
        sessionId: session.id,
        deviceId,
        personUid: profile.uid,
        orgId: org.id,
        createdAt: serverTimestamp(),
      });

      tx.set(attendanceRef, {
        orgId: org.id,
        personUid: profile.uid,
        personName: profile.name,
        personMemberId: profile.memberId,
        role: profile.role === 'admin' ? 'manager' : profile.role,
        managerId: profile.managerId || null,
        date,
        timestamp: serverTimestamp(),
        status,
        method,
        markedBy: profile.uid,
        note: '',
        sessionId: session.id,
        lat,
        lng,
        accuracy,
        distanceMeters,
        deviceId,
        ...(method === 'live_qr' ? { submittedToken: params.token || '' } : {}),
        ...(method === 'live_code' ? { submittedCode: params.code || '' } : {}),
      });
    });

    return {
      ok: true,
      status,
      timeStr: currentHHMM,
      distanceMeters,
    };
  } catch (err) {
    const message = (err as Error)?.message || '';
    const codeErr = (err as { code?: string })?.code || '';

    if (message === 'TX_SESSION_CLOSED') {
      return { ok: false, errorCode: 'errSessionClosed' };
    }
    if (message === 'TX_ALREADY_MARKED') {
      return { ok: false, errorCode: 'errAlreadyMarked' };
    }
    if (message === 'TX_DEVICE_USED') {
      await logFailedAttempt({
        orgId: org.id,
        sessionId: session.id,
        ownerUid: session.ownerUid,
        person: profile,
        reason: 'device_already_used',
        distance: distanceMeters,
      });
      return { ok: false, errorCode: 'errDeviceUsed' };
    }

    if (!navigator.onLine || codeErr === 'unavailable' || codeErr === 'deadline-exceeded') {
      return { ok: false, errorCode: 'errNetwork' };
    }

    // If Firestore backend rules rejected the commit, diagnose the exact cause
    if (codeErr === 'permission-denied') {
      try {
        const [attSnap, devSnap, sessSnap] = await Promise.all([
          getDoc(attendanceRef),
          getDoc(deviceRef),
          getDoc(sessionRef),
        ]);
        if (attSnap.exists()) {
          return { ok: false, errorCode: 'errAlreadyMarked' };
        }
        if (devSnap.exists()) {
          await logFailedAttempt({
            orgId: org.id,
            sessionId: session.id,
            ownerUid: session.ownerUid,
            person: profile,
            reason: 'device_already_used',
            distance: distanceMeters,
          });
          return { ok: false, errorCode: 'errDeviceUsed' };
        }
        if (sessSnap.exists()) {
          const s = sessSnap.data() as AttendanceSession;
          if (s.status !== 'open' || (s.endsAt?.toMillis?.() ?? 0) <= Date.now()) {
            return { ok: false, errorCode: 'errSessionClosed' };
          }
        }
      } catch {
        // Proceed to expired/invalid secret classification
      }

      await logFailedAttempt({
        orgId: org.id,
        sessionId: session.id,
        ownerUid: session.ownerUid,
        person: profile,
        reason: 'expired_or_invalid_secret',
        distance: distanceMeters,
      });
      return {
        ok: false,
        errorCode: method === 'live_qr' ? 'errExpired' : 'errInvalidCode',
      };
    }

    return { ok: false, errorCode: 'generic' };
  }
}
