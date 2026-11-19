import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import {
  AlertCircle,
  Camera,
  CameraOff,
  CheckCircle2,
  Crosshair,
  MapPin,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import type { AttendanceSession, LiveSessionQRPayload } from '../types';
import {
  findActiveParentSession,
  submitSelfAttendance,
  type SelfMarkResult,
} from '../services/sessionService';
import {
  getCurrentPosition,
  getFlatEarthDistanceMeters,
  playBeep,
  triggerVibration,
} from '../utils/helpers';
import { Layout } from '../components/Layout';

export const MarkYourAttendancePage: React.FC = () => {
  const { profile, org } = useAuth();
  const { t, formatNumber } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab = searchParams.get('tab') === 'code' ? 'code' : 'scan';
  const [tab, setTab] = useState<'scan' | 'code'>(initialTab);

  // Active parent session state
  const [loadingSession, setLoadingSession] = useState(true);
  const [session, setSession] = useState<AttendanceSession | null>(null);

  // Step 1: GPS state
  const [readingGps, setReadingGps] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsError, setGpsError] = useState<'denied' | 'low_accuracy' | null>(null);

  // Step 2A: QR scanner state
  const [cameraRunning, setCameraRunning] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scanBusyRef = useRef(false);

  // Step 2B: Enter ID + Live Code state
  const [enteredId, setEnteredId] = useState('');
  const [liveCode, setLiveCode] = useState('');

  // Submission & outcome state
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successResult, setSuccessResult] = useState<SelfMarkResult | null>(null);

  // Find active parent session
  const loadActiveSession = useCallback(async () => {
    if (!profile || !org) return;
    setLoadingSession(true);
    setErrorMessage('');
    try {
      const active = await findActiveParentSession(profile, org);
      setSession(active);
    } catch {
      setSession(null);
    } finally {
      setLoadingSession(false);
    }
  }, [profile, org]);

  // Step 1: Automatically read high-accuracy GPS
  const readGpsLocation = useCallback(async () => {
    setReadingGps(true);
    setGpsError(null);
    try {
      const pos = await getCurrentPosition();
      setGps(pos);
      if (pos.accuracy > 100) {
        setGpsError('low_accuracy');
      }
    } catch {
      setGps(null);
      setGpsError('denied');
    } finally {
      setReadingGps(false);
    }
  }, []);

  useEffect(() => {
    loadActiveSession();
    readGpsLocation();
  }, [loadActiveSession, readGpsLocation]);

  // Computed distance to active session
  const distanceMeters = useMemo(() => {
    if (!session || !gps) return null;
    return getFlatEarthDistanceMeters(
      gps.lat,
      gps.lng,
      session.location.lat,
      session.location.lng,
      session.location.cosLat
    );
  }, [session, gps]);

  const locationRequired = session ? session.locationCheckEnabled : org?.location?.enabled ?? true;
  const locationOk = useMemo(() => {
    if (!locationRequired) return true;
    if (!gps || gpsError) return false;
    if (distanceMeters === null || !session) return false;
    return distanceMeters <= session.location.radius;
  }, [locationRequired, gps, gpsError, distanceMeters, session]);

  const stopCamera = useCallback(async () => {
    const inst = scannerRef.current;
    scannerRef.current = null;
    if (inst) {
      try {
        if (inst.isScanning) await inst.stop();
        inst.clear();
      } catch {
        // Ignore
      }
    }
    setCameraRunning(false);
  }, []);

  const handleSubmitTokenOrCode = useCallback(
    async (mode: 'live_qr' | 'live_code', value: string, scannedSessionId?: string) => {
      if (!org || !profile || !session) return;
      setErrorMessage('');

      if (scannedSessionId && scannedSessionId !== session.id) {
        playBeep(false);
        triggerVibration(false);
        setErrorMessage(t('mark.errWrongSession'));
        return;
      }

      if (locationRequired) {
        if (!gps) {
          setErrorMessage(t('mark.locationDenied'));
          return;
        }
        if (gps.accuracy > 100) {
          setErrorMessage(t('mark.lowAccuracy'));
          return;
        }
      }

      setSubmitting(true);
      try {
        const res = await submitSelfAttendance({
          org,
          profile,
          session,
          method: mode,
          token: mode === 'live_qr' ? value : undefined,
          code: mode === 'live_code' ? value : undefined,
          lat: gps?.lat ?? 0,
          lng: gps?.lng ?? 0,
          accuracy: gps?.accuracy ?? 0,
        });

        if (res.ok) {
          playBeep(true);
          triggerVibration(true);
          await stopCamera();
          setSuccessResult(res);
        } else {
          playBeep(false);
          triggerVibration(false);
          const key = res.errorCode === 'generic' ? 'errors.generic' : `mark.${res.errorCode}`;
          setErrorMessage(t(key));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [org, profile, session, locationRequired, gps, stopCamera, t]
  );

  const handleDecodedLiveQR = useCallback(
    async (raw: string) => {
      if (scanBusyRef.current) return;
      let parsed: LiveSessionQRPayload;
      try {
        const obj = JSON.parse(raw);
        if (!obj || typeof obj.s !== 'string' || typeof obj.t !== 'string') {
          setErrorMessage(t('attendance.invalidQr'));
          return;
        }
        parsed = obj as LiveSessionQRPayload;
      } catch {
        setErrorMessage(t('attendance.invalidQr'));
        return;
      }

      scanBusyRef.current = true;
      await handleSubmitTokenOrCode('live_qr', parsed.t, parsed.s);
      window.setTimeout(() => {
        scanBusyRef.current = false;
      }, 1500);
    },
    [handleSubmitTokenOrCode, t]
  );

  const startCamera = useCallback(
    async (mode: 'environment' | 'user' = facingMode) => {
      setCameraError('');
      await stopCamera();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(t('attendance.cameraPermissionDesc'));
        return;
      }

      try {
        const scanner = new Html5Qrcode('mark-qr-reader');
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: mode },
          { fps: 10, qrbox: { width: 230, height: 230 }, aspectRatio: 1 },
          (text) => {
            handleDecodedLiveQR(text);
          },
          () => {}
        );
        setCameraRunning(true);
      } catch {
        setCameraError(t('attendance.cameraPermissionDesc'));
        setCameraRunning(false);
      }
    },
    [facingMode, stopCamera, handleDecodedLiveQR, t]
  );

  const handleSwitchCamera = async () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    if (cameraRunning) await startCamera(next);
  };

  useEffect(() => {
    if (tab !== 'scan' && cameraRunning) {
      stopCamera();
    }
  }, [tab, cameraRunning, stopCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const handleCodeFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanId = enteredId.trim().toUpperCase();
    const myId = (profile?.memberId || '').trim().toUpperCase();
    if (!cleanId || cleanId !== myId) {
      setErrorMessage(t('mark.idMismatch'));
      return;
    }

    const cleanCode = liveCode.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      setErrorMessage(t('mark.errInvalidCode'));
      return;
    }

    await handleSubmitTokenOrCode('live_code', cleanCode);
  };

  const handleTabSwitch = (next: 'scan' | 'code') => {
    setTab(next);
    setErrorMessage('');
    setSearchParams({ tab: next }, { replace: true });
  };

  return (
    <Layout title={t('mark.title')}>
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
            {t('mark.title')}
          </h2>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            {t('mark.subtitle')}
          </p>
        </div>

        {/* SUCCESS SCREEN */}
        {successResult ? (
          <div className="rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-600 text-white mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-emerald-900 dark:text-emerald-200">
                {t('mark.successTitle')}
              </h3>
              <p className="mt-1.5 text-base font-semibold text-stone-900 dark:text-stone-100">
                {profile?.name} · <span className="font-mono">{profile?.memberId}</span>
              </p>
            </div>

            <div className="flex items-center justify-center gap-4 text-sm text-emerald-900/80 dark:text-emerald-300 tabular-nums pt-2">
              <span>{t(`common.${successResult.status || 'present'}`)}</span>
              <span>·</span>
              <span>{successResult.timeStr}</span>
              {successResult.distanceMeters !== undefined && locationRequired && (
                <>
                  <span>·</span>
                  <span>
                    {formatNumber(successResult.distanceMeters)} {t('common.meters')}
                  </span>
                </>
              )}
            </div>
          </div>
        ) : loadingSession ? (
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-8 text-center text-sm text-stone-500">
            {t('mark.findingSession')}
          </div>
        ) : !session ? (
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-8 text-center space-y-3">
            <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
              {t('mark.noActiveSession')}
            </h3>
            <p className="text-sm text-stone-500 dark:text-stone-400">
              {t('mark.noActiveSessionHint')}
            </p>
            <button
              type="button"
              onClick={loadActiveSession}
              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-5 py-2.5 text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              <span>{t('mark.refreshSession')}</span>
            </button>
          </div>
        ) : (
          <>
            {/* Active Session Header + Step 1 Location Status */}
            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2 text-xs text-stone-500 dark:text-stone-400">
                <span className="font-medium text-stone-900 dark:text-stone-100 text-sm">
                  {session.title || session.ownerName}
                </span>
                <span className="font-mono">
                  {t('common.memberId')}: {profile?.memberId}
                </span>
              </div>

              {/* Step 1: GPS Distance Banner */}
              {!locationRequired ? (
                <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/50 px-4 py-3 text-xs text-stone-600 dark:text-stone-400">
                  {t('mark.locationCheckDisabled')}
                </div>
              ) : readingGps ? (
                <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/50 px-4 py-3 flex items-center gap-2.5 text-sm text-stone-600 dark:text-stone-300">
                  <Crosshair className="w-4 h-4 animate-spin text-[#C25E00]" />
                  <span>{t('mark.readingGps')}</span>
                </div>
              ) : gpsError === 'low_accuracy' ? (
                <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-start justify-between gap-3">
                  <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    {t('mark.lowAccuracy')} (±{gps?.accuracy} {t('common.meters')})
                  </p>
                  <button
                    type="button"
                    onClick={readGpsLocation}
                    className="shrink-0 rounded-lg bg-amber-700 text-white px-3 py-1.5 text-xs font-medium"
                  >
                    {t('mark.retryGps')}
                  </button>
                </div>
              ) : gpsError === 'denied' || !gps ? (
                <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-4 py-3 flex items-start justify-between gap-3">
                  <p className="text-xs text-red-800 dark:text-red-300 leading-relaxed">
                    {t('mark.locationDenied')}
                  </p>
                  <button
                    type="button"
                    onClick={readGpsLocation}
                    className="shrink-0 rounded-lg bg-red-600 text-white px-3 py-1.5 text-xs font-medium"
                  >
                    {t('mark.retryGps')}
                  </button>
                </div>
              ) : (
                <div
                  className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-3 ${
                    locationOk
                      ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                      : 'border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 text-red-900 dark:text-red-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 text-sm font-medium tabular-nums">
                    <MapPin className="w-4 h-4 shrink-0" />
                    <span>
                      {(locationOk ? t('mark.withinRadius') : t('mark.outsideRadius')).replace(
                        '{distance}',
                        formatNumber(distanceMeters ?? 0)
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={readGpsLocation}
                    aria-label={t('mark.retryGps')}
                    className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              )}
            </section>

            {/* Step 2: Two Tabs (Scan QR | Enter ID) */}
            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6 space-y-5">
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800">
                <button
                  type="button"
                  onClick={() => handleTabSwitch('scan')}
                  className={`py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === 'scan'
                      ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                      : 'text-stone-600 dark:text-stone-400'
                  }`}
                >
                  {t('mark.tabScanQr')}
                </button>
                <button
                  type="button"
                  onClick={() => handleTabSwitch('code')}
                  className={`py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    tab === 'code'
                      ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                      : 'text-stone-600 dark:text-stone-400'
                  }`}
                >
                  {t('mark.tabEnterId')}
                </button>
              </div>

              {errorMessage && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 flex items-start gap-2.5 text-sm text-red-800 dark:text-red-300"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {tab === 'scan' ? (
                <div className="space-y-4">
                  <div className="relative overflow-hidden rounded-xl bg-stone-950 min-h-[280px] flex items-center justify-center">
                    <div id="mark-qr-reader" className="w-full" />
                    {!cameraRunning && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-stone-100 dark:bg-stone-900">
                        <Camera className="w-9 h-9 text-stone-400 mb-3" />
                        <p className="text-sm text-stone-700 dark:text-stone-300 max-w-xs">
                          {cameraError || t('attendance.cameraActiveHint')}
                        </p>
                        <button
                          type="button"
                          onClick={() => startCamera(facingMode)}
                          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-5 py-2.5 text-sm font-medium"
                        >
                          <Camera className="w-4 h-4" />
                          <span>{t('attendance.startCamera')}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {cameraRunning ? (
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 py-3 text-sm font-medium"
                      >
                        <CameraOff className="w-4 h-4" />
                        <span>{t('attendance.stopCamera')}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startCamera(facingMode)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] text-white py-3 text-sm font-medium"
                      >
                        <Camera className="w-4 h-4" />
                        <span>{t('attendance.startCamera')}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleSwitchCamera}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 py-3 text-sm font-medium"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>{t('attendance.switchCamera')}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleCodeFormSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                      {t('mark.yourIdLabel')}
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={enteredId}
                      onChange={(e) => setEnteredId(e.target.value.toUpperCase())}
                      placeholder={profile?.memberId || t('mark.yourIdPlaceholder')}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-4 py-3 text-base font-mono uppercase tracking-[0.2em] focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                      {t('mark.liveCodeLabel')}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      maxLength={6}
                      value={liveCode}
                      onChange={(e) => setLiveCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder={t('mark.liveCodePlaceholder')}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-4 py-3 text-2xl font-mono tracking-[0.3em] text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white py-3 text-sm font-medium transition-colors"
                  >
                    {submitting ? t('mark.submitting') : t('mark.submitBtn')}
                  </button>
                </form>
              )}
            </section>
          </>
        )}
      </div>
    </Layout>
  );
};
