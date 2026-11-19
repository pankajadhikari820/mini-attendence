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

export async function recordAuditLog(params: {
  actor?: Pick<UserProfile, 'uid' | 'name' | 'role' | 'orgId'>;
  orgId?: string;
  actorUid?: string;
  actorName?: string;
  actorRole?: UserRole;
  action: AuditLog['action'];
  targetCollection?: string;
  targetType?: string;
  targetId: string;
  summary: string;
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  const orgId = params.actor?.orgId || params.orgId;
  const actorUid = params.actor?.uid || params.actorUid;
  const actorName = params.actor?.name || params.actorName || 'User';
  const actorRole = (params.actor?.role || params.actorRole || 'member') as UserRole;
  const targetCollection = params.targetCollection || params.targetType || 'general';
  if (!orgId || !actorUid) return;

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
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        ...(data as Omit<AuditLog, 'id'>),
        id: d.id,
        createdAt: data.createdAt || data.timestamp || null,
        timestamp: data.timestamp || data.createdAt || null,
        targetType: data.targetType || data.targetCollection || '',
      };
    });
  } catch {
    // Fallback without orderBy in case composite index is still building
    const q = query(collection(db, 'auditLogs'), where('orgId', '==', orgId));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          ...(data as Omit<AuditLog, 'id'>),
          id: d.id,
          createdAt: data.createdAt || data.timestamp || null,
          timestamp: data.timestamp || data.createdAt || null,
          targetType: data.targetType || data.targetCollection || '',
        };
      })
      .sort((a, b) => {
        const ta = a.timestamp?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const tb = b.timestamp?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        return tb - ta;
      })
      .slice(0, maxItems);
  }
}
