import { createUserWithEmailAndPassword } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  LanguageCode,
  ManagerCodeLookup,
  OrgCodeLookup,
  Organization,
  OrgType,
} from '../types';
import { buildOrgPrefix, generateCode, getDefaultRoleLabels } from '../utils/helpers';

export async function generateUniqueOrgCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode(6);
    const snap = await getDoc(doc(db, 'orgCodes', code));
    if (!snap.exists()) {
      return code;
    }
  }
  return generateCode(8);
}

export async function createOrganizationAndAdmin(params: {
  orgName: string;
  orgType: OrgType;
  adminName: string;
  email: string;
  password: string;
  phone: string;
  language: LanguageCode;
}): Promise<{ orgId: string; orgCode: string; uid: string }> {
  const email = params.email.trim().toLowerCase();
  const orgCode = await generateUniqueOrgCode();

  const cred = await createUserWithEmailAndPassword(auth, email, params.password);
  const uid = cred.user.uid;

  const orgRef = doc(collection(db, 'organizations'));
  const orgId = orgRef.id;
  const roleLabels = getDefaultRoleLabels(params.orgType);
  const prefix = buildOrgPrefix(params.orgName);

  const batch = writeBatch(db);

  batch.set(orgRef, {
    name: params.orgName.trim(),
    type: params.orgType,
    orgCode,
    adminUid: uid,
    roleLabels,
    lateAfter: '09:30',
    timezone: 'Asia/Kolkata',
    location: {
      lat: 0,
      lng: 0,
      radius: 200,
      enabled: false,
    },
    lowAttendanceThreshold: 75,
    counters: {
      manager: 0,
      member: 0,
    },
    hasDemoData: false,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'orgCodes', orgCode), {
    orgId,
    orgName: params.orgName.trim(),
    roleLabels,
  });

  batch.set(doc(db, 'users', uid), {
    uid,
    name: params.adminName.trim(),
    email,
    phone: params.phone.trim(),
    role: 'admin',
    orgId,
    managerId: null,
    memberId: `${prefix}-ADM-0001`,
    status: 'active',
    language: params.language,
    createdAt: serverTimestamp(),
  });

  await batch.commit();

  return { orgId, orgCode, uid };
}

export async function lookupOrgCode(code: string): Promise<OrgCodeLookup | null> {
  const clean = code.trim().toUpperCase();
  if (!clean) return null;
  const snap = await getDoc(doc(db, 'orgCodes', clean));
  if (!snap.exists()) return null;
  return snap.data() as OrgCodeLookup;
}

export async function lookupManagerCode(code: string): Promise<ManagerCodeLookup | null> {
  const clean = code.trim().toUpperCase();
  if (!clean) return null;
  const snap = await getDoc(doc(db, 'managerCodes', clean));
  if (!snap.exists()) return null;
  return snap.data() as ManagerCodeLookup;
}

export async function updateOrganization(
  orgId: string,
  orgCode: string,
  updates: Partial<Omit<Organization, 'id' | 'orgCode' | 'adminUid' | 'createdAt'>>
): Promise<void> {
  await updateDoc(doc(db, 'organizations', orgId), updates as Record<string, unknown>);
  if (updates.name || updates.roleLabels) {
    const codePatch: Record<string, unknown> = {};
    if (updates.name) codePatch.orgName = updates.name;
    if (updates.roleLabels) codePatch.roleLabels = updates.roleLabels;
    await setDoc(doc(db, 'orgCodes', orgCode), codePatch, { merge: true });
  }
}
