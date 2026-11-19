import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import {
  AlertCircle,
  Camera,
  CameraOff,
  CheckCircle2,
  Crosshair,
  Loader2,
  MapPin,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type { AttendanceSession, LiveSessionQRPayload } from '../types';
import {
  findActiveParentSession,
  resolveScannedSession,
  submitSelfAttendance,
  subscribeActiveParentSession,
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
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab = searchParams.get('tab') === 'code' ? 'code' : 'scan';
  const [tab, setTab] = useState<'scan' | 'code'>(initialTab);

  // Active parent session state (real-time synced)
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

  // Manual refresh fallback
  const refreshActiveSession = useCallback(async () => {
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

  // Real-time subscription to parent's LIVE session
  useEffect(() => {
    if (!profile || !org) return;
    setLoadingSession(true);
    const unsub = subscribeActiveParentSession(
      profile,
      org,
      (active) => {
        setSession(active);
        setLoadingSession(false);
      },
      () => {
        setLoadingSession(false);
      }
    );
    return () => unsub();
  }, [profile, org]);

  // Auto-expire locally if session's endsAt passes while screen is open
  useEffect(() => {
    if (!session?.endsAt) return;
    const endMs = session.endsAt.toMillis();
    const delay = endMs - Date.now();
    if (delay <= 0) {
      setSession(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setSession(null);
    }, delay + 500);
    return () => window.clearTimeout(timer);
  }, [session?.id, session?.endsAt]);

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
    readGpsLocation();
  }, [readGpsLocation]);

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
        // Ignore stop cleanup errors
      }
    }
    setCameraRunning(false);
  }, []);

  const reportError = useCallback(
    (msg: string) => {
      playBeep(false);
      triggerVibration(false);
      setErrorMessage(msg);
      showToast(msg, 'error');
    },
    [showToast]
  );

  const handleSubmitTokenOrCode = useCallback(
    async (mode: 'live_qr' | 'live_code', value: string, scannedSessionId?: string) => {
      if (!org || !profile) return;
      setErrorMessage('');

      // Determine target session: use active session if matching, otherwise resolve scanned sessionId from Firestore
      let targetSession: AttendanceSession | null = session;

      if (mode === 'live_qr' && scannedSessionId) {
        if (!targetSession || targetSession.id !== scannedSessionId) {
          setSubmitting(true);
          const resolved = await resolveScannedSession(scannedSessionId, profile, org);
          if (resolved.status !== 'ok') {
            setSubmitting(false);
            if (resolved.status === 'closed') {
              reportError(t('mark.errSessionClosed'));
            } else if (resolved.status === 'unauthorized') {
              reportError(t('mark.errUnauthorized'));
            } else if (resolved.status === 'network') {
              reportError(t('mark.errNetwork'));
            } else {
              reportError(t('attendance.invalidQr'));
            }
            return;
          }
          targetSession = resolved.session;
          setSession(resolved.session);
        }
      }

      if (!targetSession) {
        reportError(t('mark.errSessionClosed'));
        return;
      }

      const needsGps = targetSession.locationCheckEnabled;
      if (needsGps) {
        if (!gps) {
          reportError(t('mark.locationDenied'));
          return;
        }
        if (gps.accuracy > 100) {
          reportError(t('mark.lowAccuracy'));
          return;
        }
      }

      setSubmitting(true);
      try {
        const res = await submitSelfAttendance({
          org,
          profile,
          session: targetSession,
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
          showToast(t('mark.successTitle'), 'success');
        } else {
          const key = res.errorCode === 'generic' ? 'errors.generic' : `mark.${res.errorCode}`;
          reportError(t(key));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [org, profile, session, gps, stopCamera, showToast, reportError, t]
  );

  const handleDecodedLiveQR = useCallback(
    async (raw: string) => {
      if (scanBusyRef.current) return;
      let parsed: LiveSessionQRPayload;
      try {
        const obj = JSON.parse(raw);
        if (
          !obj ||
          typeof obj.s !== 'string' ||
          obj.s.trim().length < 4 ||
          typeof obj.t !== 'string' ||
          obj.t.trim().length < 16
        ) {
          scanBusyRef.current = true;
          reportError(t('attendance.invalidQr'));
          window.setTimeout(() => {
            scanBusyRef.current = false;
          }, 1500);
          return;
        }
        parsed = { s: obj.s.trim(), t: obj.t.trim() };
      } catch {
        scanBusyRef.current = true;
        reportError(t('attendance.invalidQr'));
        window.setTimeout(() => {
          scanBusyRef.current = false;
        }, 1500);
        return;
      }

      scanBusyRef.current = true;
      await handleSubmitTokenOrCode('live_qr', parsed.t, parsed.s);
      window.setTimeout(() => {
        scanBusyRef.current = false;
      }, 1500);
    },
    [handleSubmitTokenOrCode, reportError, t]
  );

  const startCamera = useCallback(
    async (mode: 'environment' | 'user' = facingMode) => {
      setCameraError('');
      await stopCamera();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(t('attendance.cameraPermissionDesc'));
        return;
      }

      const scannerConfig = {
        fps: 12,
        qrbox: { width: 220, height: 220 },
        aspectRatio: 1,
      };

      const onScanSuccess = (text: string) => {
        handleDecodedLiveQR(text);
      };

      try {
        const scanner = new Html5Qrcode('mark-qr-reader');
        scannerRef.current = scanner;
        await scanner.start({ facingMode: mode }, scannerConfig, onScanSuccess, () => {});
        setCameraRunning(true);
      } catch (firstErr) {
        // Desktop webcams sometimes reject facingMode: 'environment'; fallback to first detected camera
        try {
          const cameras = await Html5Qrcode.getCameras();
          if (cameras && cameras.length > 0) {
            const scanner = new Html5Qrcode('mark-qr-reader');
            scannerRef.current = scanner;
            const preferred =
              mode === 'environment'
                ? cameras.find((c) => /back|rear|environment/i.test(c.label)) || cameras[0]
                : cameras.find((c) => /front|user|face/i.test(c.label)) || cameras[0];
            await scanner.start(preferred.id, scannerConfig, onScanSuccess, () => {});
            setCameraRunning(true);
            return;
          }
        } catch {
          // Fall through to permission error message
        }

        const msg = (firstErr as Error)?.message || '';
        setCameraError(
          msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')
            ? t('attendance.cameraPermissionDesc')
            : t('attendance.cameraPermissionDesc')
        );
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
      reportError(t('mark.idMismatch'));
      return;
    }

    const cleanCode = liveCode.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(cleanCode)) {
      reportError(t('mark.errInvalidCode'));
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
        ) : (
          <>
            {/* Live Session Status + Step 1 Location Status */}
            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 space-y-4">
              {loadingSession ? (
                <div className="flex items-center gap-2.5 text-sm text-stone-500">
                  <Loader2 className="w-4 h-4 animate-spin text-[#C25E00]" />
                  <span>{t('mark.findingSession')}</span>
                </div>
              ) : session ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600/12 dark:bg-emerald-500/20 border border-emerald-600/30 px-2 py-0.5 text-[11px] font-bold tracking-wider text-emerald-700 dark:text-emerald-300 uppercase shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 animate-pulse" />
                      {t('session.liveBadge')}
                    </span>
                    <span className="font-semibold text-stone-900 dark:text-stone-100 text-sm truncate">
                      {session.title || session.ownerName}
                    </span>
                  </div>
                  <span className="font-mono text-xs text-stone-500 dark:text-stone-400">
                    {t('common.memberId')}: {profile?.memberId}
                  </span>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                      {t('mark.noActiveSession')}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                      {t('mark.noActiveSessionHint')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={refreshActiveSession}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 px-3 py-1.5 text-xs font-medium shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{t('mark.refreshSession')}</span>
                  </button>
                </div>
              )}

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
              ) : session ? (
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
              ) : null}
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
                  <div className="relative overflow-hidden rounded-xl bg-stone-950 min-h-[290px] sm:min-h-[320px] flex items-center justify-center">
                    <div id="mark-qr-reader" className="w-full" />

                    {/* Clean Corner-Bracket Scanning Frame Overlay */}
                    {cameraRunning && (
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <div className="relative w-52 h-52 sm:w-56 sm:h-56">
                          <span className="absolute top-0 left-0 w-7 h-7 border-t-[3px] border-l-[3px] border-[#C25E00] rounded-tl-lg" />
                          <span className="absolute top-0 right-0 w-7 h-7 border-t-[3px] border-r-[3px] border-[#C25E00] rounded-tr-lg" />
                          <span className="absolute bottom-0 left-0 w-7 h-7 border-b-[3px] border-l-[3px] border-[#C25E00] rounded-bl-lg" />
                          <span className="absolute bottom-0 right-0 w-7 h-7 border-b-[3px] border-r-[3px] border-[#C25E00] rounded-br-lg" />
                        </div>
                        <p className="mt-4 px-3 py-1 rounded-lg bg-black/60 text-white text-xs font-medium">
                          {submitting ? t('mark.submitting') : t('mark.scanFrameHint')}
                        </p>
                      </div>
                    )}

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

                  {cameraError && !cameraRunning && (
                    <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3.5 text-xs text-amber-900 dark:text-amber-200">
                      <p className="font-semibold">{t('attendance.cameraPermissionTitle')}</p>
                      <p className="mt-1">{t('attendance.cameraPermissionDesc')}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    {cameraRunning ? (
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 py-3 text-sm font-medium hover:bg-stone-50 dark:hover:bg-stone-800"
                      >
                        <CameraOff className="w-4 h-4" />
                        <span>{t('attendance.stopCamera')}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startCamera(facingMode)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white py-3 text-sm font-medium"
                      >
                        <Camera className="w-4 h-4" />
                        <span>{t('attendance.startCamera')}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleSwitchCamera}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 py-3 text-sm font-medium hover:bg-stone-50 dark:hover:bg-stone-800"
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
                    disabled={submitting || !session}
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
