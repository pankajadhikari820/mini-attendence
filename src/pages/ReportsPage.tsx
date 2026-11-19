import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
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
import { Download, FileText, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type { AttendanceRecord, AttendanceStatus, UserProfile } from '../types';
import {
  fetchAttendanceForManager,
  fetchAttendanceForOrg,
} from '../services/attendanceService';
import { fetchManagerMembers, fetchOrgUsers } from '../services/userService';
import { getFirebaseErrorKey, getOrgDateString, getPastDates } from '../utils/helpers';
import { Layout } from '../components/Layout';
import { CardSkeleton, EmptyState } from '../components/Skeletons';

const PAGE_SIZE = 15;

export const ReportsPage: React.FC = () => {
  const { profile, org } = useAuth();
  const { t, formatDate, formatNumber } = useTranslation();
  const { showToast } = useToast();

  const today = useMemo(() => getOrgDateString(org?.timezone || 'Asia/Kolkata'), [org?.timezone]);
  const defaultFrom = useMemo(() => getPastDates(30, org?.timezone || 'Asia/Kolkata')[0], [org?.timezone]);

  const [view, setView] = useState<'records' | 'summary' | 'register'>('records');
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(today);
  const [registerMonth, setRegisterMonth] = useState(today.slice(0, 7)); // YYYY-MM
  const [personFilter, setPersonFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AttendanceStatus>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'personName'>('date');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [people, setPeople] = useState<UserProfile[]>([]);

  const loadReportData = useCallback(async () => {
    if (!org || !profile) return;
    setLoading(true);
    try {
      const effectiveFrom =
        view === 'register' ? `${registerMonth}-01` : fromDate;
      const effectiveTo =
        view === 'register' ? `${registerMonth}-31` : toDate;

      if (profile.role === 'admin') {
        const [allUsers, recs] = await Promise.all([
          fetchOrgUsers(org.id),
          fetchAttendanceForOrg(org.id, { fromDate: effectiveFrom, toDate: effectiveTo }),
        ]);
        setPeople(allUsers.filter((u) => u.role !== 'admin'));
        setRecords(recs);
      } else {
        const [members, recs] = await Promise.all([
          fetchManagerMembers(org.id, profile.uid),
          fetchAttendanceForManager(org.id, profile.uid, {
            fromDate: effectiveFrom,
            toDate: effectiveTo,
          }),
        ]);
        setPeople(members);
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

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records
      .filter((r) => {
        if (personFilter !== 'all' && r.personUid !== personFilter) return false;
        if (statusFilter !== 'all' && r.status !== statusFilter) return false;
        if (!q) return true;
        return (
          r.personName.toLowerCase().includes(q) ||
          (r.personMemberId || '').toLowerCase().includes(q) ||
          r.date.includes(q)
        );
      })
      .sort((a, b) =>
        sortBy === 'date'
          ? b.date.localeCompare(a.date)
          : a.personName.localeCompare(b.personName)
      );
  }, [records, personFilter, statusFilter, search, sortBy]);

  useEffect(() => {
    setPage(1);
  }, [personFilter, statusFilter, search, sortBy, view]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const paginatedRecords = filteredRecords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Per-person summary
  const summaryRows = useMemo(() => {
    const map = new Map<
      string,
      {
        uid: string;
        name: string;
        memberId: string;
        present: number;
        late: number;
        absent: number;
        leave: number;
        total: number;
        pct: number;
      }
    >();

    for (const p of people) {
      if (personFilter !== 'all' && p.uid !== personFilter) continue;
      map.set(p.uid, {
        uid: p.uid,
        name: p.name,
        memberId: p.memberId || '—',
        present: 0,
        late: 0,
        absent: 0,
        leave: 0,
        total: 0,
        pct: 0,
      });
    }

    for (const r of filteredRecords) {
      const existing = map.get(r.personUid) || {
        uid: r.personUid,
        name: r.personName,
        memberId: r.personMemberId || '—',
        present: 0,
        late: 0,
        absent: 0,
        leave: 0,
        total: 0,
        pct: 0,
      };
      existing.total++;
      if (r.status === 'present') existing.present++;
      else if (r.status === 'late') existing.late++;
      else if (r.status === 'absent') existing.absent++;
      else if (r.status === 'leave') existing.leave++;
      map.set(r.personUid, existing);
    }

    const q = search.trim().toLowerCase();
    return Array.from(map.values())
      .map((row) => ({
        ...row,
        pct: row.total > 0 ? Math.round(((row.present + row.late) / row.total) * 100) : 0,
      }))
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.memberId.toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [people, filteredRecords, personFilter, search]);

  // Chart data
  const chartData = useMemo(() => {
    const byDate = new Map<string, { present: number; late: number; absent: number; leave: number }>();
    for (const r of filteredRecords) {
      const b = byDate.get(r.date) || { present: 0, late: 0, absent: 0, leave: 0 };
      b[r.status]++;
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

  // Register sheet days (1..daysInMonth)
  const registerDays = useMemo(() => {
    const [y, m] = registerMonth.split('-').map(Number);
    const total = new Date(y, m, 0).getDate();
    return Array.from({ length: total }, (_, i) => i + 1);
  }, [registerMonth]);

  const registerLookup = useMemo(() => {
    const map = new Map<string, AttendanceStatus>();
    for (const r of records) {
      map.set(`${r.personUid}_${r.date}`, r.status);
    }
    return map;
  }, [records]);

  // Export CSV
  const handleExportCsv = () => {
    let csv = '';
    if (view === 'summary') {
      csv = Papa.unparse(
        summaryRows.map((s) => ({
          Name: s.name,
          ID: s.memberId,
          Present: s.present,
          Late: s.late,
          Absent: s.absent,
          Leave: s.leave,
          Total: s.total,
          Percentage: `${s.pct}%`,
        }))
      );
    } else if (view === 'register') {
      csv = Papa.unparse(
        people.map((p) => {
          const row: Record<string, string | number> = {
            Name: p.name,
            ID: p.memberId || '',
          };
          let presentCount = 0;
          for (const d of registerDays) {
            const ds = `${registerMonth}-${String(d).padStart(2, '0')}`;
            const st = registerLookup.get(`${p.uid}_${ds}`);
            row[String(d)] =
              st === 'present' ? 'P' : st === 'late' ? 'L' : st === 'absent' ? 'A' : st === 'leave' ? 'LV' : '';
            if (st === 'present' || st === 'late') presentCount++;
          }
          row['Total P+L'] = presentCount;
          return row;
        })
      );
    } else {
      csv = Papa.unparse(
        filteredRecords.map((r) => ({
          Date: r.date,
          Name: r.personName,
          ID: r.personMemberId || '',
          Status: r.status,
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

  // Export PDF
  const handleExportPdf = () => {
    const doc = new jsPDF({ orientation: view === 'register' ? 'landscape' : 'portrait' });
    doc.setFontSize(15);
    doc.text(`${org?.name || 'Smart Attendance'} — Attendance Report`, 14, 16);
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(
      view === 'register'
        ? `Monthly Register: ${registerMonth}`
        : `Period: ${fromDate} to ${toDate}`,
      14,
      23
    );

    if (view === 'summary') {
      autoTable(doc, {
        startY: 29,
        head: [['Name', 'ID', 'Present', 'Late', 'Absent', 'Leave', 'Total', '%']],
        body: summaryRows.map((s) => [
          s.name,
          s.memberId,
          s.present,
          s.late,
          s.absent,
          s.leave,
          s.total,
          `${s.pct}%`,
        ]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [194, 94, 0] },
      });
    } else if (view === 'register') {
      const head = [['Name', ...registerDays.map(String), 'P+L']];
      const body = people.map((p) => {
        let pCount = 0;
        const cells = registerDays.map((d) => {
          const ds = `${registerMonth}-${String(d).padStart(2, '0')}`;
          const st = registerLookup.get(`${p.uid}_${ds}`);
          if (st === 'present' || st === 'late') pCount++;
          return st === 'present' ? 'P' : st === 'late' ? 'L' : st === 'absent' ? 'A' : st === 'leave' ? 'LV' : '-';
        });
        return [p.name, ...cells, String(pCount)];
      });
      autoTable(doc, {
        startY: 29,
        head,
        body,
        styles: { fontSize: 6.5, cellPadding: 1.5 },
        headStyles: { fillColor: [194, 94, 0] },
      });
    } else {
      autoTable(doc, {
        startY: 29,
        head: [['Date', 'Name', 'ID', 'Status', 'Method', 'Note']],
        body: filteredRecords.map((r) => [
          r.date,
          r.personName,
          r.personMemberId || '',
          r.status,
          r.method,
          r.note || '',
        ]),
        styles: { fontSize: 9 },
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
        {/* Top Controls & Export Buttons */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="inline-flex p-1 rounded-xl bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 self-start">
            {(['records', 'summary', 'register'] as const).map((tabKey) => (
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
                {tabKey === 'records'
                  ? t('reports.tabRecords')
                  : tabKey === 'summary'
                  ? t('reports.tabSummary')
                  : t('reports.tabRegister')}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2.5">
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
              <div>
                <label className="block text-xs text-stone-500 mb-1">{t('reports.person')}</label>
                <select
                  value={personFilter}
                  onChange={(e) => setPersonFilter(e.target.value)}
                  className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm max-w-[180px]"
                >
                  <option value="all">{t('common.all')}</option>
                  {people.map((p) => (
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
                  <option value="late">{t('common.late')}</option>
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

        {/* Chart (Records & Summary views) */}
        {view !== 'register' && chartData.length > 0 && (
          <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 mb-4">
              {t('reports.chartTitle')}
            </h3>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" opacity={0.4} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#78716C' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#78716C' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #E7E5E4', fontSize: '12px' }} />
                  <Bar dataKey="present" name={t('common.present')} stackId="a" fill="#15803D" />
                  <Bar dataKey="late" name={t('common.late')} stackId="a" fill="#D97706" />
                  <Bar dataKey="leave" name={t('common.leave')} stackId="a" fill="#0284C7" />
                  <Bar dataKey="absent" name={t('common.absent')} stackId="a" fill="#DC2626" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Content Views */}
        {loading ? (
          <CardSkeleton rows={6} />
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
                        <th className="py-3 px-4 font-medium">{t('common.status')}</th>
                        <th className="py-3 px-4 font-medium">{t('reports.method')}</th>
                        <th className="py-3 px-4 font-medium">{t('common.note')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                      {paginatedRecords.map((r) => {
                        const isManual = r.method === 'manual';
                        return (
                          <tr
                            key={r.id}
                            className={
                              isManual
                                ? 'bg-amber-50/80 dark:bg-amber-950/30'
                                : undefined
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
                            <td className="py-3 px-4 text-xs font-semibold">
                              <span
                                className={
                                  r.status === 'present'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : r.status === 'late'
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : r.status === 'leave'
                                    ? 'text-sky-700 dark:text-sky-400'
                                    : 'text-red-700 dark:text-red-400'
                                }
                              >
                                {t(`common.${r.status}`)}
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
                      <th className="py-3 px-4 font-medium text-right">{t('reports.presentDays')}</th>
                      <th className="py-3 px-4 font-medium text-right">{t('reports.lateDays')}</th>
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
                        <td className="py-3 px-4 text-right text-emerald-700 dark:text-emerald-400">
                          {formatNumber(s.present)}
                        </td>
                        <td className="py-3 px-4 text-right text-amber-700 dark:text-amber-400">
                          {formatNumber(s.late)}
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
                              s.total > 0 && s.pct < (org?.lowAttendanceThreshold ?? 75)
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
        ) : (
          /* Monthly Register Sheet */
          people.length === 0 ? (
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
                      <th className="py-2.5 px-3 text-right font-medium">P+L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-stone-800 tabular-nums">
                    {people
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
                              if (st === 'present' || st === 'late') attended++;
                              const symbol =
                                st === 'present'
                                  ? 'P'
                                  : st === 'late'
                                  ? 'L'
                                  : st === 'absent'
                                  ? 'A'
                                  : st === 'leave'
                                  ? 'LV'
                                  : '·';
                              const cls =
                                st === 'present'
                                  ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                  : st === 'late'
                                  ? 'text-amber-700 dark:text-amber-400 font-semibold'
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
          )
        )}
      </div>
    </Layout>
  );
};
