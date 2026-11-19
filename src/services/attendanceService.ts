import {
  collection,
  doc,
  getDoc,
  getDocs,
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
  Organization,
  QRPayload,
  UserProfile,
} from '../types';
import {
  getCurrentPosition,
  getDistanceMeters,
  getOrgDateString,
  getOrgTimeHHMM,
  isAfterLateTime,
} from '../utils/helpers';

export function buildAttendanceDocId(orgId: string, date: string, personUid: string): string {
  return `${orgId}_${date}_${personUid}`;
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
    | 'markedLate'
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

/**
 * Backup ID-Card QR scanner used by Admin/Manager (e.g. when a member has a dead phone or no GPS).
 * Tagged as method: "manual" so reports highlight backup entries cleanly in yellow.
 */
export async function markAttendanceViaQR(params: {
  rawText: string;
  org: Organization;
  marker: UserProfile;
  skipLocationCheck?: boolean;
}): Promise<QRScanResult> {
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

  const isDirectParent =
    (params.marker.role === 'admin' && person.role === 'manager') ||
    (params.marker.role === 'manager' &&
      person.role === 'member' &&
      person.managerId === params.marker.uid);

  if (!isDirectParent) {
    return { ok: false, code: 'notYourPerson', personName: person.name, memberId: person.memberId };
  }

  const date = getOrgDateString(params.org.timezone || 'Asia/Kolkata');
  const currentHHMM = getOrgTimeHHMM(params.org.timezone || 'Asia/Kolkata');
  const docId = buildAttendanceDocId(params.org.id, date, person.uid);
  const existing = await getDoc(doc(db, 'attendance', docId));

  if (existing.exists()) {
    const existingData = existing.data() as AttendanceRecord;
    return {
      ok: false,
      code: 'alreadyMarked',
      personName: person.name,
      memberId: person.memberId,
      status: existingData.status,
      timeStr: currentHHMM,
    };
  }

  const status: AttendanceStatus = isAfterLateTime(currentHHMM, params.org.lateAfter)
    ? 'late'
    : 'present';

  await setDoc(doc(db, 'attendance', docId), {
    orgId: params.org.id,
    personUid: person.uid,
    personName: person.name,
    personMemberId: person.memberId,
    role: person.role,
    managerId: person.managerId || null,
    date,
    timestamp: serverTimestamp(),
    status,
    method: 'manual' as AttendanceMethod,
    markedBy: params.marker.uid,
    note: 'ID Card QR backup',
  });

  return {
    ok: true,
    code: status === 'late' ? 'markedLate' : 'markedPresent',
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
}): Promise<void> {
  if (params.person.status !== 'active') {
    throw new Error('Cannot mark inactive or pending user');
  }
  const today = getOrgDateString(params.org.timezone || 'Asia/Kolkata');
  if (params.marker.role !== 'admin' && params.date !== today) {
    throw new Error('Only admins can edit past dates');
  }

  const docId = buildAttendanceDocId(params.org.id, params.date, params.person.uid);
  await setDoc(doc(db, 'attendance', docId), {
    orgId: params.org.id,
    personUid: params.person.uid,
    personName: params.person.name,
    personMemberId: params.person.memberId,
    role: params.person.role === 'admin' ? 'manager' : params.person.role,
    managerId: params.person.managerId || null,
    date: params.date,
    timestamp: serverTimestamp(),
    status: params.status,
    method: 'manual' as AttendanceMethod,
    markedBy: params.marker.uid,
    note: params.note?.trim() || '',
  });
}

export async function bulkMarkAttendance(params: {
  org: Organization;
  marker: UserProfile;
  entries: Array<{ person: UserProfile; status: AttendanceStatus; note?: string }>;
  date: string;
}): Promise<void> {
  const today = getOrgDateString(params.org.timezone || 'Asia/Kolkata');
  if (params.marker.role !== 'admin' && params.date !== today) {
    throw new Error('Only admins can edit past dates');
  }

  const CHUNK = 400;
  for (let i = 0; i < params.entries.length; i += CHUNK) {
    const slice = params.entries.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const entry of slice) {
      if (entry.person.status !== 'active') continue;
      const docId = buildAttendanceDocId(params.org.id, params.date, entry.person.uid);
      batch.set(doc(db, 'attendance', docId), {
        orgId: params.org.id,
        personUid: entry.person.uid,
        personName: entry.person.name,
        personMemberId: entry.person.memberId,
        role: entry.person.role === 'admin' ? 'manager' : entry.person.role,
        managerId: entry.person.managerId || null,
        date: params.date,
        timestamp: serverTimestamp(),
        status: entry.status,
        method: 'manual' as AttendanceMethod,
        markedBy: params.marker.uid,
        note: entry.note?.trim() || '',
      });
    }
    await batch.commit();
  }
}

export async function fetchAttendanceForOrg(
  orgId: string,
  options?: { fromDate?: string; toDate?: string; date?: string }
): Promise<AttendanceRecord[]> {
  const constraints = [where('orgId', '==', orgId)];
  if (options?.date) {
    constraints.push(where('date', '==', options.date));
  }
  const snap = await getDocs(query(collection(db, 'attendance'), ...constraints));
  let records = snap.docs.map((d) => ({ ...(d.data() as AttendanceRecord), id: d.id }));
  if (options?.fromDate) records = records.filter((r) => r.date >= options.fromDate!);
  if (options?.toDate) records = records.filter((r) => r.date <= options.toDate!);
  return records.sort((a, b) => b.date.localeCompare(a.date));
}

export async function fetchAttendanceForManager(
  orgId: string,
  managerUid: string,
  options?: { fromDate?: string; toDate?: string; date?: string; includeOwn?: boolean }
): Promise<AttendanceRecord[]> {
  const teamConstraints = [
    where('orgId', '==', orgId),
    where('managerId', '==', managerUid),
  ];
  if (options?.date) teamConstraints.push(where('date', '==', options.date));
  const teamSnap = await getDocs(query(collection(db, 'attendance'), ...teamConstraints));
  let records = teamSnap.docs.map((d) => ({ ...(d.data() as AttendanceRecord), id: d.id }));

  if (options?.includeOwn) {
    const ownConstraints = [
      where('orgId', '==', orgId),
      where('personUid', '==', managerUid),
    ];
    if (options?.date) ownConstraints.push(where('date', '==', options.date));
    const ownSnap = await getDocs(query(collection(db, 'attendance'), ...ownConstraints));
    const ownRecs = ownSnap.docs.map((d) => ({ ...(d.data() as AttendanceRecord), id: d.id }));
    const seen = new Set(records.map((r) => r.id));
    for (const r of ownRecs) {
      if (!seen.has(r.id)) records.push(r);
    }
  }

  if (options?.fromDate) records = records.filter((r) => r.date >= options.fromDate!);
  if (options?.toDate) records = records.filter((r) => r.date <= options.toDate!);
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
  let records = snap.docs.map((d) => ({ ...(d.data() as AttendanceRecord), id: d.id }));
  if (options?.fromDate) records = records.filter((r) => r.date >= options.fromDate!);
  if (options?.toDate) records = records.filter((r) => r.date <= options.toDate!);
  return records.sort((a, b) => b.date.localeCompare(a.date));
}
