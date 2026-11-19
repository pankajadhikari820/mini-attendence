import {
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
import type { AttendanceMethod, AttendanceStatus, Organization, UserProfile } from '../types';
import { getPastDates } from '../utils/helpers';
import { buildAttendanceDocId } from './attendanceService';
import { allocateUniqueUserId } from './userService';

const DEMO_MANAGERS = [
  { key: 'mgr1', name: 'Kavita Nair', email: 'kavita.demo@example.com', phone: '9810112201' },
  { key: 'mgr2', name: 'Rajesh Verma', email: 'rajesh.demo@example.com', phone: '9810112202' },
  { key: 'mgr3', name: 'Meera Deshmukh', email: 'meera.demo@example.com', phone: '9810112203' },
];

const DEMO_MEMBERS = [
  { key: 'mem01', mgrIdx: 0, name: 'Aarav Sharma', roll: '101', rate: 0.94 },
  { key: 'mem02', mgrIdx: 0, name: 'Diya Patel', roll: '102', rate: 0.90 },
  { key: 'mem03', mgrIdx: 0, name: 'Rohan Kulkarni', roll: '103', rate: 0.62 },
  { key: 'mem04', mgrIdx: 0, name: 'Ananya Iyer', roll: '104', rate: 0.96 },
  { key: 'mem05', mgrIdx: 0, name: 'Kabir Mehta', roll: '105', rate: 0.85 },
  { key: 'mem06', mgrIdx: 1, name: 'Priya Singh', roll: '201', rate: 0.92 },
  { key: 'mem07', mgrIdx: 1, name: 'Vihaan Joshi', roll: '202', rate: 0.68 },
  { key: 'mem08', mgrIdx: 1, name: 'Sneha Reddy', roll: '203', rate: 0.88 },
  { key: 'mem09', mgrIdx: 1, name: 'Arjun Malhotra', roll: '204', rate: 0.82 },
  { key: 'mem10', mgrIdx: 1, name: 'Neha Gupta', roll: '205', rate: 0.95 },
  { key: 'mem11', mgrIdx: 2, name: 'Siddharth Rao', roll: '301', rate: 0.91 },
  { key: 'mem12', mgrIdx: 2, name: 'Tanvi Kapoor', roll: '302', rate: 0.86 },
  { key: 'mem13', mgrIdx: 2, name: 'Ishaan Chatterjee', roll: '303', rate: 0.58 },
  { key: 'mem14', mgrIdx: 2, name: 'Pooja Yadav', roll: '304', rate: 0.93 },
  { key: 'mem15', mgrIdx: 2, name: 'Devansh Tiwari', roll: '305', rate: 0.89 },
];

async function commitOpsInChunks(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>
): Promise<void> {
  const CHUNK = 380;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + CHUNK)) {
      op(batch);
    }
    await batch.commit();
  }
}

export async function loadDemoData(org: Organization, admin: UserProfile): Promise<void> {
  await deleteDemoData(org.id);

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  // Allocate globally unique 6-character IDs (e.g. KAV482) for every demo manager & member
  const mgrDocs = await Promise.all(
    DEMO_MANAGERS.map(async (m, idx) => {
      const uid = `demo_${org.id}_${m.key}`;
      const memberId = await allocateUniqueUserId({
        nameForId: m.name,
        uid,
        orgId: org.id,
        role: 'manager',
        isDemo: true,
      });
      const managerCode = `DM${org.orgCode.slice(0, 3)}${idx + 1}`.toUpperCase();
      return { ...m, uid, memberId, managerCode };
    })
  );

  for (const m of mgrDocs) {
    ops.push((batch) => {
      batch.set(doc(db, 'users', m.uid), {
        uid: m.uid,
        name: m.name,
        email: m.email,
        phone: m.phone,
        role: 'manager',
        orgId: org.id,
        managerId: null,
        memberId: m.memberId,
        managerCode: m.managerCode,
        status: 'active',
        language: 'en',
        isDemo: true,
        createdAt: serverTimestamp(),
      });
    });
  }

  const memDocs = await Promise.all(
    DEMO_MEMBERS.map(async (m, idx) => {
      const uid = `demo_${org.id}_${m.key}`;
      const mgr = mgrDocs[m.mgrIdx];
      const memberId = await allocateUniqueUserId({
        nameForId: m.name,
        uid,
        orgId: org.id,
        role: 'member',
        isDemo: true,
      });
      return {
        ...m,
        uid,
        managerId: mgr.uid,
        memberId,
        email: `${m.key}.demo@example.com`,
        phone: `982000${String(1000 + idx)}`,
      };
    })
  );

  for (const mem of memDocs) {
    ops.push((batch) => {
      batch.set(doc(db, 'users', mem.uid), {
        uid: mem.uid,
        name: mem.name,
        email: mem.email,
        phone: mem.phone,
        rollNumber: mem.roll,
        role: 'member',
        orgId: org.id,
        managerId: mem.managerId,
        memberId: mem.memberId,
        status: 'active',
        language: 'en',
        isDemo: true,
        createdAt: serverTimestamp(),
      });
    });
  }

  const dates = getPastDates(30, org.timezone || 'Asia/Kolkata');

  let seed = 42;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (const date of dates) {
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dayOfWeek === 0 && date !== dates[dates.length - 1]) continue;

    for (const m of mgrDocs) {
      const r = nextRand();
      const status: AttendanceStatus =
        r < 0.84 ? 'present' : r < 0.92 ? 'late' : r < 0.96 ? 'leave' : 'absent';
      const method: AttendanceMethod =
        status === 'present' || status === 'late'
          ? r < 0.72
            ? 'live_qr'
            : r < 0.86
            ? 'live_code'
            : 'manual'
          : 'manual';
      const docId = buildAttendanceDocId(org.id, date, m.uid);
      ops.push((batch) => {
        batch.set(doc(db, 'attendance', docId), {
          orgId: org.id,
          personUid: m.uid,
          personName: m.name,
          personMemberId: m.memberId,
          role: 'manager',
          managerId: null,
          date,
          timestamp: serverTimestamp(),
          status,
          method,
          distanceMeters: method === 'manual' ? 0 : Math.floor(nextRand() * 28) + 4,
          markedBy: method === 'manual' ? admin.uid : m.uid,
          note: '',
          isDemo: true,
        });
      });
    }

    for (const mem of memDocs) {
      const r = nextRand();
      let status: AttendanceStatus;
      if (r < mem.rate * 0.88) status = 'present';
      else if (r < mem.rate) status = 'late';
      else if (r < mem.rate + 0.05) status = 'leave';
      else status = 'absent';

      const method: AttendanceMethod =
        status === 'present' || status === 'late'
          ? nextRand() < 0.75
            ? 'live_qr'
            : nextRand() < 0.7
            ? 'live_code'
            : 'manual'
          : 'manual';

      const docId = buildAttendanceDocId(org.id, date, mem.uid);
      ops.push((batch) => {
        batch.set(doc(db, 'attendance', docId), {
          orgId: org.id,
          personUid: mem.uid,
          personName: mem.name,
          personMemberId: mem.memberId,
          role: 'member',
          managerId: mem.managerId,
          date,
          timestamp: serverTimestamp(),
          status,
          method,
          distanceMeters: method === 'manual' ? 0 : Math.floor(nextRand() * 32) + 3,
          markedBy: method === 'manual' ? mem.managerId : mem.uid,
          note: '',
          isDemo: true,
        });
      });
    }
  }

  const today = dates[dates.length - 1];
  ops.push((batch) => {
    batch.set(doc(collection(db, 'leaves')), {
      orgId: org.id,
      personUid: mgrDocs[0].uid,
      personName: mgrDocs[0].name,
      personRole: 'manager',
      personMemberId: mgrDocs[0].memberId,
      toUid: admin.uid,
      fromDate: today,
      toDate: today,
      reason: 'Attending university academic seminar (Demo)',
      status: 'pending',
      comment: '',
      isDemo: true,
      createdAt: serverTimestamp(),
    });
  });

  ops.push((batch) => {
    batch.set(doc(collection(db, 'leaves')), {
      orgId: org.id,
      personUid: memDocs[2].uid,
      personName: memDocs[2].name,
      personRole: 'member',
      personMemberId: memDocs[2].memberId,
      toUid: mgrDocs[0].uid,
      fromDate: today,
      toDate: today,
      reason: 'Medical appointment (Demo)',
      status: 'pending',
      comment: '',
      isDemo: true,
      createdAt: serverTimestamp(),
    });
  });

  ops.push((batch) => {
    batch.set(doc(collection(db, 'announcements')), {
      orgId: org.id,
      fromUid: admin.uid,
      fromName: admin.name,
      fromRole: 'admin',
      audience: 'all',
      managerId: null,
      text: 'Morning attendance session opens at 09:00 AM. Please keep GPS enabled on your phone. (Demo notice)',
      isDemo: true,
      createdAt: serverTimestamp(),
    });
  });

  await commitOpsInChunks(ops);
  await updateDoc(doc(db, 'organizations', org.id), { hasDemoData: true });
}

export async function deleteDemoData(orgId: string): Promise<void> {
  const collectionsToClean = [
    'users',
    'userIds',
    'attendance',
    'leaves',
    'announcements',
    'notifications',
  ];
  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  for (const col of collectionsToClean) {
    try {
      const snap = await getDocs(
        query(collection(db, col), where('orgId', '==', orgId), where('isDemo', '==', true))
      );
      for (const d of snap.docs) {
        ops.push((batch) => batch.delete(d.ref));
      }
    } catch {
      // Continue if empty or collection not yet initialized
    }
  }

  if (ops.length > 0) {
    await commitOpsInChunks(ops);
  }
  await updateDoc(doc(db, 'organizations', orgId), { hasDemoData: false });
}
