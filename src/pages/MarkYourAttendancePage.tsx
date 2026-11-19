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
  WifiOff,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type { AttendanceSession, LiveSessionQRPayload } from '../types';
import {
  findEligibleLiveSessions,
  resolveScannedSession,
  submitSelfAttendance,
  subscribeEligibleLiveSessions,
  type SelfMarkResult,
  type SessionStreamError,
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
  const paramSessionId = searchParams.get('sessionId') || '';
  const [tab, setTab] = useState<'scan' | 'code'>(initialTab);

  // Active eligible live sessions (real-time synced across all teachers assigned to student's class)
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(paramSessionId);
  const [streamError, setStreamError] = useState<SessionStreamError | null>(null);
  const [rechecking, setRechecking] = useState(false);

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

  // Selected active session (auto-defaults to first open session or ?sessionId=)
  const session = useMemo(() => {
    if (sessions.length === 0) return null;
    if (selectedSessionId) {
      const found = sessions.find((s) => s.id === selectedSessionId);
      if (found) return found;
    }
    return sessions[0];
  }, [sessions, selectedSessionId]);

  useEffect(() => {
    if (sessions.length > 0 && (!selectedSessionId || !sessions.some((s) => s.id === selectedSessionId))) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [sessions, selectedSessionId]);

  // Step 1: Read high-accuracy GPS
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

  // Manual "Check again" handler: refreshes both Firestore query AND GPS
  const refreshActiveSession = useCallback(async () => {
    if (!profile || !org) return;
    setRechecking(true);
    setErrorMessage('');
    try {
      const res = await findEligibleLiveSessions(profile, org);
      setSessions(res.sessions);
      setStreamError(res.error);
      if (res.sessions.length > 0) {
        setSelectedSessionId((prev) =>
          res.sessions.some((s) => s.id === prev) ? prev : res.sessions[0].id
        );
      }
      readGpsLocation();
    } finally {
      setRechecking(false);
      setLoadingSession(false);
    }
  }, [profile, org, readGpsLocation]);

  // Real-time subscription to ALL eligible live sessions
  useEffect(() => {
    if (!profile || !org) return;
    setLoadingSession(true);
    setStreamError(null);

    const unsub = subscribeEligibleLiveSessions(
      profile,
      org,
      (list) => {
        setSessions(list);
        setStreamError(null);
        setLoadingSession(false);
      },
      (err) => {
        setStreamError(err);
        setLoadingSession(false);
      }
    );

    return () => unsub();
  }, [profile, org]);

  // Auto-prune expired sessions in real time while screen stays open
  useEffect(() => {
    if (sessions.length === 0) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setSessions((prev) =>
        prev.filter((s) => !s.endsAt || s.endsAt.toMillis() > now)
      );
    }, 5000);
    return () => window.clearInterval(interval);
  }, [sessions.length]);

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

      let targetSession: AttendanceSession | null = session;

      if (mode === 'live_qr' && scannedSessionId) {
        const matchedFromList = sessions.find((s) => s.id === scannedSessionId) || null;
        if (matchedFromList) {
          targetSession = matchedFromList;
          setSelectedSessionId(matchedFromList.id);
        } else {
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
          setSessions((prev) =>
            prev.some((s) => s.id === resolved.session.id)
              ? prev
              : [resolved.session, ...prev]
          );
          setSelectedSessionId(resolved.session.id);
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
    [org, profile, session, sessions, gps, stopCamera, showToast, reportError, t]
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
      } catch {
        try {
          const cameras = await Html5Qrcode.getCameras();
          if (cameras && cameras.length > 0) {
            const scanner = new Html5Qrcode('mark-qr-reader');
            scannerRef.current = scanner;
            const preferred =
              mode === 'environment'
                ? cameras.find((c) => /back|rear|environment/i.test(c.label)) || cameras[0]
                : cameras.find((c) => /front|user/i.test(c.label)) || cameras[0];
            await scanner.start(preferred.id, scannerConfig, onScanSuccess, () => {});
            setCameraRunning(true);
            return;
          }
        } catch {
          // Fall through
        }

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

        {/* SUCCESS SCREEN (Strictly PRESENT) */}
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
              {successResult.subjectName && (
                <p className="mt-1 text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  {successResult.subjectName}
                </p>
              )}
            </div>

            <div className="flex items-center justify-center gap-4 text-sm text-emerald-900/80 dark:text-emerald-300 tabular-nums pt-2">
              <span className="font-semibold uppercase">{t('common.present')}</span>
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

            {sessions.length > 1 && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSuccessResult(null);
                    setLiveCode('');
                  }}
                  className="rounded-xl border border-emerald-400 dark:border-emerald-700 px-4 py-2 text-xs font-medium text-emerald-900 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                >
                  {t('mark.markAnotherSession')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Live Session Discovery Card — explicitly differentiates loading, errors, empty, and active sessions */}
            <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 space-y-4">
              {loadingSession ? (
                <div className="flex items-center gap-2.5 text-sm text-stone-500">
                  <Loader2 className="w-4 h-4 animate-spin text-[#C25E00]" />
                  <span>{t('mark.findingSession')}</span>
                </div>
              ) : streamError && sessions.length === 0 ? (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    {streamError.code === 'network' ? (
                      <WifiOff className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                        {streamError.code === 'permission-denied'
                          ? t('mark.sessionPermErrorTitle')
                          : streamError.code === 'index-required'
                          ? t('mark.sessionIndexErrorTitle')
                          : t('mark.sessionNetworkErrorTitle')}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                        {streamError.message}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={rechecking}
                    onClick={refreshActiveSession}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 px-3 py-1.5 text-xs font-medium shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${rechecking ? 'animate-spin' : ''}`} />
                    <span>{t('mark.refreshSession')}</span>
                  </button>
                </div>
              ) : sessions.length > 0 && session ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600/12 dark:bg-emerald-500/20 border border-emerald-600/30 px-2 py-0.5 text-[11px] font-bold tracking-wider text-emerald-700 dark:text-emerald-300 uppercase shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 animate-pulse" />
                        {t('session.liveBadge')}
                      </span>
                      <span className="font-semibold text-stone-900 dark:text-stone-100 text-sm truncate">
                        {session.subjectName || session.title || session.ownerName}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-stone-500 dark:text-stone-400">
                      {t('common.memberId')}: {profile?.memberId}
                    </span>
                  </div>

                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {session.teacherName || session.ownerName}
                    {session.className ? ` · ${session.className}` : ''}
                    {session.classroom ? ` · ${session.classroom}` : ''}
                  </p>

                  {/* If multiple teachers have active sessions concurrently, let student pick */}
                  {sessions.length > 1 && (
                    <div className="pt-2 border-t border-stone-100 dark:border-stone-800 space-y-2">
                      <p className="text-xs font-medium text-stone-600 dark:text-stone-300">
                        {t('mark.multipleLiveSessions')} ({formatNumber(sessions.length)})
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {sessions.map((s) => {
                          const isSelected = s.id === session.id;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => setSelectedSessionId(s.id)}
                              className={`rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                                isSelected
                                  ? 'border-[#C25E00] bg-amber-50/70 dark:bg-amber-950/30 text-stone-900 dark:text-stone-100'
                                  : 'border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800/50'
                              }`}
                            >
                              <p className="font-semibold truncate">
                                {s.subjectName || s.title}
                              </p>
                              <p className="text-[11px] text-stone-500 truncate mt-0.5">
                                {s.teacherName || s.ownerName}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
                    disabled={rechecking}
                    onClick={refreshActiveSession}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 px-3 py-1.5 text-xs font-medium shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${rechecking ? 'animate-spin' : ''}`} />
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
