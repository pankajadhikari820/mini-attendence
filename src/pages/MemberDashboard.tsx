import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ChevronLeft, ChevronRight, QrCode } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type { Announcement, AttendanceRecord } from '../types';
import { fetchAttendanceForPerson } from '../services/attendanceService';
import { fetchAnnouncements } from '../services/communicationService';
import { getFirebaseErrorKey, getOrgDateString } from '../utils/helpers';
import { Layout } from '../components/Layout';
import { QRCardModal } from '../components/QRCardModal';
import { CardSkeleton } from '../components/Skeletons';

export const MemberDashboard: React.FC = () => {
  const { profile, org, getRoleLabel } = useAuth();
  const { t, formatDate, formatNumber, language } = useTranslation();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [showQrModal, setShowQrModal] = useState(false);

  const today = useMemo(() => getOrgDateString(org?.timezone || 'Asia/Kolkata'), [org?.timezone]);
  const [calYear, setCalYear] = useState(() => Number(today.slice(0, 4)));
  const [calMonth, setCalMonth] = useState(() => Number(today.slice(5, 7)) - 1); // 0-indexed

  const memberLabel = getRoleLabel('member');

  const loadData = useCallback(async () => {
    if (!org || !profile) return;
    setLoading(true);
    try {
      const [recs, notices] = await Promise.all([
        fetchAttendanceForPerson(org.id, profile.uid),
        fetchAnnouncements(profile),
      ]);
      setRecords(recs);
      setAnnouncements(notices.slice(0, 4));
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setLoading(false);
    }
  }, [org, profile, showToast, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const recordByDate = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const r of records) map.set(r.date, r);
    return map;
  }, [records]);

  const todayRecord = recordByDate.get(today);

  const monthPrefix = `${today.slice(0, 7)}`;
  const monthlyStats = useMemo(() => {
    const monthRecs = records.filter((r) => r.date.startsWith(monthPrefix));
    const attended = monthRecs.filter((r) => r.status === 'present' || r.status === 'late').length;
    const pct = monthRecs.length > 0 ? Math.round((attended / monthRecs.length) * 100) : 0;
    return { attended, total: monthRecs.length, pct };
  }, [records, monthPrefix]);

  // Current consecutive streak of Present or Late
  const streak = useMemo(() => {
    const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
    let count = 0;
    for (const r of sorted) {
      if (r.status === 'present' || r.status === 'late') {
        count++;
      } else if (r.status === 'absent') {
        break;
      }
    }
    return count;
  }, [records]);

  // Calendar Grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    const startWeekday = firstDay.getDay(); // 0=Sun
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
      ? JSON.stringify({ orgId: org.id, uid: profile.uid, memberId: profile.memberId })
      : '';

  const cellColors = (status?: string) => {
    if (status === 'present')
      return 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800';
    if (status === 'absent')
      return 'bg-red-100 dark:bg-red-950/60 text-red-900 dark:text-red-200 border-red-200 dark:border-red-800';
    if (status === 'late' || status === 'leave')
      return 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800';
    return 'bg-stone-50 dark:bg-stone-900/50 text-stone-600 dark:text-stone-400 border-stone-200/70 dark:border-stone-800';
  };

  const weekdayLabels =
    language === 'hi'
      ? ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <Layout title={t('nav.myQr')}>
      <div className="space-y-8">
        {/* Top Row: QR Card + Key Metrics */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-5 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6 flex flex-col items-center justify-between text-center">
            <div>
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                {org?.name}
              </p>
              <h2 className="mt-1 text-xl font-bold text-stone-900 dark:text-stone-100">
                {profile?.name}
              </h2>
              <p className="mt-0.5 text-xs font-mono text-stone-500 dark:text-stone-400">
                {profile?.memberId} · {memberLabel}
              </p>
            </div>

            <div className="my-5 p-4 rounded-xl bg-white border border-stone-200">
              {qrValue && <QRCodeSVG value={qrValue} size={172} level="M" />}
            </div>

            <button
              type="button"
              onClick={() => setShowQrModal(true)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2.5 text-sm font-medium transition-colors"
            >
              <QrCode className="w-4 h-4" />
              <span>
                {t('qr.downloadQr')} / {t('qr.printCard')}
              </span>
            </button>
          </div>

          <div className="lg:col-span-7 flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
                <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                  {t('dashboard.todayStatus')}
                </p>
                <p className="mt-2 text-2xl font-bold text-stone-900 dark:text-stone-100">
                  {todayRecord ? t(`common.${todayRecord.status}`) : t('common.unmarked')}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
                <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                  {t('dashboard.myAttendanceRate')}
                </p>
                <p className="mt-2 text-3xl font-bold tabular-nums text-stone-900 dark:text-stone-100">
                  {formatNumber(monthlyStats.pct)}%
                </p>
                <p className="mt-1 text-xs text-stone-500 tabular-nums">
                  {formatNumber(monthlyStats.attended)} / {formatNumber(monthlyStats.total)} {t('common.days')}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
                <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                  {t('dashboard.currentStreak')}
                </p>
                <p className="mt-2 text-3xl font-bold tabular-nums text-[#C25E00]">
                  {formatNumber(streak)}
                </p>
                <p className="mt-1 text-xs text-stone-500">{t('common.days')}</p>
              </div>
            </div>

            {/* Monthly Calendar */}
            <section className="flex-1 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
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
                  const rec = recordByDate.get(cell.dateStr);
                  return (
                    <div
                      key={cell.dateStr}
                      title={rec ? `${cell.dateStr}: ${t(`common.${rec.status}`)}` : cell.dateStr}
                      className={`h-10 rounded-lg border flex flex-col items-center justify-center text-xs font-medium tabular-nums ${cellColors(
                        rec?.status
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
                  <span className="w-3 h-3 rounded bg-amber-200 dark:bg-amber-900 border border-amber-400" />
                  {t('common.late')} / {t('common.leave')}
                </span>
              </div>
            </section>
          </div>
        </div>

        {/* History + Notices */}
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
                {records.slice(0, 12).map((r) => (
                  <div key={r.id} className="py-3 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <p className="font-medium text-stone-900 dark:text-stone-100">
                        {formatDate(r.date)}
                      </p>
                      <p className="text-xs text-stone-500">
                        {t(`common.${r.method}`)}
                        {r.note ? ` · ${r.note}` : ''}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        r.status === 'present'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : r.status === 'absent'
                          ? 'text-red-700 dark:text-red-400'
                          : 'text-amber-700 dark:text-amber-400'
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
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100 mb-4">
              {t('dashboard.recentAnnouncements')}
            </h3>
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
