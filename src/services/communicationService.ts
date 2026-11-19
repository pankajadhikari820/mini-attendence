import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Announcement, AppNotification, UserProfile } from '../types';

export async function createNotification(params: {
  orgId: string;
  toUid: string;
  type: AppNotification['type'];
  text: string;
  isDemo?: boolean;
}): Promise<void> {
  await addDoc(collection(db, 'notifications'), {
    orgId: params.orgId,
    toUid: params.toUid,
    type: params.type,
    text: params.text,
    read: false,
    ...(params.isDemo ? { isDemo: true } : {}),
    createdAt: serverTimestamp(),
  });
}

export function subscribeNotifications(
  uid: string,
  callback: (items: AppNotification[]) => void
): () => void {
  const q = query(collection(db, 'notifications'), where('toUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ ...(d.data() as AppNotification), id: d.id }))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
        .slice(0, 30);
      callback(items);
    },
    () => {
      callback([]);
    }
  );
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(db, 'notifications', id), { read: true });
}

export async function markAllNotificationsRead(items: AppNotification[]): Promise<void> {
  const unread = items.filter((n) => !n.read);
  if (unread.length === 0) return;
  const batch = writeBatch(db);
  for (const n of unread) {
    batch.update(doc(db, 'notifications', n.id), { read: true });
  }
  await batch.commit();
}

export async function postAnnouncement(params: {
  author: UserProfile;
  audience: 'all' | 'managers' | 'members';
  text: string;
  recipientUids?: string[];
}): Promise<string> {
  const ref = await addDoc(collection(db, 'announcements'), {
    orgId: params.author.orgId,
    fromUid: params.author.uid,
    fromName: params.author.name,
    fromRole: params.author.role === 'admin' ? 'admin' : 'manager',
    audience: params.author.role === 'manager' ? 'members' : params.audience,
    managerId: params.author.role === 'manager' ? params.author.uid : null,
    text: params.text.trim(),
    createdAt: serverTimestamp(),
  });

  if (params.recipientUids && params.recipientUids.length > 0) {
    const snippet =
      params.text.trim().length > 70
        ? `${params.text.trim().slice(0, 70)}...`
        : params.text.trim();
    const targets = params.recipientUids.slice(0, 80);
    const batch = writeBatch(db);
    for (const toUid of targets) {
      if (toUid === params.author.uid) continue;
      batch.set(doc(collection(db, 'notifications')), {
        orgId: params.author.orgId,
        toUid,
        type: 'announcement',
        text: `${params.author.name}: ${snippet}`,
        read: false,
        createdAt: serverTimestamp(),
      });
    }
    try {
      await batch.commit();
    } catch {
      // Non-fatal
    }
  }

  return ref.id;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await deleteDoc(doc(db, 'announcements', id));
}

export async function fetchAnnouncements(profile: UserProfile): Promise<Announcement[]> {
  const sortDesc = (list: Announcement[]) =>
    list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

  if (profile.role === 'admin') {
    const snap = await getDocs(
      query(collection(db, 'announcements'), where('orgId', '==', profile.orgId))
    );
    return sortDesc(snap.docs.map((d) => ({ ...(d.data() as Announcement), id: d.id })));
  }

  if (profile.role === 'manager') {
    const [allSnap, mgrSnap, ownSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'announcements'),
          where('orgId', '==', profile.orgId),
          where('audience', '==', 'all')
        )
      ),
      getDocs(
        query(
          collection(db, 'announcements'),
          where('orgId', '==', profile.orgId),
          where('audience', '==', 'managers')
        )
      ),
      getDocs(
        query(
          collection(db, 'announcements'),
          where('orgId', '==', profile.orgId),
          where('fromUid', '==', profile.uid)
        )
      ),
    ]);
    const map = new Map<string, Announcement>();
    for (const s of [allSnap, mgrSnap, ownSnap]) {
      for (const d of s.docs) {
        map.set(d.id, { ...(d.data() as Announcement), id: d.id });
      }
    }
    return sortDesc(Array.from(map.values()));
  }

  // Member: org-wide ("all") + manager's announcements ("members" with managerId == profile.managerId)
  const queries = [
    getDocs(
      query(
        collection(db, 'announcements'),
        where('orgId', '==', profile.orgId),
        where('audience', '==', 'all')
      )
    ),
  ];
  if (profile.managerId) {
    queries.push(
      getDocs(
        query(
          collection(db, 'announcements'),
          where('orgId', '==', profile.orgId),
          where('audience', '==', 'members'),
          where('managerId', '==', profile.managerId)
        )
      )
    );
  }
  const snaps = await Promise.all(queries);
  const map = new Map<string, Announcement>();
  for (const s of snaps) {
    for (const d of s.docs) {
      map.set(d.id, { ...(d.data() as Announcement), id: d.id });
    }
  }
  return sortDesc(Array.from(map.values()));
}

export async function submitContactMessage(params: {
  name: string;
  email: string;
  message: string;
}): Promise<void> {
  await addDoc(collection(db, 'messages'), {
    name: params.name.trim(),
    email: params.email.trim().toLowerCase(),
    message: params.message.trim(),
    createdAt: serverTimestamp(),
  });
}
