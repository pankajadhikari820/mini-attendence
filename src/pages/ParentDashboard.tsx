import React, { useEffect, useMemo, useState } from 'react';
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
} from 'recharts';
import {
  AlertTriangle,
  BookOpen,
  FileSpreadsheet,
  FileText,
  GraduationCap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import type { AttendanceRecord, LeaveRequest, UserProfile } from '../types';
import { fetchLinkedStudentsForParent } from '../services/academicService';
import { fetchAttendanceForPerson } from '../services/attendanceService';
import { fetchLeavesForStudent } from '../services/leaveService';
import { computeStudentAttendanceAnalysis } from '../services/lowAttendanceService';
import { Layout } from '../components/Layout';
import { CardSkeleton, EmptyState } from '../components/Skeletons';

export const ParentDashboard: React.FC = () => {
  const { profile, org } = useAuth();
  const { t, formatDate, formatNumber } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<UserProfile[]>([]);
  const [selectedChildUid, setSelectedChildUid] = useState<string>('');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);

  const threshold = org?.lowAttendanceThreshold ?? 75;

  useEffect(() => {
    if (!profile) return;
    setLoading(true);
    fetchLinkedStudentsForParent(profile)
      .then((list) => {
        setChildren(list);
        if (list[0]) setSelectedChildUid(list[0].uid);
      })
      .finally(() => setLoading(false));
  }, [profile]);

  const selectedChild = useMemo(
    () => children.find((c) => c.uid === selectedChildUid) || children[0] || null,
    [children, selectedChildUid]
  );

  useEffect(() => {
    if (!org || !selectedChild) {
      setRecords([]);
      setLeaves([]);
      return;
    }
    setLoading(true);
    Promise.all([
      fetchAttendanceForPerson(org.id, selectedChild.uid),
      fetchLeavesForStudent(org.id, selectedChild.uid),
    ])
      .then(([att, lv]) => {
        setRecords(att);
        setLeaves(lv);
      })
      .finally(() => setLoading(false));
  }, [org, selectedChild]);

  const analysis = useMemo(() => {
    if (!selectedChild) return null;
    return computeStudentAttendanceAnalysis(selectedChild, records, threshold);
  }, [selectedChild, records, threshold]);

  const handleExportPDF = () => {
    if (!selectedChild || !org || !analysis) return;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text(org.name, 14, 16);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text(
      `Student Attendance Report — ${selectedChild.name} (${selectedChild.memberId})`,
      14,
      23
    );
    pdf.text(
      `Class: ${selectedChild.className || '—'} · Overall: ${analysis.overallPercent}% (${analysis.presentCount}/${analysis.totalClasses})`,
      14,
      29
    );

    autoTable(pdf, {
      startY: 36,
      head: [['Date', 'Subject', 'Teacher', 'Status', 'Method']],
      body: records.map((r) => [
        r.date,
        r.subjectName || 'General',
        r.teacherName || '—',
        r.status.toUpperCase(),
        r.method,
      ]),
      styles: { fontSize: 8.5 },
      headStyles: { fillColor: [194, 94, 0] },
    });

    pdf.save(`${selectedChild.memberId || 'student'}_attendance_report.pdf`);
  };

  const handleExportExcel = () => {
    if (!selectedChild || !analysis) return;
    const wb = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet(
      analysis.subjects.map((s) => ({
        Subject: s.subjectName,
        Code: s.subjectCode,
        Present: s.present,
        Absent: s.absent,
        Leave: s.leave,
        Total: s.total,
        Percentage: `${s.percentage}%`,
      }))
    );
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Subject Summary');

    const detailSheet = XLSX.utils.json_to_sheet(
      records.map((r) => ({
        Date: r.date,
        Subject: r.subjectName || 'General',
        Teacher: r.teacherName || '',
        Status: r.status.toUpperCase(),
        Method: r.method,
        Note: r.note || '',
      }))
    );
    XLSX.utils.book_append_sheet(wb, detailSheet, 'Attendance History');
    XLSX.writeFile(wb, `${selectedChild.memberId || 'student'}_attendance.xlsx`);
  };

  return (
    <Layout title={t('nav.parentPortal')}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {t('parent.title')}
            </h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {t('parent.subtitle')}
            </p>
          </div>

          {selectedChild && (
            <div className="flex flex-wrap items-center gap-2">
              {children.length > 1 && (
                <select
                  value={selectedChild.uid}
                  onChange={(e) => setSelectedChildUid(e.target.value)}
                  className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
                >
                  {children.map((c) => (
                    <option key={c.uid} value={c.uid}>
                      {c.name} ({c.memberId})
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={handleExportExcel}
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2 text-xs font-medium"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={handleExportPDF}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-3.5 py-2 text-xs font-medium"
              >
                <FileText className="w-4 h-4" />
                <span>PDF</span>
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <CardSkeleton rows={4} />
        ) : !selectedChild || !analysis ? (
          <EmptyState
            title={t('parent.noLinkedStudentTitle')}
            description={t('parent.noLinkedStudentDesc')}
          />
        ) : (
          <>
            {/* Student Banner */}
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-[#C25E00] flex items-center justify-center">
                  <GraduationCap className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-stone-900 dark:text-stone-100">
                    {selectedChild.name}
                  </h3>
                  <p className="text-xs text-stone-500 dark:text-stone-400 font-mono">
                    ID: {selectedChild.memberId}
                    {selectedChild.className ? ` · ${selectedChild.className}` : ''}
                    {selectedChild.enrollmentNumber ? ` · #${selectedChild.enrollmentNumber}` : ''}
                  </p>
                </div>
              </div>
              <span className="text-xs text-stone-500 dark:text-stone-400">
                {t('parent.readOnlyNote')}
              </span>
            </div>

            {/* 75% Shortage Warning */}
            {analysis.totalClasses > 0 && analysis.hasShortage && (
              <div
                role="alert"
                className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50/75 dark:bg-red-950/30 p-4 flex items-start gap-3"
              >
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-900 dark:text-red-200">
                    {t('alerts.shortageWarningTitle')} ({threshold}%)
                  </p>
                  <p className="text-xs text-red-800 dark:text-red-300 mt-0.5">
                    {t('alerts.overallShortageDesc')
                      .replace('{pct}', String(analysis.overallPercent))
                      .replace('{threshold}', String(threshold))}
                  </p>
                </div>
              </div>
            )}

            {/* KPI Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
                <p className="text-xs text-stone-500">{t('student.overallRate')}</p>
                <p
                  className={`mt-1.5 text-3xl font-bold tabular-nums ${
                    analysis.overallPercent < threshold && analysis.totalClasses > 0
                      ? 'text-red-600'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {formatNumber(analysis.overallPercent)}%
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
                <p className="text-xs text-stone-500">{t('common.present')}</p>
                <p className="mt-1.5 text-3xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatNumber(analysis.presentCount)}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
                <p className="text-xs text-stone-500">{t('common.absent')}</p>
                <p className="mt-1.5 text-3xl font-bold tabular-nums text-red-700 dark:text-red-400">
                  {formatNumber(analysis.absentCount)}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
                <p className="text-xs text-stone-500">{t('common.leave')}</p>
                <p className="mt-1.5 text-3xl font-bold tabular-nums text-sky-700 dark:text-sky-400">
                  {formatNumber(analysis.leaveCount)}
                </p>
              </div>
            </div>

            {/* Subject-wise Chart */}
            {analysis.subjects.length > 0 && (
              <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
                <h3 className="text-base font-semibold flex items-center gap-2 mb-5">
                  <BookOpen className="w-4 h-4 text-[#C25E00]" />
                  <span>{t('student.subjectWiseTitle')}</span>
                </h3>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={analysis.subjects.map((s) => ({
                        name: s.subjectName,
                        percentage: s.percentage,
                      }))}
                      margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" opacity={0.4} vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#78716C' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#78716C' }} axisLine={false} tickLine={false} />
                      <Tooltip />
                      <Bar dataKey="percentage" name="Attendance %" fill="#C25E00" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* Attendance History & Leave Status */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <section className="lg:col-span-7 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
                <h3 className="text-base font-semibold mb-4">{t('dashboard.recentHistory')}</h3>
                {records.length === 0 ? (
                  <p className="text-sm text-stone-500">{t('common.noData')}</p>
                ) : (
                  <div className="divide-y divide-stone-100 dark:divide-stone-800">
                    {records.slice(0, 15).map((r) => (
                      <div key={r.id} className="py-3 flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium text-stone-900 dark:text-stone-100 truncate">
                            {r.subjectName ? `${r.subjectName} · ` : ''}
                            {formatDate(r.date)}
                          </p>
                          <p className="text-xs text-stone-500 truncate">
                            {r.teacherName || t(`common.${r.method}`)}
                          </p>
                        </div>
                        <span
                          className={`text-xs font-semibold uppercase ${
                            r.status === 'present'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : r.status === 'absent'
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-sky-700 dark:text-sky-400'
                          }`}
                        >
                          {t(`common.${r.status}`)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="lg:col-span-5 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
                <h3 className="text-base font-semibold mb-4">{t('parent.leaveStatusTitle')}</h3>
                {leaves.length === 0 ? (
                  <p className="text-sm text-stone-500">{t('leaves.empty')}</p>
                ) : (
                  <div className="divide-y divide-stone-100 dark:divide-stone-800">
                    {leaves.map((l) => (
                      <div key={l.id} className="py-3 flex items-start justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <p className="font-medium text-stone-900 dark:text-stone-100">
                            {formatDate(l.fromDate)} – {formatDate(l.toDate)}
                          </p>
                          <p className="text-stone-500 mt-0.5">{l.reason}</p>
                        </div>
                        <span
                          className={`font-semibold uppercase shrink-0 ${
                            l.status === 'approved'
                              ? 'text-emerald-700'
                              : l.status === 'rejected'
                              ? 'text-red-600'
                              : 'text-amber-600'
                          }`}
                        >
                          {t(`leaves.${l.status}`)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};
