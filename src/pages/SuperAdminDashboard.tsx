import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, Globe, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import type { Organization } from '../types';
import { fetchAllOrganizations } from '../services/academicService';
import { Layout } from '../components/Layout';
import { CardSkeleton, EmptyState } from '../components/Skeletons';

export const SuperAdminDashboard: React.FC = () => {
  const { org } = useAuth();
  const { t, formatNumber } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<Organization[]>([]);

  useEffect(() => {
    setLoading(true);
    fetchAllOrganizations()
      .then(setOrgs)
      .catch(() => {
        if (org) setOrgs([org]);
      })
      .finally(() => setLoading(false));
  }, [org]);

  return (
    <Layout title={t('nav.organizations')}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {t('superAdmin.title')}
            </h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {t('superAdmin.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <Link
              to="/audit-logs"
              className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] px-3.5 py-2 text-xs font-medium"
            >
              <ShieldCheck className="w-4 h-4 text-[#C25E00]" />
              <span>{t('nav.auditLogs')}</span>
            </Link>
            <Link
              to="/admin"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2 text-xs font-medium"
            >
              <span>{t('superAdmin.openCurrentOrg')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
            <div className="flex items-center justify-between text-stone-500">
              <p className="text-xs">{t('superAdmin.totalOrgs')}</p>
              <Building2 className="w-4 h-4 text-[#C25E00]" />
            </div>
            <p className="mt-2 text-3xl font-bold tabular-nums">{formatNumber(orgs.length)}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
            <div className="flex items-center justify-between text-stone-500">
              <p className="text-xs">{t('superAdmin.activeWorkspace')}</p>
              <Globe className="w-4 h-4 text-[#C25E00]" />
            </div>
            <p className="mt-2 text-lg font-bold truncate">{org?.name || '—'}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
            <div className="flex items-center justify-between text-stone-500">
              <p className="text-xs">{t('dashboard.yourOrgCode')}</p>
              <KeyRound className="w-4 h-4 text-[#C25E00]" />
            </div>
            <p className="mt-2 text-2xl font-mono font-bold text-[#C25E00]">
              {org?.orgCode || '—'}
            </p>
          </div>
        </div>

        {loading ? (
          <CardSkeleton rows={4} />
        ) : orgs.length === 0 ? (
          <EmptyState title={t('common.noData')} description={t('superAdmin.subtitle')} />
        ) : (
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] overflow-hidden">
            {/* Mobile Card List */}
            <div className="md:hidden divide-y divide-stone-100 dark:divide-stone-800">
              {orgs.map((o) => (
                <div key={o.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="w-4 h-4 text-[#C25E00] shrink-0" />
                      <p className="font-semibold text-sm text-stone-900 dark:text-stone-100 truncate">
                        {o.name}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase shrink-0">
                      {o.status || 'active'}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 tabular-nums">
                    <span>{o.type}</span>
                    <span className="font-mono text-stone-700 dark:text-stone-300">{o.orgCode}</span>
                    <span className="font-mono">{o.lowAttendanceThreshold ?? 75}%</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/50 text-xs text-stone-500">
                  <tr>
                    <th className="py-3 px-4 font-medium">{t('auth.orgNameLabel')}</th>
                    <th className="py-3 px-4 font-medium">{t('auth.orgTypeLabel')}</th>
                    <th className="py-3 px-4 font-medium">{t('dashboard.yourOrgCode')}</th>
                    <th className="py-3 px-4 font-medium">{t('settings.lowAttendanceThreshold')}</th>
                    <th className="py-3 px-4 font-medium">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {orgs.map((o) => (
                    <tr key={o.id} className="hover:bg-stone-50/50 dark:hover:bg-stone-800/30">
                      <td className="py-3 px-4 font-medium flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-[#C25E00] shrink-0" />
                        <span>{o.name}</span>
                      </td>
                      <td className="py-3 px-4 text-xs text-stone-500">{o.type}</td>
                      <td className="py-3 px-4 font-mono text-xs">{o.orgCode}</td>
                      <td className="py-3 px-4 font-mono text-xs tabular-nums">
                        {o.lowAttendanceThreshold ?? 75}%
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase">
                        {o.status || 'active'}
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
