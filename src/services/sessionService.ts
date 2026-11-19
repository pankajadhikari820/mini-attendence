import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
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

  await setDoc(sessionRef, sessionPayload);

  await setDoc(doc(db, 'sessionSecrets', sessionId), {
    ownerUid: params.owner.uid,
    orgId: params.org.id,
    token,
    prevToken: '',
    code,
    prevCode: '',
    tokenUpdatedAt: serverTimestamp(),
  });

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

export async function rotateSessionSecret(params: {
  sessionId: string;
  prevToken: string;
  prevCode: string;
}): Promise<{ token: string; code: string }> {
  const token = generateSessionToken();
  const code = generateSixDigitCode();

  await updateDoc(doc(db, 'sessionSecrets', params.sessionId), {
    token,
    prevToken: params.prevToken,
    code,
    prevCode: params.prevCode,
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

export async function closeAttendanceSession(sessionId: string): Promise<void> {
  await updateDoc(doc(db, 'sessions', sessionId), {
    status: 'closed',
  });
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

/**
 * Finds the active open session of the logged-in user's direct parent
 * (Member -> their Manager, Manager -> Org Admin).
 */
export async function findActiveParentSession(
  profile: UserProfile,
  org: Organization
): Promise<AttendanceSession | null> {
  const parentUid =
    profile.role === 'member'
      ? profile.managerId
      : profile.role === 'manager'
      ? org.adminUid
      : null;

  if (!parentUid) return null;
  return fetchOpenSessionByOwner(org.id, parentUid);
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
  | 'generic';

export interface SelfMarkResult {
  ok: boolean;
  errorCode?: SelfMarkErrorCode;
  status?: AttendanceStatus;
  timeStr?: string;
  distanceMeters?: number;
}

/**
 * Self-marking flow enforced by Firestore Security Rules (zero Cloud Functions):
 * - Writes `attendance/{orgId}_{date}_{personUid}` and `sessionDevices/{sessionId}_{deviceId}`
 *   atomically in a single writeBatch.
 * - Firestore rules verify session open/endsAt, token/code against `sessionSecrets`
 *   (15s current / 5s previous), flat-earth radius using `cosLat`, and one-device lock.
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

  const distanceMeters = getFlatEarthDistanceMeters(
    lat,
    lng,
    session.location.lat,
    session.location.lng,
    session.location.cosLat
  );

  // Client pre-checks for immediate feedback + attempt logging
  if (session.status !== 'open' || (session.endsAt?.toMillis?.() ?? 0) < Date.now()) {
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

  // Check if already marked today
  const existingAtt = await getDoc(doc(db, 'attendance', attendanceDocId));
  if (existingAtt.exists()) {
    return { ok: false, errorCode: 'errAlreadyMarked' };
  }

  // Check if this device was already used in this session
  const deviceId = getOrCreateDeviceId();
  const deviceDocId = `${session.id}_${deviceId}`;
  try {
    const existingDevice = await getDoc(doc(db, 'sessionDevices', deviceDocId));
    if (existingDevice.exists()) {
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
  } catch {
    // Proceed to atomic batch which is authoritative
  }

  const status: AttendanceStatus = isAfterLateTime(currentHHMM, org.lateAfter)
    ? 'late'
    : 'present';

  const batch = writeBatch(db);

  batch.set(doc(db, 'sessionDevices', deviceDocId), {
    sessionId: session.id,
    deviceId,
    personUid: profile.uid,
    orgId: org.id,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'attendance', attendanceDocId), {
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

  try {
    await batch.commit();
    return {
      ok: true,
      status,
      timeStr: currentHHMM,
      distanceMeters,
    };
  } catch (err) {
    // Diagnose rejection reason accurately
    try {
      const [attSnap, devSnap, sessSnap] = await Promise.all([
        getDoc(doc(db, 'attendance', attendanceDocId)),
        getDoc(doc(db, 'sessionDevices', deviceDocId)),
        getDoc(doc(db, 'sessions', session.id)),
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
        if (s.status !== 'open' || (s.endsAt?.toMillis?.() ?? 0) < Date.now()) {
          return { ok: false, errorCode: 'errSessionClosed' };
        }
      }
    } catch {
      // Fall through to token/code error
    }

    const codeErr = (err as { code?: string })?.code;
    if (codeErr === 'permission-denied') {
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
