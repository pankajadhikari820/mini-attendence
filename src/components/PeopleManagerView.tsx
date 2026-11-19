import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import {
  Check,
  Copy,
  Edit2,
  Plus,
  QrCode,
  Search,
  Trash2,
  Upload,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type { UserProfile } from '../types';
import {
  addPersonDirect,
  approvePendingUser,
  deleteUserProfile,
  fetchManagerMembers,
  fetchOrgUsers,
  rejectPendingUser,
  setUserStatus,
  updateUserDetails,
} from '../services/userService';
import { getFirebaseErrorKey } from '../utils/helpers';
import { Layout } from './Layout';
import { QRCardModal } from './QRCardModal';
import { CardSkeleton, EmptyState } from './Skeletons';

interface PeopleManagerViewProps {
  targetRole: 'manager' | 'member';
  adminViewingAllMembers?: boolean;
}

interface CsvPreviewRow {
  rowNum: number;
  name: string;
  email: string;
  phone: string;
  rollNumber: string;
  error?: string;
}

const PAGE_SIZE = 10;

export const PeopleManagerView: React.FC<PeopleManagerViewProps> = ({
  targetRole,
  adminViewingAllMembers = false,
}) => {
  const { profile, org, getRoleLabel } = useAuth();
  const { t, formatNumber } = useTranslation();
  const { showToast } = useToast();

  const roleLabel = getRoleLabel(targetRole);
  const managerLabel = getRoleLabel('manager');

  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [managers, setManagers] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'inactive'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'memberId'>('name');
  const [page, setPage] = useState(1);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [editingPerson, setEditingPerson] = useState<UserProfile | null>(null);
  const [qrPerson, setQrPerson] = useState<UserProfile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserProfile | null>(null);
  const [copied, setCopied] = useState(false);

  // Add / Edit form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formRoll, setFormRoll] = useState('');
  const [formManagerId, setFormManagerId] = useState('');
  const [saving, setSaving] = useState(false);

  // CSV import state
  const [csvRows, setCsvRows] = useState<CsvPreviewRow[]>([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvProgress, setCsvProgress] = useState({ done: 0, total: 0, failed: 0 });

  const loadPeople = useCallback(async () => {
    if (!org || !profile) return;
    setLoading(true);
    try {
      if (targetRole === 'manager') {
        const list = await fetchOrgUsers(org.id, 'manager');
        setPeople(list);
      } else if (adminViewingAllMembers) {
        const [mems, mgrs] = await Promise.all([
          fetchOrgUsers(org.id, 'member'),
          fetchOrgUsers(org.id, 'manager'),
        ]);
        setPeople(mems);
        setManagers(mgrs.filter((m) => m.status === 'active'));
      } else {
        const list = await fetchManagerMembers(org.id, profile.uid);
        setPeople(list);
      }
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setLoading(false);
    }
  }, [org, profile, targetRole, adminViewingAllMembers, showToast, t]);

  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  const managerNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of managers) map.set(m.uid, m.name);
    return map;
  }, [managers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people
      .filter((p) => {
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q) ||
          (p.memberId || '').toLowerCase().includes(q) ||
          (p.rollNumber || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        sortBy === 'name'
          ? a.name.localeCompare(b.name)
          : (a.memberId || '').localeCompare(b.memberId || '')
      );
  }, [people, search, statusFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, sortBy]);

  const inviteCode =
    targetRole === 'manager'
      ? org?.orgCode
      : !adminViewingAllMembers
      ? profile?.managerCode
      : undefined;

  const handleCopyInvite = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const openAddModal = () => {
    setFormName('');
    setFormEmail('');
    setFormPhone('');
    setFormRoll('');
    setFormManagerId(managers[0]?.uid || '');
    setShowAddModal(true);
  };

  const openEditModal = (p: UserProfile) => {
    setEditingPerson(p);
    setFormName(p.name);
    setFormPhone(p.phone || '');
    setFormRoll(p.rollNumber || '');
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !profile) return;
    if (!formName.trim() || !formEmail.trim()) {
      showToast(t('errors.requiredFields'), 'error');
      return;
    }
    setSaving(true);
    try {
      const assignedManagerId =
        targetRole === 'member'
          ? adminViewingAllMembers
            ? formManagerId || null
            : profile.uid
          : null;

      const { resetEmailSent } = await addPersonDirect({
        org,
        role: targetRole,
        managerId: assignedManagerId,
        name: formName,
        email: formEmail,
        phone: formPhone,
        rollNumber: formRoll,
      });

      showToast(
        resetEmailSent ? t('people.personAdded') : t('people.personAddedNoEmail'),
        'success'
      );
      setShowAddModal(false);
      await loadPeople();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPerson) return;
    setSaving(true);
    try {
      await updateUserDetails(editingPerson.uid, {
        name: formName.trim(),
        phone: formPhone.trim(),
        rollNumber: formRoll.trim(),
      });
      showToast(t('people.personUpdated'), 'success');
      setEditingPerson(null);
      await loadPeople();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (p: UserProfile) => {
    const next = p.status === 'active' ? 'inactive' : 'active';
    try {
      await setUserStatus(p.uid, next);
      showToast(t('people.personUpdated'), 'success');
      await loadPeople();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    }
  };

  const handleApprove = async (p: UserProfile) => {
    if (!org) return;
    try {
      await approvePendingUser(org, p);
      showToast(t('people.approvedToast'), 'success');
      await loadPeople();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    }
  };

  const handleReject = async (p: UserProfile) => {
    if (!org) return;
    try {
      await rejectPendingUser(org.id, p);
      showToast(t('people.rejectedToast'), 'info');
      await loadPeople();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteUserProfile(confirmDelete);
      showToast(t('people.personRemoved'), 'success');
      setConfirmDelete(null);
      await loadPeople();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    }
  };

  // CSV Handling
  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const seenEmails = new Set(people.map((p) => p.email.toLowerCase()));
        const parsed: CsvPreviewRow[] = res.data.map((row, idx) => {
          const name = (row.name || row.Name || '').trim();
          const email = (row.email || row.Email || '').trim().toLowerCase();
          const phone = (row.phone || row.Phone || '').trim();
          const rollNumber = (row.rollNumber || row.roll || row.employeeId || '').trim();

          let error: string | undefined;
          if (!name) error = t('people.csvMissingName');
          else if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            error = t('people.csvInvalidEmail');
          } else if (seenEmails.has(email)) {
            error = t('errors.emailInUse');
          } else {
            seenEmails.add(email);
          }

          return { rowNum: idx + 1, name, email, phone, rollNumber, error };
        });
        setCsvRows(parsed);
      },
    });
  };

  const handleDownloadSampleCsv = () => {
    const csv = 'name,email,phone,rollNumber\nAarav Sharma,aarav@example.com,9810012345,101\nDiya Patel,diya@example.com,9810012346,102\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sample_${targetRole}s.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportCsv = async () => {
    if (!org || !profile) return;
    const valid = csvRows.filter((r) => !r.error);
    if (valid.length === 0) return;

    setCsvImporting(true);
    setCsvProgress({ done: 0, total: valid.length, failed: 0 });
    let failed = 0;
    const updatedRows = [...csvRows];

    for (let i = 0; i < valid.length; i++) {
      const row = valid[i];
      try {
        const assignedManagerId =
          targetRole === 'member'
            ? adminViewingAllMembers
              ? formManagerId || managers[0]?.uid || null
              : profile.uid
            : null;
        await addPersonDirect({
          org,
          role: targetRole,
          managerId: assignedManagerId,
          name: row.name,
          email: row.email,
          phone: row.phone,
          rollNumber: row.rollNumber,
        });
      } catch (err) {
        failed++;
        const idx = updatedRows.findIndex((r) => r.rowNum === row.rowNum);
        if (idx >= 0) updatedRows[idx] = { ...updatedRows[idx], error: t(getFirebaseErrorKey(err)) };
      }
      setCsvProgress({ done: i + 1, total: valid.length, failed });
    }

    setCsvRows(updatedRows);
    setCsvImporting(false);
    showToast(t('people.csvDone'), failed === 0 ? 'success' : 'info');
    await loadPeople();
    if (failed === 0) {
      setShowCsvModal(false);
      setCsvRows([]);
    }
  };

  const validCsvCount = csvRows.filter((r) => !r.error).length;
  const invalidCsvCount = csvRows.length - validCsvCount;

  return (
    <Layout title={roleLabel}>
      <div className="space-y-6">
        {/* Top Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {roleLabel}
            </h2>
            {inviteCode && (
              <div className="mt-1.5 flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                <span>{t('people.inviteCode')}:</span>
                <span className="font-mono font-semibold text-stone-900 dark:text-stone-100">
                  {inviteCode}
                </span>
                <button
                  type="button"
                  onClick={handleCopyInvite}
                  className="inline-flex items-center gap-1 text-[#C25E00] hover:underline"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? t('common.copied') : t('common.copy')}</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {(!adminViewingAllMembers || managers.length > 0) && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setCsvRows([]);
                    setFormManagerId(managers[0]?.uid || '');
                    setShowCsvModal(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2 text-sm font-medium transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  <span>{t('people.bulkImport')}</span>
                </button>
                <button
                  type="button"
                  onClick={openAddModal}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-4 py-2 text-sm font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>
                    {t('people.addPerson')} {roleLabel}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Search & Filter Row */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search')}
              className="w-full rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] px-3 py-2.5 text-sm"
            >
              <option value="all">{t('people.statusAll')}</option>
              <option value="active">{t('common.active')}</option>
              <option value="pending">{t('common.pending')}</option>
              <option value="inactive">{t('common.inactive')}</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'memberId')}
              className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] px-3 py-2.5 text-sm"
            >
              <option value="name">{t('common.name')}</option>
              <option value="memberId">{t('common.memberId')}</option>
            </select>
          </div>
        </div>

        {/* Table / List */}
        {loading ? (
          <CardSkeleton rows={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={t('people.emptyTitle')}
            description={t('people.emptyDesc')}
            actionLabel={
              !adminViewingAllMembers || managers.length > 0
                ? `${t('people.addPerson')} ${roleLabel}`
                : undefined
            }
            onAction={openAddModal}
          />
        ) : (
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/50 text-xs text-stone-500 dark:text-stone-400">
                  <tr>
                    <th className="py-3 px-4 font-medium">{t('common.name')}</th>
                    <th className="py-3 px-4 font-medium">{t('common.memberId')}</th>
                    {adminViewingAllMembers && (
                      <th className="py-3 px-4 font-medium">{managerLabel}</th>
                    )}
                    <th className="py-3 px-4 font-medium">{t('common.phone')}</th>
                    <th className="py-3 px-4 font-medium">{t('common.status')}</th>
                    <th className="py-3 px-4 font-medium text-right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {paginated.map((person) => (
                    <tr
                      key={person.uid}
                      className="hover:bg-stone-50/70 dark:hover:bg-stone-800/30 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <p className="font-medium text-stone-900 dark:text-stone-100">
                          {person.name}
                          {person.isDemo && (
                            <span className="ml-2 text-xs font-normal text-stone-400">
                              · {t('common.demo')}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-stone-500 dark:text-stone-400">
                          {person.email}
                          {person.rollNumber ? ` · #${person.rollNumber}` : ''}
                        </p>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-stone-700 dark:text-stone-300 whitespace-nowrap">
                        {person.memberId || '—'}
                        {person.managerCode && (
                          <div className="text-[11px] text-stone-400 mt-0.5">
                            Code: {person.managerCode}
                          </div>
                        )}
                      </td>
                      {adminViewingAllMembers && (
                        <td className="py-3 px-4 text-xs text-stone-600 dark:text-stone-400">
                          {(person.managerId && managerNameMap.get(person.managerId)) || '—'}
                        </td>
                      )}
                      <td className="py-3 px-4 text-xs text-stone-600 dark:text-stone-400 tabular-nums whitespace-nowrap">
                        {person.phone || '—'}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium whitespace-nowrap">
                        <span
                          className={
                            person.status === 'active'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : person.status === 'pending'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-stone-400'
                          }
                        >
                          {t(`common.${person.status}`)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {person.status === 'pending' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleApprove(person)}
                                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 text-xs font-medium"
                              >
                                {t('dashboard.approve')}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReject(person)}
                                className="rounded-lg border border-stone-200 dark:border-stone-700 px-2 py-1 text-xs text-stone-600 hover:text-red-600"
                              >
                                {t('dashboard.reject')}
                              </button>
                            </>
                          ) : (
                            <>
                              {person.status === 'active' && (
                                <button
                                  type="button"
                                  onClick={() => setQrPerson(person)}
                                  title={t('people.viewQr')}
                                  aria-label={t('people.viewQr')}
                                  className="p-2 rounded-lg text-stone-500 hover:text-[#C25E00] hover:bg-stone-100 dark:hover:bg-stone-800"
                                >
                                  <QrCode className="w-4 h-4" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditModal(person)}
                                title={t('common.edit')}
                                aria-label={t('common.edit')}
                                className="p-2 rounded-lg text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleStatus(person)}
                                title={
                                  person.status === 'active'
                                    ? t('people.deactivate')
                                    : t('people.activate')
                                }
                                aria-label={
                                  person.status === 'active'
                                    ? t('people.deactivate')
                                    : t('people.activate')
                                }
                                className="p-2 rounded-lg text-stone-500 hover:text-amber-700 hover:bg-stone-100 dark:hover:bg-stone-800"
                              >
                                {person.status === 'active' ? (
                                  <UserX className="w-4 h-4" />
                                ) : (
                                  <UserCheck className="w-4 h-4" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDelete(person)}
                                title={t('people.remove')}
                                aria-label={t('people.remove')}
                                className="p-2 rounded-lg text-stone-500 hover:text-red-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between text-xs text-stone-500">
                <span className="tabular-nums">
                  {t('common.page')} {formatNumber(page)} {t('common.of')} {formatNumber(totalPages)}
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
        )}
      </div>

      {/* Add Person Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">
                {t('people.addPerson')} {roleLabel}
              </h3>
              <button type="button" onClick={() => setShowAddModal(false)}>
                <X className="w-5 h-5 text-stone-400" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.name')}</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.email')}</label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('common.phone')}</label>
                  <input
                    type="tel"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('common.rollNumber')}</label>
                  <input
                    type="text"
                    value={formRoll}
                    onChange={(e) => setFormRoll(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                  />
                </div>
              </div>

              {adminViewingAllMembers && managers.length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-1">{managerLabel}</label>
                  <select
                    value={formManagerId}
                    onChange={(e) => setFormManagerId(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2 text-sm"
                  >
                    {managers.map((m) => (
                      <option key={m.uid} value={m.uid}>
                        {m.name} ({m.memberId})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <p className="text-xs text-stone-500 dark:text-stone-400">
                {t('people.passwordResetNote')}
              </p>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-xl border border-stone-200 dark:border-stone-700 px-4 py-2 text-sm font-medium"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white px-4 py-2 text-sm font-medium"
                >
                  {saving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Person Modal */}
      {editingPerson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">{t('people.editPerson')}</h3>
              <button type="button" onClick={() => setEditingPerson(null)}>
                <X className="w-5 h-5 text-stone-400" />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.name')}</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.phone')}</label>
                <input
                  type="tel"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.rollNumber')}</label>
                <input
                  type="text"
                  value={formRoll}
                  onChange={(e) => setFormRoll(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingPerson(null)}
                  className="rounded-xl border border-stone-200 dark:border-stone-700 px-4 py-2 text-sm font-medium"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-[#C25E00] text-white px-4 py-2 text-sm font-medium"
                >
                  {saving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk CSV Import Modal */}
      {showCsvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6 shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">{t('people.csvTitle')}</h3>
              <button type="button" onClick={() => setShowCsvModal(false)}>
                <X className="w-5 h-5 text-stone-400" />
              </button>
            </div>
            <p className="text-sm text-stone-500 dark:text-stone-400">{t('people.csvHint')}</p>

            {adminViewingAllMembers && managers.length > 0 && (
              <div className="mt-3">
                <label className="block text-xs font-medium mb-1">{managerLabel}</label>
                <select
                  value={formManagerId}
                  onChange={(e) => setFormManagerId(e.target.value)}
                  className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-1.5 text-sm"
                >
                  {managers.map((m) => (
                    <option key={m.uid} value={m.uid}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 px-4 py-2 text-sm font-medium cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>{t('people.csvSelectFile')}</span>
                <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} className="hidden" />
              </label>
              <button
                type="button"
                onClick={handleDownloadSampleCsv}
                className="text-xs font-medium text-[#C25E00] hover:underline"
              >
                {t('people.csvDownloadSample')}
              </button>
            </div>

            {csvRows.length > 0 && (
              <>
                <div className="mt-4 flex items-center gap-4 text-xs text-stone-600 dark:text-stone-400">
                  <span>
                    {t('people.csvValid')}: <strong className="text-emerald-700">{validCsvCount}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    {t('people.csvInvalid')}: <strong className="text-red-600">{invalidCsvCount}</strong>
                  </span>
                </div>

                <div className="mt-3 flex-1 overflow-auto rounded-xl border border-stone-200 dark:border-stone-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-stone-50 dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800">
                      <tr>
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">{t('common.name')}</th>
                        <th className="py-2 px-3">{t('common.email')}</th>
                        <th className="py-2 px-3">{t('common.phone')}</th>
                        <th className="py-2 px-3">{t('common.status')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                      {csvRows.map((row) => (
                        <tr key={row.rowNum}>
                          <td className="py-2 px-3 tabular-nums">{row.rowNum}</td>
                          <td className="py-2 px-3">{row.name || '—'}</td>
                          <td className="py-2 px-3">{row.email || '—'}</td>
                          <td className="py-2 px-3">{row.phone || '—'}</td>
                          <td className="py-2 px-3">
                            {row.error ? (
                              <span className="text-red-600 font-medium">{row.error}</span>
                            ) : (
                              <span className="text-emerald-700 font-medium">{t('people.csvValid')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-stone-500">
                    {csvImporting
                      ? `${t('people.csvImporting')} ${csvProgress.done}/${csvProgress.total}`
                      : t('people.passwordResetNote')}
                  </span>
                  <button
                    type="button"
                    disabled={csvImporting || validCsvCount === 0}
                    onClick={handleImportCsv}
                    className="rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-50 text-white px-4 py-2 text-sm font-medium whitespace-nowrap"
                  >
                    {csvImporting
                      ? t('people.csvImporting')
                      : `${t('people.csvImportBtn')} (${validCsvCount})`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6 shadow-xl">
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              {confirmDelete.name}
            </h3>
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
              {t('people.confirmRemove')}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-xl border border-stone-200 dark:border-stone-700 px-4 py-2 text-sm font-medium"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="rounded-xl bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-medium"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Card Modal */}
      {qrPerson && org && (
        <QRCardModal
          person={qrPerson}
          org={org}
          roleLabel={roleLabel}
          onClose={() => setQrPerson(null)}
        />
      )}
    </Layout>
  );
};
