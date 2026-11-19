import React, { useEffect, useState } from 'react';
import { Database, MapPin, QrCode, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import type { OrgType } from '../types';
import { updateOrganization } from '../services/orgService';
import { updateUserDetails } from '../services/userService';
import { deleteDemoData, loadDemoData } from '../services/demoService';
import { getCurrentPosition, getFirebaseErrorKey } from '../utils/helpers';
import { Layout } from '../components/Layout';
import { LanguageToggle } from '../components/LanguageToggle';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { QRCardModal } from '../components/QRCardModal';

const ORG_TYPES: OrgType[] = ['College', 'School', 'Coaching', 'Company', 'Other'];
const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];

export const SettingsPage: React.FC = () => {
  const { profile, org, getRoleLabel } = useAuth();
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { showToast } = useToast();

  // Profile fields
  const [myName, setMyName] = useState(profile?.name || '');
  const [myPhone, setMyPhone] = useState(profile?.phone || '');
  const [myRoll, setMyRoll] = useState(profile?.rollNumber || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Org fields (Admin only)
  const [orgName, setOrgName] = useState(org?.name || '');
  const [orgType, setOrgType] = useState<OrgType>(org?.type || 'College');
  const [managerLabel, setManagerLabel] = useState(org?.roleLabels?.manager || 'Manager');
  const [memberLabel, setMemberLabel] = useState(org?.roleLabels?.member || 'Member');
  const [lateAfter, setLateAfter] = useState(org?.lateAfter || '09:30');
  const [timezone, setTimezone] = useState(org?.timezone || 'Asia/Kolkata');
  const [lowThreshold, setLowThreshold] = useState(org?.lowAttendanceThreshold ?? 75);
  const [locEnabled, setLocEnabled] = useState(org?.location?.enabled ?? false);
  const [locRadius, setLocRadius] = useState(org?.location?.radius ?? 200);
  const [locLat, setLocLat] = useState(org?.location?.lat ?? 0);
  const [locLng, setLocLng] = useState(org?.location?.lng ?? 0);
  const [savingOrg, setSavingOrg] = useState(false);
  const [locating, setLocating] = useState(false);

  // Demo data state
  const [demoBusy, setDemoBusy] = useState<'loading' | 'deleting' | null>(null);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    if (profile) {
      setMyName(profile.name);
      setMyPhone(profile.phone || '');
      setMyRoll(profile.rollNumber || '');
    }
  }, [profile]);

  useEffect(() => {
    if (org) {
      setOrgName(org.name);
      setOrgType(org.type);
      setManagerLabel(org.roleLabels?.manager || 'Manager');
      setMemberLabel(org.roleLabels?.member || 'Member');
      setLateAfter(org.lateAfter || '09:30');
      setTimezone(org.timezone || 'Asia/Kolkata');
      setLowThreshold(org.lowAttendanceThreshold ?? 75);
      setLocEnabled(org.location?.enabled ?? false);
      setLocRadius(org.location?.radius ?? 200);
      setLocLat(org.location?.lat ?? 0);
      setLocLng(org.location?.lng ?? 0);
    }
  }, [org]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSavingProfile(true);
    try {
      await updateUserDetails(profile.uid, {
        name: myName.trim(),
        phone: myPhone.trim(),
        rollNumber: myRoll.trim(),
      });
      showToast(t('settings.savedToast'), 'success');
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setSavingOrg(true);
    try {
      await updateOrganization(org.id, org.orgCode, {
        name: orgName.trim(),
        type: orgType,
        roleLabels: {
          manager: managerLabel.trim() || 'Manager',
          member: memberLabel.trim() || 'Member',
        },
        lateAfter,
        timezone,
        lowAttendanceThreshold: Number(lowThreshold) || 75,
        location: {
          enabled: locEnabled,
          radius: Number(locRadius) || 200,
          lat: locLat,
          lng: locLng,
        },
      });
      showToast(t('settings.savedToast'), 'success');
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSavingOrg(false);
    }
  };

  const handleSetCurrentLocation = async () => {
    setLocating(true);
    try {
      const pos = await getCurrentPosition();
      setLocLat(Number(pos.lat.toFixed(6)));
      setLocLng(Number(pos.lng.toFixed(6)));
      showToast(t('settings.locationSet'), 'success');
    } catch {
      showToast(t('attendance.locationDenied'), 'error');
    } finally {
      setLocating(false);
    }
  };

  const handleLoadDemo = async () => {
    if (!org || !profile) return;
    setDemoBusy('loading');
    try {
      await loadDemoData(org, profile);
      showToast(t('settings.demoLoadedToast'), 'success');
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setDemoBusy(null);
    }
  };

  const handleDeleteDemo = async () => {
    if (!org) return;
    setDemoBusy('deleting');
    try {
      await deleteDemoData(org.id);
      showToast(t('settings.demoDeletedToast'), 'info');
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setDemoBusy(null);
    }
  };

  return (
    <Layout title={t('settings.title')}>
      <div className="space-y-8 max-w-3xl">
        {/* Profile */}
        <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              {t('settings.profileSection')}
            </h2>
            {profile && profile.role !== 'admin' && (
              <button
                type="button"
                onClick={() => setShowQr(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#C25E00] hover:underline"
              >
                <QrCode className="w-4 h-4" />
                <span>{t('dashboard.showQr')}</span>
              </button>
            )}
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.name')}</label>
                <input
                  type="text"
                  required
                  value={myName}
                  onChange={(e) => setMyName(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.email')}</label>
                <input
                  type="email"
                  disabled
                  value={profile?.email || ''}
                  className="w-full rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 px-3.5 py-2 text-sm text-stone-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.phone')}</label>
                <input
                  type="tel"
                  value={myPhone}
                  onChange={(e) => setMyPhone(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.rollNumber')}</label>
                <input
                  type="text"
                  value={myRoll}
                  onChange={(e) => setMyRoll(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white px-5 py-2 text-sm font-medium"
            >
              {savingProfile ? t('common.saving') : t('common.save')}
            </button>
          </form>
        </section>

        {/* Preferences */}
        <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6 space-y-5">
          <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            {t('settings.preferencesSection')}
          </h2>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-stone-700 dark:text-stone-300">
              {t('settings.languageLabel')}
            </span>
            <LanguageToggle />
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-stone-700 dark:text-stone-300">
              {t('settings.themeLabel')}
            </span>
            <div className="inline-flex p-1 rounded-lg bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-xs font-medium">
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`px-3 py-1 rounded-md ${
                  theme === 'light'
                    ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                    : 'text-stone-500'
                }`}
              >
                {t('settings.lightMode')}
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`px-3 py-1 rounded-md ${
                  theme === 'dark'
                    ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                    : 'text-stone-500'
                }`}
              >
                {t('settings.darkMode')}
              </button>
            </div>
          </div>

          <div>
            <PWAInstallButton />
          </div>
        </section>

        {/* Admin Organization Settings */}
        {profile?.role === 'admin' && org && (
          <>
            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100 mb-5">
                {t('settings.orgSection')}
              </h2>

              <form onSubmit={handleSaveOrg} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.orgName')}
                    </label>
                    <input
                      type="text"
                      required
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.orgType')}
                    </label>
                    <select
                      value={orgType}
                      onChange={(e) => setOrgType(e.target.value as OrgType)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2 text-sm"
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
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.managerLabel')}
                    </label>
                    <input
                      type="text"
                      value={managerLabel}
                      onChange={(e) => setManagerLabel(e.target.value)}
                      placeholder="Teacher / Team Lead"
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.memberLabel')}
                    </label>
                    <input
                      type="text"
                      value={memberLabel}
                      onChange={(e) => setMemberLabel(e.target.value)}
                      placeholder="Student / Employee"
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.lateAfter')}
                    </label>
                    <input
                      type="time"
                      value={lateAfter}
                      onChange={(e) => setLateAfter(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2 text-sm"
                    />
                    <p className="mt-1 text-[11px] text-stone-500">{t('settings.lateAfterHint')}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.timezone')}
                    </label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2 text-sm"
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t('settings.lowThreshold')}
                    </label>
                    <input
                      type="number"
                      min={10}
                      max={100}
                      value={lowThreshold}
                      onChange={(e) => setLowThreshold(Number(e.target.value))}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm tabular-nums"
                    />
                  </div>
                </div>

                {/* Location Check */}
                <div className="pt-4 border-t border-stone-200 dark:border-stone-800 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                        {t('settings.locationSection')}
                      </h3>
                      <p className="text-xs text-stone-500 mt-0.5">{t('settings.locationDesc')}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={locEnabled}
                      onChange={(e) => setLocEnabled(e.target.checked)}
                      aria-label={t('settings.enableLocation')}
                      className="w-5 h-5 accent-[#C25E00] mt-0.5 cursor-pointer"
                    />
                  </div>

                  {locEnabled && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                      <div>
                        <label className="block text-xs font-medium mb-1">
                          {t('settings.radiusMeters')}
                        </label>
                        <input
                          type="number"
                          min={20}
                          max={5000}
                          value={locRadius}
                          onChange={(e) => setLocRadius(Number(e.target.value))}
                          className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm tabular-nums"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <button
                          type="button"
                          disabled={locating}
                          onClick={handleSetCurrentLocation}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2 text-sm font-medium"
                        >
                          <MapPin className="w-4 h-4 text-[#C25E00]" />
                          <span>
                            {locating ? t('common.loading') : t('settings.setCurrentLocation')}
                          </span>
                        </button>
                        <p className="text-[11px] font-mono text-stone-500">
                          {locLat || locLng
                            ? `${locLat}, ${locLng}`
                            : t('settings.noLocationSaved')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={savingOrg}
                  className="rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white px-5 py-2.5 text-sm font-medium"
                >
                  {savingOrg ? t('common.saving') : t('common.save')}
                </button>
              </form>
            </section>

            {/* Demo Data Controls */}
            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                {t('settings.demoSection')}
              </h2>
              <p className="mt-1.5 text-sm text-stone-600 dark:text-stone-400">
                {t('settings.demoDesc')}
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={demoBusy !== null}
                  onClick={handleLoadDemo}
                  className="inline-flex items-center gap-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:opacity-90 disabled:opacity-50 px-4 py-2.5 text-sm font-medium"
                >
                  <Database className="w-4 h-4" />
                  <span>
                    {demoBusy === 'loading'
                      ? t('settings.loadingDemo')
                      : t('settings.loadDemoBtn')}
                  </span>
                </button>

                {org.hasDemoData && (
                  <button
                    type="button"
                    disabled={demoBusy !== null}
                    onClick={handleDeleteDemo}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-300 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 px-4 py-2.5 text-sm font-medium"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>
                      {demoBusy === 'deleting'
                        ? t('settings.deletingDemo')
                        : t('settings.deleteDemoBtn')}
                    </span>
                  </button>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {showQr && profile && org && (
        <QRCardModal
          person={profile}
          org={org}
          roleLabel={getRoleLabel(profile.role === 'manager' ? 'manager' : 'member')}
          onClose={() => setShowQr(false)}
        />
      )}
    </Layout>
  );
};
