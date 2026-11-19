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
import type { LanguageCode, Organization, UserProfile, UserRole, UserStatus } from '../types';
import {
  extractIdPrefixFromName,
  generateCandidateUserId,
  generateCode,
} from '../utils/helpers';
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

/**
 * Atomically reserves a globally unique 6-character ID (e.g. PAN482)
 * using a Firestore transaction on the `userIds/{ID}` lookup collection.
 * Retries up to 30 times with new random 3 digits; if exhausted, changes the 3rd letter.
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
 * Directly adds a Manager (by Admin) or Member (by Manager/Admin).
 * Uses the secondary Firebase Auth instance so the current user stays signed in.
 */
export async function addPersonDirect(params: {
  org: Organization;
  role: 'manager' | 'member';
  managerId: string | null;
  name: string;
  englishName?: string;
  email: string;
  phone: string;
  rollNumber?: string;
  language?: LanguageCode;
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

  const userDoc: Omit<UserProfile, 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
    uid,
    name: params.name.trim(),
    ...(params.englishName?.trim() ? { englishName: params.englishName.trim() } : {}),
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
  if (person.memberId && /^[A-Z]{3}\d{3}$/.test(person.memberId)) {
    try {
      await deleteDoc(doc(db, 'userIds', person.memberId));
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
