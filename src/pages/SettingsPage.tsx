import React, { useEffect, useState } from 'react';
import { Camera, Database, MapPin, Moon, QrCode, Save, Sun, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import type { OrgType } from '../types';
import { updateOrganization } from '../services/orgService';
import { updateUserDetails } from '../services/userService';
import { deleteDemoData, loadDemoData } from '../services/demoService';
import {
  compressImageToDataUrl,
  getCurrentPosition,
  getFirebaseErrorKey,
  getInitials,
} from '../utils/helpers';
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
  const [myEnrollment, setMyEnrollment] = useState(profile?.enrollmentNumber || '');
  const [myPhotoUrl, setMyPhotoUrl] = useState(profile?.photoUrl || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Org fields (Admin / Super Admin only — ZERO lateAfter field)
  const [orgName, setOrgName] = useState(org?.name || '');
  const [orgType, setOrgType] = useState<OrgType>(org?.type || 'College');
  const [orgAddress, setOrgAddress] = useState(org?.address || '');
  const [orgLogoUrl, setOrgLogoUrl] = useState(org?.logoUrl || '');
  const [managerLabel, setManagerLabel] = useState(org?.roleLabels?.manager || 'Manager');
  const [memberLabel, setMemberLabel] = useState(org?.roleLabels?.member || 'Member');
  const [timezone, setTimezone] = useState(org?.timezone || 'Asia/Kolkata');
  const [lowThreshold, setLowThreshold] = useState(org?.lowAttendanceThreshold ?? 75);
  const [defaultDuration, setDefaultDuration] = useState(org?.defaultSessionDuration ?? 45);
  const [locEnabled, setLocEnabled] = useState(org?.location?.enabled ?? true);
  const [locRadius, setLocRadius] = useState(org?.location?.radius ?? 50);
  const [locLat, setLocLat] = useState(org?.location?.lat ?? 0);
  const [locLng, setLocLng] = useState(org?.location?.lng ?? 0);
  const [savingOrg, setSavingOrg] = useState(false);
  const [locating, setLocating] = useState(false);

  // Demo data state
  const [demoBusy, setDemoBusy] = useState<'loading' | 'deleting' | null>(null);
  const [showQr, setShowQr] = useState(false);

  const isOrgAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

  useEffect(() => {
    if (profile) {
      setMyName(profile.name);
      setMyPhone(profile.phone || '');
      setMyRoll(profile.rollNumber || '');
      setMyEnrollment(profile.enrollmentNumber || '');
      setMyPhotoUrl(profile.photoUrl || '');
    }
  }, [profile]);

  useEffect(() => {
    if (org) {
      setOrgName(org.name);
      setOrgType(org.type);
      setOrgAddress(org.address || '');
      setOrgLogoUrl(org.logoUrl || '');
      setManagerLabel(org.roleLabels?.manager || 'Manager');
      setMemberLabel(org.roleLabels?.member || 'Member');
      setTimezone(org.timezone || 'Asia/Kolkata');
      setLowThreshold(org.lowAttendanceThreshold ?? 75);
      setDefaultDuration(org.defaultSessionDuration ?? 45);
      setLocEnabled(org.location?.enabled ?? true);
      setLocRadius(Math.min(500, Math.max(20, org.location?.radius ?? 50)));
      setLocLat(org.location?.lat ?? 0);
      setLocLng(org.location?.lng ?? 0);
    }
  }, [org]);

  const handleProfilePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file, 220);
      setMyPhotoUrl(dataUrl);
    } catch {
      showToast(t('errors.generic'), 'error');
    }
    e.target.value = '';
  };

  const handleOrgLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file, 200);
      setOrgLogoUrl(dataUrl);
    } catch {
      showToast(t('errors.generic'), 'error');
    }
    e.target.value = '';
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSavingProfile(true);
    try {
      await updateUserDetails(profile.uid, {
        name: myName.trim(),
        phone: myPhone.trim(),
        rollNumber: myRoll.trim(),
        enrollmentNumber: myEnrollment.trim(),
        photoUrl: myPhotoUrl,
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
    if (!org || !profile) return;
    setSavingOrg(true);
    try {
      await updateOrganization(
        org.id,
        org.orgCode,
        {
          name: orgName.trim(),
          type: orgType,
          address: orgAddress.trim(),
          logoUrl: orgLogoUrl,
          roleLabels: {
            manager: managerLabel.trim() || 'Manager',
            member: memberLabel.trim() || 'Member',
          },
          timezone,
          lowAttendanceThreshold: Math.min(100, Math.max(10, Number(lowThreshold) || 75)),
          defaultSessionDuration: Number(defaultDuration) || 45,
          location: {
            enabled: locEnabled,
            radius: Math.min(500, Math.max(20, Number(locRadius) || 50)),
            lat: locLat,
            lng: locLng,
          },
        },
        profile
      );
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
          <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                {t('settings.profileSection')}
              </h2>
              {profile?.memberId && (
                <span className="font-mono text-xs font-semibold text-[#C25E00]">
                  {t('common.memberId')}: {profile.memberId}
                </span>
              )}
            </div>
            {profile && profile.role !== 'parent' && (
              <button
                type="button"
                onClick={() => setShowQr(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#C25E00] hover:underline"
              >
                <QrCode className="w-4 h-4" />
                <span>{t('qr.openDigitalIdBtn')}</span>
              </button>
            )}
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            {/* Profile Photo Upload (Spark-plan safe compressed JPEG) */}
            <div className="flex flex-wrap items-center gap-4 pb-2">
              {myPhotoUrl ? (
                <img
                  src={myPhotoUrl}
                  alt={myName}
                  className="w-16 h-16 rounded-2xl object-cover border border-stone-200 dark:border-stone-700"
                />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 flex items-center justify-center text-base font-semibold text-stone-600 dark:text-stone-300">
                  {getInitials(myName || 'U')}
                </div>
              )}
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 px-3 py-1.5 text-xs font-medium cursor-pointer">
                    <Camera className="w-3.5 h-3.5 text-[#C25E00]" />
                    <span>{t('settings.uploadPhoto')}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleProfilePhotoFile}
                      className="hidden"
                    />
                  </label>
                  {myPhotoUrl && (
                    <button
                      type="button"
                      onClick={() => setMyPhotoUrl('')}
                      className="text-xs text-stone-500 hover:text-red-600 px-2 py-1"
                    >
                      {t('settings.removePhoto')}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-stone-500">{t('settings.photoHint')}</p>
              </div>
            </div>

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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              <div>
                <label className="block text-sm font-medium mb-1">{t('qr.enrollmentNo')}</label>
                <input
                  type="text"
                  value={myEnrollment}
                  onChange={(e) => setMyEnrollment(e.target.value)}
                  placeholder="e.g. ENR-2025-014"
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white px-5 py-2.5 text-sm font-medium"
            >
              <Save className="w-4 h-4" />
              <span>{savingProfile ? t('common.saving') : t('common.save')}</span>
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
                className={`min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-md ${
                  theme === 'light'
                    ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                    : 'text-stone-500'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>{t('settings.lightMode')}</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1 rounded-md ${
                  theme === 'dark'
                    ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                    : 'text-stone-500'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>{t('settings.darkMode')}</span>
              </button>
            </div>
          </div>

          <div>
            <PWAInstallButton />
          </div>
        </section>

        {/* Admin Organization Settings */}
        {isOrgAdmin && org && (
          <>
            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
              <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100 mb-5">
                {t('settings.orgSection')}
              </h2>

              <form onSubmit={handleSaveOrg} className="space-y-5">
                {/* College / Organization Logo */}
                <div className="flex flex-wrap items-center gap-4">
                  {orgLogoUrl ? (
                    <img
                      src={orgLogoUrl}
                      alt={orgName}
                      className="w-14 h-14 rounded-xl object-contain border border-stone-200 dark:border-stone-700 bg-white p-1"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 flex items-center justify-center text-sm font-semibold text-stone-500">
                      {getInitials(orgName || 'O')}
                    </div>
                  )}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 px-3 py-1.5 text-xs font-medium cursor-pointer">
                        <Upload className="w-3.5 h-3.5 text-[#C25E00]" />
                        <span>{t('settings.uploadLogo')}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleOrgLogoFile}
                          className="hidden"
                        />
                      </label>
                      {orgLogoUrl && (
                        <button
                          type="button"
                          onClick={() => setOrgLogoUrl('')}
                          className="text-xs text-stone-500 hover:text-red-600 px-2 py-1"
                        >
                          {t('settings.removePhoto')}
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-stone-500">{t('settings.logoHint')}</p>
                  </div>
                </div>

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

                <div>
                  <label className="block text-sm font-medium mb-1">
                    {t('settings.orgAddress')}
                  </label>
                  <input
                    type="text"
                    value={orgAddress}
                    onChange={(e) => setOrgAddress(e.target.value)}
                    placeholder={t('settings.orgAddressPlaceholder')}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm"
                  />
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
                      placeholder="Teacher / Faculty"
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

                {/* Live Session Defaults & Location Check */}
                <div className="pt-4 border-t border-stone-200 dark:border-stone-800 space-y-4">
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                    {t('settings.sessionDefaultsSection')}
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium mb-1">
                        {t('settings.defaultDuration')}
                      </label>
                      <select
                        value={defaultDuration}
                        onChange={(e) => setDefaultDuration(Number(e.target.value))}
                        className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2 text-sm tabular-nums"
                      >
                        {[15, 30, 45, 60, 120].map((d) => (
                          <option key={d} value={d}>
                            {d} {t('common.minutes')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">
                        {t('settings.radiusMeters')}
                      </label>
                      <input
                        type="number"
                        min={20}
                        max={500}
                        value={locRadius}
                        onChange={(e) => setLocRadius(Number(e.target.value))}
                        className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2 text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="flex items-start justify-between gap-4 pt-2">
                    <div>
                      <h4 className="text-sm font-medium text-stone-900 dark:text-stone-100">
                        {t('settings.locationSection')}
                      </h4>
                      <p className="text-xs text-stone-500 mt-0.5">{t('settings.locationDesc')}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={locEnabled}
                      aria-label={t('settings.enableLocation')}
                      onClick={() => setLocEnabled((v) => !v)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                        locEnabled ? 'bg-[#C25E00]' : 'bg-stone-300 dark:bg-stone-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                          locEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {locEnabled && (
                    <div className="space-y-1.5">
                      <button
                        type="button"
                        disabled={locating}
                        onClick={handleSetCurrentLocation}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2 text-sm font-medium"
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
                  )}
                </div>

                <button
                  type="submit"
                  disabled={savingOrg}
                  className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white px-5 py-2.5 text-sm font-medium"
                >
                  <Save className="w-4 h-4" />
                  <span>{savingOrg ? t('common.saving') : t('common.save')}</span>
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
          roleLabel={
            profile.role === 'admin' || profile.role === 'super_admin'
              ? t('common.admin')
              : getRoleLabel(profile.role === 'manager' ? 'manager' : 'member')
          }
          onClose={() => setShowQr(false)}
        />
      )}
    </Layout>
  );
};
