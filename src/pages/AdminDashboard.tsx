import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  BellRing,
  BookOpen,
  CalendarDays,
  Check,
  Copy,
  ScanLine,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type { Announcement, AttendanceRecord, ParentLink, UserProfile } from '../types';
import { approvePendingUser, fetchOrgUsers, rejectPendingUser } from '../services/userService';
import { fetchAttendanceForOrg } from '../services/attendanceService';
import { fetchAnnouncements } from '../services/communicationService';
import { fetchParentLinks } from '../services/academicService';
import {
  computeStudentAttendanceAnalysis,
  dispatchLowAttendanceAlerts,
} from '../services/lowAttendanceService';
import { getOrgDateString, getPastDates, getFirebaseErrorKey } from '../utils/helpers';
import { Layout } from '../components/Layout';
import { CardSkeleton, StatGridSkeleton } from '../components/Skeletons';

export const AdminDashboard: React.FC = () => {
  const { profile, org, getRoleLabel } = useAuth();
  const { t, formatDate, formatNumber } = useTranslation();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [parentLinks, setParentLinks] = useState<ParentLink[]>([]);
  const [rangeDays, setRangeDays] = useState<7 | 30>(7);
  const [copied, setCopied] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [sendingAlerts, setSendingAlerts] = useState(false);

  const today = useMemo(() => getOrgDateString(org?.timezone || 'Asia/Kolkata'), [org?.timezone]);
  const managerLabel = getRoleLabel('manager');
  const memberLabel = getRoleLabel('member');
  const threshold = org?.lowAttendanceThreshold ?? 75;

  const loadData = useCallback(async () => {
    if (!org || !profile) return;
    setLoading(true);
    try {
      const fromDate = getPastDates(30, org.timezone)[0];
      const [allUsers, attRecs, notices, links] = await Promise.all([
        fetchOrgUsers(org.id),
        fetchAttendanceForOrg(org.id, { fromDate, toDate: today }),
        fetchAnnouncements(profile),
        fetchParentLinks(org.id).catch(() => [] as ParentLink[]),
      ]);
      setUsers(allUsers);
      setAttendance(attRecs);
      setAnnouncements(notices.slice(0, 4));
      setParentLinks(links);
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setLoading(false);
    }
  }, [org, profile, today, showToast, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const managers = useMemo(
    () => users.filter((u) => u.role === 'manager' && u.status === 'active'),
    [users]
  );
  const members = useMemo(
    () => users.filter((u) => u.role === 'member' && u.status === 'active'),
    [users]
  );
  const pendingUsers = useMemo(
    () => users.filter((u) => u.status === 'pending'),
    [users]
  );
  const pendingParentLinks = useMemo(
    () => parentLinks.filter((l) => l.status === 'pending'),
    [parentLinks]
  );

  const todayMap = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of attendance) {
      if (r.date === today) map.set(r.personUid, r);
    }
    return map;
  }, [attendance, today]);

  // Strictly PRESENT, LEAVE, ABSENT (ZERO LATE)
  const todayStats = useMemo(() => {
    let present = 0;
    let leave = 0;
    let absent = 0;
    for (const r of attendance) {
      if (r.date !== today) continue;
      if (r.status === 'present') present++;
      else if (r.status === 'leave') leave++;
      else if (r.status === 'absent') absent++;
    }
    return { present, leave, absent };
  }, [attendance, today]);

  const chartData = useMemo(() => {
    const dates = getPastDates(rangeDays, org?.timezone || 'Asia/Kolkata');
    const byDate = new Map<string, { present: number; leave: number; absent: number }>();
    for (const d of dates) byDate.set(d, { present: 0, leave: 0, absent: 0 });

    for (const r of attendance) {
      const bucket = byDate.get(r.date);
      if (!bucket) continue;
      if (r.status === 'present') bucket.present++;
      else if (r.status === 'leave') bucket.leave++;
      else if (r.status === 'absent') bucket.absent++;
    }

    return dates.map((d) => ({
      date: formatDate(d, { day: 'numeric', month: 'short' }),
      ...byDate.get(d)!,
    }));
  }, [attendance, rangeDays, org?.timezone, formatDate]);

  // Low Attendance Analysis (< threshold)
  const lowAttendanceAnalyses = useMemo(() => {
    const recordsByStudent = new Map<string, AttendanceRecord[]>();
    for (const r of attendance) {
      if (r.role !== 'member') continue;
      const list = recordsByStudent.get(r.personUid) || [];
      list.push(r);
      recordsByStudent.set(r.personUid, list);
    }
    return members
      .map((student) =>
        computeStudentAttendanceAnalysis(
          student,
          recordsByStudent.get(student.uid) || [],
          threshold
        )
      )
      .filter((a) => a.totalClasses > 0 && a.hasShortage)
      .sort((a, b) => a.overallPercent - b.overallPercent);
  }, [members, attendance, threshold]);

  const handleDispatchAlerts = async () => {
    if (!org || !profile || lowAttendanceAnalyses.length === 0) return;
    setSendingAlerts(true);
    try {
      const res = await dispatchLowAttendanceAlerts({
        org,
        actor: profile,
        analyses: lowAttendanceAnalyses,
        parentLinks,
      });
      showToast(
        t('alerts.dispatchedToast').replace('{count}', String(res.sent)),
        res.sent > 0 ? 'success' : 'info'
      );
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSendingAlerts(false);
    }
  };

  const handleCopyOrgCode = () => {
    if (!org?.orgCode) return;
    navigator.clipboard.writeText(org.orgCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleApprove = async (person: UserProfile) => {
    if (!org) return;
    setBusyUid(person.uid);
    try {
      await approvePendingUser(org, person, profile);
      showToast(t('people.approvedToast'), 'success');
      await loadData();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setBusyUid(null);
    }
  };

  const handleReject = async (person: UserProfile) => {
    if (!org) return;
    setBusyUid(person.uid);
    try {
      await rejectPendingUser(org.id, person, profile);
      showToast(t('people.rejectedToast'), 'info');
      await loadData();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setBusyUid(null);
    }
  };

  const statusTextColor = (status?: string) => {
    if (status === 'present') return 'text-emerald-700 dark:text-emerald-400';
    if (status === 'leave') return 'text-sky-700 dark:text-sky-400';
    if (status === 'absent') return 'text-red-700 dark:text-red-400';
    return 'text-stone-400 dark:text-stone-500';
  };

  return (
    <Layout title={t('nav.dashboard')}>
      <div className="space-y-8">
        {/* Top Greeting & Primary CTA */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              {formatDate(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <h2 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {t('dashboard.welcome')}, {profile?.name}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {org && (
              <div className="flex items-center gap-2.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] px-3.5 py-2">
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  {t('dashboard.yourOrgCode')}
                </span>
                <span className="font-mono text-sm font-semibold tracking-wider text-stone-900 dark:text-stone-100">
                  {org.orgCode}
                </span>
                <button
                  type="button"
                  onClick={handleCopyOrgCode}
                  aria-label={t('common.copy')}
                  className="text-stone-400 hover:text-[#C25E00] transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            )}

            <Link
              to="/attendance"
              className="inline-flex items-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap"
            >
              <ScanLine className="w-4 h-4" />
              <span>{t('dashboard.markNow')}</span>
            </Link>
          </div>
        </div>

        {/* Stat Grid (Strictly PRESENT / LEAVE / ABSENT) */}
        {loading ? (
          <StatGridSkeleton />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                {t('dashboard.totalManagers')} {managerLabel}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
                {formatNumber(managers.length)}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                {t('dashboard.totalMembers')} {memberLabel}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
                {formatNumber(members.length)}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                {t('dashboard.presentToday')}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatNumber(todayStats.present)}
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                {t('dashboard.leaveToday')}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-sky-700 dark:text-sky-400">
                {formatNumber(todayStats.leave)}
              </p>
            </div>
            <div className="col-span-2 lg:col-span-1 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                {t('dashboard.absentToday')}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-red-700 dark:text-red-400">
                {formatNumber(todayStats.absent)}
              </p>
            </div>
          </div>
        )}

        {/* Quick Campus Management Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link
            to="/academics"
            className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] hover:border-[#C25E00]/50 p-4 flex items-center justify-between gap-3 transition-colors"
          >
            <div className="flex items-center gap-3">
              <BookOpen className="w-5 h-5 text-[#C25E00]" />
              <div>
                <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {t('nav.academics')}
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  {t('academics.quickCardDesc')}
                </p>
              </div>
            </div>
            {pendingParentLinks.length > 0 && (
              <span className="font-mono text-xs font-semibold text-[#C25E00] tabular-nums">
                {pendingParentLinks.length}
              </span>
            )}
          </Link>

          <Link
            to="/timetable"
            className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] hover:border-[#C25E00]/50 p-4 flex items-center gap-3 transition-colors"
          >
            <CalendarDays className="w-5 h-5 text-[#C25E00]" />
            <div>
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                {t('nav.timetable')}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {t('timetable.quickCardDesc')}
              </p>
            </div>
          </Link>

          <Link
            to="/audit-logs"
            className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] hover:border-[#C25E00]/50 p-4 flex items-center gap-3 transition-colors"
          >
            <ShieldCheck className="w-5 h-5 text-[#C25E00]" />
            <div>
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                {t('nav.auditLogs')}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {t('audit.quickCardDesc')}
              </p>
            </div>
          </Link>
        </div>

        {/* Attendance Trend Chart (Strictly PRESENT / LEAVE / ABSENT) */}
        <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              {t('dashboard.attendanceTrend')}
            </h3>
            <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-xs font-medium">
              <button
                type="button"
                onClick={() => setRangeDays(7)}
                className={`px-3 py-1 rounded-md transition-colors ${
                  rangeDays === 7
                    ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                    : 'text-stone-500 dark:text-stone-400'
                }`}
              >
                {t('dashboard.last7Days')}
              </button>
              <button
                type="button"
                onClick={() => setRangeDays(30)}
                className={`px-3 py-1 rounded-md transition-colors ${
                  rangeDays === 30
                    ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                    : 'text-stone-500 dark:text-stone-400'
                }`}
              >
                {t('dashboard.last30Days')}
              </button>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" opacity={0.4} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#78716C' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#78716C' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #E7E5E4',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="present" name={t('common.present')} stackId="a" fill="#15803D" />
                <Bar dataKey="leave" name={t('common.leave')} stackId="a" fill="#0284C7" />
                <Bar dataKey="absent" name={t('common.absent')} stackId="a" fill="#DC2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Bottom 2-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-6">
            {/* Low Attendance Alert Widget */}
            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                    {t('dashboard.lowAttendance')} ({t('dashboard.belowThreshold')} {threshold}%)
                  </h3>
                </div>
                {lowAttendanceAnalyses.length > 0 && (
                  <button
                    type="button"
                    disabled={sendingAlerts}
                    onClick={handleDispatchAlerts}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs font-medium"
                  >
                    <BellRing className="w-3.5 h-3.5" />
                    <span>{sendingAlerts ? t('common.saving') : t('alerts.sendAlertsBtn')}</span>
                  </button>
                )}
              </div>

              {loading ? (
                <CardSkeleton rows={3} />
              ) : lowAttendanceAnalyses.length === 0 ? (
                <p className="text-sm text-stone-500 dark:text-stone-400 py-3">
                  {t('dashboard.noLowAttendance')}
                </p>
              ) : (
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  {lowAttendanceAnalyses.slice(0, 6).map((item) => (
                    <div key={item.student.uid} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">
                          {item.student.name}
                        </p>
                        <p className="text-xs text-stone-500 dark:text-stone-400 font-mono truncate">
                          {item.student.memberId}
                          {item.student.className ? ` · ${item.student.className}` : ''} ·{' '}
                          {item.presentCount}/{item.totalClasses}
                        </p>
                      </div>
                      <span className="text-sm font-bold tabular-nums text-red-700 dark:text-red-400 shrink-0">
                        {item.overallPercent}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Teachers Today */}
            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                  {managerLabel} · {t('dashboard.todayStatus')}
                </h3>
                <Link to="/admin/managers" className="text-xs font-medium text-[#C25E00] hover:underline">
                  {t('dashboard.viewAll')}
                </Link>
              </div>

              {loading ? (
                <CardSkeleton rows={3} />
              ) : managers.length === 0 ? (
                <p className="text-sm text-stone-500 dark:text-stone-400 py-6 text-center">
                  {t('people.emptyTitle')}
                </p>
              ) : (
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  {managers.slice(0, 8).map((mgr) => {
                    const rec = todayMap.get(mgr.uid);
                    return (
                      <div key={mgr.uid} className="py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">
                            {mgr.name}
                            {mgr.isDemo && (
                              <span className="ml-2 text-xs font-normal text-stone-400">
                                · {t('common.demo')}
                              </span>
                            )}
                          </p>
                          <p className="text-xs font-mono text-stone-500 dark:text-stone-400">
                            {mgr.memberId}
                          </p>
                        </div>
                        <span className={`text-xs font-semibold ${statusTextColor(rec?.status)}`}>
                          {rec ? t(`common.${rec.status}`) : t('common.unmarked')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Pending Approvals & Notices */}
          <div className="lg:col-span-5 space-y-6">
            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                  {t('dashboard.pendingApprovals')}
                </h3>
                <span className="text-xs font-mono text-stone-500 tabular-nums">
                  {formatNumber(pendingUsers.length)}
                </span>
              </div>

              {pendingUsers.length === 0 ? (
                <p className="text-sm text-stone-500 dark:text-stone-400 py-4">
                  {t('dashboard.noPendingApprovals')}
                </p>
              ) : (
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  {pendingUsers.slice(0, 5).map((u) => (
                    <div key={u.uid} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">
                          {u.name}
                        </p>
                        <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
                          {u.role === 'manager'
                            ? managerLabel
                            : u.role === 'parent'
                            ? t('common.parent')
                            : memberLabel}{' '}
                          · {u.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={busyUid === u.uid}
                          onClick={() => handleApprove(u)}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 text-xs font-medium"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{t('dashboard.approve')}</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyUid === u.uid}
                          onClick={() => handleReject(u)}
                          aria-label={t('dashboard.reject')}
                          className="inline-flex items-center justify-center rounded-lg border border-stone-200 dark:border-stone-700 text-stone-500 hover:text-red-600 p-1.5"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                  {t('dashboard.recentAnnouncements')}
                </h3>
                <Link to="/announcements" className="text-xs font-medium text-[#C25E00] hover:underline">
                  {t('dashboard.viewAll')}
                </Link>
              </div>
              {announcements.length === 0 ? (
                <p className="text-sm text-stone-500 dark:text-stone-400 py-2">
                  {t('dashboard.noAnnouncements')}
                </p>
              ) : (
                <div className="space-y-3">
                  {announcements.map((a) => (
                    <div
                      key={a.id}
                      className="pb-3 border-b last:border-b-0 border-stone-100 dark:border-stone-800"
                    >
                      <p className="text-sm text-stone-800 dark:text-stone-200 leading-relaxed">
                        {a.text}
                      </p>
                      <p className="mt-1 text-xs text-stone-400">{a.fromName}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </Layout>
  );
};
