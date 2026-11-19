import { createUserWithEmailAndPassword } from 'firebase/auth';
import {
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
import type { LanguageCode, Organization, UserProfile, UserStatus } from '../types';
import { buildOrgPrefix, formatMemberId, generateCode } from '../utils/helpers';
import { createNotification } from './communicationService';

export async function generateUniqueManagerCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode(6);
    const snap = await getDoc(doc(db, 'managerCodes', code));
    if (!snap.exists()) return code;
  }
  return generateCode(8);
}

/**
 * Atomically increments the org counter in a Firestore transaction
 * and returns a unique readable ID like ORG-MGR-0001 or ORG-MEM-0001.
 */
export async function allocateMemberId(
  orgId: string,
  orgName: string,
  role: 'manager' | 'member'
): Promise<string> {
  const orgRef = doc(db, 'organizations', orgId);
  const nextNumber = await runTransaction(db, async (tx) => {
    const snap = await tx.get(orgRef);
    if (!snap.exists()) throw new Error('Organization not found');
    const data = snap.data() as Organization;
    const current = data.counters?.[role] ?? 0;
    const next = current + 1;
    tx.update(orgRef, {
      counters: {
        manager: role === 'manager' ? next : data.counters?.manager ?? 0,
        member: role === 'member' ? next : data.counters?.member ?? 0,
      },
    });
    return next;
  });

  const prefix = buildOrgPrefix(orgName);
  return formatMemberId(prefix, role, nextNumber);
}

/**
 * Directly adds a Manager (by Admin) or Member (by Manager/Admin).
 * Uses the secondary Firebase Auth instance so the current user stays signed in.
 */
export async function addPersonDirect(params: {
  org: Organization;
  role: 'manager' | 'member';
  managerId: string | null;
  name: string;
  email: string;
  phone: string;
  rollNumber?: string;
  language?: LanguageCode;
}): Promise<{ profile: UserProfile; resetEmailSent: boolean }> {
  const cleanEmail = params.email.trim().toLowerCase();
  const { uid, resetEmailSent } = await createSecondaryAccount(cleanEmail);

  const memberId = await allocateMemberId(params.org.id, params.org.name, params.role);
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

  const userDoc: Omit<UserProfile, 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
    uid,
    name: params.name.trim(),
    email: cleanEmail,
    phone: params.phone.trim(),
    rollNumber: params.rollNumber?.trim() || '',
    role: params.role,
    orgId: params.org.id,
    managerId: params.role === 'member' ? params.managerId : null,
    memberId,
    status: 'active',
    ...(managerCode ? { managerCode } : {}),
    language: params.language || 'en',
    createdAt: serverTimestamp(),
  };

  await setDoc(doc(db, 'users', uid), userDoc);

  return {
    profile: { ...userDoc, createdAt: null } as UserProfile,
    resetEmailSent,
  };
}

/**
 * Self-registration for a Manager (using Organization Code) or Member (using Manager Code).
 * Status starts as 'pending' until approved by parent.
 */
export async function selfRegisterUser(params: {
  role: 'manager' | 'member';
  orgId: string;
  managerId: string | null;
  parentNotifyUid: string | null;
  name: string;
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
    email: cleanEmail,
    phone: params.phone.trim(),
    rollNumber: params.rollNumber?.trim() || '',
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

export async function approvePendingUser(org: Organization, person: UserProfile): Promise<void> {
  if (person.role === 'admin') return;
  const memberId = person.memberId || (await allocateMemberId(org.id, org.name, person.role));
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
    text: `Your account has been approved. Your ID is ${memberId}.`,
  });
}

export async function rejectPendingUser(orgId: string, person: UserProfile): Promise<void> {
  await updateDoc(doc(db, 'users', person.uid), { status: 'inactive' });
  await createNotification({
    orgId,
    toUid: person.uid,
    type: 'approval',
    text: 'Your registration request was not approved.',
  });
}

export async function updateUserDetails(
  uid: string,
  updates: Partial<Pick<UserProfile, 'name' | 'phone' | 'rollNumber' | 'language'>>
): Promise<void> {
  await updateDoc(doc(db, 'users', uid), updates as Record<string, unknown>);
}

export async function setUserStatus(uid: string, status: UserStatus): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { status });
}

export async function deleteUserProfile(person: UserProfile): Promise<void> {
  if (person.managerCode) {
    try {
      await deleteDoc(doc(db, 'managerCodes', person.managerCode));
    } catch {
      // Ignore if already removed
    }
  }
  await deleteDoc(doc(db, 'users', person.uid));
}

export async function fetchOrgUsers(
  orgId: string,
  role?: 'manager' | 'member'
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
