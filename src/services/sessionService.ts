import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
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
  SessionSecret,
  TimetableSlot,
  UserProfile,
} from '../types';
import {
  generateSessionToken,
  generateSixDigitCode,
  getFlatEarthDistanceMetersExact,
  getOrgDateString,
  getOrgTimeHHMM,
  getOrCreateDeviceId,
  normalizeAttendanceStatus,
} from '../utils/helpers';
import { buildSessionAttendanceDocId } from './attendanceService';
import { recordAuditLog } from './auditService';

// Tolerance for local client clock skew when filtering status === 'open' sessions on the client.
// Authoritative expiry (`request.time <= sess.endsAt`) is always enforced by Firestore server rules.
const CLIENT_CLOCK_SKEW_TOLERANCE_MS = 15 * 60 * 1000;

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
  courseName?: string;
  semester?: string;
  section?: string;
  subjectId?: string | null;
  subjectName?: string;
  subjectCode?: string;
  classroom?: string;
  roomNumber?: string;
  timetableSlotId?: string | null;
}): Promise<{ session: AttendanceSession; token: string; code: string; issuedAtMs: number }> {
  // Check for duplicate active session by this owner for the exact same subject/slot
  const openMine = await fetchOpenSessionsByOwner(params.org.id, params.owner.uid);
  const targetSlotId = params.timetableSlot?.id || params.timetableSlotId || '';
  const targetSubjectId =
    params.timetableSlot?.subjectId || params.assignment?.subjectId || params.subjectId || '';
  const targetClassId =
    params.timetableSlot?.classId || params.assignment?.classId || params.classId || '';
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
    return {
      session: duplicate,
      token: fresh.token,
      code: fresh.code,
      issuedAtMs: fresh.issuedAtMs,
    };
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

  const classId = targetClassId;
  const className =
    params.timetableSlot?.className || params.assignment?.className || params.className || '';
  const courseName =
    params.timetableSlot?.courseName || params.assignment?.courseName || params.courseName || '';
  const semester =
    params.timetableSlot?.semester || params.assignment?.semester || params.semester || '';
  const section =
    params.timetableSlot?.section || params.assignment?.section || params.section || '';
  const subjectId = targetSubjectId;
  const subjectName =
    params.timetableSlot?.subjectName || params.assignment?.subjectName || params.subjectName || '';
  const subjectCode =
    params.timetableSlot?.subjectCode || params.assignment?.subjectCode || params.subjectCode || '';
  const departmentId =
    params.assignment?.departmentId || params.timetableSlot?.departmentId || params.departmentId || '';
  const departmentName =
    params.assignment?.departmentName ||
    params.timetableSlot?.departmentName ||
    params.departmentName ||
    '';
  const roomNumber =
    params.timetableSlot?.classroom ||
    params.timetableSlot?.roomNumber ||
    params.classroom ||
    params.roomNumber ||
    '';

  const autoTitle =
    params.title.trim() ||
    (subjectName && className ? `${subjectName} · ${className}` : subjectName || 'Live Attendance');

  const sessionPayload = {
    orgId: params.org.id,
    ownerUid: params.owner.uid,
    ownerName: params.owner.name,
    teacherName: params.owner.name,
    ownerRole:
      params.owner.role === 'admin' || params.owner.role === 'super_admin'
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
    ...(departmentId ? { departmentId, departmentName } : {}),
    ...(classId ? { classId, className, courseName, semester, section } : {}),
    ...(subjectId ? { subjectId, subjectName, subjectCode } : {}),
    ...(roomNumber ? { roomNumber, classroom: roomNumber } : {}),
    ...(targetSlotId ? { timetableSlotId: targetSlotId } : {}),
    ...(params.timetableSlot
      ? {
          startTimeLabel: params.timetableSlot.startTime,
          endTimeLabel: params.timetableSlot.endTime,
        }
      : {}),
    startedAt: serverTimestamp(),
    endsAt,
  };

  const writeStartedMs = Date.now();
  const batch = writeBatch(db);
  batch.set(sessionRef, sessionPayload);
  batch.set(doc(db, 'sessionSecrets', sessionId), {
    ownerUid: params.owner.uid,
    orgId: params.org.id,
    active: true,
    token,
    code,
    prevToken: '',
    prevCode: '',
    prevTokenUpdatedAt: null,
    rotationSeq: 1,
    tokenUpdatedAt: serverTimestamp(),
  });
  await batch.commit();

  // Fire audit log non-blocking so the fresh QR code is displayed immediately without eating into its 10s window
  void recordAuditLog({
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
  }).catch(() => {});

  return {
    session: {
      ...sessionPayload,
      id: sessionId,
      startedAt: Timestamp.now(),
    },
    token,
    code,
    issuedAtMs: writeStartedMs,
  };
}

/**
 * Rotates the live session's QR token & 6-digit code every 10 seconds inside an atomic
 * Firestore transaction. Shifts the previous server-committed token/code into `prevToken`/`prevCode`
 * (strictly verified by firestore.rules) so students whose scan was already in flight right across
 * a 10-second rotation boundary succeed reliably, while older tokens remain strictly rejected.
 */
export async function rotateSessionSecret(params: {
  sessionId: string;
}): Promise<{ token: string; code: string; issuedAtMs: number }> {
  const token = generateSessionToken();
  const code = generateSixDigitCode();
  const secretRef = doc(db, 'sessionSecrets', params.sessionId);
  const writeStartedMs = Date.now();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(secretRef);
    if (!snap.exists()) {
      throw new Error('SESSION_SECRET_MISSING');
    }
    const cur = snap.data() as SessionSecret;
    if (cur.active === false) {
      throw new Error('SESSION_SECRET_CLOSED');
    }

    const canCarryPrev =
      typeof cur.token === 'string' &&
      cur.token.length >= 32 &&
      typeof cur.code === 'string' &&
      cur.code.length === 6 &&
      !!cur.tokenUpdatedAt;

    tx.update(secretRef, {
      active: true,
      token,
      code,
      prevToken: canCarryPrev ? cur.token : '',
      prevCode: canCarryPrev ? cur.code : '',
      prevTokenUpdatedAt: canCarryPrev ? cur.tokenUpdatedAt : null,
      rotationSeq: (typeof cur.rotationSeq === 'number' ? cur.rotationSeq : 0) + 1,
      tokenUpdatedAt: serverTimestamp(),
    });
  });

  return { token, code, issuedAtMs: writeStartedMs };
}

/**
 * Owner-only real-time listener on `sessionSecrets/{sessionId}`.
 * Ignores local uncommitted writes (`hasPendingWrites`) so the projector always reflects
 * the authoritative server-committed token and never displays an uncommitted QR on slow networks.
 */
export function subscribeSessionSecret(
  sessionId: string,
  callback: (secret: SessionSecret | null) => void,
  onError?: (err: unknown) => void
): () => void {
  return onSnapshot(
    doc(db, 'sessionSecrets', sessionId),
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      if (!snap.exists()) {
        callback(null);
      } else {
        callback(snap.data() as SessionSecret);
      }
    },
    (err) => {
      onError?.(err);
    }
  );
}

/**
 * Guards against teacher device clock skew: once Firestore confirms the server `startedAt`
 * timestamp on a newly opened session, corrects `endsAt` if the teacher's local clock was
 * off by more than 30 seconds so `request.time <= sess.endsAt` never rejects valid scans.
 */
export async function syncSessionEndsAtToServerClock(
  sessionId: string,
  serverStartedAt: Timestamp,
  currentEndsAt: Timestamp | null | undefined,
  durationMinutes: number
): Promise<Timestamp | null> {
  const expectedEndsMs = serverStartedAt.toMillis() + Math.max(1, durationMinutes) * 60 * 1000;
  const currentEndsMs = currentEndsAt?.toMillis?.() ?? 0;
  // Only adjust if drift is > 30s and the session has not been manually extended past expectedEndsMs
  if (expectedEndsMs - currentEndsMs > 30_000) {
    const corrected = Timestamp.fromMillis(expectedEndsMs);
    await updateDoc(doc(db, 'sessions', sessionId), {
      endsAt: corrected,
    });
    return corrected;
  }
  return null;
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
 * Stops a live attendance session and immediately wipes both current and previous
 * secrets atomically so no further QR scans can succeed.
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
    prevToken: '',
    prevCode: '',
    prevTokenUpdatedAt: null,
    tokenUpdatedAt: serverTimestamp(),
  });
  await batch.commit();

  if (actor) {
    void recordAuditLog({
      actor,
      action: 'session.closed',
      targetCollection: 'sessions',
      targetId: sessionId,
      summary: `Closed live attendance session ${sessionId.slice(0, 8)}`,
    }).catch(() => {});
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
    .map((d) => {
      const raw = d.data() as Omit<AttendanceSession, 'id'>;
      return {
        ...raw,
        id: d.id,
        teacherName: raw.teacherName || raw.ownerName,
        classroom: raw.classroom || raw.roomNumber || '',
      };
    })
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

  // Multi-teacher or Admin-led class/section session -> Student assigned to that class
  if (
    (session.ownerRole === 'manager' || session.ownerRole === 'admin') &&
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
    return {
      code: 'network',
      message: 'Unable to reach Firestore. Check your internet connection and click Check again.',
    };
  }
  if (code === 'permission-denied') {
    return {
      code: 'permission-denied',
      message:
        'Firestore security rules denied reading live sessions. Deploy the updated firestore.rules and verify your class assignment.',
    };
  }
  if (code === 'failed-precondition') {
    return {
      code: 'index-required',
      message:
        'A Firestore composite index is still building or missing. Deploy firestore.indexes.json and try again.',
    };
  }
  return {
    code: 'unknown',
    message: rawMsg || 'Could not load active live sessions. Please try again.',
  };
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
): Promise<{ sessions: AttendanceSession[]; error: SessionStreamError | null }> {
  if (!navigator.onLine) {
    return {
      sessions: [],
      error: {
        code: 'network',
        message: 'You appear to be offline. Reconnect to the internet and tap Check again.',
      },
    };
  }

  const queries = buildEligibleSessionQueries(profile, org);
  if (queries.length === 0) {
    return { sessions: [], error: null };
  }

  const nowMs = Date.now();
  const map = new Map<string, AttendanceSession>();
  let lastErr: SessionStreamError | null = null;
  let anySuccess = false;

  await Promise.all(
    queries.map(async (q) => {
      try {
        const snap = await getDocs(q);
        anySuccess = true;
        for (const d of snap.docs) {
          const raw = d.data() as Omit<AttendanceSession, 'id'>;
          const s: AttendanceSession = {
            ...raw,
            id: d.id,
            teacherName: raw.teacherName || raw.ownerName,
            classroom: raw.classroom || raw.roomNumber || '',
          };
          if (
            s.status === 'open' &&
            (s.endsAt?.toMillis?.() ?? Infinity) > nowMs - CLIENT_CLOCK_SKEW_TOLERANCE_MS &&
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
  return { sessions: sorted, error: anySuccess ? null : lastErr };
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
          (sess.endsAt?.toMillis?.() ?? Infinity) > nowMs - CLIENT_CLOCK_SKEW_TOLERANCE_MS &&
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
          const raw = d.data() as Omit<AttendanceSession, 'id'>;
          nextMap.set(d.id, {
            ...raw,
            id: d.id,
            teacherName: raw.teacherName || raw.ownerName,
            classroom: raw.classroom || raw.roomNumber || '',
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
    // Do not reject an 'open' session based on local device clock skew —
    // Firestore server rules (`request.time <= sess.endsAt`) enforce expiry authoritatively.
    if (sess.status !== 'open') {
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
  | 'errInvalidQr'
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
 *   rotating token/code against server `request.time` (with 5s rotation-boundary handoff),
 *   exact GPS radius, and one-device-per-session lock.
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

  const cleanToken = (params.token || '').trim();
  const cleanCode = (params.code || '').replace(/\s+/g, '');

  if (method === 'live_qr' && cleanToken.length < 32) {
    return { ok: false, errorCode: 'errInvalidQr' };
  }
  if (method === 'live_code' && !/^\d{6}$/.test(cleanCode)) {
    return { ok: false, errorCode: 'errInvalidCode' };
  }

  // Exact unrounded flat-earth distance matches Firestore rule `flatEarthDistanceOk`
  const exactDistanceMeters = getFlatEarthDistanceMetersExact(
    lat,
    lng,
    session.location.lat,
    session.location.lng,
    session.location.cosLat
  );
  const distanceMeters = Math.round(exactDistanceMeters);

  // Pre-check status only (never reject an 'open' session on local device clock skew)
  if (session.status !== 'open') {
    return { ok: false, errorCode: 'errSessionClosed' };
  }

  if (session.locationCheckEnabled && exactDistanceMeters > session.location.radius) {
    void logFailedAttempt({
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
      const liveSess = {
        ...(sessSnap.data() as Omit<AttendanceSession, 'id'>),
        id: sessSnap.id,
      };
      if (liveSess.status !== 'open') {
        throw new Error('TX_SESSION_CLOSED');
      }

      if (!isAuthorizedForSession(profile, org, liveSess)) {
        throw new Error('TX_UNAUTHORIZED');
      }

      if (liveSess.locationCheckEnabled) {
        const liveExactDist = getFlatEarthDistanceMetersExact(
          lat,
          lng,
          liveSess.location.lat,
          liveSess.location.lng,
          liveSess.location.cosLat
        );
        if (liveExactDist > liveSess.location.radius) {
          throw new Error('TX_OUTSIDE_AREA');
        }
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
        teacherUid: liveSess.ownerUid,
        teacherName: liveSess.ownerName,
        ...(liveSess.departmentId ? { departmentId: liveSess.departmentId } : {}),
        ...(liveSess.classId
          ? {
              classId: liveSess.classId,
              className: liveSess.className || '',
              semester: liveSess.semester || '',
              section: liveSess.section || '',
            }
          : {}),
        ...(liveSess.subjectId
          ? {
              subjectId: liveSess.subjectId,
              subjectName: liveSess.subjectName || '',
              subjectCode: liveSess.subjectCode || '',
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
        ...(method === 'live_qr' ? { submittedToken: cleanToken } : {}),
        ...(method === 'live_code' ? { submittedCode: cleanCode } : {}),
      });
    });

    // Record audit trail asynchronously so confirmation UI appears instantly
    void recordAuditLog({
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
    }).catch(() => {});

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
    if (message === 'TX_UNAUTHORIZED') {
      return { ok: false, errorCode: 'errUnauthorized' };
    }
    if (message === 'TX_OUTSIDE_AREA') {
      void logFailedAttempt({
        orgId: org.id,
        sessionId: session.id,
        ownerUid: session.ownerUid,
        person: profile,
        reason: 'outside_radius',
        distance: distanceMeters,
      });
      return { ok: false, errorCode: 'errOutsideArea', distanceMeters };
    }
    if (message === 'TX_ALREADY_MARKED') {
      return { ok: false, errorCode: 'errAlreadyMarked' };
    }
    if (message === 'TX_DEVICE_USED') {
      void logFailedAttempt({
        orgId: org.id,
        sessionId: session.id,
        ownerUid: session.ownerUid,
        person: profile,
        reason: 'device_already_used',
        distance: distanceMeters,
      });
      return { ok: false, errorCode: 'errDeviceUsed' };
    }

    if (
      !navigator.onLine ||
      codeErr === 'unavailable' ||
      codeErr === 'deadline-exceeded' ||
      codeErr === 'aborted'
    ) {
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
          void logFailedAttempt({
            orgId: org.id,
            sessionId: session.id,
            ownerUid: session.ownerUid,
            person: profile,
            reason: 'device_already_used',
            distance: distanceMeters,
          });
          return { ok: false, errorCode: 'errDeviceUsed' };
        }
        if (!sessSnap.exists()) {
          return { ok: false, errorCode: 'errSessionClosed' };
        }
        const s: AttendanceSession = {
          ...(sessSnap.data() as Omit<AttendanceSession, 'id'>),
          id: sessSnap.id,
        };
        if (s.status !== 'open') {
          return { ok: false, errorCode: 'errSessionClosed' };
        }
        if (!isAuthorizedForSession(profile, org, s)) {
          return { ok: false, errorCode: 'errUnauthorized' };
        }
        if (s.locationCheckEnabled) {
          const liveExactDist = getFlatEarthDistanceMetersExact(
            lat,
            lng,
            s.location.lat,
            s.location.lng,
            s.location.cosLat
          );
          if (liveExactDist > s.location.radius) {
            void logFailedAttempt({
              orgId: org.id,
              sessionId: session.id,
              ownerUid: session.ownerUid,
              person: profile,
              reason: 'outside_radius',
              distance: Math.round(liveExactDist),
            });
            return {
              ok: false,
              errorCode: 'errOutsideArea',
              distanceMeters: Math.round(liveExactDist),
            };
          }
        }
        // Only classify as closed on local endsAt if clearly past end time (> 60s ago)
        if ((s.endsAt?.toMillis?.() ?? Infinity) <= Date.now() - 60_000) {
          return { ok: false, errorCode: 'errSessionClosed' };
        }
      } catch {
        // Proceed to expired/invalid secret classification
      }

      void logFailedAttempt({
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
