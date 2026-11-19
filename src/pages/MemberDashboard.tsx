import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  QrCode,
  Radio,
  RefreshCw,
  ScanLine,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import type {
  Announcement,
  AttendanceRecord,
  AttendanceSession,
  LeaveRequest,
  TimetableSlot,
} from '../types';
import { subscribeAttendanceForPerson } from '../services/attendanceService';
import {
  findEligibleLiveSessions,
  subscribeEligibleLiveSessions,
  type SessionStreamError,
} from '../services/sessionService';
import { subscribeTimetableForClass } from '../services/academicService';
import { fetchLeavesForStudent } from '../services/leaveService';
import { fetchAnnouncements } from '../services/communicationService';
import { computeStudentAttendanceAnalysis } from '../services/lowAttendanceService';
import {
  formatTimeRange12h,
  getInitials,
  getOrgDateString,
  getOrgWeekdayIndex,
} from '../utils/helpers';
import { Layout } from '../components/Layout';
import { QRCardModal } from '../components/QRCardModal';
import { CardSkeleton } from '../components/Skeletons';

export const MemberDashboard: React.FC = () => {
  const { profile, org, getRoleLabel } = useAuth();
  const { t, formatDate, formatNumber, language } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [liveSessions, setLiveSessions] = useState<AttendanceSession[]>([]);
  const [sessionError, setSessionError] = useState<SessionStreamError | null>(null);
  const [recheckingSessions, setRecheckingSessions] = useState(false);
  const [timetable, setTimetable] = useState<TimetableSlot[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [showQrModal, setShowQrModal] = useState(false);

  const today = useMemo(() => getOrgDateString(org?.timezone || 'Asia/Kolkata'), [org?.timezone]);
  const todayWeekday = useMemo(
    () => getOrgWeekdayIndex(org?.timezone || 'Asia/Kolkata'),
    [org?.timezone]
  );
  const [calYear, setCalYear] = useState(() => Number(today.slice(0, 4)));
  const [calMonth, setCalMonth] = useState(() => Number(today.slice(5, 7)) - 1);

  const memberLabel = getRoleLabel('member');
  const threshold = org?.lowAttendanceThreshold ?? 75;

  // Real-time Attendance, Live Sessions & Timetable listeners
  useEffect(() => {
    if (!org || !profile) return;
    setLoading(true);

    const unsubAtt = subscribeAttendanceForPerson(org.id, profile.uid, (list) => {
      setRecords(list);
      setLoading(false);
    });

    const unsubSessions = subscribeEligibleLiveSessions(
      profile,
      org,
      (list) => {
        setLiveSessions(list);
        setSessionError(null);
      },
      (err) => {
        setSessionError(err);
      }
    );

    const unsubTT = profile.classId
      ? subscribeTimetableForClass(org.id, profile.classId, setTimetable)
      : () => {};

    Promise.all([
      fetchLeavesForStudent(org.id, profile.uid).catch(() => [] as LeaveRequest[]),
      fetchAnnouncements(profile).catch(() => [] as Announcement[]),
    ]).then(([lv, notices]) => {
      setLeaves(lv.slice(0, 5));
      setAnnouncements(notices.slice(0, 4));
    });

    return () => {
      unsubAtt();
      unsubSessions();
      unsubTT();
    };
  }, [org, profile]);

  const handleRecheckSessions = async () => {
    if (!profile || !org) return;
    setRecheckingSessions(true);
    try {
      const res = await findEligibleLiveSessions(profile, org);
      setLiveSessions(res.sessions);
      setSessionError(res.error);
    } finally {
      setRecheckingSessions(false);
    }
  };

  // Student Performance Analysis (Overall % + Subject-wise % + 75% Shortage Detection)
  const analysis = useMemo(() => {
    if (!profile) return null;
    return computeStudentAttendanceAnalysis(profile, records, threshold);
  }, [profile, records, threshold]);

  // Today's Scheduled Lectures merged with attendance & live sessions
  const todayLectures = useMemo(() => {
    const todaySlots = timetable.filter((s) => s.dayOfWeek === todayWeekday);
    const todayRecs = records.filter((r) => r.date === today);

    return todaySlots.map((slot) => {
      const rec = todayRecs.find((r) => r.subjectId === slot.subjectId);
      const liveSess = liveSessions.find(
        (s) => s.subjectId === slot.subjectId && (!s.classId || s.classId === slot.classId)
      );
      return {
        slot,
        status: rec ? rec.status : ('not_started' as const),
        liveSession: liveSess || null,
      };
    });
  }, [timetable, todayWeekday, records, today, liveSessions]);

  // Calendar aggregation by date (if multiple subjects on same day: present wins over leave, absent if all absent)
  const statusByDate = useMemo(() => {
    const map = new Map<string, 'present' | 'leave' | 'absent'>();
    for (const r of records) {
      const cur = map.get(r.date);
      if (!cur) {
        map.set(r.date, r.status);
      } else if (r.status === 'present') {
        map.set(r.date, 'present');
      } else if (r.status === 'leave' && cur === 'absent') {
        map.set(r.date, 'leave');
      }
    }
    return map;
  }, [records]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells: Array<{ day: number | null; dateStr?: string }> = [];
    for (let i = 0; i < startWeekday; i++) cells.push({ day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const m = String(calMonth + 1).padStart(2, '0');
      const dayStr = String(d).padStart(2, '0');
      cells.push({ day: d, dateStr: `${calYear}-${m}-${dayStr}` });
    }
    return cells;
  }, [calYear, calMonth]);

  const monthHeading = new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(calYear, calMonth, 1));

  const prevMonth = () => {
    if (calMonth === 0) {
      setCalMonth(11);
      setCalYear((y) => y - 1);
    } else {
      setCalMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (calMonth === 11) {
      setCalMonth(0);
      setCalYear((y) => y + 1);
    } else {
      setCalMonth((m) => m + 1);
    }
  };

  const qrValue =
    org && profile
      ? JSON.stringify({ type: 'student_id', orgId: org.id, uid: profile.uid, id: profile.memberId })
      : '';

  const cellColors = (status?: string) => {
    if (status === 'present')
      return 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800';
    if (status === 'absent')
      return 'bg-red-100 dark:bg-red-950/60 text-red-900 dark:text-red-200 border-red-200 dark:border-red-800';
    if (status === 'leave')
      return 'bg-sky-100 dark:bg-sky-950/60 text-sky-900 dark:text-sky-200 border-sky-200 dark:border-sky-800';
    return 'bg-stone-50 dark:bg-stone-900/50 text-stone-600 dark:text-stone-400 border-stone-200/70 dark:border-stone-800';
  };

  const weekdayLabels =
    language === 'hi'
      ? ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <Layout title={t('student.dashboardTitle')}>
      <div className="space-y-7">
        {/* REAL-TIME ACTIVE SESSIONS BANNER (Auto-updates instantly when any teacher starts/ends a session) */}
        {liveSessions.length > 0 ? (
          <section className="rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/75 dark:bg-emerald-950/30 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-900 dark:text-emerald-200">
                <Radio className="w-4 h-4 text-emerald-600 animate-pulse" />
                <span>
                  {t('student.activeLiveSessionsTitle')} ({formatNumber(liveSessions.length)})
                </span>
              </div>
              <button
                type="button"
                onClick={handleRecheckSessions}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 dark:text-emerald-300 hover:underline"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${recheckingSessions ? 'animate-spin' : ''}`} />
                <span>{t('mark.refreshSession')}</span>
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {liveSessions.map((sess) => (
                <div
                  key={sess.id}
                  className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-[#161619] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                      {sess.subjectName || sess.title}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5">
                      {sess.teacherName || sess.ownerName}
                      {sess.classroom ? ` · ${sess.classroom}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      to={`/mark?tab=scan&sessionId=${sess.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#C25E00] hover:bg-[#A84F00] text-white px-3 py-1.5 text-xs font-medium"
                    >
                      <ScanLine className="w-3.5 h-3.5" />
                      <span>{t('landing.markCardScanBtn')}</span>
                    </Link>
                    <Link
                      to={`/mark?tab=code&sessionId=${sess.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 dark:border-stone-700 px-2.5 py-1.5 text-xs font-medium"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>{t('mark.codeShort')}</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-50">
                {sessionError ? t('mark.sessionNetworkErrorTitle') : t('mark.noActiveSession')}
              </h2>
              <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                {sessionError ? sessionError.message : t('mark.noActiveSessionHint')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={recheckingSessions}
                onClick={handleRecheckSessions}
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2 text-xs font-medium"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${recheckingSessions ? 'animate-spin' : ''}`} />
                <span>{t('mark.refreshSession')}</span>
              </button>
              <Link
                to="/mark?tab=scan"
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2 text-xs font-medium"
              >
                <ScanLine className="w-3.5 h-3.5" />
                <span>{t('landing.markCardScanBtn')}</span>
              </Link>
            </div>
          </div>
        )}

        {/* 75% ATTENDANCE SHORTAGE WARNING BANNER */}
        {analysis && analysis.totalClasses > 0 && analysis.hasShortage && (
          <div
            role="alert"
            className="rounded-2xl border border-red-200 dark:border-red-900/80 bg-red-50/75 dark:bg-red-950/30 p-4 sm:p-5 flex items-start gap-3"
          >
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-red-900 dark:text-red-200">
                {t('alerts.shortageWarningTitle')} ({threshold}%)
              </h3>
              <p className="mt-1 text-xs text-red-800 dark:text-red-300 leading-relaxed">
                {analysis.isOverallShortage
                  ? t('alerts.overallShortageDesc')
                      .replace('{pct}', String(analysis.overallPercent))
                      .replace('{threshold}', String(threshold))
                  : t('alerts.subjectShortageDesc').replace(
                      '{subjects}',
                      analysis.shortageSubjects
                        .map((s) => `${s.subjectName} (${s.percentage}%)`)
                        .join(', ')
                    )}
              </p>
            </div>
          </div>
        )}

        {/* Top Row: Digital Student ID Card + Performance Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Digital Student ID Card Preview */}
          <div className="lg:col-span-5 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] overflow-hidden flex flex-col justify-between">
            <div className="bg-[#C25E00] px-5 py-3.5 text-white flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">{org?.name}</p>
                <p className="text-[10px] uppercase tracking-wider text-white/85">
                  {t('qr.officialCardLabel')}
                </p>
              </div>
              <span className="font-mono text-xs font-bold bg-white/15 px-2 py-0.5 rounded">
                {profile?.memberId}
              </span>
            </div>

            <div className="p-5 flex flex-col items-center text-center flex-1 justify-between">
              <div className="flex items-center gap-3.5 w-full text-left">
                {profile?.photoUrl ? (
                  <img
                    src={profile.photoUrl}
                    alt={profile.name}
                    className="w-14 h-14 rounded-xl object-cover border border-stone-200 dark:border-stone-700 shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-200 flex items-center justify-center text-base font-bold shrink-0">
                    {getInitials(profile?.name || '')}
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 truncate">
                    {profile?.name}
                  </h2>
                  <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
                    {profile?.className || memberLabel}
                  </p>
                  {(profile?.enrollmentNumber || profile?.rollNumber) && (
                    <p className="text-[11px] font-mono text-stone-400 mt-0.5">
                      {t('qr.enrollmentNo')}: {profile.enrollmentNumber || profile.rollNumber}
                    </p>
                  )}
                </div>
              </div>

              <div className="my-4 p-3 rounded-xl bg-white border border-stone-200">
                {qrValue && <QRCodeSVG value={qrValue} size={148} level="M" />}
              </div>

              <button
                type="button"
                onClick={() => setShowQrModal(true)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2.5 text-sm font-medium transition-colors"
              >
                <QrCode className="w-4 h-4" />
                <span>{t('qr.openDigitalIdBtn')}</span>
              </button>
            </div>
          </div>

          {/* Performance Metrics + Today's Lectures */}
          <div className="lg:col-span-7 flex flex-col gap-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-4">
                <p className="text-xs text-stone-500 dark:text-stone-400">{t('student.overallRate')}</p>
                <p
                  className={`mt-1.5 text-2xl font-bold tabular-nums ${
                    (analysis?.overallPercent ?? 100) < threshold && (analysis?.totalClasses ?? 0) > 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {formatNumber(analysis?.overallPercent ?? 0)}%
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-4">
                <p className="text-xs text-stone-500 dark:text-stone-400">{t('common.present')}</p>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatNumber(analysis?.presentCount ?? 0)}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-4">
                <p className="text-xs text-stone-500 dark:text-stone-400">{t('common.absent')}</p>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-red-700 dark:text-red-400">
                  {formatNumber(analysis?.absentCount ?? 0)}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-4">
                <p className="text-xs text-stone-500 dark:text-stone-400">{t('common.leave')}</p>
                <p className="mt-1.5 text-2xl font-bold tabular-nums text-sky-700 dark:text-sky-400">
                  {formatNumber(analysis?.leaveCount ?? 0)}
                </p>
              </div>
            </div>

            {/* Today's Lectures Schedule */}
            <section className="flex-1 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
              <div className="flex items-center justify-between mb-3.5">
                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-[#C25E00]" />
                  <span>{t('student.todaysLectures')}</span>
                </h3>
                <Link to="/timetable" className="text-xs font-medium text-[#C25E00] hover:underline">
                  {t('nav.timetable')}
                </Link>
              </div>

              {todayLectures.length === 0 ? (
                <p className="text-sm text-stone-500 dark:text-stone-400 py-4">
                  {t('student.noLecturesToday')}
                </p>
              ) : (
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  {todayLectures.map(({ slot, status, liveSession }) => (
                    <div
                      key={slot.id}
                      className="py-3 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                          {slot.subjectName}
                        </p>
                        <p className="text-xs text-stone-500 dark:text-stone-400 tabular-nums mt-0.5">
                          {slot.teacherName} · {formatTimeRange12h(slot.startTime, slot.endTime)}
                          {slot.classroom ? ` · ${slot.classroom}` : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {liveSession && status === 'not_started' && (
                          <Link
                            to={`/mark?tab=scan&sessionId=${liveSession.id}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 text-xs font-medium"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            <span>{t('session.liveBadge')}</span>
                          </Link>
                        )}
                        <span
                          className={`text-xs font-semibold uppercase ${
                            status === 'present'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : status === 'absent'
                              ? 'text-red-700 dark:text-red-400'
                              : status === 'leave'
                              ? 'text-sky-700 dark:text-sky-400'
                              : 'text-stone-400'
                          }`}
                        >
                          {status === 'not_started'
                            ? t('student.notStarted')
                            : t(`common.${status}`)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Subject-Wise Attendance Breakdown + Monthly Calendar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Subject-wise Breakdown */}
          <section className="lg:col-span-6 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2 mb-4">
              <BookOpen className="w-4 h-4 text-[#C25E00]" />
              <span>{t('student.subjectWiseTitle')}</span>
            </h3>

            {loading ? (
              <CardSkeleton rows={3} />
            ) : !analysis || analysis.subjects.length === 0 ? (
              <p className="text-sm text-stone-500 py-4">{t('common.noData')}</p>
            ) : (
              <div className="space-y-4">
                {analysis.subjects.map((sub) => (
                  <div key={sub.subjectId} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-stone-900 dark:text-stone-100 truncate">
                        {sub.subjectName}
                        {sub.subjectCode ? (
                          <span className="ml-1.5 font-mono text-xs text-stone-400">
                            {sub.subjectCode}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={`font-mono text-xs font-bold tabular-nums ${
                          sub.isShortage
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {sub.percentage}% ({sub.present}/{sub.total})
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          sub.isShortage ? 'bg-red-500' : 'bg-emerald-600'
                        }`}
                        style={{ width: `${Math.min(100, sub.percentage)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Monthly Calendar (Strictly Present / Absent / Leave) */}
          <section className="lg:col-span-6 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                {monthHeading}
              </h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={prevMonth}
                  aria-label={t('common.previous')}
                  className="p-1.5 rounded-lg border border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={nextMonth}
                  aria-label={t('common.next')}
                  className="p-1.5 rounded-lg border border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-medium text-stone-500 mb-2">
              {weekdayLabels.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {calendarDays.map((cell, idx) => {
                if (!cell.day || !cell.dateStr) return <div key={idx} />;
                const st = statusByDate.get(cell.dateStr);
                return (
                  <div
                    key={cell.dateStr}
                    title={st ? `${cell.dateStr}: ${t(`common.${st}`)}` : cell.dateStr}
                    className={`h-10 rounded-lg border flex flex-col items-center justify-center text-xs font-medium tabular-nums ${cellColors(
                      st
                    )} ${cell.dateStr === today ? 'ring-2 ring-[#C25E00]' : ''}`}
                  >
                    <span>{cell.day}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-stone-600 dark:text-stone-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-200 dark:bg-emerald-900 border border-emerald-400" />
                {t('common.present')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-red-200 dark:bg-red-900 border border-red-400" />
                {t('common.absent')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-sky-200 dark:bg-sky-900 border border-sky-400" />
                {t('common.leave')}
              </span>
            </div>
          </section>
        </div>

        {/* Attendance History + Leave History + Notices */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100 mb-4">
              {t('dashboard.recentHistory')}
            </h3>
            {loading ? (
              <CardSkeleton rows={4} />
            ) : records.length === 0 ? (
              <p className="text-sm text-stone-500 py-4">{t('common.noData')}</p>
            ) : (
              <div className="divide-y divide-stone-100 dark:divide-stone-800">
                {records.slice(0, 14).map((r) => (
                  <div key={r.id} className="py-3 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-stone-900 dark:text-stone-100 truncate">
                        {r.subjectName ? `${r.subjectName} · ` : ''}
                        {formatDate(r.date)}
                      </p>
                      <p className="text-xs text-stone-500 truncate">
                        {t(`common.${r.method}`)}
                        {r.teacherName ? ` · ${r.teacherName}` : ''}
                        {r.note ? ` · ${r.note}` : ''}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-semibold shrink-0 uppercase ${
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

          <div className="lg:col-span-5 space-y-6">
            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                  {t('leaves.myRequests')}
                </h3>
                <Link to="/leaves" className="text-xs font-medium text-[#C25E00] hover:underline">
                  {t('dashboard.viewAll')}
                </Link>
              </div>
              {leaves.length === 0 ? (
                <p className="text-sm text-stone-500">{t('leaves.empty')}</p>
              ) : (
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  {leaves.map((l) => (
                    <div key={l.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-stone-800 dark:text-stone-200 truncate">
                          {formatDate(l.fromDate)} – {formatDate(l.toDate)}
                        </p>
                        <p className="text-stone-500 truncate mt-0.5">{l.reason}</p>
                      </div>
                      <span
                        className={`font-semibold uppercase shrink-0 ${
                          l.status === 'approved'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : l.status === 'rejected'
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {t(`leaves.${l.status}`)}
                      </span>
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
                <p className="text-sm text-stone-500">{t('dashboard.noAnnouncements')}</p>
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
          roleLabel={memberLabel}
          onClose={() => setShowQrModal(false)}
        />
      )}
    </Layout>
  );
};
