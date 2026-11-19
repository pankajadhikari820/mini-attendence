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
  { key: 'mgr1', name: 'Dr. Kavita Nair', email: 'kavita.demo@example.com', phone: '9810112201' },
  { key: 'mgr2', name: 'Prof. Rajesh Verma', email: 'rajesh.demo@example.com', phone: '9810112202' },
  { key: 'mgr3', name: 'Prof. Meera Deshmukh', email: 'meera.demo@example.com', phone: '9810112203' },
];

const DEMO_MEMBERS = [
  { key: 'mem01', mgrIdx: 0, classIdx: 0, name: 'Aarav Sharma', roll: 'BCA-201', rate: 0.94 },
  { key: 'mem02', mgrIdx: 0, classIdx: 0, name: 'Diya Patel', roll: 'BCA-202', rate: 0.90 },
  { key: 'mem03', mgrIdx: 0, classIdx: 0, name: 'Rohan Kulkarni', roll: 'BCA-203', rate: 0.62 },
  { key: 'mem04', mgrIdx: 0, classIdx: 0, name: 'Ananya Iyer', roll: 'BCA-204', rate: 0.96 },
  { key: 'mem05', mgrIdx: 0, classIdx: 0, name: 'Kabir Mehta', roll: 'BCA-205', rate: 0.85 },
  { key: 'mem06', mgrIdx: 1, classIdx: 0, name: 'Priya Singh', roll: 'BCA-206', rate: 0.92 },
  { key: 'mem07', mgrIdx: 1, classIdx: 0, name: 'Vihaan Joshi', roll: 'BCA-207', rate: 0.68 },
  { key: 'mem08', mgrIdx: 1, classIdx: 0, name: 'Sneha Reddy', roll: 'BCA-208', rate: 0.88 },
  { key: 'mem09', mgrIdx: 2, classIdx: 1, name: 'Arjun Malhotra', roll: 'BSC-101', rate: 0.82 },
  { key: 'mem10', mgrIdx: 2, classIdx: 1, name: 'Neha Gupta', roll: 'BSC-102', rate: 0.95 },
  { key: 'mem11', mgrIdx: 2, classIdx: 1, name: 'Siddharth Rao', roll: 'BSC-103', rate: 0.91 },
  { key: 'mem12', mgrIdx: 2, classIdx: 1, name: 'Ishaan Chatterjee', roll: 'BSC-104', rate: 0.58 },
];

async function commitOpsInChunks(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>
): Promise<void> {
  const CHUNK = 350;
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

  // 1. Seed Demo Department
  const deptId = `demo_${org.id}_dept_cs`;
  const deptName = 'Computer Science & AI';
  ops.push((batch) => {
    batch.set(doc(db, 'departments', deptId), {
      orgId: org.id,
      name: deptName,
      code: 'CSAI',
      isDemo: true,
      createdAt: serverTimestamp(),
    });
  });

  // 2. Seed Demo Classes
  const demoClasses = [
    {
      id: `demo_${org.id}_cls_bca`,
      name: 'BCA AI & DS · Sem 2 · Sec C',
      courseName: 'BCA AI & DS',
      semester: 'Sem 2',
      section: 'Sec C',
      classroom: 'Lab 204',
    },
    {
      id: `demo_${org.id}_cls_bsc`,
      name: 'BSc Data Science · Sem 1 · Sec A',
      courseName: 'BSc Data Science',
      semester: 'Sem 1',
      section: 'Sec A',
      classroom: 'Room 108',
    },
  ];

  for (const cls of demoClasses) {
    ops.push((batch) => {
      batch.set(doc(db, 'classes', cls.id), {
        orgId: org.id,
        departmentId: deptId,
        departmentName: deptName,
        name: cls.name,
        courseName: cls.courseName,
        semester: cls.semester,
        section: cls.section,
        classroom: cls.classroom,
        isDemo: true,
        createdAt: serverTimestamp(),
      });
    });
  }

  // 3. Seed Demo Subjects
  const demoSubjects = [
    { id: `demo_${org.id}_sub_math`, name: 'Mathematics', code: 'MTH201' },
    { id: `demo_${org.id}_sub_prog`, name: 'Programming in Python', code: 'CS202' },
    { id: `demo_${org.id}_sub_dbms`, name: 'Database Systems', code: 'CS105' },
  ];

  for (const sub of demoSubjects) {
    ops.push((batch) => {
      batch.set(doc(db, 'subjects', sub.id), {
        orgId: org.id,
        departmentId: deptId,
        departmentName: deptName,
        name: sub.name,
        code: sub.code,
        isDemo: true,
        createdAt: serverTimestamp(),
      });
    });
  }

  // 4. Allocate demo teachers
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
        departmentId: deptId,
        departmentName: deptName,
        memberId: m.memberId,
        managerCode: m.managerCode,
        status: 'active',
        language: 'en',
        isDemo: true,
        createdAt: serverTimestamp(),
      });
    });
  }

  // 5. Faculty Assignments (Multiple teachers independently assigned to the same class for different subjects)
  const assignments = [
    {
      id: `demo_${org.id}_fa_1`,
      teacher: mgrDocs[0],
      cls: demoClasses[0],
      sub: demoSubjects[0], // Mathematics
    },
    {
      id: `demo_${org.id}_fa_2`,
      teacher: mgrDocs[1],
      cls: demoClasses[0],
      sub: demoSubjects[1], // Programming
    },
    {
      id: `demo_${org.id}_fa_3`,
      teacher: mgrDocs[2],
      cls: demoClasses[1],
      sub: demoSubjects[2], // Database Systems
    },
  ];

  for (const fa of assignments) {
    ops.push((batch) => {
      batch.set(doc(db, 'facultyAssignments', fa.id), {
        orgId: org.id,
        teacherUid: fa.teacher.uid,
        teacherName: fa.teacher.name,
        departmentId: deptId,
        departmentName: deptName,
        classId: fa.cls.id,
        className: fa.cls.name,
        subjectId: fa.sub.id,
        subjectName: fa.sub.name,
        subjectCode: fa.sub.code,
        semester: fa.cls.semester,
        section: fa.cls.section,
        isDemo: true,
        createdAt: serverTimestamp(),
      });
    });
  }

  // 6. Weekly Timetable slots (Mon-Sat)
  for (let day = 1; day <= 6; day++) {
    ops.push((batch) => {
      batch.set(doc(db, 'timetables', `demo_${org.id}_tt_${day}_1`), {
        orgId: org.id,
        dayOfWeek: day,
        startTime: '09:00',
        endTime: '10:00',
        departmentId: deptId,
        departmentName: deptName,
        classId: demoClasses[0].id,
        className: demoClasses[0].name,
        subjectId: demoSubjects[0].id,
        subjectName: demoSubjects[0].name,
        subjectCode: demoSubjects[0].code,
        teacherUid: mgrDocs[0].uid,
        teacherName: mgrDocs[0].name,
        classroom: demoClasses[0].classroom,
        semester: demoClasses[0].semester,
        section: demoClasses[0].section,
        isDemo: true,
        createdAt: serverTimestamp(),
      });
    });
    ops.push((batch) => {
      batch.set(doc(db, 'timetables', `demo_${org.id}_tt_${day}_2`), {
        orgId: org.id,
        dayOfWeek: day,
        startTime: '10:00',
        endTime: '11:00',
        departmentId: deptId,
        departmentName: deptName,
        classId: demoClasses[0].id,
        className: demoClasses[0].name,
        subjectId: demoSubjects[1].id,
        subjectName: demoSubjects[1].name,
        subjectCode: demoSubjects[1].code,
        teacherUid: mgrDocs[1].uid,
        teacherName: mgrDocs[1].name,
        classroom: demoClasses[0].classroom,
        semester: demoClasses[0].semester,
        section: demoClasses[0].section,
        isDemo: true,
        createdAt: serverTimestamp(),
      });
    });
    ops.push((batch) => {
      batch.set(doc(db, 'timetables', `demo_${org.id}_tt_${day}_3`), {
        orgId: org.id,
        dayOfWeek: day,
        startTime: '11:15',
        endTime: '12:15',
        departmentId: deptId,
        departmentName: deptName,
        classId: demoClasses[1].id,
        className: demoClasses[1].name,
        subjectId: demoSubjects[2].id,
        subjectName: demoSubjects[2].name,
        subjectCode: demoSubjects[2].code,
        teacherUid: mgrDocs[2].uid,
        teacherName: mgrDocs[2].name,
        classroom: demoClasses[1].classroom,
        semester: demoClasses[1].semester,
        section: demoClasses[1].section,
        isDemo: true,
        createdAt: serverTimestamp(),
      });
    });
  }

  // 7. Demo Students
  const memDocs = await Promise.all(
    DEMO_MEMBERS.map(async (m, idx) => {
      const uid = `demo_${org.id}_${m.key}`;
      const mgr = mgrDocs[m.mgrIdx];
      const cls = demoClasses[m.classIdx];
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
        cls,
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
        enrollmentNumber: `ENR-2025-${mem.roll}`,
        role: 'member',
        orgId: org.id,
        managerId: mem.managerId,
        departmentId: deptId,
        departmentName: deptName,
        classId: mem.cls.id,
        className: mem.cls.name,
        courseName: mem.cls.courseName,
        semester: mem.cls.semester,
        section: mem.cls.section,
        memberId: mem.memberId,
        status: 'active',
        language: 'en',
        isDemo: true,
        createdAt: serverTimestamp(),
      });
    });
  }

  // 8. Subject-wise Attendance Records (STRICTLY PRESENT, ABSENT, LEAVE ONLY — ZERO LATE)
  const dates = getPastDates(18, org.timezone || 'Asia/Kolkata');
  let seed = 42;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (const date of dates) {
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dayOfWeek === 0 && date !== dates[dates.length - 1]) continue;

    // Teacher attendance
    for (const m of mgrDocs) {
      const r = nextRand();
      const status: AttendanceStatus = r < 0.9 ? 'present' : r < 0.96 ? 'leave' : 'absent';
      const method: AttendanceMethod =
        status === 'present' ? (r < 0.7 ? 'live_qr' : 'live_code') : 'manual';
      const docId = buildAttendanceDocId(org.id, date, m.uid);
      ops.push((batch) => {
        batch.set(doc(db, 'attendance', docId), {
          orgId: org.id,
          personUid: m.uid,
          personName: m.name,
          personMemberId: m.memberId,
          role: 'manager',
          managerId: null,
          departmentId: deptId,
          departmentName: deptName,
          date,
          timestamp: serverTimestamp(),
          status,
          method,
          distanceMeters: method === 'manual' ? 0 : Math.floor(nextRand() * 25) + 4,
          markedBy: method === 'manual' ? admin.uid : m.uid,
          note: '',
          isDemo: true,
        });
      });
    }

    // Subject-wise Student attendance (independent records per subject per day)
    for (const fa of assignments) {
      const classStudents = memDocs.filter((mem) => mem.cls.id === fa.cls.id);
      for (const mem of classStudents) {
        const r = nextRand();
        let status: AttendanceStatus;
        if (r < mem.rate) status = 'present';
        else if (r < mem.rate + 0.06) status = 'leave';
        else status = 'absent';

        const method: AttendanceMethod =
          status === 'present'
            ? nextRand() < 0.78
              ? 'live_qr'
              : 'live_code'
            : 'manual';

        const docId = buildAttendanceDocId(org.id, date, mem.uid, fa.sub.id);
        ops.push((batch) => {
          batch.set(doc(db, 'attendance', docId), {
            orgId: org.id,
            personUid: mem.uid,
            personName: mem.name,
            personMemberId: mem.memberId,
            role: 'member',
            managerId: mem.managerId,
            teacherUid: fa.teacher.uid,
            teacherName: fa.teacher.name,
            departmentId: deptId,
            departmentName: deptName,
            classId: fa.cls.id,
            className: fa.cls.name,
            subjectId: fa.sub.id,
            subjectName: fa.sub.name,
            subjectCode: fa.sub.code,
            date,
            timestamp: serverTimestamp(),
            status,
            method,
            distanceMeters: method === 'manual' ? 0 : Math.floor(nextRand() * 30) + 3,
            markedBy: method === 'manual' ? fa.teacher.uid : mem.uid,
            note: '',
            isDemo: true,
          });
        });
      }
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
      text: 'Subject-wise live attendance sessions open at lecture start. Please keep GPS enabled on your phone. (Demo notice)',
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
    'departments',
    'classes',
    'subjects',
    'facultyAssignments',
    'timetables',
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
