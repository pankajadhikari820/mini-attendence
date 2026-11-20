import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  GraduationCap,
  KeyRound,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type { ManagerCodeLookup, OrgCodeLookup, OrgType } from '../types';
import {
  createOrganizationAndAdmin,
  lookupManagerCode,
  lookupOrgCode,
} from '../services/orgService';
import { registerParentAccount, selfRegisterUser } from '../services/userService';
import { getFirebaseErrorKey, needsEnglishNameForId } from '../utils/helpers';
import { Logo } from '../components/Logo';
import { LanguageToggle } from '../components/LanguageToggle';
import { ThemeToggle } from '../components/ThemeToggle';

const ORG_TYPES: OrgType[] = ['College', 'School', 'Coaching', 'Company', 'Other'];

export const RegisterPage: React.FC = () => {
  const { t, language } = useTranslation();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Create Org fields
  const [orgName, setOrgName] = useState('');
  const [orgType, setOrgType] = useState<OrgType>('College');
  const [adminName, setAdminName] = useState('');
  const [englishName, setEnglishName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const showEnglishNameField = needsEnglishNameForId(adminName);

  // Join Org fields
  const [joinRole, setJoinRole] = useState<'manager' | 'member' | 'parent'>('member');
  const [joinCode, setJoinCode] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [verifiedOrg, setVerifiedOrg] = useState<OrgCodeLookup | null>(null);
  const [verifiedManager, setVerifiedManager] = useState<ManagerCodeLookup | null>(null);
  const [rollNumber, setRollNumber] = useState('');
  const [studentMemberId, setStudentMemberId] = useState('');
  const [relationship, setRelationship] = useState('Parent');

  const handleVerifyCode = async () => {
    setError('');
    setVerifiedOrg(null);
    setVerifiedManager(null);
    if (!joinCode.trim()) {
      setError(t('errors.invalidCode'));
      return;
    }
    setVerifyingCode(true);
    try {
      if (joinRole === 'manager' || joinRole === 'parent') {
        const res = await lookupOrgCode(joinCode);
        if (!res) {
          setError(t('errors.invalidCode'));
        } else {
          setVerifiedOrg(res);
        }
      } else {
        const res = await lookupManagerCode(joinCode);
        if (!res) {
          setError(t('errors.invalidCode'));
        } else {
          setVerifiedManager(res);
        }
      }
    } catch (err) {
      setError(t(getFirebaseErrorKey(err)));
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError(t('errors.passwordMismatch'));
      return;
    }
    if (password.length < 6) {
      setError(t('errors.weakPassword'));
      return;
    }
    if (showEnglishNameField && needsEnglishNameForId(englishName)) {
      setError(t('errors.englishNameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await createOrganizationAndAdmin({
        orgName,
        orgType,
        adminName,
        englishName: showEnglishNameField ? englishName.trim() : undefined,
        email,
        password,
        phone,
        language,
      });
      showToast(t('landing.step1Title'), 'success');
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(t(getFirebaseErrorKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoinOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('errors.passwordMismatch'));
      return;
    }
    if (password.length < 6) {
      setError(t('errors.weakPassword'));
      return;
    }
    if (showEnglishNameField && needsEnglishNameForId(englishName)) {
      setError(t('errors.englishNameRequired'));
      return;
    }

    let orgLookup = verifiedOrg;
    let mgrLookup = verifiedManager;

    setSubmitting(true);
    try {
      if ((joinRole === 'manager' || joinRole === 'parent') && !orgLookup) {
        orgLookup = await lookupOrgCode(joinCode);
        if (!orgLookup) {
          setError(t('errors.invalidCode'));
          setSubmitting(false);
          return;
        }
      }
      if (joinRole === 'member' && !mgrLookup) {
        mgrLookup = await lookupManagerCode(joinCode);
        if (!mgrLookup) {
          setError(t('errors.invalidCode'));
          setSubmitting(false);
          return;
        }
      }

      if (joinRole === 'parent') {
        if (!studentMemberId.trim()) {
          setError(t('auth.studentIdRequired'));
          setSubmitting(false);
          return;
        }
        await registerParentAccount({
          orgId: orgLookup!.orgId,
          name: adminName,
          englishName: showEnglishNameField ? englishName.trim() : undefined,
          email,
          password,
          phone,
          studentMemberId,
          relationship,
          language,
        });
        navigate('/pending', { replace: true });
        return;
      }

      await selfRegisterUser({
        role: joinRole,
        orgId: joinRole === 'manager' ? orgLookup!.orgId : mgrLookup!.orgId,
        managerId: joinRole === 'member' ? mgrLookup!.managerUid : null,
        parentNotifyUid: joinRole === 'member' ? mgrLookup!.managerUid : null,
        name: adminName,
        englishName: showEnglishNameField ? englishName.trim() : undefined,
        email,
        password,
        phone,
        rollNumber,
        language,
      });
      navigate('/pending', { replace: true });
    } catch (err) {
      if (err instanceof Error && err.message === 'STUDENT_NOT_FOUND') {
        setError(t('auth.studentIdNotFound'));
      } else {
        setError(t(getFirebaseErrorKey(err)));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] dark:bg-[#0F0F11] flex flex-col">
      <header className="max-w-6xl w-full mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6 sm:p-8 shadow-xs">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
            {t('auth.registerTitle')}
          </h1>
          <p className="mt-1.5 text-sm text-stone-500 dark:text-stone-400">
            {t('auth.registerSubtitle')}
          </p>

          {/* Segmented Mode Switch */}
          <div className="mt-6 grid grid-cols-2 gap-1 p-1 rounded-xl bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800">
            <button
              type="button"
              onClick={() => {
                setMode('create');
                setError('');
              }}
              className={`min-h-[40px] px-2 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 ${
                mode === 'create'
                  ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400'
              }`}
            >
              <Building2 className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('auth.tabCreateOrg')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('join');
                setError('');
              }}
              className={`min-h-[40px] px-2 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 ${
                mode === 'join'
                  ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400'
              }`}
            >
              <UserPlus className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('auth.tabJoinOrg')}</span>
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {mode === 'create' ? (
            <form onSubmit={handleCreateOrg} className="mt-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('auth.orgNameLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={t('auth.orgNamePlaceholder')}
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('auth.orgTypeLabel')}
                  </label>
                  <select
                    value={orgType}
                    onChange={(e) => setOrgType(e.target.value as OrgType)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  >
                    {ORG_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`auth.orgTypes.${type}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('auth.yourNameLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('auth.phoneLabel')}
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                </div>
              </div>

              {showEnglishNameField && (
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('common.englishNameLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    value={englishName}
                    onChange={(e) => setEnglishName(e.target.value)}
                    placeholder="e.g. Pankaj Sharma"
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    {t('common.englishNameHint')}
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  {t('auth.emailLabel')}
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('auth.passwordLabel')}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('auth.confirmPasswordLabel')}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white py-3 text-sm font-medium transition-colors"
              >
                <Building2 className="w-4 h-4" />
                <span>{submitting ? t('common.saving') : t('auth.createOrgBtn')}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoinOrg} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  {t('auth.joinAsLabel')}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'member', label: t('auth.joinRoleMember'), Icon: GraduationCap },
                      { id: 'manager', label: t('auth.joinRoleManager'), Icon: UserCog },
                      { id: 'parent', label: t('auth.joinRoleParent'), Icon: Users },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setJoinRole(opt.id);
                        setVerifiedOrg(null);
                        setVerifiedManager(null);
                        setError('');
                      }}
                      className={`min-h-[44px] rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-colors flex items-center gap-2 ${
                        joinRole === opt.id
                          ? 'border-[#C25E00] bg-amber-50/50 dark:bg-amber-950/20 text-stone-900 dark:text-stone-100'
                          : 'border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400'
                      }`}
                    >
                      <opt.Icon
                        className={`w-4 h-4 shrink-0 ${
                          joinRole === opt.id ? 'text-[#C25E00]' : 'text-stone-400'
                        }`}
                      />
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  {joinRole === 'member' ? t('auth.managerCodeLabel') : t('auth.orgCodeLabel')}
                </label>
                <div className="flex flex-col min-[360px]:flex-row gap-2">
                  <input
                    type="text"
                    required
                    value={joinCode}
                    onChange={(e) => {
                      setJoinCode(e.target.value.toUpperCase());
                      setVerifiedOrg(null);
                      setVerifiedManager(null);
                    }}
                    placeholder="ABC123"
                    className="flex-1 min-w-0 min-h-[44px] rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm font-mono uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyCode}
                    disabled={verifyingCode}
                    className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 dark:border-stone-700 px-4 py-2.5 text-sm font-medium hover:bg-stone-50 dark:hover:bg-stone-800 whitespace-nowrap"
                  >
                    <KeyRound className="w-4 h-4 text-[#C25E00]" />
                    <span>{verifyingCode ? '...' : t('auth.verifyCodeBtn')}</span>
                  </button>
                </div>

                {(verifiedOrg || verifiedManager) && (
                  <div className="mt-2.5 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      {t('auth.joiningOrg')}:{' '}
                      <strong>{verifiedOrg?.orgName || verifiedManager?.orgName}</strong>
                      {verifiedManager ? ` · ${t('auth.underManager')}: ${verifiedManager.managerName}` : ''}
                    </span>
                  </div>
                )}
              </div>

              {joinRole === 'parent' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                      {t('auth.childStudentIdLabel')}
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={8}
                      value={studentMemberId}
                      onChange={(e) => setStudentMemberId(e.target.value.toUpperCase())}
                      placeholder="e.g. AAR482"
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm font-mono uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                      {t('auth.relationshipLabel')}
                    </label>
                    <select
                      value={relationship}
                      onChange={(e) => setRelationship(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm"
                    >
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Guardian">Guardian</option>
                      <option value="Parent">Parent</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('auth.yourNameLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('auth.phoneLabel')}
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                </div>
              </div>

              {showEnglishNameField && (
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('common.englishNameLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    value={englishName}
                    onChange={(e) => setEnglishName(e.target.value)}
                    placeholder="e.g. Rahul Verma"
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                  <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                    {t('common.englishNameHint')}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('auth.emailLabel')}
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                </div>
                {joinRole !== 'parent' && (
                  <div>
                    <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                      {t('common.rollNumber')} ({t('common.optional')})
                    </label>
                    <input
                      type="text"
                      value={rollNumber}
                      onChange={(e) => setRollNumber(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('auth.passwordLabel')}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                    {t('auth.confirmPasswordLabel')}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white py-3 text-sm font-medium transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                <span>{submitting ? t('common.saving') : t('auth.joinBtn')}</span>
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-stone-500 dark:text-stone-400">
            {t('auth.haveAccount')}{' '}
            <Link to="/login" className="font-medium text-[#C25E00] hover:underline">
              {t('auth.signInLink')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
};
