import React, { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type { Announcement } from '../types';
import {
  deleteAnnouncement,
  fetchAnnouncements,
  postAnnouncement,
} from '../services/communicationService';
import { fetchManagerMembers, fetchOrgUsers } from '../services/userService';
import { getFirebaseErrorKey } from '../utils/helpers';
import { Layout } from '../components/Layout';
import { CardSkeleton, EmptyState } from '../components/Skeletons';

export const AnnouncementsPage: React.FC = () => {
  const { profile, org, getRoleLabel } = useAuth();
  const { t, formatTime } = useTranslation();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Announcement[]>([]);
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<'all' | 'managers' | 'members'>('all');
  const [posting, setPosting] = useState(false);

  const canPost = profile?.role === 'admin' || profile?.role === 'manager';

  const loadNotices = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const list = await fetchAnnouncements(profile);
      setItems(list);
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setLoading(false);
    }
  }, [profile, showToast, t]);

  useEffect(() => {
    loadNotices();
  }, [loadNotices]);

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !org || !text.trim()) return;
    setPosting(true);
    try {
      let recipientUids: string[] = [];
      if (profile.role === 'admin') {
        const users = await fetchOrgUsers(
          org.id,
          audience === 'managers' ? 'manager' : undefined
        );
        recipientUids = users.filter((u) => u.status === 'active').map((u) => u.uid);
      } else if (profile.role === 'manager') {
        const members = await fetchManagerMembers(org.id, profile.uid);
        recipientUids = members.filter((u) => u.status === 'active').map((u) => u.uid);
      }

      await postAnnouncement({
        author: profile,
        audience: profile.role === 'manager' ? 'members' : audience,
        text,
        recipientUids,
      });
      setText('');
      showToast(t('announcements.postedToast'), 'success');
      await loadNotices();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAnnouncement(id);
      showToast(t('announcements.deletedToast'), 'info');
      setItems((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    }
  };

  return (
    <Layout title={t('announcements.title')}>
      <div className="space-y-8 max-w-3xl">
        {canPost && (
          <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100 mb-4">
              {t('announcements.postTitle')}
            </h2>
            <form onSubmit={handlePost} className="space-y-4">
              <textarea
                rows={3}
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('announcements.placeholder')}
                className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm resize-none"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                {profile?.role === 'admin' ? (
                  <div className="flex items-center gap-2 text-sm">
                    <label className="text-xs text-stone-500">
                      {t('announcements.audienceLabel')}:
                    </label>
                    <select
                      value={audience}
                      onChange={(e) => setAudience(e.target.value as 'all' | 'managers')}
                      className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-1.5 text-xs"
                    >
                      <option value="all">{t('announcements.audienceAll')}</option>
                      <option value="managers">
                        {getRoleLabel('manager')} ({t('announcements.audienceManagers')})
                      </option>
                    </select>
                  </div>
                ) : (
                  <span className="text-xs text-stone-500">
                    {t('announcements.audienceLabel')}: {t('announcements.audienceMembers')}
                  </span>
                )}

                <button
                  type="submit"
                  disabled={posting}
                  className="rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white px-5 py-2 text-sm font-medium"
                >
                  {posting ? t('common.saving') : t('announcements.postBtn')}
                </button>
              </div>
            </form>
          </section>
        )}

        {loading ? (
          <CardSkeleton rows={4} />
        ) : items.length === 0 ? (
          <EmptyState
            title={t('announcements.emptyTitle')}
            description={t('announcements.emptyDesc')}
          />
        ) : (
          <div className="space-y-3">
            {items.map((a) => (
              <article
                key={a.id}
                className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="text-sm text-stone-900 dark:text-stone-100 leading-relaxed whitespace-pre-wrap">
                    {a.text}
                  </p>
                  {(profile?.role === 'admin' || a.fromUid === profile?.uid) && (
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      aria-label={t('common.delete')}
                      className="p-1.5 text-stone-400 hover:text-red-600 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                  <span className="font-medium text-stone-700 dark:text-stone-300">
                    {a.fromName}
                  </span>
                  <span>·</span>
                  <span>{formatTime(a.createdAt?.toDate?.())}</span>
                  {a.isDemo && (
                    <>
                      <span>·</span>
                      <span>{t('common.demo')}</span>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
};
