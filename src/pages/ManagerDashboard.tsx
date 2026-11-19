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
  BellRing,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  Play,
  QrCode,
  Radio,
  ScanLine,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type {
  Announcement,
  AttendanceRecord,
  AttendanceSession,
  FacultyAssignment,
  LeaveRequest,
  TimetableSlot,
  UserProfile,
} from '../types';
import {
  approvePendingUser,
  fetchManagerMembers,
  fetchUsersByClass,
  rejectPendingUser,
} from '../services/userService';
import { fetchAttendanceForManager } from '../services/attendanceService';
import { fetchLeavesForUser } from '../services/leaveService';
import { fetchAnnouncements } from '../services/communicationService';
import {
  subscribeFacultyAssignments,
  subscribeTimetableForTeacher,
} from '../services/academicService';
import { subscribeOwnerOpenSessions } from '../services/sessionService';
import {
  computeStudentAttendanceAnalysis,
  dispatchLowAttendanceAlerts,
} from '../services/lowAttendanceService';
import {
  formatTimeRange12h,
  getFirebaseErrorKey,
  getOrgDateString,
  getOrgWeekdayIndex,
  getPastDates,
} from '../utils/helpers';
import { Layout } from '../components/Layout';
import { QRCardModal } from '../components/QRCardModal';
import { CardSkeleton, StatGridSkeleton } from '../components/Skeletons';

export const ManagerDashboard: React.FC = () => {
  const { profile, org, getRoleLabel } = useAuth();
  const { t, formatDate, formatNumber } = useTranslation();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<LeaveRequest[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [assignments, setAssignments] = useState<FacultyAssignment[]>([]);
  const [timetable, setTimetable] = useState<TimetableSlot[]>([]);
  const [openSessions, setOpenSessions] = useState<AttendanceSession[]>([]);
  const [showQrModal, setShowQrModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendingAlerts, setSendingAlerts] = useState(false);

  const today = useMemo(() => getOrgDateString(org?.timezone || 'Asia/Kolkata'), [org?.timezone]);
  const todayWeekday = useMemo(
    () => getOrgWeekdayIndex(org?.timezone || 'Asia/Kolkata'),
    [org?.timezone]
  );
  const managerLabel = getRoleLabel('manager');
  const memberLabel = getRoleLabel('member');
  const threshold = org?.lowAttendanceThreshold ?? 75;

  // Real-time subscriptions: My Assigned Subjects, My Timetable, My Active Live Sessions
  useEffect(() => {
    if (!org || !profile) return;
    const unsubAsgn = subscribeFacultyAssignments(org.id, setAssignments, profile.uid);
    const unsubTT = subscribeTimetableForTeacher(org.id, profile.uid, setTimetable);
    const unsubSess = subscribeOwnerOpenSessions(org.id, profile.uid, setOpenSessions);
    return () => {
      unsubAsgn();
      unsubTT();
      unsubSess();
    };
  }, [org, profile]);

  const loadData = useCallback(async () => {
    if (!org || !profile) return;
    setLoading(true);
    try {
      const fromDate = getPastDates(30, org.timezone)[0];
      const assignedClassIds = Array.from(new Set(assignments.map((a) => a.classId)));

      const [directMembers, classMembersNested, attRecs, leavesRes, notices] = await Promise.all([
        fetchManagerMembers(org.id, profile.uid),
        Promise.all(assignedClassIds.map((cid) => fetchUsersByClass(org.id, cid))),
        fetchAttendanceForManager(org.id, profile.uid, { fromDate, toDate: today }),
        fetchLeavesForUser(profile),
        fetchAnnouncements(profile),
      ]);

      // Deduplicate students across assigned classes + legacy direct managerId
      const studentMap = new Map<string, UserProfile>();
      for (const m of directMembers) studentMap.set(m.uid, m);
      for (const batch of classMembersNested) {
        for (const m of batch) studentMap.set(m.uid, m);
      }

      setMembers(Array.from(studentMap.values()).sort((a, b) => a.name.localeCompare(b.name)));
      setAttendance(attRecs);
      setPendingLeaves(leavesRes.teamLeaves.filter((l) => l.status === 'pending'));
      setAnnouncements(notices.slice(0, 4));
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setLoading(false);
    }
  }, [org, profile, assignments, today, showToast, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeMembers = useMemo(() => members.filter((m) => m.status === 'active'), [members]);
  const pendingMembers = useMemo(() => members.filter((m) => m.status === 'pending'), [members]);
  const todayLectures = useMemo(
    () => timetable.filter((slot) => slot.dayOfWeek === todayWeekday),
    [timetable, todayWeekday]
  );

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

  const weeklyChart = useMemo(() => {
    const dates = getPastDates(7, org?.timezone || 'Asia/Kolkata');
    const byDate = new Map<string, { present: number; leave: number; absent: number }>();
    for (const d of dates) byDate.set(d, { present: 0, leave: 0, absent: 0 });
    for (const r of attendance) {
      const b = byDate.get(r.date);
      if (!b) continue;
      if (r.status === 'present') b.present++;
      else if (r.status === 'leave') b.leave++;
      else if (r.status === 'absent') b.absent++;
    }
    return dates.map((d) => ({
      date: formatDate(d, { weekday: 'short', day: 'numeric' }),
      ...byDate.get(d)!,
    }));
  }, [attendance, org?.timezone, formatDate]);

  // Low Attendance Analysis (< threshold)
  const lowAttendanceAnalyses = useMemo(() => {
    const recordsByStudent = new Map<string, AttendanceRecord[]>();
    for (const r of attendance) {
      const list = recordsByStudent.get(r.personUid) || [];
      list.push(r);
      recordsByStudent.set(r.personUid, list);
    }
    return activeMembers
      .map((student) =>
        computeStudentAttendanceAnalysis(
          student,
          recordsByStudent.get(student.uid) || [],
          threshold
        )
      )
      .filter((a) => a.totalClasses > 0 && a.hasShortage)
      .sort((a, b) => a.overallPercent - b.overallPercent);
  }, [activeMembers, attendance, threshold]);

  const handleSendAlerts = async () => {
    if (!org || !profile || lowAttendanceAnalyses.length === 0) return;
    setSendingAlerts(true);
    try {
      const res = await dispatchLowAttendanceAlerts({
        org,
        actor: profile,
        analyses: lowAttendanceAnalyses,
        parentLinks: [],
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

  const handleCopyCode = () => {
    if (!profile?.managerCode) return;
    navigator.clipboard.writeText(profile.managerCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleApprove = async (m: UserProfile) => {
    if (!org) return;
    try {
      await approvePendingUser(org, m, profile);
      showToast(t('people.approvedToast'), 'success');
      await loadData();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    }
  };

  const handleReject = async (m: UserProfile) => {
    if (!org) return;
    try {
      await rejectPendingUser(org.id, m, profile);
      showToast(t('people.rejectedToast'), 'info');
      await loadData();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    }
  };

  return (
    <Layout title={t('teacher.dashboardTitle')}>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              {formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h2 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {t('dashboard.welcome')}, {profile?.name}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {profile?.managerCode && (
              <div className="flex items-center gap-2 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] px-3 py-2">
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  {t('dashboard.yourManagerCode')}
                </span>
                <span className="font-mono text-sm font-semibold text-stone-900 dark:text-stone-100">
                  {profile.managerCode}
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  aria-label={t('common.copy')}
                  className="text-stone-400 hover:text-[#C25E00]"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowQrModal(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2.5 text-sm font-medium transition-colors"
            >
              <QrCode className="w-4 h-4 text-[#C25E00]" />
              <span>{t('dashboard.showQr')}</span>
            </button>

            <Link
              to="/mark?tab=scan"
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{t('mark.qrScannerBtn')}</span>
            </Link>

            <Link
              to="/attendance"
              className="inline-flex items-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap"
            >
              <ScanLine className="w-4 h-4" />
              <span>{t('dashboard.markNow')}</span>
            </Link>
          </div>
        </div>

        {/* Active Live Sessions Strip */}
        {openSessions.length > 0 && (
          <section className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
              <Radio className="w-4 h-4 text-emerald-600 animate-pulse" />
              <span>
                {t('teacher.activeSessions')} ({formatNumber(openSessions.length)})
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {openSessions.map((sess) => (
                <div
                  key={sess.id}
                  className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-[#161619] p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                      {sess.subjectName || sess.title}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5">
                      {sess.className || memberLabel}
                    </p>
                  </div>
                  <Link
                    to="/attendance"
                    className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-medium shrink-0"
                  >
                    {t('teacher.openLiveView')}
                  </Link>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Stats (Strictly PRESENT / LEAVE / ABSENT) */}
        {loading ? (
          <StatGridSkeleton />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                {memberLabel}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
                {formatNumber(activeMembers.length)}
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
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                {t('dashboard.absentToday')}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-red-700 dark:text-red-400">
                {formatNumber(todayStats.absent)}
              </p>
            </div>
          </div>
        )}

        {/* My Lectures Today + My Assigned Classes & Subjects */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-[#C25E00]" />
                <span>{t('teacher.myLecturesToday')}</span>
              </h3>
              <Link to="/timetable" className="text-xs font-medium text-[#C25E00] hover:underline">
                {t('nav.timetable')}
              </Link>
            </div>

            {todayLectures.length === 0 ? (
              <p className="text-sm text-stone-500 dark:text-stone-400 py-4">
                {t('teacher.noLecturesToday')}
              </p>
            ) : (
              <div className="divide-y divide-stone-100 dark:divide-stone-800">
                {todayLectures.map((slot) => {
                  const isLive = openSessions.some(
                    (s) => s.classId === slot.classId && s.subjectId === slot.subjectId
                  );
                  return (
                    <div
                      key={slot.id}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                          {slot.subjectName}
                          {slot.subjectCode ? (
                            <span className="ml-1.5 font-mono text-xs text-stone-400">
                              {slot.subjectCode}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 tabular-nums">
                          {slot.className}
                          {slot.classroom ? ` · ${slot.classroom}` : ''} ·{' '}
                          {formatTimeRange12h(slot.startTime, slot.endTime)}
                        </p>
                      </div>
                      <Link
                        to={`/attendance?slotId=${slot.id}`}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium shrink-0 self-start sm:self-center ${
                          isLive
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-[#C25E00] hover:bg-[#A84F00] text-white'
                        }`}
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>{isLive ? t('teacher.openLiveView') : t('teacher.startLectureBtn')}</span>
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="lg:col-span-5 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#C25E00]" />
                <span>{t('teacher.myAssignedSubjects')}</span>
              </h3>
              <Link to="/reports" className="text-xs font-medium text-[#C25E00] hover:underline">
                {t('nav.reports')}
              </Link>
            </div>

            {assignments.length === 0 ? (
              <p className="text-sm text-stone-500 dark:text-stone-400 py-4">
                {t('teacher.noAssignedSubjects')}
              </p>
            ) : (
              <div className="divide-y divide-stone-100 dark:divide-stone-800">
                {assignments.map((asgn) => (
                  <div
                    key={asgn.id}
                    className="py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">
                        {asgn.subjectName}
                      </p>
                      <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5">
                        {asgn.className}
                      </p>
                    </div>
                    <Link
                      to={`/attendance?assignmentId=${asgn.id}`}
                      className="rounded-lg border border-stone-200 dark:border-stone-700 hover:border-[#C25E00] hover:text-[#C25E00] px-3 py-1.5 text-xs font-medium shrink-0"
                    >
                      {t('teacher.startShort')}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Weekly Chart (Strictly PRESENT / LEAVE / ABSENT) */}
        <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
          <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100 mb-5">
            {t('dashboard.attendanceTrend')} · {t('dashboard.last7Days')}
          </h3>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyChart} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E7E5E4" opacity={0.4} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#78716C' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#78716C' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #E7E5E4', fontSize: '12px' }} />
                <Bar dataKey="present" name={t('common.present')} stackId="a" fill="#15803D" />
                <Bar dataKey="leave" name={t('common.leave')} stackId="a" fill="#0284C7" />
                <Bar dataKey="absent" name={t('common.absent')} stackId="a" fill="#DC2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Bottom 2-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Low Attendance List */}
          <section className="lg:col-span-6 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                  {t('dashboard.lowAttendance')}
                </h3>
                <p className="text-xs text-stone-500 dark:text-stone-400 tabular-nums">
                  {t('dashboard.belowThreshold')} {threshold}%
                </p>
              </div>
              {lowAttendanceAnalyses.length > 0 && (
                <button
                  type="button"
                  disabled={sendingAlerts}
                  onClick={handleSendAlerts}
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
              <p className="text-sm text-stone-500 dark:text-stone-400 py-4">
                {t('dashboard.noLowAttendance')}
              </p>
            ) : (
              <div className="divide-y divide-stone-100 dark:divide-stone-800">
                {lowAttendanceAnalyses.map((item) => (
                  <div key={item.student.uid} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate">
                        {item.student.name}
                      </p>
                      <p className="text-xs font-mono text-stone-500 dark:text-stone-400">
                        {item.student.memberId} · {item.presentCount}/{item.totalClasses}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-red-700 dark:text-red-400">
                      {item.overallPercent}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Pending Approvals, Leaves & Notices */}
          <div className="lg:col-span-6 space-y-6">
            {pendingMembers.length > 0 && (
              <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100 mb-3">
                  {t('dashboard.pendingApprovals')} ({pendingMembers.length})
                </h3>
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  {pendingMembers.map((m) => (
                    <div key={m.uid} className="py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{m.name}</p>
                        <p className="text-xs text-stone-500 truncate">{m.email}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleApprove(m)}
                          className="rounded-lg bg-emerald-600 text-white px-2.5 py-1 text-xs font-medium"
                        >
                          {t('dashboard.approve')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(m)}
                          className="rounded-lg border border-stone-200 dark:border-stone-700 p-1 text-stone-500 hover:text-red-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                  {t('dashboard.pendingLeaves')}
                </h3>
                <Link to="/leaves" className="text-xs font-medium text-[#C25E00] hover:underline">
                  {t('dashboard.viewAll')}
                </Link>
              </div>
              {pendingLeaves.length === 0 ? (
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  {t('dashboard.noPendingLeaves')}
                </p>
              ) : (
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  {pendingLeaves.slice(0, 4).map((l) => (
                    <div key={l.id} className="py-2.5">
                      <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
                        {l.personName}
                      </p>
                      <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                        {formatDate(l.fromDate)} – {formatDate(l.toDate)} · {l.reason}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                  {t('dashboard.recentAnnouncements')}
                </h3>
                <Link to="/announcements" className="text-xs font-medium text-[#C25E00] hover:underline">
                  {t('dashboard.viewAll')}
                </Link>
              </div>
              {announcements.length === 0 ? (
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  {t('dashboard.noAnnouncements')}
                </p>
              ) : (
                <div className="space-y-3">
                  {announcements.map((a) => (
                    <div
                      key={a.id}
                      className="pb-3 border-b last:border-b-0 border-stone-100 dark:border-stone-800"
                    >
                      <p className="text-sm text-stone-800 dark:text-stone-200">{a.text}</p>
                      <p className="mt-1 text-xs text-stone-400">{a.fromName}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {showQrModal && profile && org && (
        <QRCardModal
          person={profile}
          org={org}
          roleLabel={managerLabel}
          onClose={() => setShowQrModal(false)}
        />
      )}
    </Layout>
  );
};
