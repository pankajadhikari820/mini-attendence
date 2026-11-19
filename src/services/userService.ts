import { createUserWithEmailAndPassword } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, createSecondaryAccount, db } from '../firebase';
import type { LanguageCode, Organization, UserProfile, UserRole, UserStatus } from '../types';
import {
  extractIdPrefixFromName,
  generateCandidateUserId,
  generateCode,
} from '../utils/helpers';
import { recordAuditLog } from './auditService';
import { createNotification } from './communicationService';

export async function generateUniqueManagerCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode(6);
    const snap = await getDoc(doc(db, 'managerCodes', code));
    if (!snap.exists()) return code;
  }
  return generateCode(8);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export async function lookupUserId(code: string): Promise<{
  uid: string;
  orgId: string;
  role: UserRole;
} | null> {
  const clean = code.trim().toUpperCase();
  if (!clean) return null;
  const snap = await getDoc(doc(db, 'userIds', clean));
  if (!snap.exists()) return null;
  const data = snap.data() as { uid: string; orgId: string; role: UserRole };
  return data;
}

/**
 * Atomically reserves a globally unique 6-character ID (e.g. PAN482)
 * using a Firestore transaction on the `userIds/{ID}` lookup collection.
 */
export async function allocateUniqueUserId(params: {
  nameForId: string;
  uid: string;
  orgId: string;
  role: UserRole;
  isDemo?: boolean;
}): Promise<string> {
  const basePrefix = extractIdPrefixFromName(params.nameForId);
  const firstTwo = basePrefix.slice(0, 2);
  const startThirdIdx = Math.max(0, ALPHABET.indexOf(basePrefix[2] || 'X'));

  for (let letterStep = 0; letterStep < 26; letterStep++) {
    const thirdChar = ALPHABET[(startThirdIdx + letterStep) % 26];
    const prefix = `${firstTwo}${thirdChar}`;

    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = generateCandidateUserId(prefix);
      const idRef = doc(db, 'userIds', candidate);
      try {
        const reserved = await runTransaction(db, async (tx) => {
          const snap = await tx.get(idRef);
          if (snap.exists()) return false;
          tx.set(idRef, {
            uid: params.uid,
            orgId: params.orgId,
            role: params.role,
            ...(params.isDemo ? { isDemo: true } : {}),
            createdAt: serverTimestamp(),
          });
          return true;
        });
        if (reserved) return candidate;
      } catch {
        // Collision or transaction retry contention — try next candidate
      }
    }
  }

  throw new Error('Could not allocate unique 6-character ID');
}

/**
 * Directly adds a Manager/Teacher, Student/Member, or Parent.
 * Uses the secondary Firebase Auth instance so the current user stays signed in.
 */
export async function addPersonDirect(params: {
  org: Organization;
  role: 'manager' | 'member' | 'parent';
  managerId: string | null;
  name: string;
  englishName?: string;
  email: string;
  phone: string;
  rollNumber?: string;
  enrollmentNumber?: string;
  classId?: string | null;
  className?: string;
  departmentId?: string | null;
  departmentName?: string;
  courseName?: string;
  semester?: string;
  section?: string;
  photoUrl?: string;
  language?: LanguageCode;
  actor?: UserProfile | null;
}): Promise<{ profile: UserProfile; resetEmailSent: boolean }> {
  const cleanEmail = params.email.trim().toLowerCase();
  const { uid, resetEmailSent } = await createSecondaryAccount(cleanEmail);

  const memberId = await allocateUniqueUserId({
    nameForId: params.englishName?.trim() || params.name,
    uid,
    orgId: params.org.id,
    role: params.role,
  });

  let managerCode: string | undefined;
  if (params.role === 'manager') {
    managerCode = await generateUniqueManagerCode();
    await setDoc(doc(db, 'managerCodes', managerCode), {
      orgId: params.org.id,
      managerUid: uid,
      managerName: params.name.trim(),
      orgName: params.org.name,
      roleLabels: params.org.roleLabels,
    });
  }

  const userDoc: Record<string, unknown> = {
    uid,
    name: params.name.trim(),
    ...(params.englishName?.trim() ? { englishName: params.englishName.trim() } : {}),
    email: cleanEmail,
    phone: params.phone.trim(),
    rollNumber: params.rollNumber?.trim() || '',
    enrollmentNumber: params.enrollmentNumber?.trim() || params.rollNumber?.trim() || '',
    role: params.role,
    orgId: params.org.id,
    managerId: params.role === 'member' ? params.managerId : null,
    memberId,
    status: 'active',
    ...(managerCode ? { managerCode } : {}),
    ...(params.classId ? { classId: params.classId } : {}),
    ...(params.className ? { className: params.className } : {}),
    ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    ...(params.departmentName ? { departmentName: params.departmentName } : {}),
    ...(params.courseName ? { courseName: params.courseName } : {}),
    ...(params.semester ? { semester: params.semester } : {}),
    ...(params.section ? { section: params.section } : {}),
    ...(params.photoUrl ? { photoUrl: params.photoUrl } : {}),
    ...(params.role === 'parent' ? { linkedStudentUids: [] } : {}),
    language: params.language || 'en',
    createdAt: serverTimestamp(),
  };

  await setDoc(doc(db, 'users', uid), userDoc);

  if (params.actor) {
    await recordAuditLog({
      orgId: params.org.id,
      actorUid: params.actor.uid,
      actorName: params.actor.name,
      actorRole: params.actor.role,
      action: 'user.created',
      targetType: 'user',
      targetId: uid,
      summary: `Added ${params.role} ${params.name.trim()} (${memberId})`,
    });
  }

  return {
    profile: { ...userDoc, createdAt: null } as unknown as UserProfile,
    resetEmailSent,
  };
}

/**
 * Self-registration for a Manager (using Organization Code) or Member (using Manager Code).
 */
export async function selfRegisterUser(params: {
  role: 'manager' | 'member';
  orgId: string;
  managerId: string | null;
  parentNotifyUid: string | null;
  name: string;
  englishName?: string;
  email: string;
  password: string;
  phone: string;
  rollNumber?: string;
  language: LanguageCode;
}): Promise<string> {
  const cleanEmail = params.email.trim().toLowerCase();
  const cred = await createUserWithEmailAndPassword(auth, cleanEmail, params.password);
  const uid = cred.user.uid;

  await setDoc(doc(db, 'users', uid), {
    uid,
    name: params.name.trim(),
    ...(params.englishName?.trim() ? { englishName: params.englishName.trim() } : {}),
    email: cleanEmail,
    phone: params.phone.trim(),
    rollNumber: params.rollNumber?.trim() || '',
    enrollmentNumber: params.rollNumber?.trim() || '',
    role: params.role,
    orgId: params.orgId,
    managerId: params.role === 'member' ? params.managerId : null,
    memberId: '',
    status: 'pending',
    language: params.language,
    createdAt: serverTimestamp(),
  });

  if (params.parentNotifyUid) {
    try {
      await createNotification({
        orgId: params.orgId,
        toUid: params.parentNotifyUid,
        type: 'approval',
        text: `${params.name.trim()} requested to join as ${params.role}.`,
      });
    } catch {
      // Non-fatal
    }
  }

  return uid;
}

/**
 * Parent self-registration using Organization Code + Child's 6-character Student ID.
 * Creates a pending parent account and a pending parentLink request for Admin verification.
 */
export async function registerParentAccount(params: {
  orgId: string;
  adminNotifyUid?: string | null;
  name: string;
  englishName?: string;
  email: string;
  password: string;
  phone: string;
  studentMemberId: string;
  relationship: string;
  language: LanguageCode;
}): Promise<{ uid: string; studentFound: boolean }> {
  const cleanStudentCode = params.studentMemberId.trim().toUpperCase();
  const studentLookup = await lookupUserId(cleanStudentCode);
  if (!studentLookup || studentLookup.orgId !== params.orgId || studentLookup.role !== 'member') {
    throw new Error('STUDENT_NOT_FOUND');
  }

  const cleanEmail = params.email.trim().toLowerCase();
  const cred = await createUserWithEmailAndPassword(auth, cleanEmail, params.password);
  const uid = cred.user.uid;

  await setDoc(doc(db, 'users', uid), {
    uid,
    name: params.name.trim(),
    ...(params.englishName?.trim() ? { englishName: params.englishName.trim() } : {}),
    email: cleanEmail,
    phone: params.phone.trim(),
    role: 'parent',
    orgId: params.orgId,
    managerId: null,
    memberId: '',
    linkedStudentUids: [],
    status: 'pending',
    language: params.language,
    createdAt: serverTimestamp(),
  });

  await addDoc(collection(db, 'parentLinks'), {
    orgId: params.orgId,
    parentUid: uid,
    parentName: params.name.trim(),
    parentEmail: cleanEmail,
    studentUid: studentLookup.uid,
    studentName: '',
    studentMemberId: cleanStudentCode,
    relationship: params.relationship.trim() || 'Parent',
    status: 'pending',
    createdAt: serverTimestamp(),
  });

  if (params.adminNotifyUid) {
    try {
      await createNotification({
        orgId: params.orgId,
        toUid: params.adminNotifyUid,
        type: 'approval',
        text: `${params.name.trim()} requested Parent access linked to student ID ${cleanStudentCode}.`,
      });
    } catch {
      // Non-fatal
    }
  }

  return { uid, studentFound: true };
}

export async function approvePendingUser(
  org: Organization,
  person: UserProfile,
  actor?: UserProfile | null
): Promise<void> {
  if (person.role === 'admin' || person.role === 'super_admin') return;
  const memberId =
    person.memberId ||
    (await allocateUniqueUserId({
      nameForId: person.englishName || person.name,
      uid: person.uid,
      orgId: org.id,
      role: person.role,
    }));

  const patch: Record<string, unknown> = {
    status: 'active',
    memberId,
  };

  if (person.role === 'manager' && !person.managerCode) {
    const code = await generateUniqueManagerCode();
    patch.managerCode = code;
    await setDoc(doc(db, 'managerCodes', code), {
      orgId: org.id,
      managerUid: person.uid,
      managerName: person.name,
      orgName: org.name,
      roleLabels: org.roleLabels,
    });
  }

  await updateDoc(doc(db, 'users', person.uid), patch);

  await createNotification({
    orgId: org.id,
    toUid: person.uid,
    type: 'approval',
    text: `Your account has been approved. Your unique ID is ${memberId}.`,
  });

  if (actor) {
    await recordAuditLog({
      orgId: org.id,
      actorUid: actor.uid,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'user.approved',
      targetType: 'user',
      targetId: person.uid,
      summary: `Approved ${person.role} ${person.name} (${memberId})`,
    });
  }
}

export async function rejectPendingUser(
  orgId: string,
  person: UserProfile,
  actor?: UserProfile | null
): Promise<void> {
  await updateDoc(doc(db, 'users', person.uid), { status: 'inactive' });
  await createNotification({
    orgId,
    toUid: person.uid,
    type: 'approval',
    text: 'Your registration request was not approved.',
  });
  if (actor) {
    await recordAuditLog({
      orgId,
      actorUid: actor.uid,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'user.rejected',
      targetType: 'user',
      targetId: person.uid,
      summary: `Rejected registration for ${person.name}`,
    });
  }
}

export async function updateUserDetails(
  uid: string,
  updates: Partial<
    Pick<
      UserProfile,
      | 'name'
      | 'phone'
      | 'rollNumber'
      | 'enrollmentNumber'
      | 'language'
      | 'photoUrl'
      | 'classId'
      | 'className'
      | 'departmentId'
      | 'departmentName'
      | 'courseName'
      | 'semester'
      | 'section'
      | 'managerId'
    >
  >
): Promise<void> {
  await updateDoc(doc(db, 'users', uid), updates as Record<string, unknown>);
}

export async function updateUserRole(
  person: UserProfile,
  newRole: UserRole,
  actor: UserProfile
): Promise<void> {
  await updateDoc(doc(db, 'users', person.uid), { role: newRole });
  await recordAuditLog({
    orgId: person.orgId,
    actorUid: actor.uid,
    actorName: actor.name,
    actorRole: actor.role,
    action: 'user.role_changed',
    targetType: 'user',
    targetId: person.uid,
    summary: `Changed role for ${person.name} from ${person.role} to ${newRole}`,
  });
}

export async function setUserStatus(
  uid: string,
  status: UserStatus,
  actor?: UserProfile | null,
  orgId?: string
): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { status });
  if (actor && orgId) {
    await recordAuditLog({
      orgId,
      actorUid: actor.uid,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'user.status_changed',
      targetType: 'user',
      targetId: uid,
      summary: `Set user status to ${status}`,
    });
  }
}

export async function deleteUserProfile(
  person: UserProfile,
  actor?: UserProfile | null
): Promise<void> {
  if (person.managerCode) {
    try {
      await deleteDoc(doc(db, 'managerCodes', person.managerCode));
    } catch {
      // Ignore if already removed
    }
  }
  if (person.memberId && /^[A-Z]{3}\d{3}$/.test(person.memberId)) {
    try {
      await deleteDoc(doc(db, 'userIds', person.memberId));
    } catch {
      // Ignore if already removed
    }
  }
  await deleteDoc(doc(db, 'users', person.uid));

  if (actor) {
    await recordAuditLog({
      orgId: person.orgId,
      actorUid: actor.uid,
      actorName: actor.name,
      actorRole: actor.role,
      action: 'user.deleted',
      targetType: 'user',
      targetId: person.uid,
      summary: `Deleted ${person.role} ${person.name} (${person.memberId})`,
    });
  }
}

export async function fetchOrgUsers(
  orgId: string,
  role?: 'manager' | 'member' | 'parent'
): Promise<UserProfile[]> {
  const constraints = [where('orgId', '==', orgId)];
  if (role) constraints.push(where('role', '==', role));
  const q = query(collection(db, 'users'), ...constraints);
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ ...(d.data() as UserProfile), uid: d.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchManagerMembers(
  orgId: string,
  managerUid: string
): Promise<UserProfile[]> {
  const q = query(
    collection(db, 'users'),
    where('orgId', '==', orgId),
    where('managerId', '==', managerUid)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ ...(d.data() as UserProfile), uid: d.id }))
    .filter((u) => u.role === 'member')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchUsersByClass(
  orgId: string,
  classId: string
): Promise<UserProfile[]> {
  if (!classId) return [];
  const q = query(
    collection(db, 'users'),
    where('orgId', '==', orgId),
    where('classId', '==', classId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ ...(d.data() as UserProfile), uid: d.id }))
    .filter((u) => u.role === 'member')
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fetches all registered students (role === 'member') belonging strictly to the given institution.
 */
export async function fetchInstitutionStudents(orgId: string): Promise<UserProfile[]> {
  if (!orgId) return [];
  return fetchOrgUsers(orgId, 'member');
}

/**
 * Persists a teacher's selected class student UIDs on their own user profile in Firestore.
 */
export async function saveTeacherSelectedStudents(
  teacherUid: string,
  studentUids: string[]
): Promise<string[]> {
  const uniqueUids = Array.from(
    new Set(studentUids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))
  );
  await updateDoc(doc(db, 'users', teacherUid), {
    selectedStudentUids: uniqueUids,
  });
  return uniqueUids;
}

/**
 * Resolves a teacher's student/class list:
 * - If the teacher has saved `selectedStudentUids`, returns ONLY those students (strictly scoped to same institution).
 * - Otherwise, falls back to the existing assigned/direct members list.
 */
export function resolveTeacherStudents(
  allInstitutionStudents: UserProfile[],
  teacherProfile: UserProfile,
  fallbackMembers: UserProfile[]
): UserProfile[] {
  if (Array.isArray(teacherProfile.selectedStudentUids)) {
    const selectedSet = new Set(teacherProfile.selectedStudentUids);
    return allInstitutionStudents
      .filter((s) => s.orgId === teacherProfile.orgId && s.role === 'member' && selectedSet.has(s.uid))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return fallbackMembers;
}
