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
  FacultyAssignment,
  Organization,
  TimetableSlot,
  UserProfile,
} from '../types';
import {
  generateSessionToken,
  generateSixDigitCode,
  getFlatEarthDistanceMeters,
  getOrgDateString,
  getOrgTimeHHMM,
  getOrCreateDeviceId,
  normalizeAttendanceStatus,
} from '../utils/helpers';
import { buildSessionAttendanceDocId } from './attendanceService';
import { recordAuditLog } from './auditService';

/**
 * Starts a new Live Attendance Session scoped to a specific subject, class, semester,
 * section, and teacher (or Org-level Admin -> Manager session).
 * Atomically initializes its owner-only `sessionSecrets/{sessionId}` document with a
 * 128-bit crypto token and 6-digit live code valid for strictly 10 seconds on `request.time`.
 * Prevents duplicate open sessions for the same teacher + class + subject or timetable slot.
 */
export async function startAttendanceSession(params: {
  org: Organization;
  owner: UserProfile;
  title: string;
  durationMinutes: number;
  lat: number;
  lng: number;
  radius: number;
  assignment?: FacultyAssignment | null;
  timetableSlot?: TimetableSlot | null;
  departmentId?: string | null;
  departmentName?: string;
  classId?: string | null;
  className?: string;
  subjectId?: string | null;
  subjectName?: string;
  subjectCode?: string;
  courseName?: string;
  semester?: string;
  section?: string;
  classroom?: string;
  roomNumber?: string;
  timetableSlotId?: string | null;
  startTimeLabel?: string;
  endTimeLabel?: string;
}): Promise<{ session: AttendanceSession; token: string; code: string }> {
  // Check for duplicate active session by this owner for the exact same subject/slot
  const openMine = await fetchOpenSessionsByOwner(params.org.id, params.owner.uid);
  const targetSubjectId =
    params.subjectId || params.timetableSlot?.subjectId || params.assignment?.subjectId || '';
  const targetClassId =
    params.classId || params.timetableSlot?.classId || params.assignment?.classId || '';
  const targetSlotId = params.timetableSlotId || params.timetableSlot?.id || '';

  const duplicate = openMine.find((s) => {
    if (targetSlotId && s.timetableSlotId === targetSlotId) return true;
    if (targetSubjectId && targetClassId) {
      return s.subjectId === targetSubjectId && s.classId === targetClassId;
    }
    return !targetSubjectId && !s.subjectId;
  });

  if (duplicate) {
    // Re-attach cleanly instead of creating duplicate conflicting sessions
    const fresh = await rotateSessionSecret({ sessionId: duplicate.id });
    return { session: duplicate, token: fresh.token, code: fresh.code };
  }

  const sessionRef = doc(collection(db, 'sessions'));
  const sessionId = sessionRef.id;

  const token = generateSessionToken();
  const code = generateSixDigitCode();
  const cosLat = Math.cos((params.lat * Math.PI) / 180);
  const endsAtDate = new Date(Date.now() + params.durationMinutes * 60 * 1000);
  const endsAt = Timestamp.fromDate(endsAtDate);
  const locationCheckEnabled = params.org.location?.enabled ?? true;
  const dateStr = getOrgDateString(params.org.timezone || 'Asia/Kolkata');

  const classId = params.classId || params.timetableSlot?.classId || params.assignment?.classId || '';
  const className = params.className || params.timetableSlot?.className || params.assignment?.className || '';
  const courseName = params.courseName || params.timetableSlot?.courseName || params.assignment?.courseName || '';
  const semester = params.semester || params.timetableSlot?.semester || params.assignment?.semester || '';
  const section = params.section || params.timetableSlot?.section || params.assignment?.section || '';
  const subjectId = params.subjectId || params.timetableSlot?.subjectId || params.assignment?.subjectId || '';
  const subjectName = params.subjectName || params.timetableSlot?.subjectName || params.assignment?.subjectName || '';
  const subjectCode = params.subjectCode || params.timetableSlot?.subjectCode || params.assignment?.subjectCode || '';
  const departmentId = params.departmentId || params.assignment?.departmentId || '';
  const roomNumber = params.classroom || params.roomNumber || params.timetableSlot?.roomNumber || params.timetableSlot?.classroom || '';

  const autoTitle =
    params.title.trim() ||
    (subjectName && className ? `${subjectName} · ${className}` : subjectName || 'Live Attendance');

  const sessionPayload: Omit<AttendanceSession, 'id'> = {
    orgId: params.org.id,
    ownerUid: params.owner.uid,
    ownerName: params.owner.name,
    teacherName: params.owner.name,
    ownerRole: params.owner.role === 'admin' || params.owner.role === 'super_admin'
      ? ('admin' as const)
      : ('manager' as const),
    title: autoTitle,
    date: dateStr,
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
    ...(departmentId ? { departmentId } : {}),
    ...(classId ? { classId, className, courseName, semester, section } : {}),
    ...(subjectId ? { subjectId, subjectName, subjectCode } : {}),
    ...(roomNumber ? { roomNumber, classroom: roomNumber } : {}),
    ...(params.timetableSlotId || params.timetableSlot
      ? {
          timetableSlotId: params.timetableSlotId || params.timetableSlot?.id,
          startTimeLabel: params.startTimeLabel || params.timetableSlot?.startTime,
          endTimeLabel: params.endTimeLabel || params.timetableSlot?.endTime,
        }
      : {}),
    startedAt: serverTimestamp() as unknown as Timestamp,
    endsAt,
  };

  const batch = writeBatch(db);
  batch.set(sessionRef, sessionPayload);
  batch.set(doc(db, 'sessionSecrets', sessionId), {
    ownerUid: params.owner.uid,
    orgId: params.org.id,
    active: true,
    token,
    code,
    rotationSeq: 1,
    tokenUpdatedAt: serverTimestamp(),
  });
  await batch.commit();

  await recordAuditLog({
    actor: params.owner,
    action: 'session.started',
    targetCollection: 'sessions',
    targetId: sessionId,
    summary: `Started live session "${autoTitle}" (${params.durationMinutes} min)`,
    metadata: {
      classId: classId || null,
      subjectId: subjectId || null,
      durationMinutes: params.durationMinutes,
    },
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
    code,
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
export async function closeAttendanceSession(
  sessionId: string,
  actor?: UserProfile | null
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'sessions', sessionId), {
    status: 'closed',
    closedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'sessionSecrets', sessionId), {
    active: false,
    token: '',
    code: '',
    tokenUpdatedAt: serverTimestamp(),
  });
  await batch.commit();

  if (actor) {
    await recordAuditLog({
      actor,
      action: 'session.closed',
      targetCollection: 'sessions',
      targetId: sessionId,
      summary: `Closed live attendance session ${sessionId.slice(0, 8)}`,
    });
  }
}

export async function fetchOpenSessionsByOwner(
  orgId: string,
  ownerUid: string
): Promise<AttendanceSession[]> {
  const snap = await getDocs(
    query(
      collection(db, 'sessions'),
      where('orgId', '==', orgId),
      where('ownerUid', '==', ownerUid),
      where('status', '==', 'open')
    )
  );
  const nowMs = Date.now();
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<AttendanceSession, 'id'>), id: d.id }))
    .filter((s) => (s.endsAt?.toMillis?.() ?? 0) > nowMs)
    .sort((a, b) => (b.startedAt?.toMillis?.() ?? 0) - (a.startedAt?.toMillis?.() ?? 0));
}

export async function fetchOpenSessionByOwner(
  orgId: string,
  ownerUid: string
): Promise<AttendanceSession | null> {
  const list = await fetchOpenSessionsByOwner(orgId, ownerUid);
  return list[0] || null;
}

export async function fetchRecentSessionsByOwner(
  orgId: string,
  ownerUid: string,
  maxCount = 20
): Promise<AttendanceSession[]> {
  const snap = await getDocs(
    query(
      collection(db, 'sessions'),
      where('orgId', '==', orgId),
      where('ownerUid', '==', ownerUid)
    )
  );
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<AttendanceSession, 'id'>), id: d.id }))
    .sort((a, b) => (b.startedAt?.toMillis?.() ?? 0) - (a.startedAt?.toMillis?.() ?? 0))
    .slice(0, maxCount);
}

export function subscribeOwnerOpenSessions(
  orgId: string,
  ownerUid: string,
  callback: (sessions: AttendanceSession[]) => void
): () => void {
  const q = query(
    collection(db, 'sessions'),
    where('orgId', '==', orgId),
    where('ownerUid', '==', ownerUid),
    where('status', '==', 'open')
  );
  return onSnapshot(
    q,
    (snap) => {
      const nowMs = Date.now();
      const list = snap.docs
        .map((d) => ({ ...(d.data() as Omit<AttendanceSession, 'id'>), id: d.id }))
        .filter((s) => (s.endsAt?.toMillis?.() ?? 0) > nowMs)
        .sort((a, b) => (b.startedAt?.toMillis?.() ?? 0) - (a.startedAt?.toMillis?.() ?? 0));
      callback(list);
    },
    () => callback([])
  );
}

export function isAuthorizedForSession(
  profile: UserProfile,
  org: Organization,
  session: AttendanceSession
): boolean {
  if (profile.status !== 'active') return false;
  if (session.orgId !== org.id || profile.orgId !== org.id) return false;

  // Admin -> Manager session
  if (session.ownerRole === 'admin' && profile.role === 'manager') return true;

  // Multi-teacher class/section session -> Student assigned to that class
  if (
    session.ownerRole === 'manager' &&
    profile.role === 'member' &&
    session.classId &&
    profile.classId &&
    session.classId === profile.classId
  ) {
    return true;
  }

  // Legacy direct Manager -> Member session
  if (
    session.ownerRole === 'manager' &&
    profile.role === 'member' &&
    profile.managerId &&
    profile.managerId === session.ownerUid
  ) {
    return true;
  }

  return false;
}

export interface SessionStreamError {
  code: 'permission-denied' | 'network' | 'index-required' | 'unknown';
  message: string;
}

function classifyFirestoreError(err: unknown): SessionStreamError {
  const code = (err as { code?: string })?.code || '';
  const rawMsg = (err as { message?: string })?.message || '';
  if (!navigator.onLine || code === 'unavailable' || code === 'deadline-exceeded') {
    return { code: 'network', message: 'Network disconnected or request timed out.' };
  }
  if (code === 'permission-denied') {
    return { code: 'permission-denied', message: rawMsg || 'Permission denied by Firestore rules.' };
  }
  if (code === 'failed-precondition') {
    return { code: 'index-required', message: rawMsg || 'Firestore composite index required.' };
  }
  return { code: 'unknown', message: rawMsg || 'An unexpected error occurred.' };
}

/**
 * Queries all currently active (OPEN & unexpired) sessions eligible for the logged-in user.
 * - For Students: merges active sessions matching `classId` (multi-teacher!) AND legacy `managerId`.
 * - For Teachers/Managers: queries open sessions started by Org Admin (`ownerRole == 'admin'`).
 * Every query matches the exact static predicates in `firestore.rules` so Firestore never
 * rejects the query with a false permission-denied error.
 */
export async function findEligibleLiveSessions(
  profile: UserProfile,
  org: Organization
): Promise<{ sessions: AttendanceSession[]; error?: SessionStreamError }> {
  if (!navigator.onLine) {
    return { sessions: [], error: { code: 'network', message: 'No internet connection.' } };
  }

  const queries = buildEligibleSessionQueries(profile, org);
  if (queries.length === 0) {
    return { sessions: [] };
  }

  const nowMs = Date.now();
  const map = new Map<string, AttendanceSession>();
  let lastErr: SessionStreamError | undefined;
  let anySuccess = false;

  await Promise.all(
    queries.map(async (q) => {
      try {
        const snap = await getDocs(q);
        anySuccess = true;
        for (const d of snap.docs) {
          const data = d.data() as Omit<AttendanceSession, 'id'>;
          const s: AttendanceSession = {
            ...data,
            id: d.id,
            teacherName: data.teacherName || data.ownerName,
            classroom: data.classroom || data.roomNumber || '',
          };
          if (
            s.status === 'open' &&
            (s.endsAt?.toMillis?.() ?? 0) > nowMs &&
            isAuthorizedForSession(profile, org, s)
          ) {
            map.set(s.id, s);
          }
        }
      } catch (err) {
        lastErr = classifyFirestoreError(err);
      }
    })
  );

  const sorted = Array.from(map.values()).sort(
    (a, b) => (b.startedAt?.toMillis?.() ?? 0) - (a.startedAt?.toMillis?.() ?? 0)
  );
  return { sessions: sorted, error: anySuccess ? undefined : lastErr };
}

function buildEligibleSessionQueries(profile: UserProfile, org: Organization) {
  const list = [];
  if (profile.role === 'manager') {
    list.push(
      query(
        collection(db, 'sessions'),
        where('orgId', '==', org.id),
        where('ownerRole', '==', 'admin'),
        where('status', '==', 'open')
      )
    );
  } else if (profile.role === 'member') {
    if (profile.classId) {
      list.push(
        query(
          collection(db, 'sessions'),
          where('orgId', '==', org.id),
          where('classId', '==', profile.classId),
          where('status', '==', 'open')
        )
      );
    }
    if (profile.managerId) {
      list.push(
        query(
          collection(db, 'sessions'),
          where('orgId', '==', org.id),
          where('ownerUid', '==', profile.managerId),
          where('status', '==', 'open')
        )
      );
    }
  }
  return list;
}

/**
 * Real-time `onSnapshot()` subscription to ALL active sessions eligible for this Student or Manager.
 * Supports multiple teachers running independent subject-wise sessions simultaneously or back-to-back.
 * Properly surfaces permission-denied, network, and index errors instead of masking them as empty.
 * Unsubscribes cleanly on unmount.
 */
export function subscribeEligibleLiveSessions(
  profile: UserProfile,
  org: Organization,
  onUpdate: (sessions: AttendanceSession[]) => void,
  onError?: (err: SessionStreamError) => void
): () => void {
  const queries = buildEligibleSessionQueries(profile, org);
  if (queries.length === 0) {
    onUpdate([]);
    return () => {};
  }

  const buckets: Array<Map<string, AttendanceSession>> = queries.map(() => new Map());
  const ready = queries.map(() => false);
  let active = true;

  const emitMerged = () => {
    if (!active) return;
    const nowMs = Date.now();
    const merged = new Map<string, AttendanceSession>();
    for (const bucket of buckets) {
      for (const [id, sess] of bucket.entries()) {
        if (
          sess.status === 'open' &&
          (sess.endsAt?.toMillis?.() ?? 0) > nowMs &&
          isAuthorizedForSession(profile, org, sess)
        ) {
          merged.set(id, sess);
        }
      }
    }
    const sorted = Array.from(merged.values()).sort(
      (a, b) => (b.startedAt?.toMillis?.() ?? 0) - (a.startedAt?.toMillis?.() ?? 0)
    );
    onUpdate(sorted);
  };

  const unsubs = queries.map((q, idx) =>
    onSnapshot(
      q,
      (snap) => {
        const nextMap = new Map<string, AttendanceSession>();
        for (const d of snap.docs) {
          const data = d.data() as Omit<AttendanceSession, 'id'>;
          nextMap.set(d.id, {
            ...data,
            id: d.id,
            teacherName: data.teacherName || data.ownerName,
            classroom: data.classroom || data.roomNumber || '',
          });
        }
        buckets[idx] = nextMap;
        ready[idx] = true;
        emitMerged();
      },
      (err) => {
        if (!active) return;
        const kind = classifyFirestoreError(err);
        buckets[idx] = new Map();
        ready[idx] = true;
        // Only surface error if NO sibling query succeeded with data
        const anyHasData = buckets.some((b) => b.size > 0);
        if (!anyHasData) {
          onError?.(kind);
        }
      }
    )
  );

  return () => {
    active = false;
    for (const unsub of unsubs) {
      try {
        unsub();
      } catch {
        // Ignore cleanup error
      }
    }
  };
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
        .map((d) => {
          const data = d.data() as AttendanceRecord;
          return { ...data, id: d.id, status: normalizeAttendanceStatus(data.status) };
        })
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
  subjectName?: string;
}

/**
 * Atomic self-marking flow using a Firestore Transaction + strict backend Security Rules:
 * - Always records status: 'present' (LATE status completely removed).
 * - Uses session-scoped deterministic doc ID `${orgId}_${sessionId}_${personUid}` so
 *   multiple subjects/teachers on the same day NEVER overwrite each other while strictly
 *   preventing duplicate attendance within the same session.
 * - Atomically writes `sessionDevices/{sessionId}_{deviceId}` and `attendance/{recordId}`.
 * - Backend `firestore.rules` authoritatively validates role/class eligibility, open session,
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

  const date = session.date || getOrgDateString(org.timezone || 'Asia/Kolkata');
  const currentHHMM = getOrgTimeHHMM(org.timezone || 'Asia/Kolkata');
  const attendanceDocId = buildSessionAttendanceDocId(org.id, session.id, profile.uid);
  const deviceId = getOrCreateDeviceId();
  const deviceDocId = `${session.id}_${deviceId}`;

  // Strictly PRESENT (no LATE status anywhere)
  const status: AttendanceStatus = 'present';

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
        role: profile.role === 'manager' ? 'manager' : 'member',
        managerId: profile.managerId || null,
        teacherUid: session.ownerUid,
        teacherName: session.ownerName,
        ...(session.departmentId ? { departmentId: session.departmentId } : {}),
        ...(session.classId
          ? {
              classId: session.classId,
              className: session.className || '',
              semester: session.semester || '',
              section: session.section || '',
            }
          : {}),
        ...(session.subjectId
          ? {
              subjectId: session.subjectId,
              subjectName: session.subjectName || '',
              subjectCode: session.subjectCode || '',
            }
          : {}),
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

    await recordAuditLog({
      actor: profile,
      action: 'attendance.created',
      targetCollection: 'attendance',
      targetId: attendanceDocId,
      summary: `Marked PRESENT via ${method} for ${session.subjectName || session.title}`,
      metadata: {
        sessionId: session.id,
        subjectId: session.subjectId || null,
        classId: session.classId || null,
        distanceMeters,
      },
    });

    return {
      ok: true,
      status,
      timeStr: currentHHMM,
      distanceMeters,
      subjectName: session.subjectName || session.title,
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
