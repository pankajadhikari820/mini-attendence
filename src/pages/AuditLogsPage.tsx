import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { FileSpreadsheet, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type { AuditLog } from '../types';
import { fetchAuditLogs } from '../services/auditService';
import { getFirebaseErrorKey } from '../utils/helpers';
import { Layout } from '../components/Layout';
import { CardSkeleton, EmptyState } from '../components/Skeletons';

export const AuditLogsPage: React.FC = () => {
  const { org } = useAuth();
  const { t, formatTime } = useTranslation();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');

  const loadLogs = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    try {
      const list = await fetchAuditLogs(org.id, 250);
      setLogs(list);
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setLoading(false);
    }
  }, [org, showToast, t]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (category !== 'all' && !log.action.startsWith(category)) return false;
      if (!q) return true;
      return (
        log.actorName.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        log.summary.toLowerCase().includes(q)
      );
    });
  }, [logs, search, category]);

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(
      filtered.map((l) => ({
        Timestamp: l.createdAt?.toDate ? l.createdAt.toDate().toISOString() : '',
        Actor: l.actorName,
        Role: l.actorRole,
        Action: l.action,
        TargetType: l.targetType,
        TargetId: l.targetId,
        Summary: l.summary,
      }))
    );
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Logs');
    XLSX.writeFile(wb, `audit_logs_${org?.orgCode || 'org'}.xlsx`);
  };

  return (
    <Layout title={t('nav.auditLogs')}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50 flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-[#C25E00]" />
              <span>{t('audit.title')}</span>
            </h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {t('audit.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadLogs}
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2 text-xs font-medium"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t('mark.refreshSession')}</span>
            </button>
            <button
              type="button"
              disabled={filtered.length === 0}
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-50 text-white px-3.5 py-2 text-xs font-medium"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('audit.searchPlaceholder')}
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] pl-10 pr-4 py-2.5 text-sm"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] px-3 py-2.5 text-sm"
          >
            <option value="all">{t('audit.allActions')}</option>
            <option value="session.">Sessions</option>
            <option value="attendance.">Attendance</option>
            <option value="user.">Users</option>
            <option value="leave.">Leaves</option>
            <option value="academic.">Academics</option>
            <option value="timetable.">Timetable</option>
            <option value="parent.">Parent Links</option>
            <option value="alert.">Low Attendance Alerts</option>
            <option value="settings.">Settings</option>
          </select>
        </div>

        {loading ? (
          <CardSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <EmptyState title={t('audit.emptyTitle')} description={t('audit.subtitle')} />
        ) : (
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/50 text-xs text-stone-500">
                  <tr>
                    <th className="py-3 px-4 font-medium">{t('audit.time')}</th>
                    <th className="py-3 px-4 font-medium">{t('audit.actor')}</th>
                    <th className="py-3 px-4 font-medium">{t('audit.action')}</th>
                    <th className="py-3 px-4 font-medium">{t('audit.summary')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {filtered.map((log) => (
                    <tr key={log.id} className="hover:bg-stone-50/50 dark:hover:bg-stone-800/30">
                      <td className="py-3 px-4 text-xs font-mono text-stone-500 whitespace-nowrap tabular-nums">
                        {log.createdAt?.toDate
                          ? `${log.createdAt.toDate().toLocaleDateString()} ${formatTime(log.createdAt.toDate())}`
                          : '—'}
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        <p className="font-medium text-stone-900 dark:text-stone-100">
                          {log.actorName}
                        </p>
                        <p className="text-stone-400 uppercase text-[10px]">{log.actorRole}</p>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-[#C25E00] whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-3 px-4 text-xs text-stone-700 dark:text-stone-300">
                        {log.summary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};
