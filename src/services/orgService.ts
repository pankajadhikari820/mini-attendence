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
  UserProfile,
} from '../types';
import { generateCode, getDefaultRoleLabels } from '../utils/helpers';
import { recordAuditLog } from './auditService';
import { allocateUniqueUserId } from './userService';

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
  englishName?: string;
  email: string;
  password: string;
  phone: string;
  language: LanguageCode;
}): Promise<{ orgId: string; orgCode: string; uid: string; adminId: string }> {
  const email = params.email.trim().toLowerCase();
  const orgCode = await generateUniqueOrgCode();

  const cred = await createUserWithEmailAndPassword(auth, email, params.password);
  const uid = cred.user.uid;

  const orgRef = doc(collection(db, 'organizations'));
  const orgId = orgRef.id;
  const roleLabels = getDefaultRoleLabels(params.orgType);

  const adminId = await allocateUniqueUserId({
    nameForId: params.englishName?.trim() || params.adminName,
    uid,
    orgId,
    role: 'admin',
  });

  const batch = writeBatch(db);

  batch.set(orgRef, {
    name: params.orgName.trim(),
    type: params.orgType,
    orgCode,
    adminUid: uid,
    roleLabels,
    timezone: 'Asia/Kolkata',
    defaultSessionDuration: 45,
    location: {
      lat: 0,
      lng: 0,
      radius: 50,
      enabled: true,
    },
    lowAttendanceThreshold: 75,
    counters: {
      manager: 0,
      member: 0,
    },
    status: 'active',
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
    ...(params.englishName?.trim() ? { englishName: params.englishName.trim() } : {}),
    email,
    phone: params.phone.trim(),
    role: 'admin',
    orgId,
    managerId: null,
    memberId: adminId,
    status: 'active',
    language: params.language,
    createdAt: serverTimestamp(),
  });

  await batch.commit();

  return { orgId, orgCode, uid, adminId };
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
  updates: Partial<Omit<Organization, 'id' | 'orgCode' | 'adminUid' | 'createdAt'>>,
  actor?: UserProfile | null
): Promise<void> {
  await updateDoc(doc(db, 'organizations', orgId), updates as Record<string, unknown>);
  if (updates.name || updates.roleLabels) {
    const codePatch: Record<string, unknown> = {};
    if (updates.name) codePatch.orgName = updates.name;
    if (updates.roleLabels) codePatch.roleLabels = updates.roleLabels;
    await setDoc(doc(db, 'orgCodes', orgCode), codePatch, { merge: true });
  }
  if (actor) {
    await recordAuditLog({
      actor,
      action: 'settings.updated',
      targetCollection: 'organizations',
      targetId: orgId,
      summary: `Updated organization settings (${Object.keys(updates).join(', ')})`,
    });
  }
}
