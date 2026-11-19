import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { AttendanceRecord, Organization, UserProfile } from '../types';
import { getOrgDateString, normalizeAttendanceStatus } from '../utils/helpers';
import { recordAuditLog } from './auditService';

export interface SubjectAttendanceSummary {
  subjectKey: string;
  subjectId?: string;
  subjectName: string;
  subjectCode?: string;
  present: number;
  absent: number;
  leave: number;
  total: number;
  percentage: number;
  isShortage: boolean;
}

export interface StudentAttendanceAnalysis {
  student: UserProfile;
  present: number;
  absent: number;
  leave: number;
  total: number;
  totalClasses: number;
  overallPct: number;
  overallPercent: number;
  presentCount: number;
  absentCount: number;
  leaveCount: number;
  isLowOverall: boolean;
  isOverallShortage: boolean;
  hasShortage: boolean;
  subjects: SubjectAttendanceSummary[];
  shortageSubjects: SubjectAttendanceSummary[];
}

/**
 * Computes accurate overall and subject-wise attendance statistics using ONLY
 * PRESENT, ABSENT, and LEAVE statuses. Every lecture session is counted individually
 * so multiple lectures on the same day never collapse into a single record.
 */
export function computeStudentAttendanceAnalysis(
  student: UserProfile,
  records: AttendanceRecord[],
  threshold = 75
): StudentAttendanceAnalysis {
  let present = 0;
  let absent = 0;
  let leave = 0;

  const bySubject = new Map<
    string,
    {
      subjectId?: string;
      subjectName: string;
      subjectCode?: string;
      present: number;
      absent: number;
      leave: number;
    }
  >();

  for (const r of records) {
    const st = normalizeAttendanceStatus(r.status);
    if (st === 'present') present++;
    else if (st === 'absent') absent++;
    else leave++;

    const key = r.subjectId || r.subjectName || 'general';
    const cur = bySubject.get(key) || {
      subjectId: r.subjectId,
      subjectName: r.subjectName || 'General Attendance',
      subjectCode: r.subjectCode,
      present: 0,
      absent: 0,
      leave: 0,
    };
    if (st === 'present') cur.present++;
    else if (st === 'absent') cur.absent++;
    else cur.leave++;
    bySubject.set(key, cur);
  }

  const total = present + absent + leave;
  const overallPct = total > 0 ? Math.round((present / total) * 100) : 0;

  const subjects: SubjectAttendanceSummary[] = Array.from(bySubject.entries())
    .map(([subjectKey, s]) => {
      const subTotal = s.present + s.absent + s.leave;
      const pct = subTotal > 0 ? Math.round((s.present / subTotal) * 100) : 0;
      return {
        subjectKey,
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        subjectCode: s.subjectCode,
        present: s.present,
        absent: s.absent,
        leave: s.leave,
        total: subTotal,
        percentage: pct,
        isShortage: subTotal > 0 && pct < threshold,
      };
    })
    .sort((a, b) => a.percentage - b.percentage);

  const isLowOverall = total > 0 && overallPct < threshold;
  const shortageSubjects = subjects.filter((s) => s.isShortage);
  const hasShortage = isLowOverall || shortageSubjects.length > 0;

  return {
    student,
    present,
    absent,
    leave,
    total,
    totalClasses: total,
    overallPct,
    overallPercent: overallPct,
    presentCount: present,
    absentCount: absent,
    leaveCount: leave,
    isLowOverall,
    isOverallShortage: isLowOverall,
    hasShortage,
    subjects,
    shortageSubjects,
  };
}

/**
 * Dispatches deduplicated low-attendance alerts to Students, their Faculty/Manager,
 * and Verified Parents using deterministic notification doc IDs scoped by YYYY-MM
 * so duplicate notifications are never sent in the same month.
 */
export async function dispatchLowAttendanceAlerts(params: {
  org: Organization;
  actor: UserProfile;
  analyses: StudentAttendanceAnalysis[];
  parentLinks?: any[];
}): Promise<{ sent: number; sentCount: number; skippedDuplicates: number }> {
  const threshold = params.org.lowAttendanceThreshold ?? 75;
  const monthKey = getOrgDateString(params.org.timezone || 'Asia/Kolkata').slice(0, 7);
  let sentCount = 0;
  let skippedDuplicates = 0;

  const belowList = params.analyses.filter(
    (a) => a.total > 0 && (a.hasShortage ?? (a.isLowOverall || a.shortageSubjects.length > 0))
  );

  for (const item of belowList) {
    const shortageSummary =
      item.shortageSubjects.length > 0
        ? item.shortageSubjects
            .slice(0, 3)
            .map((s) => `${s.subjectName} (${s.percentage}%)`)
            .join(', ')
        : `Overall (${item.overallPct}%)`;

    const targets: Array<{ uid: string; label: string; text: string }> = [
      {
        uid: item.student.uid,
        label: 'student',
        text: `Low attendance alert (${item.overallPct}% — minimum required ${threshold}%). Shortage in: ${shortageSummary}.`,
      },
    ];

    if (item.student.managerId) {
      targets.push({
        uid: item.student.managerId,
        label: 'faculty',
        text: `Student ${item.student.name} (${item.student.memberId}) is below ${threshold}% attendance (${item.overallPct}%). Shortage: ${shortageSummary}.`,
      });
    }

    for (const parentUid of item.student.parentUids || []) {
      targets.push({
        uid: parentUid,
        label: 'parent',
        text: `Attendance alert for ${item.student.name} (${item.student.memberId}): currently ${item.overallPct}% (minimum ${threshold}%). Shortage: ${shortageSummary}.`,
      });
    }

    for (const target of targets) {
      const dedupeDocId = `lowatt_${params.org.id}_${monthKey}_${item.student.uid}_${target.uid}`;
      const notifRef = doc(db, 'notifications', dedupeDocId);
      try {
        const existing = await getDoc(notifRef);
        if (existing.exists()) {
          skippedDuplicates++;
          continue;
        }
        await setDoc(notifRef, {
          orgId: params.org.id,
          toUid: target.uid,
          type: 'low_attendance',
          text: target.text,
          dedupeKey: dedupeDocId,
          read: false,
          createdAt: serverTimestamp(),
        });
        sentCount++;
      } catch {
        // Ignore individual permission failures
      }
    }
  }

  if (sentCount > 0) {
    await recordAuditLog({
      actor: params.actor,
      action: 'alert.low_attendance_sent',
      targetCollection: 'notifications',
      targetId: `${params.org.id}_${monthKey}`,
      summary: `Sent ${sentCount} deduplicated low-attendance alerts (threshold ${threshold}%)`,
      metadata: { sentCount, skippedDuplicates, threshold },
    });
  }

  return { sent: sentCount, sentCount, skippedDuplicates };
}
