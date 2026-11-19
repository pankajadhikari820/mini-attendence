import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type { LeaveRequest } from '../types';
import {
  createLeaveRequest,
  decideLeaveRequest,
  fetchLeavesForUser,
} from '../services/leaveService';
import { getFirebaseErrorKey, getOrgDateString } from '../utils/helpers';
import { Layout } from '../components/Layout';
import { CardSkeleton, EmptyState } from '../components/Skeletons';

export const LeavesPage: React.FC = () => {
  const { profile, org } = useAuth();
  const { t, formatDate } = useTranslation();
  const { showToast } = useToast();

  const today = useMemo(() => getOrgDateString(org?.timezone || 'Asia/Kolkata'), [org?.timezone]);

  const [loading, setLoading] = useState(true);
  const [myLeaves, setMyLeaves] = useState<LeaveRequest[]>([]);
  const [teamLeaves, setTeamLeaves] = useState<LeaveRequest[]>([]);

  // Request form
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Review comments by leave ID
  const [comments, setComments] = useState<Record<string, string>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const loadLeaves = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const res = await fetchLeavesForUser(profile);
      setMyLeaves(res.myLeaves);
      setTeamLeaves(res.teamLeaves);
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setLoading(false);
    }
  }, [profile, showToast, t]);

  useEffect(() => {
    loadLeaves();
  }, [loadLeaves]);

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !profile) return;
    if (toDate < fromDate) {
      showToast(t('leaves.invalidRange'), 'error');
      return;
    }
    if (!reason.trim()) {
      showToast(t('errors.requiredFields'), 'error');
      return;
    }
    setSubmitting(true);
    try {
      await createLeaveRequest({
        org,
        requester: profile,
        fromDate,
        toDate,
        reason,
      });
      setReason('');
      showToast(t('leaves.submittedToast'), 'success');
      await loadLeaves();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecision = async (leave: LeaveRequest, decision: 'approved' | 'rejected') => {
    if (!profile) return;
    setDecidingId(leave.id);
    try {
      await decideLeaveRequest({
        leave,
        decision,
        comment: comments[leave.id] || '',
        decidedBy: profile,
      });
      showToast(
        decision === 'approved' ? t('leaves.approvedToast') : t('leaves.rejectedToast'),
        decision === 'approved' ? 'success' : 'info'
      );
      await loadLeaves();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setDecidingId(null);
    }
  };

  const statusColor = (s: LeaveRequest['status']) => {
    if (s === 'approved') return 'text-emerald-700 dark:text-emerald-400';
    if (s === 'rejected') return 'text-red-700 dark:text-red-400';
    return 'text-amber-700 dark:text-amber-400';
  };

  return (
    <Layout title={t('leaves.title')}>
      <div className="space-y-8">
        {/* Request Leave Form (Member & Manager) */}
        {profile?.role !== 'admin' && (
          <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100 mb-4">
              {t('leaves.requestLeave')}
            </h2>
            <form onSubmit={handleRequestSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                    {t('leaves.fromDate')}
                  </label>
                  <input
                    type="date"
                    required
                    value={fromDate}
                    onChange={(e) => {
                      setFromDate(e.target.value);
                      if (toDate < e.target.value) setToDate(e.target.value);
                    }}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                    {t('leaves.toDate')}
                  </label>
                  <input
                    type="date"
                    required
                    min={fromDate}
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                  {t('leaves.reason')}
                </label>
                <textarea
                  rows={2}
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t('leaves.reasonPlaceholder')}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm resize-none"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white px-5 py-2.5 text-sm font-medium"
              >
                {submitting ? t('common.saving') : t('leaves.submitRequest')}
              </button>
            </form>
          </section>
        )}

        {/* Team Requests to Review (Admin & Manager) */}
        {(profile?.role === 'admin' || profile?.role === 'manager') && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
              {t('leaves.teamRequests')}
            </h2>

            {loading ? (
              <CardSkeleton rows={3} />
            ) : teamLeaves.length === 0 ? (
              <EmptyState title={t('leaves.emptyTitle')} description={t('leaves.emptyDesc')} />
            ) : (
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] divide-y divide-stone-100 dark:divide-stone-800">
                {teamLeaves.map((leave) => (
                  <div key={leave.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-semibold text-stone-900 dark:text-stone-100">
                          {leave.personName}
                        </span>
                        <span className="text-stone-400">·</span>
                        <span className={`text-xs font-semibold ${statusColor(leave.status)}`}>
                          {t(`common.${leave.status}`)}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-stone-500">
                        {formatDate(leave.fromDate)} — {formatDate(leave.toDate)}
                      </p>
                      <p className="text-sm text-stone-700 dark:text-stone-300">{leave.reason}</p>
                      {leave.comment && (
                        <p className="text-xs text-stone-500 italic">{leave.comment}</p>
                      )}
                    </div>

                    {leave.status === 'pending' && (
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                        <input
                          type="text"
                          value={comments[leave.id] || ''}
                          onChange={(e) =>
                            setComments((prev) => ({ ...prev, [leave.id]: e.target.value }))
                          }
                          placeholder={t('leaves.commentPlaceholder')}
                          className="rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-xs w-full sm:w-44"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={decidingId === leave.id}
                            onClick={() => handleDecision(leave, 'approved')}
                            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-medium"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{t('dashboard.approve')}</span>
                          </button>
                          <button
                            type="button"
                            disabled={decidingId === leave.id}
                            onClick={() => handleDecision(leave, 'rejected')}
                            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:text-red-600 px-3.5 py-2 text-xs font-medium"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>{t('dashboard.reject')}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* My Requests */}
        {profile?.role !== 'admin' && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
              {t('leaves.myRequests')}
            </h2>

            {loading ? (
              <CardSkeleton rows={3} />
            ) : myLeaves.length === 0 ? (
              <EmptyState title={t('leaves.emptyTitle')} description={t('leaves.emptyDesc')} />
            ) : (
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] divide-y divide-stone-100 dark:divide-stone-800">
                {myLeaves.map((leave) => (
                  <div key={leave.id} className="p-5 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
                        {formatDate(leave.fromDate)} — {formatDate(leave.toDate)}
                      </p>
                      <p className="text-sm text-stone-600 dark:text-stone-400">{leave.reason}</p>
                      {leave.comment && (
                        <p className="text-xs text-stone-500">
                          {t('common.note')}: {leave.comment}
                        </p>
                      )}
                    </div>
                    <span className={`text-xs font-semibold shrink-0 ${statusColor(leave.status)}`}>
                      {t(`common.${leave.status}`)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </Layout>
  );
};
