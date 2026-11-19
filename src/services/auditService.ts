import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { AuditLog, UserProfile, UserRole } from '../types';

export type RecordAuditLogParams =
  | {
      actor: Pick<UserProfile, 'uid' | 'name' | 'role' | 'orgId'>;
      action: AuditLog['action'];
      targetCollection: string;
      targetId: string;
      summary: string;
      metadata?: Record<string, string | number | boolean | null>;
    }
  | {
      orgId: string;
      actorUid: string;
      actorName: string;
      actorRole: UserRole;
      action: AuditLog['action'];
      targetType?: string;
      targetCollection?: string;
      targetId: string;
      summary: string;
      metadata?: Record<string, string | number | boolean | null>;
    };

export async function recordAuditLog(params: RecordAuditLogParams): Promise<void> {
  const orgId = 'actor' in params ? params.actor?.orgId : params.orgId;
  const actorUid = 'actor' in params ? params.actor?.uid : params.actorUid;
  const actorName = 'actor' in params ? params.actor?.name || 'User' : params.actorName || 'User';
  const actorRole = 'actor' in params ? params.actor?.role : params.actorRole;
  const targetCollection =
    'actor' in params
      ? params.targetCollection
      : params.targetCollection || params.targetType || 'system';

  if (!actorUid || !orgId) return;
  try {
    await addDoc(collection(db, 'auditLogs'), {
      orgId,
      actorUid,
      actorName,
      actorRole,
      action: params.action,
      targetCollection,
      targetType: targetCollection,
      targetId: params.targetId,
      summary: params.summary,
      metadata: params.metadata || {},
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking: audit log failure must not crash user flow if offline/rules not yet deployed
  }
}

function hydrateAuditLog(id: string, raw: Omit<AuditLog, 'id'>): AuditLog {
  const ts = raw.timestamp || raw.createdAt || null;
  const target = raw.targetCollection || raw.targetType || '';
  return {
    ...raw,
    id,
    targetCollection: target,
    targetType: target,
    timestamp: ts,
    createdAt: ts,
  };
}

export async function fetchAuditLogs(
  orgId: string,
  maxItems = 150
): Promise<AuditLog[]> {
  try {
    const q = query(
      collection(db, 'auditLogs'),
      where('orgId', '==', orgId),
      orderBy('timestamp', 'desc'),
      limit(maxItems)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => hydrateAuditLog(d.id, d.data() as Omit<AuditLog, 'id'>));
  } catch {
    // Fallback without orderBy in case composite index is still building
    const q = query(collection(db, 'auditLogs'), where('orgId', '==', orgId));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => hydrateAuditLog(d.id, d.data() as Omit<AuditLog, 'id'>))
      .sort((a, b) => (b.timestamp?.toMillis?.() ?? 0) - (a.timestamp?.toMillis?.() ?? 0))
      .slice(0, maxItems);
  }
}
