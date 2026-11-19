import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { LeaveRequest, Organization, UserProfile } from '../types';
import { eachDateBetween } from '../utils/helpers';
import { buildAttendanceDocId } from './attendanceService';
import { recordAuditLog } from './auditService';
import { createNotification } from './communicationService';

export async function createLeaveRequest(params: {
  org: Organization;
  requester: UserProfile;
  fromDate: string;
  toDate: string;
  reason: string;
}): Promise<string> {
  const toUid =
    params.requester.role === 'member' && params.requester.managerId
      ? params.requester.managerId
      : params.org.adminUid;

  const ref = await addDoc(collection(db, 'leaves'), {
    orgId: params.org.id,
    personUid: params.requester.uid,
    personName: params.requester.name,
    personRole: params.requester.role === 'member' ? 'member' : 'manager',
    personMemberId: params.requester.memberId,
    toUid,
    fromDate: params.fromDate,
    toDate: params.toDate,
    reason: params.reason.trim(),
    status: 'pending',
    comment: '',
    createdAt: serverTimestamp(),
  });

  await createNotification({
    orgId: params.org.id,
    toUid,
    type: 'leave',
    text: `${params.requester.name} requested leave (${params.fromDate} to ${params.toDate}).`,
  });

  await recordAuditLog({
    orgId: params.org.id,
    actorUid: params.requester.uid,
    actorName: params.requester.name,
    actorRole: params.requester.role,
    action: 'leave.requested',
    targetType: 'leave',
    targetId: ref.id,
    summary: `Requested leave from ${params.fromDate} to ${params.toDate}`,
  });

  return ref.id;
}

export async function decideLeaveRequest(params: {
  leave: LeaveRequest;
  decision: 'approved' | 'rejected';
  comment: string;
  decidedBy: UserProfile;
}): Promise<void> {
  await updateDoc(doc(db, 'leaves', params.leave.id), {
    status: params.decision,
    comment: params.comment.trim(),
  });

  // When approved, automatically mark each date as "leave" in attendance collection
  if (params.decision === 'approved') {
    const dates = eachDateBetween(params.leave.fromDate, params.leave.toDate);
    if (dates.length > 0) {
      const batch = writeBatch(db);
      for (const date of dates) {
        const docId = buildAttendanceDocId(params.leave.orgId, date, params.leave.personUid);
        batch.set(doc(db, 'attendance', docId), {
          orgId: params.leave.orgId,
          personUid: params.leave.personUid,
          personName: params.leave.personName,
          personMemberId: params.leave.personMemberId || '',
          role: params.leave.personRole,
          managerId: params.leave.personRole === 'member' ? params.leave.toUid : null,
          teacherUid: params.decidedBy.uid,
          teacherName: params.decidedBy.name,
          date,
          timestamp: serverTimestamp(),
          status: 'leave',
          method: 'manual',
          markedBy: params.decidedBy.uid,
          note: params.leave.reason,
        });
      }
      await batch.commit();
    }
  }

  await createNotification({
    orgId: params.leave.orgId,
    toUid: params.leave.personUid,
    type: 'leave',
    text:
      params.decision === 'approved'
        ? `Your leave (${params.leave.fromDate} to ${params.leave.toDate}) was approved.`
        : `Your leave (${params.leave.fromDate} to ${params.leave.toDate}) was rejected.`,
  });

  await recordAuditLog({
    orgId: params.leave.orgId,
    actorUid: params.decidedBy.uid,
    actorName: params.decidedBy.name,
    actorRole: params.decidedBy.role,
    action: params.decision === 'approved' ? 'leave.approved' : 'leave.rejected',
    targetType: 'leave',
    targetId: params.leave.id,
    summary: `${params.decision === 'approved' ? 'Approved' : 'Rejected'} leave for ${params.leave.personName} (${params.leave.fromDate} to ${params.leave.toDate})`,
  });
}

export async function fetchLeavesForStudent(
  orgId: string,
  studentUid: string
): Promise<LeaveRequest[]> {
  const snap = await getDocs(
    query(
      collection(db, 'leaves'),
      where('orgId', '==', orgId),
      where('personUid', '==', studentUid)
    )
  );
  return snap.docs
    .map((d) => ({ ...(d.data() as LeaveRequest), id: d.id }))
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
}

export async function fetchLeavesForUser(profile: UserProfile): Promise<{
  myLeaves: LeaveRequest[];
  teamLeaves: LeaveRequest[];
}> {
  const sortByCreated = (list: LeaveRequest[]) =>
    list.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? 0;
      const tb = b.createdAt?.toMillis?.() ?? 0;
      return tb - ta;
    });

  if (profile.role === 'admin' || profile.role === 'super_admin') {
    const snap = await getDocs(
      query(collection(db, 'leaves'), where('orgId', '==', profile.orgId))
    );
    const all = snap.docs.map((d) => ({ ...(d.data() as LeaveRequest), id: d.id }));
    return {
      myLeaves: [],
      teamLeaves: sortByCreated(all),
    };
  }

  if (profile.role === 'manager') {
    const [ownSnap, teamSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'leaves'),
          where('orgId', '==', profile.orgId),
          where('personUid', '==', profile.uid)
        )
      ),
      getDocs(
        query(
          collection(db, 'leaves'),
          where('orgId', '==', profile.orgId),
          where('toUid', '==', profile.uid)
        )
      ),
    ]);
    return {
      myLeaves: sortByCreated(
        ownSnap.docs.map((d) => ({ ...(d.data() as LeaveRequest), id: d.id }))
      ),
      teamLeaves: sortByCreated(
        teamSnap.docs.map((d) => ({ ...(d.data() as LeaveRequest), id: d.id }))
      ),
    };
  }

  const myLeaves = await fetchLeavesForStudent(profile.orgId, profile.uid);
  return {
    myLeaves,
    teamLeaves: [],
  };
}
