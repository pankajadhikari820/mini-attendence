import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import {
  AlertTriangle,
  Bell,
  Download,
  FileSpreadsheet,
  FileText,
  Search,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type {
  AcademicClass,
  AttendanceRecord,
  AttendanceStatus,
  Department,
  Subject,
  UserProfile,
} from '../types';
import {
  fetchAttendanceForManager,
  fetchAttendanceForOrg,
} from '../services/attendanceService';
import { fetchManagerMembers, fetchOrgUsers } from '../services/userService';
import {
  fetchClasses,
  fetchDepartments,
  fetchFacultyAssignments,
  fetchSubjects,
} from '../services/academicService';
import {
  computeStudentAttendanceAnalysis,
  dispatchLowAttendanceAlerts,
} from '../services/lowAttendanceService';
import {
  getFirebaseErrorKey,
  getOrgDateString,
  getPastDates,
  normalizeAttendanceStatus,
} from '../utils/helpers';
import { Layout } from '../components/Layout';
import { CardSkeleton, EmptyState } from '../components/Skeletons';

const PAGE_SIZE = 15;

export const ReportsPage: React.FC = () => {
  const { profile, org } = useAuth();
  const { t, formatDate, formatNumber } = useTranslation();
  const { showToast } = useToast();

  const today = useMemo(() => getOrgDateString(org?.timezone || 'Asia/Kolkata'), [org?.timezone]);
  const defaultFrom = useMemo(
    () => getPastDates(30, org?.timezone || 'Asia/Kolkata')[0],
    [org?.timezone]
  );
  const threshold = org?.lowAttendanceThreshold ?? 75;

  const [view, setView] = useState<'analytics' | 'records' | 'summary' | 'register'>('analytics');
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(today);
  const [registerMonth, setRegisterMonth] = useState(today.slice(0, 7));

  const [deptFilter, setDeptFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [personFilter, setPersonFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AttendanceStatus>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'personName'>('date');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [sendingAlerts, setSendingAlerts] = useState(false);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [classes, setClasses] = useState<AcademicClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  const loadReportData = useCallback(async () => {
    if (!org || !profile) return;
    setLoading(true);
    try {
      const effectiveFrom = view === 'register' ? `${registerMonth}-01` : fromDate;
      const effectiveTo = view === 'register' ? `${registerMonth}-31` : toDate;

      const [depts, clsList, subjList] = await Promise.all([
        fetchDepartments(org.id).catch(() => []),
        fetchClasses(org.id).catch(() => []),
        fetchSubjects(org.id).catch(() => []),
      ]);
      setDepartments(depts);
      setClasses(clsList);
      setSubjects(subjList);

      if (profile.role === 'admin' || profile.role === 'super_admin') {
        const [allUsers, recs] = await Promise.all([
          fetchOrgUsers(org.id),
          fetchAttendanceForOrg(org.id, { fromDate: effectiveFrom, toDate: effectiveTo }),
        ]);
        setPeople(allUsers.filter((u) => u.role === 'member' || u.role === 'manager'));
        setRecords(recs);
      } else {
        // Teacher/Manager: include assigned classes' students + direct members + attendance they recorded
        const [directMembers, assignments, recs, allOrgUsers] = await Promise.all([
          fetchManagerMembers(org.id, profile.uid),
          fetchFacultyAssignments(org.id, { teacherUid: profile.uid }).catch(() => []),
          fetchAttendanceForManager(org.id, profile.uid, {
            fromDate: effectiveFrom,
            toDate: effectiveTo,
          }),
          fetchOrgUsers(org.id).catch(() => []),
        ]);
        const assignedClassIds = new Set(assignments.map((a) => a.classId));
        const byUid = new Map<string, UserProfile>();
        for (const m of directMembers) byUid.set(m.uid, m);
        for (const u of allOrgUsers) {
          if (u.role === 'member' && u.classId && assignedClassIds.has(u.classId)) {
            byUid.set(u.uid, u);
          }
        }
        setPeople(Array.from(byUid.values()));
        setRecords(recs);
      }
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setLoading(false);
    }
  }, [org, profile, fromDate, toDate, registerMonth, view, showToast, t]);

  useEffect(() => {
    loadReportData();
  }, [loadReportData]);

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const personByUid = useMemo(() => new Map(people.map((p) => [p.uid, p])), [people]);

  const filteredClasses = useMemo(() => {
    if (deptFilter === 'all') return classes;
    return classes.filter((c) => c.departmentId === deptFilter);
  }, [classes, deptFilter]);

  const filteredSubjects = useMemo(() => {
    if (classFilter !== 'all') {
      return subjects.filter((s) => s.classId === classFilter);
    }
    if (deptFilter !== 'all') {
      return subjects.filter((s) => s.departmentId === deptFilter);
    }
    return subjects;
  }, [subjects, classFilter, deptFilter]);

  const scopedPeople = useMemo(() => {
    return people.filter((p) => {
      if (deptFilter !== 'all') {
        const personDept =
          p.departmentId || (p.classId ? classById.get(p.classId)?.departmentId : undefined);
        if (personDept !== deptFilter) return false;
      }
      if (classFilter !== 'all' && p.classId !== classFilter) return false;
      if (personFilter !== 'all' && p.uid !== personFilter) return false;
      return true;
    });
  }, [people, deptFilter, classFilter, personFilter, classById]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records
      .filter((r) => {
        const st = normalizeAttendanceStatus(r.status);
        const person = personByUid.get(r.personUid);
        const recClassId = r.classId || person?.classId;
        const recDeptId =
          person?.departmentId || (recClassId ? classById.get(recClassId)?.departmentId : undefined);

        if (deptFilter !== 'all' && recDeptId !== deptFilter) return false;
        if (classFilter !== 'all' && recClassId !== classFilter) return false;
        if (subjectFilter !== 'all' && r.subjectId !== subjectFilter) return false;
        if (personFilter !== 'all' && r.personUid !== personFilter) return false;
        if (statusFilter !== 'all' && st !== statusFilter) return false;

        if (!q) return true;
        return (
          r.personName.toLowerCase().includes(q) ||
          (r.personMemberId || '').toLowerCase().includes(q) ||
          (r.subjectName || '').toLowerCase().includes(q) ||
          (r.className || '').toLowerCase().includes(q) ||
          r.date.includes(q)
        );
      })
      .sort((a, b) =>
        sortBy === 'date'
          ? b.date.localeCompare(a.date)
          : a.personName.localeCompare(b.personName)
      );
  }, [
    records,
    deptFilter,
    classFilter,
    subjectFilter,
    personFilter,
    statusFilter,
    search,
    sortBy,
    personByUid,
    classById,
  ]);

  useEffect(() => {
    setPage(1);
  }, [deptFilter, classFilter, subjectFilter, personFilter, statusFilter, search, sortBy, view]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const paginatedRecords = filteredRecords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Overall KPI metrics (STRICTLY PRESENT, ABSENT, LEAVE)
  const overallStats = useMemo(() => {
    let present = 0;
    let absent = 0;
    let leave = 0;
    for (const r of filteredRecords) {
      const st = normalizeAttendanceStatus(r.status);
      if (st === 'present') present++;
      else if (st === 'absent') absent++;
      else leave++;
    }
    const total = present + absent + leave;
    const rate = total > 0 ? Math.round((present / total) * 100) : 0;
    return { present, absent, leave, total, rate };
  }, [filteredRecords]);

  // Per-person summary (STRICTLY PRESENT, ABSENT, LEAVE)
  const summaryRows = useMemo(() => {
    const map = new Map<
      string,
      {
        uid: string;
        name: string;
        memberId: string;
        className: string;
        present: number;
        absent: number;
        leave: number;
        total: number;
        pct: number;
      }
    >();

    for (const p of scopedPeople) {
      map.set(p.uid, {
        uid: p.uid,
        name: p.name,
        memberId: p.memberId || '—',
        className: p.className || (p.classId ? classById.get(p.classId)?.name || '—' : '—'),
        present: 0,
        absent: 0,
        leave: 0,
        total: 0,
        pct: 0,
      });
    }

    for (const r of filteredRecords) {
      const st = normalizeAttendanceStatus(r.status);
      const existing = map.get(r.personUid) || {
        uid: r.personUid,
        name: r.personName,
        memberId: r.personMemberId || '—',
        className: r.className || '—',
        present: 0,
        absent: 0,
        leave: 0,
        total: 0,
        pct: 0,
      };
      existing.total++;
      if (st === 'present') existing.present++;
      else if (st === 'absent') existing.absent++;
      else existing.leave++;
      map.set(r.personUid, existing);
    }

    const q = search.trim().toLowerCase();
    return Array.from(map.values())
      .map((row) => ({
        ...row,
        pct: row.total > 0 ? Math.round((row.present / row.total) * 100) : 0,
      }))
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.memberId.toLowerCase().includes(q) ||
          r.className.toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [scopedPeople, filteredRecords, search, classById]);

  // Daily trend chart data (STRICTLY PRESENT, LEAVE, ABSENT)
  const dailyChartData = useMemo(() => {
    const byDate = new Map<string, { present: number; absent: number; leave: number }>();
    for (const r of filteredRecords) {
      const st = normalizeAttendanceStatus(r.status);
      const b = byDate.get(r.date) || { present: 0, absent: 0, leave: 0 };
      b[st]++;
      byDate.set(r.date, b);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-21)
      .map(([date, counts]) => ({
        date: formatDate(date, { day: 'numeric', month: 'short' }),
        ...counts,
      }));
  }, [filteredRecords, formatDate]);

  // Subject-wise breakdown
  const subjectBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        subjectId: string;
        name: string;
        code: string;
        present: number;
        absent: number;
        leave: number;
        total: number;
        pct: number;
      }
    >();
    for (const r of filteredRecords) {
      const key = r.subjectId || r.subjectName || 'general';
      const cur = map.get(key) || {
        subjectId: key,
        name: r.subjectName || t('reports.generalAttendance'),
        code: r.subjectCode || '',
        present: 0,
        absent: 0,
        leave: 0,
        total: 0,
        pct: 0,
      };
      const st = normalizeAttendanceStatus(r.status);
      cur.total++;
      cur[st]++;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((item) => ({
        ...item,
        pct: item.total > 0 ? Math.round((item.present / item.total) * 100) : 0,
        shortName: item.code || (item.name.length > 14 ? `${item.name.slice(0, 14)}…` : item.name),
      }))
      .sort((a, b) => a.pct - b.pct);
  }, [filteredRecords, t]);

  // Class-wise breakdown
  const classBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        classId: string;
        name: string;
        present: number;
        absent: number;
        leave: number;
        total: number;
        pct: number;
      }
    >();
    for (const r of filteredRecords) {
      const person = personByUid.get(r.personUid);
      const cid = r.classId || person?.classId || 'unassigned';
      const cname =
        r.className ||
        person?.className ||
        (cid !== 'unassigned' ? classById.get(cid)?.name : undefined) ||
        t('academics.unassigned');
      const cur = map.get(cid) || {
        classId: cid,
        name: cname,
        present: 0,
        absent: 0,
        leave: 0,
        total: 0,
        pct: 0,
      };
      const st = normalizeAttendanceStatus(r.status);
      cur.total++;
      cur[st]++;
      map.set(cid, cur);
    }
    return Array.from(map.values())
      .map((c) => ({
        ...c,
        pct: c.total > 0 ? Math.round((c.present / c.total) * 100) : 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredRecords, personByUid, classById, t]);

  // Low-attendance analyses (students below threshold overall or in any subject)
  const studentAnalyses = useMemo(() => {
    const recsByStudent = new Map<string, AttendanceRecord[]>();
    for (const r of filteredRecords) {
      const arr = recsByStudent.get(r.personUid) || [];
      arr.push(r);
      recsByStudent.set(r.personUid, arr);
    }
    return scopedPeople
      .filter((p) => p.role === 'member')
      .map((s) =>
        computeStudentAttendanceAnalysis(s, recsByStudent.get(s.uid) || [], threshold)
      )
      .filter((a) => a.total > 0 && (a.isLowOverall || a.shortageSubjects.length > 0))
      .sort((a, b) => a.overallPct - b.overallPct);
  }, [scopedPeople, filteredRecords, threshold]);

  const handleDispatchAlerts = async () => {
    if (!org || !profile || studentAnalyses.length === 0) return;
    setSendingAlerts(true);
    try {
      const res = await dispatchLowAttendanceAlerts({
        org,
        actor: profile,
        analyses: studentAnalyses,
      });
      showToast(
        t('alerts.dispatchedToast', { count: res.sent }),
        res.sent > 0 ? 'success' : 'info'
      );
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSendingAlerts(false);
    }
  };

  // Monthly register helpers
  const registerDays = useMemo(() => {
    const [y, m] = registerMonth.split('-').map(Number);
    const total = new Date(y, m, 0).getDate();
    return Array.from({ length: total }, (_, i) => i + 1);
  }, [registerMonth]);

  // If multiple lectures happened on a date for a student, show P if present in any, else LV if leave, else A
  const registerLookup = useMemo(() => {
    const map = new Map<string, AttendanceStatus>();
    for (const r of filteredRecords) {
      const key = `${r.personUid}_${r.date}`;
      const st = normalizeAttendanceStatus(r.status);
      const prev = map.get(key);
      if (!prev) {
        map.set(key, st);
      } else if (st === 'present') {
        map.set(key, 'present');
      } else if (st === 'leave' && prev !== 'present') {
        map.set(key, 'leave');
      }
    }
    return map;
  }, [filteredRecords]);

  // Export CSV (ZERO LATE)
  const handleExportCsv = () => {
    let csv = '';
    if (view === 'summary' || view === 'analytics') {
      csv = Papa.unparse(
        summaryRows.map((s) => ({
          Name: s.name,
          ID: s.memberId,
          Class: s.className,
          Present: s.present,
          Absent: s.absent,
          Leave: s.leave,
          Total: s.total,
          Percentage: `${s.pct}%`,
        }))
      );
    } else if (view === 'register') {
      csv = Papa.unparse(
        scopedPeople.map((p) => {
          const row: Record<string, string | number> = {
            Name: p.name,
            ID: p.memberId || '',
          };
          let presentCount = 0;
          for (const d of registerDays) {
            const ds = `${registerMonth}-${String(d).padStart(2, '0')}`;
            const st = registerLookup.get(`${p.uid}_${ds}`);
            row[String(d)] = st === 'present' ? 'P' : st === 'absent' ? 'A' : st === 'leave' ? 'LV' : '';
            if (st === 'present') presentCount++;
          }
          row['Total P'] = presentCount;
          return row;
        })
      );
    } else {
      csv = Papa.unparse(
        filteredRecords.map((r) => ({
          Date: r.date,
          Name: r.personName,
          ID: r.personMemberId || '',
          Class: r.className || '',
          Subject: r.subjectName || '',
          Status: normalizeAttendanceStatus(r.status).toUpperCase(),
          Method: r.method,
          Note: r.note || '',
        }))
      );
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_${view}_${view === 'register' ? registerMonth : `${fromDate}_to_${toDate}`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export Excel (.xlsx) — Multi-sheet professional workbook
  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summarySheet = XLSX.utils.json_to_sheet(
      summaryRows.map((s) => ({
        Name: s.name,
        'Unique ID': s.memberId,
        'Class / Section': s.className,
        Present: s.present,
        Absent: s.absent,
        Leave: s.leave,
        'Total Sessions': s.total,
        'Attendance %': s.pct,
        Status: s.total > 0 && s.pct < threshold ? `Below ${threshold}%` : 'Satisfactory',
      }))
    );
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    // Sheet 2: Subject-wise
    if (subjectBreakdown.length > 0) {
      const subjectSheet = XLSX.utils.json_to_sheet(
        subjectBreakdown.map((s) => ({
          Subject: s.name,
          Code: s.code,
          Present: s.present,
          Absent: s.absent,
          Leave: s.leave,
          Total: s.total,
          'Attendance %': s.pct,
        }))
      );
      XLSX.utils.book_append_sheet(wb, subjectSheet, 'Subject-wise');
    }

    // Sheet 3: Detailed Records
    const recordsSheet = XLSX.utils.json_to_sheet(
      filteredRecords.map((r) => ({
        Date: r.date,
        Name: r.personName,
        'Unique ID': r.personMemberId || '',
        Class: r.className || '',
        Subject: r.subjectName || '',
        'Subject Code': r.subjectCode || '',
        Status: normalizeAttendanceStatus(r.status).toUpperCase(),
        Method: r.method,
        Note: r.note || '',
      }))
    );
    XLSX.utils.book_append_sheet(wb, recordsSheet, 'Detailed Records');

    // Sheet 4: Low Attendance
    const lowSheet = XLSX.utils.json_to_sheet(
      studentAnalyses.map((a) => ({
        Name: a.student.name,
        'Unique ID': a.student.memberId || '',
        Class: a.student.className || '',
        Present: a.present,
        Absent: a.absent,
        Leave: a.leave,
        Total: a.total,
        'Overall %': a.overallPct,
        'Threshold %': threshold,
        'Shortage Subjects': a.shortageSubjects
          .map((s) => `${s.subjectName} (${s.percentage}%)`)
          .join(', '),
      }))
    );
    XLSX.utils.book_append_sheet(wb, lowSheet, 'Low Attendance');

    XLSX.writeFile(
      wb,
      `attendance_report_${view === 'register' ? registerMonth : `${fromDate}_to_${toDate}`}.xlsx`
    );
  };

  // Export Branded PDF (ZERO LATE)
  const handleExportPdf = () => {
    const doc = new jsPDF({ orientation: view === 'register' ? 'landscape' : 'portrait' });
    let startX = 14;

    if (org?.logoUrl && org.logoUrl.startsWith('data:image/')) {
      try {
        doc.addImage(org.logoUrl, 'JPEG', 14, 10, 14, 14);
        startX = 32;
      } catch {
        // Ignore logo rendering errors
      }
    }

    doc.setFontSize(14);
    doc.setTextColor(28, 25, 23);
    doc.text(`${org?.name || 'Smart Attendance System'} — Attendance Report`, startX, 16);

    doc.setFontSize(9);
    doc.setTextColor(100);
    const periodText =
      view === 'register'
        ? `Monthly Register: ${registerMonth}`
        : `Period: ${fromDate} to ${toDate}`;
    const filterParts: string[] = [periodText];
    if (classFilter !== 'all') {
      filterParts.push(`Class: ${classById.get(classFilter)?.name || classFilter}`);
    }
    if (subjectFilter !== 'all') {
      const subj = subjects.find((s) => s.id === subjectFilter);
      if (subj) filterParts.push(`Subject: ${subj.name}`);
    }
    doc.text(filterParts.join('   |   '), startX, 22);

    doc.setFontSize(8.5);
    doc.text(
      `Summary: Present ${overallStats.present}  •  Absent ${overallStats.absent}  •  Leave ${overallStats.leave}  •  Overall ${overallStats.rate}%  |  Generated ${new Date().toLocaleString()}`,
      14,
      29
    );

    if (view === 'summary' || view === 'analytics') {
      autoTable(doc, {
        startY: 34,
        head: [['Name', 'ID', 'Class', 'Present', 'Absent', 'Leave', 'Total', 'Rate']],
        body: summaryRows.map((s) => [
          s.name,
          s.memberId,
          s.className,
          s.present,
          s.absent,
          s.leave,
          s.total,
          `${s.pct}%`,
        ]),
        styles: { fontSize: 8.5 },
        headStyles: { fillColor: [194, 94, 0] },
      });
    } else if (view === 'register') {
      const head = [['Name', ...registerDays.map(String), 'P']];
      const body = scopedPeople.map((p) => {
        let pCount = 0;
        const cells = registerDays.map((d) => {
          const ds = `${registerMonth}-${String(d).padStart(2, '0')}`;
          const st = registerLookup.get(`${p.uid}_${ds}`);
          if (st === 'present') pCount++;
          return st === 'present' ? 'P' : st === 'absent' ? 'A' : st === 'leave' ? 'LV' : '-';
        });
        return [p.name, ...cells, String(pCount)];
      });
      autoTable(doc, {
        startY: 34,
        head,
        body,
        styles: { fontSize: 6.5, cellPadding: 1.4 },
        headStyles: { fillColor: [194, 94, 0] },
      });
    } else {
      autoTable(doc, {
        startY: 34,
        head: [['Date', 'Name', 'ID', 'Subject', 'Status', 'Method', 'Note']],
        body: filteredRecords.map((r) => [
          r.date,
          r.personName,
          r.personMemberId || '',
          r.subjectName || '—',
          normalizeAttendanceStatus(r.status).toUpperCase(),
          r.method,
          r.note || '',
        ]),
        styles: { fontSize: 8.5 },
        headStyles: { fillColor: [194, 94, 0] },
        didParseCell: (data) => {
          if (data.section === 'body') {
            const rec = filteredRecords[data.row.index];
            if (rec?.method === 'manual') {
              data.cell.styles.fillColor = [254, 249, 195];
            }
          }
        },
      });
    }

    doc.save(`attendance_${view}_${today}.pdf`);
  };

  return (
    <Layout title={t('reports.title')}>
      <div className="space-y-6">
        {/* Top Tabs & Export Buttons */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="inline-flex flex-wrap p-1 rounded-xl bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 self-start">
            {(['analytics', 'records', 'summary', 'register'] as const).map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                onClick={() => setView(tabKey)}
                className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                  view === tabKey
                    ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                    : 'text-stone-600 dark:text-stone-400'
                }`}
              >
                {tabKey === 'analytics'
                  ? t('reports.tabAnalytics')
                  : tabKey === 'records'
                  ? t('reports.tabRecords')
                  : tabKey === 'summary'
                  ? t('reports.tabSummary')
                  : t('reports.tabRegister')}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2 text-sm font-medium"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>{t('reports.exportExcel')}</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2 text-sm font-medium"
            >
              <Download className="w-4 h-4" />
              <span>{t('reports.exportCsv')}</span>
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-3.5 py-2 text-sm font-medium"
            >
              <FileText className="w-4 h-4" />
              <span>{t('reports.exportPdf')}</span>
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-4 flex flex-wrap items-end gap-3">
          {view === 'register' ? (
            <div>
              <label className="block text-xs text-stone-500 mb-1">{t('reports.month')}</label>
              <input
                type="month"
                value={registerMonth}
                onChange={(e) => setRegisterMonth(e.target.value)}
                className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs text-stone-500 mb-1">{t('reports.from')}</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">{t('reports.to')}</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
                />
              </div>
            </>
          )}

          {departments.length > 0 && (
            <div>
              <label className="block text-xs text-stone-500 mb-1">
                {t('academics.department')}
              </label>
              <select
                value={deptFilter}
                onChange={(e) => {
                  setDeptFilter(e.target.value);
                  setClassFilter('all');
                  setSubjectFilter('all');
                }}
                className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm max-w-[160px]"
              >
                <option value="all">{t('common.all')}</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {filteredClasses.length > 0 && (
            <div>
              <label className="block text-xs text-stone-500 mb-1">
                {t('academics.classSection')}
              </label>
              <select
                value={classFilter}
                onChange={(e) => {
                  setClassFilter(e.target.value);
                  setSubjectFilter('all');
                }}
                className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm max-w-[170px]"
              >
                <option value="all">{t('academics.allClasses')}</option>
                {filteredClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {filteredSubjects.length > 0 && view !== 'register' && (
            <div>
              <label className="block text-xs text-stone-500 mb-1">
                {t('academics.subject')}
              </label>
              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm max-w-[180px]"
              >
                <option value="all">{t('common.all')}</option>
                {filteredSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code ? `${s.code} · ${s.name}` : s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {view !== 'register' && (
            <>
              <div>
                <label className="block text-xs text-stone-500 mb-1">{t('reports.person')}</label>
                <select
                  value={personFilter}
                  onChange={(e) => setPersonFilter(e.target.value)}
                  className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm max-w-[170px]"
                >
                  <option value="all">{t('common.all')}</option>
                  {scopedPeople.map((p) => (
                    <option key={p.uid} value={p.uid}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">{t('common.status')}</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | AttendanceStatus)}
                  className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
                >
                  <option value="all">{t('common.all')}</option>
                  <option value="present">{t('common.present')}</option>
                  <option value="absent">{t('common.absent')}</option>
                  <option value="leave">{t('common.leave')}</option>
                </select>
              </div>
            </>
          )}

          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search')}
              className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent pl-9 pr-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Main Content */}
        {loading ? (
          <CardSkeleton rows={6} />
        ) : view === 'analytics' ? (
          <div className="space-y-6">
            {/* 4 Clean KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-4 sm:p-5">
                <p className="text-xs font-medium text-stone-500">{t('student.overallRate')}</p>
                <p
                  className={`mt-2 text-2xl sm:text-3xl font-semibold tabular-nums ${
                    overallStats.total > 0 && overallStats.rate < threshold
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-stone-900 dark:text-stone-100'
                  }`}
                >
                  {formatNumber(overallStats.rate)}%
                </p>
                <p className="mt-1 text-[11px] text-stone-500 tabular-nums">
                  {formatNumber(overallStats.total)} {t('reports.totalSessions')}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-4 sm:p-5">
                <p className="text-xs font-medium text-stone-500">{t('common.present')}</p>
                <p className="mt-2 text-2xl sm:text-3xl font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {formatNumber(overallStats.present)}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-4 sm:p-5">
                <p className="text-xs font-medium text-stone-500">{t('common.absent')}</p>
                <p className="mt-2 text-2xl sm:text-3xl font-semibold text-red-600 dark:text-red-400 tabular-nums">
                  {formatNumber(overallStats.absent)}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-4 sm:p-5">
                <p className="text-xs font-medium text-stone-500">{t('common.leave')}</p>
                <p className="mt-2 text-2xl sm:text-3xl font-semibold text-sky-700 dark:text-sky-400 tabular-nums">
                  {formatNumber(overallStats.leave)}
                </p>
              </div>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Daily Attendance Breakdown */}
              <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 mb-4">
                  {t('reports.chartTitle')}
                </h3>
                {dailyChartData.length === 0 ? (
                  <EmptyState title={t('reports.emptyTitle')} description={t('reports.emptyDesc')} />
                ) : (
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={dailyChartData}
                        margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#E7E5E4"
                          opacity={0.4}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 11, fill: '#78716C' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: '#78716C' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: '12px',
                            border: '1px solid #E7E5E4',
                            fontSize: '12px',
                          }}
                        />
                        <Bar dataKey="present" name={t('common.present')} stackId="a" fill="#15803D" />
                        <Bar dataKey="leave" name={t('common.leave')} stackId="a" fill="#0284C7" />
                        <Bar
                          dataKey="absent"
                          name={t('common.absent')}
                          stackId="a"
                          fill="#DC2626"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>

              {/* Subject-wise Attendance Rate */}
              <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 mb-4">
                  {t('reports.subjectWiseChartTitle')}
                </h3>
                {subjectBreakdown.length === 0 ? (
                  <EmptyState title={t('reports.emptyTitle')} description={t('reports.emptyDesc')} />
                ) : (
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={subjectBreakdown.slice(0, 10)}
                        margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#E7E5E4"
                          opacity={0.4}
                          vertical={false}
                        />
                        <XAxis
                          dataKey="shortName"
                          tick={{ fontSize: 11, fill: '#78716C' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fontSize: 11, fill: '#78716C' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          formatter={(value) => [`${value}%`, t('reports.percentage')]}
                          contentStyle={{
                            borderRadius: '12px',
                            border: '1px solid #E7E5E4',
                            fontSize: '12px',
                          }}
                        />
                        <ReferenceLine y={threshold} stroke="#DC2626" strokeDasharray="4 4" />
                        <Bar dataKey="pct" name={t('reports.percentage')} fill="#C25E00" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
            </div>

            {/* Class-wise Summary */}
            {classBreakdown.length > 0 && (
              <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] overflow-hidden">
                <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800">
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    {t('reports.classBreakdownTitle')}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/50 text-xs text-stone-500">
                      <tr>
                        <th className="py-3 px-4 font-medium">{t('academics.classSection')}</th>
                        <th className="py-3 px-4 font-medium text-right">{t('common.present')}</th>
                        <th className="py-3 px-4 font-medium text-right">{t('common.absent')}</th>
                        <th className="py-3 px-4 font-medium text-right">{t('common.leave')}</th>
                        <th className="py-3 px-4 font-medium text-right">{t('reports.percentage')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-stone-800 tabular-nums">
                      {classBreakdown.map((c) => (
                        <tr key={c.classId}>
                          <td className="py-3 px-4 font-medium text-stone-900 dark:text-stone-100">
                            {c.name}
                          </td>
                          <td className="py-3 px-4 text-right text-emerald-700 dark:text-emerald-400">
                            {formatNumber(c.present)}
                          </td>
                          <td className="py-3 px-4 text-right text-red-600 dark:text-red-400">
                            {formatNumber(c.absent)}
                          </td>
                          <td className="py-3 px-4 text-right text-sky-700 dark:text-sky-400">
                            {formatNumber(c.leave)}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold">
                            <span
                              className={
                                c.pct < threshold
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-stone-900 dark:text-stone-100'
                              }
                            >
                              {formatNumber(c.pct)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Low Attendance Shortage List + Dispatch Alerts */}
            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    {t('dashboard.lowAttendance')} ({t('dashboard.belowThreshold')} {threshold}%)
                  </h3>
                </div>
                {studentAnalyses.length > 0 && (
                  <button
                    type="button"
                    disabled={sendingAlerts}
                    onClick={handleDispatchAlerts}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white px-3.5 py-2 text-xs font-medium"
                  >
                    <Bell className="w-3.5 h-3.5" />
                    <span>{sendingAlerts ? t('common.loading') : t('alerts.sendAlertsBtn')}</span>
                  </button>
                )}
              </div>

              {studentAnalyses.length === 0 ? (
                <p className="text-sm text-stone-500">{t('dashboard.noLowAttendance')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-stone-200 dark:border-stone-800 text-xs text-stone-500">
                      <tr>
                        <th className="py-2.5 pr-4 font-medium">{t('common.name')}</th>
                        <th className="py-2.5 pr-4 font-medium">{t('common.memberId')}</th>
                        <th className="py-2.5 pr-4 font-medium">{t('academics.classSection')}</th>
                        <th className="py-2.5 pr-4 font-medium">{t('reports.shortageSubjects')}</th>
                        <th className="py-2.5 text-right font-medium">{t('student.overallRate')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-stone-800 tabular-nums">
                      {studentAnalyses.map((item) => (
                        <tr key={item.student.uid}>
                          <td className="py-2.5 pr-4 font-medium text-stone-900 dark:text-stone-100">
                            {item.student.name}
                          </td>
                          <td className="py-2.5 pr-4 font-mono text-xs text-stone-500">
                            {item.student.memberId}
                          </td>
                          <td className="py-2.5 pr-4 text-xs text-stone-600 dark:text-stone-400">
                            {item.student.className || '—'}
                          </td>
                          <td className="py-2.5 pr-4 text-xs text-stone-600 dark:text-stone-400">
                            {item.shortageSubjects.length > 0
                              ? item.shortageSubjects
                                  .map((s) => `${s.subjectName} (${s.percentage}%)`)
                                  .join(', ')
                              : '—'}
                          </td>
                          <td className="py-2.5 text-right font-semibold text-red-600 dark:text-red-400">
                            {formatNumber(item.overallPct)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        ) : view === 'records' ? (
          filteredRecords.length === 0 ? (
            <EmptyState title={t('reports.emptyTitle')} description={t('reports.emptyDesc')} />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
                <span className="w-3 h-3 rounded-xs bg-amber-100 dark:bg-amber-900/60 border border-amber-300 dark:border-amber-700 shrink-0" />
                <span>{t('reports.manualHighlightHint')}</span>
              </div>

              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/50 text-xs text-stone-500">
                      <tr>
                        <th className="py-3 px-4 font-medium">
                          <button
                            type="button"
                            onClick={() => setSortBy('date')}
                            className="hover:text-stone-900 dark:hover:text-stone-100"
                          >
                            {t('common.date')} {sortBy === 'date' ? '↓' : ''}
                          </button>
                        </th>
                        <th className="py-3 px-4 font-medium">
                          <button
                            type="button"
                            onClick={() => setSortBy('personName')}
                            className="hover:text-stone-900 dark:hover:text-stone-100"
                          >
                            {t('common.name')} {sortBy === 'personName' ? '↓' : ''}
                          </button>
                        </th>
                        <th className="py-3 px-4 font-medium">{t('common.memberId')}</th>
                        <th className="py-3 px-4 font-medium">{t('academics.subject')}</th>
                        <th className="py-3 px-4 font-medium">{t('common.status')}</th>
                        <th className="py-3 px-4 font-medium">{t('reports.method')}</th>
                        <th className="py-3 px-4 font-medium">{t('common.note')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                      {paginatedRecords.map((r) => {
                        const isManual = r.method === 'manual';
                        const st = normalizeAttendanceStatus(r.status);
                        return (
                          <tr
                            key={r.id}
                            className={
                              isManual ? 'bg-amber-50/80 dark:bg-amber-950/30' : undefined
                            }
                          >
                            <td className="py-3 px-4 text-xs tabular-nums whitespace-nowrap">
                              {formatDate(r.date)}
                            </td>
                            <td className="py-3 px-4 font-medium text-stone-900 dark:text-stone-100">
                              {r.personName}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-stone-500 dark:text-stone-400">
                              {r.personMemberId || '—'}
                            </td>
                            <td className="py-3 px-4 text-xs text-stone-600 dark:text-stone-400">
                              {r.subjectName || '—'}
                            </td>
                            <td className="py-3 px-4 text-xs font-semibold">
                              <span
                                className={
                                  st === 'present'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : st === 'leave'
                                    ? 'text-sky-700 dark:text-sky-400'
                                    : 'text-red-700 dark:text-red-400'
                                }
                              >
                                {t(`common.${st}`)}
                              </span>
                            </td>
                            <td
                              className={`py-3 px-4 text-xs whitespace-nowrap ${
                                isManual
                                  ? 'text-amber-800 dark:text-amber-300 font-semibold'
                                  : 'text-stone-500 dark:text-stone-400'
                              }`}
                            >
                              {t(`common.${r.method}`)}
                            </td>
                            <td className="py-3 px-4 text-xs text-stone-500 dark:text-stone-400 max-w-xs truncate">
                              {r.note || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="px-4 py-3 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between text-xs text-stone-500">
                    <span className="tabular-nums">
                      {t('common.page')} {formatNumber(page)} {t('common.of')}{' '}
                      {formatNumber(totalPages)}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="rounded-lg border border-stone-200 dark:border-stone-700 px-3 py-1 disabled:opacity-40"
                      >
                        {t('common.previous')}
                      </button>
                      <button
                        type="button"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        className="rounded-lg border border-stone-200 dark:border-stone-700 px-3 py-1 disabled:opacity-40"
                      >
                        {t('common.next')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        ) : view === 'summary' ? (
          summaryRows.length === 0 ? (
            <EmptyState title={t('reports.emptyTitle')} description={t('reports.emptyDesc')} />
          ) : (
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/50 text-xs text-stone-500">
                    <tr>
                      <th className="py-3 px-4 font-medium">{t('common.name')}</th>
                      <th className="py-3 px-4 font-medium">{t('common.memberId')}</th>
                      <th className="py-3 px-4 font-medium">{t('academics.classSection')}</th>
                      <th className="py-3 px-4 font-medium text-right">{t('reports.presentDays')}</th>
                      <th className="py-3 px-4 font-medium text-right">{t('reports.absentDays')}</th>
                      <th className="py-3 px-4 font-medium text-right">{t('reports.leaveDays')}</th>
                      <th className="py-3 px-4 font-medium text-right">{t('reports.percentage')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-stone-800 tabular-nums">
                    {summaryRows.map((s) => (
                      <tr key={s.uid}>
                        <td className="py-3 px-4 font-medium text-stone-900 dark:text-stone-100">
                          {s.name}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-stone-500">{s.memberId}</td>
                        <td className="py-3 px-4 text-xs text-stone-600 dark:text-stone-400">
                          {s.className}
                        </td>
                        <td className="py-3 px-4 text-right text-emerald-700 dark:text-emerald-400">
                          {formatNumber(s.present)}
                        </td>
                        <td className="py-3 px-4 text-right text-red-700 dark:text-red-400">
                          {formatNumber(s.absent)}
                        </td>
                        <td className="py-3 px-4 text-right text-sky-700 dark:text-sky-400">
                          {formatNumber(s.leave)}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold">
                          <span
                            className={
                              s.total > 0 && s.pct < threshold
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-stone-900 dark:text-stone-100'
                            }
                          >
                            {formatNumber(s.pct)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : /* Monthly Register Sheet (STRICTLY P, A, LV) */
        scopedPeople.length === 0 ? (
          <EmptyState title={t('reports.emptyTitle')} description={t('reports.emptyDesc')} />
        ) : (
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 text-stone-500">
                  <tr>
                    <th className="py-2.5 px-3 font-medium sticky left-0 bg-stone-50 dark:bg-stone-900 z-10 min-w-[150px]">
                      {t('common.name')}
                    </th>
                    {registerDays.map((d) => (
                      <th key={d} className="py-2.5 px-1.5 text-center font-mono font-medium">
                        {d}
                      </th>
                    ))}
                    <th className="py-2.5 px-3 text-right font-medium">P</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800 tabular-nums">
                  {scopedPeople
                    .filter(
                      (p) =>
                        !search.trim() ||
                        p.name.toLowerCase().includes(search.trim().toLowerCase())
                    )
                    .map((p) => {
                      let attended = 0;
                      return (
                        <tr key={p.uid}>
                          <td className="py-2 px-3 font-medium text-stone-900 dark:text-stone-100 sticky left-0 bg-white dark:bg-[#161619] border-r border-stone-100 dark:border-stone-800 truncate max-w-[180px]">
                            {p.name}
                          </td>
                          {registerDays.map((d) => {
                            const ds = `${registerMonth}-${String(d).padStart(2, '0')}`;
                            const st = registerLookup.get(`${p.uid}_${ds}`);
                            if (st === 'present') attended++;
                            const symbol =
                              st === 'present'
                                ? 'P'
                                : st === 'absent'
                                ? 'A'
                                : st === 'leave'
                                ? 'LV'
                                : '·';
                            const cls =
                              st === 'present'
                                ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                : st === 'absent'
                                ? 'text-red-600 dark:text-red-400 font-semibold'
                                : st === 'leave'
                                ? 'text-sky-600 dark:text-sky-400 font-semibold'
                                : 'text-stone-300 dark:text-stone-700';
                            return (
                              <td key={d} className={`py-2 px-1 text-center ${cls}`}>
                                {symbol}
                              </td>
                            );
                          })}
                          <td className="py-2 px-3 text-right font-semibold text-stone-900 dark:text-stone-100">
                            {formatNumber(attended)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};
