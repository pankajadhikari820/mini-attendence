import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  AttendanceMethod,
  AttendanceRecord,
  AttendanceStatus,
  FacultyAssignment,
  Organization,
  QRPayload,
  UserProfile,
} from '../types';
import {
  getCurrentPosition,
  getDistanceMeters,
  getOrgDateString,
  getOrgTimeHHMM,
  normalizeAttendanceStatus,
} from '../utils/helpers';
import { recordAuditLog } from './auditService';

/**
 * Deterministic ID for session-scoped attendance: prevents duplicates within a session
 * while allowing multiple independent subject lectures on the same day!
 */
export function buildSessionAttendanceDocId(
  orgId: string,
  sessionId: string,
  personUid: string
): string {
  return `${orgId}_${sessionId}_${personUid}`;
}

/**
 * Deterministic ID for manual/backup attendance: includes subjectId so manual Mathematics
 * does not overwrite manual Programming on the same date.
 */
export function buildAttendanceDocId(
  orgId: string,
  date: string,
  personUid: string,
  subjectId?: string
): string {
  if (subjectId) {
    return `${orgId}_${date}_${subjectId}_${personUid}`;
  }
  return `${orgId}_${date}_${personUid}`;
}

function hydrateAttendanceRecord(id: string, raw: AttendanceRecord): AttendanceRecord {
  return {
    ...raw,
    id,
    status: normalizeAttendanceStatus(raw.status),
  };
}

export async function verifyLocationCheck(
  org: Organization
): Promise<{ ok: true } | { ok: false; reason: 'locationDenied' | 'locationTooFar'; distance?: number }> {
  if (!org.location?.enabled) return { ok: true };
  if (!org.location.lat && !org.location.lng) return { ok: true };

  try {
    const pos = await getCurrentPosition();
    const distance = getDistanceMeters(pos.lat, pos.lng, org.location.lat, org.location.lng);
    if (distance > (org.location.radius || 50)) {
      return { ok: false, reason: 'locationTooFar', distance };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'locationDenied' };
  }
}

export interface QRScanResult {
  ok: boolean;
  code:
    | 'markedPresent'
    | 'alreadyMarked'
    | 'invalidQr'
    | 'wrongOrg'
    | 'notYourPerson'
    | 'userInactive'
    | 'userNotFound'
    | 'locationDenied'
    | 'locationTooFar';
  personName?: string;
  memberId?: string;
  status?: AttendanceStatus;
  timeStr?: string;
  distance?: number;
}

export interface AttendanceSubjectMeta {
  departmentId?: string | null;
  departmentName?: string;
  classId?: string;
  className?: string;
  semester?: string;
  section?: string;
  subjectId?: string;
  subjectName?: string;
  subjectCode?: string;
}

function resolveSubjectMeta(
  assignment?: FacultyAssignment | null,
  subjectMeta?: AttendanceSubjectMeta | null
): AttendanceSubjectMeta | null {
  if (assignment) {
    return {
      departmentId: assignment.departmentId,
      departmentName: assignment.departmentName || '',
      classId: assignment.classId,
      className: assignment.className,
      semester: assignment.semester,
      section: assignment.section,
      subjectId: assignment.subjectId,
      subjectName: assignment.subjectName,
      subjectCode: assignment.subjectCode,
    };
  }
  return subjectMeta || null;
}

/**
 * Backup ID-Card QR scanner used ONLY by an authenticated Admin or Teacher/Manager
 * (students cannot scan their own ID card to self-mark attendance).
 * Strictly records PRESENT (no LATE status).
 */
export async function markAttendanceViaQR(params: {
  rawText: string;
  org: Organization;
  marker: UserProfile;
  assignment?: FacultyAssignment | null;
  subjectMeta?: AttendanceSubjectMeta | null;
}): Promise<QRScanResult> {
  const meta = resolveSubjectMeta(params.assignment, params.subjectMeta);

  let payload: QRPayload;
  try {
    const parsed = JSON.parse(params.rawText);
    if (!parsed || typeof parsed.orgId !== 'string' || typeof parsed.uid !== 'string') {
      return { ok: false, code: 'invalidQr' };
    }
    payload = parsed as QRPayload;
  } catch {
    return { ok: false, code: 'invalidQr' };
  }

  if (payload.orgId !== params.org.id) {
    return { ok: false, code: 'wrongOrg' };
  }

  const personSnap = await getDoc(doc(db, 'users', payload.uid));
  if (!personSnap.exists()) {
    return { ok: false, code: 'userNotFound' };
  }
  const person = { ...(personSnap.data() as UserProfile), uid: personSnap.id };

  if (person.orgId !== params.org.id) {
    return { ok: false, code: 'wrongOrg' };
  }

  if (person.status !== 'active') {
    return { ok: false, code: 'userInactive', personName: person.name, memberId: person.memberId };
  }

  const isAuthorized =
    params.marker.role === 'admin' ||
    params.marker.role === 'super_admin' ||
    (params.marker.role === 'manager' &&
      person.role === 'member' &&
      (person.managerId === params.marker.uid ||
        (meta?.classId && person.classId === meta.classId)));

  if (!isAuthorized) {
    return { ok: false, code: 'notYourPerson', personName: person.name, memberId: person.memberId };
  }

  const date = getOrgDateString(params.org.timezone || 'Asia/Kolkata');
  const currentHHMM = getOrgTimeHHMM(params.org.timezone || 'Asia/Kolkata');
  const docId = buildAttendanceDocId(params.org.id, date, person.uid, meta?.subjectId);
  const existing = await getDoc(doc(db, 'attendance', docId));

  if (existing.exists()) {
    const existingData = hydrateAttendanceRecord(existing.id, existing.data() as AttendanceRecord);
    return {
      ok: false,
      code: 'alreadyMarked',
      personName: person.name,
      memberId: person.memberId,
      status: existingData.status,
      timeStr: currentHHMM,
    };
  }

  const status: AttendanceStatus = 'present';

  await setDoc(doc(db, 'attendance', docId), {
    orgId: params.org.id,
    personUid: person.uid,
    personName: person.name,
    personMemberId: person.memberId,
    role: person.role === 'manager' ? 'manager' : 'member',
    managerId: person.managerId || null,
    teacherUid: params.marker.uid,
    teacherName: params.marker.name,
    ...(meta
      ? {
          ...(meta.departmentId ? { departmentId: meta.departmentId } : {}),
          ...(meta.classId ? { classId: meta.classId, className: meta.className || '' } : {}),
          ...(meta.semester ? { semester: meta.semester } : {}),
          ...(meta.section ? { section: meta.section } : {}),
          ...(meta.subjectId
            ? {
                subjectId: meta.subjectId,
                subjectName: meta.subjectName || '',
                subjectCode: meta.subjectCode || '',
              }
            : {}),
        }
      : {}),
    date,
    timestamp: serverTimestamp(),
    status,
    method: 'manual' as AttendanceMethod,
    markedBy: params.marker.uid,
    note: 'ID Card QR backup',
  });

  await recordAuditLog({
    actor: params.marker,
    action: 'attendance.created',
    targetCollection: 'attendance',
    targetId: docId,
    summary: `Marked ${person.name} (${person.memberId}) PRESENT via ID Card QR backup${meta?.subjectName ? ` (${meta.subjectName})` : ''}`,
  });

  return {
    ok: true,
    code: 'markedPresent',
    personName: person.name,
    memberId: person.memberId,
    status,
    timeStr: currentHHMM,
  };
}

export async function markAttendanceManual(params: {
  org: Organization;
  marker: UserProfile;
  person: UserProfile;
  date: string;
  status: AttendanceStatus;
  note?: string;
  assignment?: FacultyAssignment | null;
  subjectMeta?: AttendanceSubjectMeta | null;
}): Promise<void> {
  if (params.person.status !== 'active') {
    throw new Error('Cannot mark inactive or pending user');
  }
  const today = getOrgDateString(params.org.timezone || 'Asia/Kolkata');
  if (params.marker.role !== 'admin' && params.marker.role !== 'super_admin' && params.date !== today) {
    throw new Error('Only admins can edit past dates');
  }

  const meta = resolveSubjectMeta(params.assignment, params.subjectMeta);
  const cleanStatus = normalizeAttendanceStatus(params.status);
  const docId = buildAttendanceDocId(params.org.id, params.date, params.person.uid, meta?.subjectId);
  const existing = await getDoc(doc(db, 'attendance', docId));

  await setDoc(doc(db, 'attendance', docId), {
    orgId: params.org.id,
    personUid: params.person.uid,
    personName: params.person.name,
    personMemberId: params.person.memberId,
    role: params.person.role === 'manager' ? 'manager' : 'member',
    managerId: params.person.managerId || null,
    teacherUid: params.marker.uid,
    teacherName: params.marker.name,
    ...(meta
      ? {
          ...(meta.departmentId ? { departmentId: meta.departmentId } : {}),
          ...(meta.classId ? { classId: meta.classId, className: meta.className || '' } : {}),
          ...(meta.semester ? { semester: meta.semester } : {}),
          ...(meta.section ? { section: meta.section } : {}),
          ...(meta.subjectId
            ? {
                subjectId: meta.subjectId,
                subjectName: meta.subjectName || '',
                subjectCode: meta.subjectCode || '',
              }
            : {}),
        }
      : params.person.classId
      ? {
          classId: params.person.classId,
          className: params.person.className || '',
          semester: params.person.semester || '',
          section: params.person.section || '',
          departmentId: params.person.departmentId || '',
        }
      : {}),
    date: params.date,
    timestamp: serverTimestamp(),
    status: cleanStatus,
    method: 'manual' as AttendanceMethod,
    markedBy: params.marker.uid,
    note: params.note?.trim() || '',
  });

  await recordAuditLog({
    actor: params.marker,
    action: existing.exists() ? 'attendance.updated' : 'attendance.created',
    targetCollection: 'attendance',
    targetId: docId,
    summary: `${existing.exists() ? 'Corrected' : 'Marked'} ${params.person.name} (${params.person.memberId}) as ${cleanStatus.toUpperCase()} on ${params.date}${meta?.subjectName ? ` · ${meta.subjectName}` : ''}`,
    metadata: {
      date: params.date,
      status: cleanStatus,
      subjectId: meta?.subjectId || null,
      classId: meta?.classId || null,
    },
  });
}

export async function bulkMarkAttendance(params: {
  org: Organization;
  marker: UserProfile;
  entries: Array<{ person: UserProfile; status: AttendanceStatus; note?: string }>;
  date: string;
  assignment?: FacultyAssignment | null;
  subjectMeta?: AttendanceSubjectMeta | null;
}): Promise<void> {
  const today = getOrgDateString(params.org.timezone || 'Asia/Kolkata');
  if (params.marker.role !== 'admin' && params.marker.role !== 'super_admin' && params.date !== today) {
    throw new Error('Only admins can edit past dates');
  }

  const meta = resolveSubjectMeta(params.assignment, params.subjectMeta);
  const CHUNK = 400;
  for (let i = 0; i < params.entries.length; i += CHUNK) {
    const slice = params.entries.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const entry of slice) {
      if (entry.person.status !== 'active') continue;
      const cleanStatus = normalizeAttendanceStatus(entry.status);
      const docId = buildAttendanceDocId(
        params.org.id,
        params.date,
        entry.person.uid,
        meta?.subjectId
      );
      batch.set(doc(db, 'attendance', docId), {
        orgId: params.org.id,
        personUid: entry.person.uid,
        personName: entry.person.name,
        personMemberId: entry.person.memberId,
        role: entry.person.role === 'manager' ? 'manager' : 'member',
        managerId: entry.person.managerId || null,
        teacherUid: params.marker.uid,
        teacherName: params.marker.name,
        ...(meta
          ? {
              ...(meta.departmentId ? { departmentId: meta.departmentId } : {}),
              ...(meta.classId ? { classId: meta.classId, className: meta.className || '' } : {}),
              ...(meta.semester ? { semester: meta.semester } : {}),
              ...(meta.section ? { section: meta.section } : {}),
              ...(meta.subjectId
                ? {
                    subjectId: meta.subjectId,
                    subjectName: meta.subjectName || '',
                    subjectCode: meta.subjectCode || '',
                  }
                : {}),
            }
          : {}),
        date: params.date,
        timestamp: serverTimestamp(),
        status: cleanStatus,
        method: 'manual' as AttendanceMethod,
        markedBy: params.marker.uid,
        note: entry.note?.trim() || '',
      });
    }
    await batch.commit();
  }

  await recordAuditLog({
    actor: params.marker,
    action: 'attendance.bulk_marked',
    targetCollection: 'attendance',
    targetId: `${params.org.id}_${params.date}`,
    summary: `Bulk marked ${params.entries.length} records on ${params.date}${meta?.subjectName ? ` for ${meta.subjectName}` : ''}`,
    metadata: { count: params.entries.length, date: params.date },
  });
}

export async function fetchAttendanceForOrg(
  orgId: string,
  options?: { fromDate?: string; toDate?: string; date?: string; classId?: string; subjectId?: string }
): Promise<AttendanceRecord[]> {
  const constraints = [where('orgId', '==', orgId)];
  if (options?.date) {
    constraints.push(where('date', '==', options.date));
  }
  const snap = await getDocs(query(collection(db, 'attendance'), ...constraints));
  let records = snap.docs.map((d) => hydrateAttendanceRecord(d.id, d.data() as AttendanceRecord));
  if (options?.fromDate) records = records.filter((r) => r.date >= options.fromDate!);
  if (options?.toDate) records = records.filter((r) => r.date <= options.toDate!);
  if (options?.classId) records = records.filter((r) => r.classId === options.classId);
  if (options?.subjectId) records = records.filter((r) => r.subjectId === options.subjectId);
  return records.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Fetches attendance records owned/taught by a Manager/Teacher across BOTH:
 * 1) Subject-wise lectures (`teacherUid == managerUid`)
 * 2) Legacy direct team (`managerId == managerUid`)
 * 3) Optionally their own attendance (`personUid == managerUid`)
 */
export async function fetchAttendanceForManager(
  orgId: string,
  managerUid: string,
  options?: {
    fromDate?: string;
    toDate?: string;
    date?: string;
    includeOwn?: boolean;
    classId?: string;
    subjectId?: string;
  }
): Promise<AttendanceRecord[]> {
  const queries = [
    query(
      collection(db, 'attendance'),
      where('orgId', '==', orgId),
      where('teacherUid', '==', managerUid),
      ...(options?.date ? [where('date', '==', options.date)] : [])
    ),
    query(
      collection(db, 'attendance'),
      where('orgId', '==', orgId),
      where('managerId', '==', managerUid),
      ...(options?.date ? [where('date', '==', options.date)] : [])
    ),
  ];

  if (options?.includeOwn) {
    queries.push(
      query(
        collection(db, 'attendance'),
        where('orgId', '==', orgId),
        where('personUid', '==', managerUid),
        ...(options?.date ? [where('date', '==', options.date)] : [])
      )
    );
  }

  const snaps = await Promise.all(
    queries.map((q) => getDocs(q).catch(() => ({ docs: [] })))
  );

  const map = new Map<string, AttendanceRecord>();
  for (const s of snaps) {
    for (const d of s.docs) {
      map.set(d.id, hydrateAttendanceRecord(d.id, d.data() as AttendanceRecord));
    }
  }

  let records = Array.from(map.values());
  if (options?.fromDate) records = records.filter((r) => r.date >= options.fromDate!);
  if (options?.toDate) records = records.filter((r) => r.date <= options.toDate!);
  if (options?.classId) records = records.filter((r) => r.classId === options.classId);
  if (options?.subjectId) records = records.filter((r) => r.subjectId === options.subjectId);
  return records.sort((a, b) => b.date.localeCompare(a.date));
}

export async function fetchAttendanceForPerson(
  orgId: string,
  personUid: string,
  options?: { fromDate?: string; toDate?: string }
): Promise<AttendanceRecord[]> {
  const snap = await getDocs(
    query(
      collection(db, 'attendance'),
      where('orgId', '==', orgId),
      where('personUid', '==', personUid)
    )
  );
  let records = snap.docs.map((d) => hydrateAttendanceRecord(d.id, d.data() as AttendanceRecord));
  if (options?.fromDate) records = records.filter((r) => r.date >= options.fromDate!);
  if (options?.toDate) records = records.filter((r) => r.date <= options.toDate!);
  return records.sort((a, b) => b.date.localeCompare(a.date));
}

export function subscribeAttendanceForPerson(
  orgId: string,
  personUid: string,
  callback: (records: AttendanceRecord[]) => void
): () => void {
  const q = query(
    collection(db, 'attendance'),
    where('orgId', '==', orgId),
    where('personUid', '==', personUid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => hydrateAttendanceRecord(d.id, d.data() as AttendanceRecord))
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0)
        );
      callback(list);
    },
    () => callback([])
  );
}
