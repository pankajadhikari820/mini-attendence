import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  AcademicClass,
  Department,
  FacultyAssignment,
  Organization,
  ParentLink,
  Subject,
  TimetableSlot,
  UserProfile,
} from '../types';
import { timesOverlap } from '../utils/helpers';
import { recordAuditLog } from './auditService';
import { createNotification } from './communicationService';

// ===================== DEPARTMENTS =====================

export async function fetchDepartments(orgId: string): Promise<Department[]> {
  const snap = await getDocs(
    query(collection(db, 'departments'), where('orgId', '==', orgId))
  );
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<Department, 'id'>), id: d.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createDepartment(params: {
  orgId: string;
  name: string;
  code: string;
  actor: UserProfile;
}): Promise<Department> {
  const payload = {
    orgId: params.orgId,
    name: params.name.trim(),
    code: params.code.trim().toUpperCase(),
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'departments'), payload);
  await recordAuditLog({
    actor: params.actor,
    action: 'academic.updated',
    targetCollection: 'departments',
    targetId: ref.id,
    summary: `Created department ${payload.name} (${payload.code})`,
  });
  return { ...payload, id: ref.id, createdAt: null };
}

export async function deleteDepartment(
  deptOrId: Department | string,
  actor?: UserProfile
): Promise<void> {
  const id = typeof deptOrId === 'string' ? deptOrId : deptOrId.id;
  const name = typeof deptOrId === 'string' ? deptOrId : deptOrId.name;
  await deleteDoc(doc(db, 'departments', id));
  if (actor) {
    await recordAuditLog({
      actor,
      action: 'academic.updated',
      targetCollection: 'departments',
      targetId: id,
      summary: `Deleted department ${name}`,
    });
  }
}

// ===================== CLASSES / SECTIONS =====================

export async function fetchClasses(orgId: string): Promise<AcademicClass[]> {
  const snap = await getDocs(query(collection(db, 'classes'), where('orgId', '==', orgId)));
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<AcademicClass, 'id'>), id: d.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createAcademicClass(params: {
  orgId: string;
  department?: Department | null;
  departmentId?: string | null;
  departmentName?: string;
  courseName: string;
  semester: string;
  section: string;
  roomNumber?: string;
  classroom?: string;
  name?: string;
  actor: UserProfile;
}): Promise<AcademicClass> {
  const course = params.courseName.trim();
  const sem = params.semester.trim();
  const sec = params.section.trim().toUpperCase();
  const formattedName =
    params.name?.trim() || `${course} · Sem ${sem} · Sec ${sec}`;
  const deptId = params.departmentId ?? params.department?.id ?? '';
  const deptName = params.departmentName ?? params.department?.name ?? '';
  const room = (params.classroom || params.roomNumber || '').trim();
  const payload = {
    orgId: params.orgId,
    departmentId: deptId,
    departmentName: deptName,
    courseName: course,
    semester: sem,
    section: sec,
    roomNumber: room,
    classroom: room,
    name: formattedName,
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'classes'), payload);
  await recordAuditLog({
    actor: params.actor,
    action: 'academic.updated',
    targetCollection: 'classes',
    targetId: ref.id,
    summary: `Created class ${formattedName}`,
  });
  return { ...payload, id: ref.id, createdAt: null };
}

export async function deleteAcademicClass(
  clsOrId: AcademicClass | string,
  actor?: UserProfile
): Promise<void> {
  const id = typeof clsOrId === 'string' ? clsOrId : clsOrId.id;
  const name = typeof clsOrId === 'string' ? clsOrId : clsOrId.name;
  await deleteDoc(doc(db, 'classes', id));
  if (actor) {
    await recordAuditLog({
      actor,
      action: 'academic.updated',
      targetCollection: 'classes',
      targetId: id,
      summary: `Deleted class ${name}`,
    });
  }
}

// ===================== SUBJECTS =====================

export async function fetchSubjects(orgId: string, classId?: string): Promise<Subject[]> {
  const constraints = [where('orgId', '==', orgId)];
  if (classId) constraints.push(where('classId', '==', classId));
  const snap = await getDocs(query(collection(db, 'subjects'), ...constraints));
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<Subject, 'id'>), id: d.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createSubject(params: {
  orgId: string;
  academicClass?: AcademicClass | null;
  department?: Department | null;
  departmentId?: string | null;
  departmentName?: string;
  classId?: string | null;
  className?: string;
  name: string;
  code: string;
  credits?: number;
  actor: UserProfile;
}): Promise<Subject> {
  const deptId = params.departmentId ?? params.academicClass?.departmentId ?? params.department?.id ?? '';
  const deptName = params.departmentName ?? params.department?.name ?? '';
  const clsId = params.classId ?? params.academicClass?.id ?? '';
  const clsName = params.className ?? params.academicClass?.name ?? '';
  const payload = {
    orgId: params.orgId,
    departmentId: deptId,
    departmentName: deptName,
    classId: clsId,
    className: clsName,
    name: params.name.trim(),
    code: params.code.trim().toUpperCase(),
    credits: params.credits || 4,
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'subjects'), payload);
  await recordAuditLog({
    actor: params.actor,
    action: 'academic.updated',
    targetCollection: 'subjects',
    targetId: ref.id,
    summary: `Created subject ${payload.name} (${payload.code})${payload.className ? ` for ${payload.className}` : ''}`,
  });
  return { ...payload, id: ref.id, createdAt: null };
}

export async function deleteSubject(
  subjOrId: Subject | string,
  actor?: UserProfile
): Promise<void> {
  const id = typeof subjOrId === 'string' ? subjOrId : subjOrId.id;
  const name = typeof subjOrId === 'string' ? subjOrId : subjOrId.name;
  await deleteDoc(doc(db, 'subjects', id));
  if (actor) {
    await recordAuditLog({
      actor,
      action: 'academic.updated',
      targetCollection: 'subjects',
      targetId: id,
      summary: `Deleted subject ${name}`,
    });
  }
}

// ===================== FACULTY ASSIGNMENTS =====================

export async function fetchFacultyAssignments(
  orgId: string,
  filterOrUid?: string | { teacherUid?: string; classId?: string }
): Promise<FacultyAssignment[]> {
  const constraints = [where('orgId', '==', orgId)];
  if (typeof filterOrUid === 'string') {
    constraints.push(where('teacherUid', '==', filterOrUid));
  } else if (filterOrUid) {
    if (filterOrUid.teacherUid) constraints.push(where('teacherUid', '==', filterOrUid.teacherUid));
    if (filterOrUid.classId) constraints.push(where('classId', '==', filterOrUid.classId));
  }
  const snap = await getDocs(query(collection(db, 'facultyAssignments'), ...constraints));
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<FacultyAssignment, 'id'>), id: d.id }))
    .sort((a, b) => a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName));
}

export function subscribeFacultyAssignments(
  orgId: string,
  param2: string | ((items: FacultyAssignment[]) => void),
  param3?: string | ((items: FacultyAssignment[]) => void)
): () => void {
  let teacherUid: string | undefined;
  let callback: (items: FacultyAssignment[]) => void = () => {};

  if (typeof param2 === 'string') {
    teacherUid = param2;
    if (typeof param3 === 'function') callback = param3;
  } else if (typeof param2 === 'function') {
    callback = param2;
    if (typeof param3 === 'string') teacherUid = param3;
  }

  const constraints = [where('orgId', '==', orgId)];
  if (teacherUid) constraints.push(where('teacherUid', '==', teacherUid));

  const q = query(collection(db, 'facultyAssignments'), ...constraints);
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => ({ ...(d.data() as Omit<FacultyAssignment, 'id'>), id: d.id }))
        .sort((a, b) => a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName));
      callback(list);
    },
    () => callback([])
  );
}

export async function createFacultyAssignment(params: {
  orgId: string;
  teacher: UserProfile;
  academicClass: AcademicClass;
  subject: Subject;
  actor: UserProfile;
}): Promise<FacultyAssignment> {
  // Prevent duplicate teacher-class-subject assignment
  const existing = await fetchFacultyAssignments(params.orgId, params.teacher.uid);
  const dup = existing.find(
    (a) => a.classId === params.academicClass.id && a.subjectId === params.subject.id
  );
  if (dup) {
    throw new Error('DUPLICATE_ASSIGNMENT');
  }

  const payload = {
    orgId: params.orgId,
    teacherUid: params.teacher.uid,
    teacherName: params.teacher.name,
    teacherMemberId: params.teacher.memberId || '',
    departmentId: params.academicClass.departmentId,
    classId: params.academicClass.id,
    className: params.academicClass.name,
    courseName: params.academicClass.courseName,
    semester: params.academicClass.semester,
    section: params.academicClass.section,
    subjectId: params.subject.id,
    subjectName: params.subject.name,
    subjectCode: params.subject.code,
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'facultyAssignments'), payload);
  await recordAuditLog({
    actor: params.actor,
    action: 'academic.updated',
    targetCollection: 'facultyAssignments',
    targetId: ref.id,
    summary: `Assigned ${params.teacher.name} to ${params.subject.name} (${params.academicClass.name})`,
  });
  return { ...payload, id: ref.id, createdAt: null };
}

export const assignFacultyToSubject = createFacultyAssignment;

export async function deleteFacultyAssignment(
  assignmentOrId: FacultyAssignment | string,
  actor?: UserProfile
): Promise<void> {
  const id = typeof assignmentOrId === 'string' ? assignmentOrId : assignmentOrId.id;
  await deleteDoc(doc(db, 'facultyAssignments', id));
  if (actor) {
    const summary = typeof assignmentOrId === 'string'
      ? `Removed faculty assignment ${id}`
      : `Removed assignment of ${assignmentOrId.teacherName} from ${assignmentOrId.subjectName} (${assignmentOrId.className})`;
    await recordAuditLog({
      actor,
      action: 'academic.updated',
      targetCollection: 'facultyAssignments',
      targetId: id,
      summary,
    });
  }
}

// ===================== TIMETABLES =====================

export async function fetchTimetableSlots(
  orgId: string,
  filters?: { classId?: string; teacherUid?: string }
): Promise<TimetableSlot[]> {
  const constraints = [where('orgId', '==', orgId)];
  if (filters?.classId) constraints.push(where('classId', '==', filters.classId));
  if (filters?.teacherUid) constraints.push(where('teacherUid', '==', filters.teacherUid));
  const snap = await getDocs(query(collection(db, 'timetables'), ...constraints));
  return snap.docs
    .map((d) => {
      const data = d.data() as Omit<TimetableSlot, 'id'>;
      return {
        ...data,
        id: d.id,
        classroom: data.classroom || data.roomNumber || '',
      };
    })
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
}

export async function fetchTimetableForOrg(orgId: string): Promise<TimetableSlot[]> {
  return fetchTimetableSlots(orgId);
}

export function subscribeTimetableForClass(
  orgId: string,
  classId: string,
  callback: (slots: TimetableSlot[]) => void
): () => void {
  const q = query(
    collection(db, 'timetables'),
    where('orgId', '==', orgId),
    where('classId', '==', classId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => {
          const data = d.data() as Omit<TimetableSlot, 'id'>;
          return {
            ...data,
            id: d.id,
            classroom: data.classroom || data.roomNumber || '',
          };
        })
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
      callback(list);
    },
    () => callback([])
  );
}

export function subscribeTimetableForTeacher(
  orgId: string,
  teacherUid: string,
  callback: (slots: TimetableSlot[]) => void
): () => void {
  const q = query(
    collection(db, 'timetables'),
    where('orgId', '==', orgId),
    where('teacherUid', '==', teacherUid)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs
        .map((d) => {
          const data = d.data() as Omit<TimetableSlot, 'id'>;
          return {
            ...data,
            id: d.id,
            classroom: data.classroom || data.roomNumber || '',
          };
        })
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
      callback(list);
    },
    () => callback([])
  );
}

export interface TimetableConflict {
  type: 'teacher' | 'class' | 'room';
  slot: TimetableSlot;
  message?: string;
}

export function detectTimetableConflicts(
  existingSlots: TimetableSlot[],
  candidate: {
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    classId: string;
    teacherUid: string;
    roomNumber?: string;
    classroom?: string;
    ignoreSlotId?: string;
  }
): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];
  const room = (candidate.classroom || candidate.roomNumber || '').trim().toLowerCase();

  for (const s of existingSlots) {
    if (candidate.ignoreSlotId && s.id === candidate.ignoreSlotId) continue;
    if (s.dayOfWeek !== candidate.dayOfWeek) continue;
    if (!timesOverlap(s.startTime, s.endTime, candidate.startTime, candidate.endTime)) continue;

    if (s.teacherUid === candidate.teacherUid) {
      conflicts.push({
        type: 'teacher',
        slot: s,
        message: `Teacher ${s.teacherName} already has ${s.subjectName} (${s.startTime}-${s.endTime})`,
      });
    }
    if (s.classId === candidate.classId) {
      conflicts.push({
        type: 'class',
        slot: s,
        message: `Class ${s.className} already has ${s.subjectName} (${s.startTime}-${s.endTime})`,
      });
    }
    if (room && (s.classroom || s.roomNumber || '').trim().toLowerCase() === room) {
      conflicts.push({
        type: 'room',
        slot: s,
        message: `Room ${s.classroom || s.roomNumber} is occupied by ${s.className} (${s.startTime}-${s.endTime})`,
      });
    }
  }
  return conflicts;
}

export async function createTimetableSlot(params: {
  orgId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  assignment?: FacultyAssignment;
  academicClass?: AcademicClass;
  subject?: Subject;
  teacher?: UserProfile;
  roomNumber?: string;
  classroom?: string;
  actor?: UserProfile;
}): Promise<TimetableSlot> {
  const room = (
    params.classroom ||
    params.roomNumber ||
    params.academicClass?.roomNumber ||
    params.academicClass?.classroom ||
    'Main Room'
  ).trim();

  const classId = params.academicClass?.id || params.assignment?.classId || '';
  const className = params.academicClass?.name || params.assignment?.className || '';
  const courseName = params.academicClass?.courseName || params.assignment?.courseName || '';
  const semester = params.academicClass?.semester || params.assignment?.semester || '';
  const section = params.academicClass?.section || params.assignment?.section || '';
  const subjectId = params.subject?.id || params.assignment?.subjectId || '';
  const subjectName = params.subject?.name || params.assignment?.subjectName || '';
  const subjectCode = params.subject?.code || params.assignment?.subjectCode || '';
  const teacherUid = params.teacher?.uid || params.assignment?.teacherUid || '';
  const teacherName = params.teacher?.name || params.assignment?.teacherName || '';

  const payload: Omit<TimetableSlot, 'id'> = {
    orgId: params.orgId,
    dayOfWeek: params.dayOfWeek,
    startTime: params.startTime,
    endTime: params.endTime,
    classId,
    className,
    courseName,
    semester,
    section,
    subjectId,
    subjectName,
    subjectCode,
    teacherUid,
    teacherName,
    roomNumber: room,
    classroom: room,
    createdAt: serverTimestamp() as unknown as Timestamp,
  };

  const ref = await addDoc(collection(db, 'timetables'), payload);
  if (params.actor) {
    await recordAuditLog({
      actor: params.actor,
      action: 'timetable.updated',
      targetCollection: 'timetables',
      targetId: ref.id,
      summary: `Scheduled ${payload.subjectName} (${payload.className}) · ${payload.startTime}-${payload.endTime}`,
    });
  }
  return { ...payload, id: ref.id, createdAt: null };
}

export async function deleteTimetableSlot(
  slotOrId: TimetableSlot | string,
  actor?: UserProfile
): Promise<void> {
  const id = typeof slotOrId === 'string' ? slotOrId : slotOrId.id;
  await deleteDoc(doc(db, 'timetables', id));
  if (actor) {
    await recordAuditLog({
      actor,
      action: 'timetable.updated',
      targetCollection: 'timetables',
      targetId: id,
      summary: `Deleted timetable slot ${id}`,
    });
  }
}

// ===================== PARENT LINKS =====================

export async function fetchParentLinks(orgId: string): Promise<ParentLink[]> {
  const snap = await getDocs(
    query(collection(db, 'parentLinks'), where('orgId', '==', orgId))
  );
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<ParentLink, 'id'>), id: d.id }))
    .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
}

export async function verifyParentLink(
  linkOrParams: ParentLink | { link: ParentLink; actor: UserProfile },
  actorParam?: UserProfile
): Promise<void> {
  const link = 'link' in linkOrParams ? linkOrParams.link : linkOrParams;
  const actor = 'actor' in linkOrParams ? linkOrParams.actor : actorParam;
  const batch = writeBatch(db);
  batch.update(doc(db, 'parentLinks', link.id), {
    status: 'verified',
    verifiedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', link.parentUid), {
    status: 'active',
    linkedStudentUids: arrayUnion(link.studentUid),
  });
  batch.update(doc(db, 'users', link.studentUid), {
    parentUids: arrayUnion(link.parentUid),
  });
  await batch.commit();

  await createNotification({
    orgId: link.orgId,
    toUid: link.parentUid,
    type: 'approval',
    text: `Your parent account has been linked and verified for student ${link.studentName} (${link.studentMemberId}).`,
  });

  if (actor) {
    await recordAuditLog({
      actor,
      action: 'parent.linked',
      targetCollection: 'parentLinks',
      targetId: link.id,
      summary: `Verified parent ${link.parentName} link to student ${link.studentName} (${link.studentMemberId})`,
    });
  }
}

export async function rejectParentLink(
  linkOrParams: ParentLink | { link: ParentLink; actor: UserProfile },
  actorParam?: UserProfile
): Promise<void> {
  const link = 'link' in linkOrParams ? linkOrParams.link : linkOrParams;
  const actor = 'actor' in linkOrParams ? linkOrParams.actor : actorParam;
  await updateDoc(doc(db, 'parentLinks', link.id), { status: 'rejected' });
  if (actor) {
    await recordAuditLog({
      actor,
      action: 'parent.linked',
      targetCollection: 'parentLinks',
      targetId: link.id,
      summary: `Rejected parent link request from ${link.parentName} for ${link.studentMemberId}`,
    });
  }
}

export async function linkParentDirectly(params: {
  orgId: string;
  parent: UserProfile;
  student: UserProfile;
  relationship?: string;
  actor: UserProfile;
}): Promise<void> {
  const linkRef = doc(collection(db, 'parentLinks'));
  const batch = writeBatch(db);
  batch.set(linkRef, {
    orgId: params.orgId,
    parentUid: params.parent.uid,
    parentName: params.parent.name,
    parentEmail: params.parent.email,
    studentUid: params.student.uid,
    studentName: params.student.name,
    studentMemberId: params.student.memberId || '',
    relationship: params.relationship || '',
    status: 'verified',
    createdAt: serverTimestamp(),
    verifiedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', params.parent.uid), {
    status: 'active',
    linkedStudentUids: arrayUnion(params.student.uid),
  });
  batch.update(doc(db, 'users', params.student.uid), {
    parentUids: arrayUnion(params.parent.uid),
  });
  await batch.commit();

  await recordAuditLog({
    actor: params.actor,
    action: 'parent.linked',
    targetCollection: 'parentLinks',
    targetId: linkRef.id,
    summary: `Linked parent ${params.parent.name} directly to student ${params.student.name} (${params.student.memberId})`,
  });
}

export async function fetchLinkedStudentsForParent(
  parentProfile: UserProfile
): Promise<UserProfile[]> {
  const uids = parentProfile.linkedStudentUids || [];
  if (uids.length === 0) return [];
  const snaps = await Promise.all(uids.map((uid) => getDoc(doc(db, 'users', uid))));
  return snaps
    .filter((s) => s.exists())
    .map((s) => ({ ...(s.data() as UserProfile), uid: s.id }));
}

// ===================== SUPER ADMIN ORG MANAGEMENT =====================

export async function fetchAllOrganizations(): Promise<Organization[]> {
  const snap = await getDocs(collection(db, 'organizations'));
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<Organization, 'id'>), id: d.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
