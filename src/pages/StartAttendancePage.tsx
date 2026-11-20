import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Clock,
  Crosshair,
  Maximize2,
  Minimize2,
  Play,
  PlusCircle,
  Square,
  Users,
  Wrench,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type {
  AttendanceAttempt,
  AttendanceRecord,
  AttendanceSession,
  FacultyAssignment,
  TimetableSlot,
} from '../types';
import {
  closeAttendanceSession,
  extendAttendanceSession,
  fetchOpenSessionsByOwner,
  rotateSessionSecret,
  startAttendanceSession,
  subscribeSession,
  subscribeSessionAttendance,
  subscribeSessionAttempts,
} from '../services/sessionService';
import {
  subscribeFacultyAssignments,
  subscribeTimetableForTeacher,
  fetchTimetableForOrg,
} from '../services/academicService';
import { fetchManagerMembers, fetchOrgUsers, fetchUsersByClass } from '../services/userService';
import {
  formatTimeRange12h,
  getCurrentPosition,
  getFirebaseErrorKey,
  getOrgWeekdayIndex,
} from '../utils/helpers';
import { Layout } from '../components/Layout';
import { LocationPickerMap } from '../components/LocationPickerMap';

const DURATIONS = [15, 30, 45, 60, 90];
const ROTATION_SECONDS = 10;

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

export const StartAttendancePage: React.FC = () => {
  const { profile, org, getRoleLabel } = useAuth();
  const { t, formatNumber, formatTime } = useTranslation();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();

  const paramSlotId = searchParams.get('slotId') || '';
  const paramAssignmentId = searchParams.get('assignmentId') || '';

  // Academic assignments & timetable
  const [assignments, setAssignments] = useState<FacultyAssignment[]>([]);
  const [todaySlots, setTodaySlots] = useState<TimetableSlot[]>([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>('');
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');

  // Setup state
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState<number>(org?.defaultSessionDuration ?? 45);
  const [radius, setRadius] = useState<number>(
    Math.max(20, Math.min(500, org?.location?.radius ?? 50))
  );
  const [lat, setLat] = useState<number>(org?.location?.lat || 28.6139);
  const [lng, setLng] = useState<number>(org?.location?.lng || 77.209);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [starting, setStarting] = useState(false);

  // Active live session state
  const [activeSession, setActiveSession] = useState<AttendanceSession | null>(null);
  const [otherOpenSessions, setOtherOpenSessions] = useState<AttendanceSession[]>([]);
  const [currentToken, setCurrentToken] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(ROTATION_SECONDS);
  const [rotating, setRotating] = useState(false);
  const [sessionRemainingSec, setSessionRemainingSec] = useState(0);
  const [markedRecords, setMarkedRecords] = useState<AttendanceRecord[]>([]);
  const [attempts, setAttempts] = useState<AttendanceAttempt[]>([]);
  const [totalExpected, setTotalExpected] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [wakeLockOn, setWakeLockOn] = useState(false);

  const tokenIssuedAtMsRef = useRef<number>(Date.now());
  const endsAtMsRef = useRef<number>(0);
  const isRotatingRef = useRef<boolean>(false);
  const projectorRef = useRef<HTMLDivElement | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
  const targetRoleLabel = isAdmin ? getRoleLabel('manager') : getRoleLabel('member');
  const todayWeekday = useMemo(
    () => getOrgWeekdayIndex(org?.timezone || 'Asia/Kolkata'),
    [org?.timezone]
  );

  // Subscribe to faculty assignments (teachers only see their assigned classes/subjects)
  useEffect(() => {
    if (!org || !profile) return;
    return subscribeFacultyAssignments(
      org.id,
      (list: FacultyAssignment[]) => {
        setAssignments(list);
      },
      isAdmin ? undefined : profile.uid
    );
  }, [org, profile, isAdmin]);

  // Load today's timetable slots
  useEffect(() => {
    if (!org || !profile) return;
    if (!isAdmin) {
      return subscribeTimetableForTeacher(org.id, profile.uid, (slots: TimetableSlot[]) => {
        setTodaySlots(slots.filter((s) => s.dayOfWeek === todayWeekday));
      });
    }
    fetchTimetableForOrg(org.id)
      .then((slots: TimetableSlot[]) => setTodaySlots(slots.filter((s) => s.dayOfWeek === todayWeekday)))
      .catch(() => {});
  }, [org, profile, isAdmin, todayWeekday]);

  // Auto-select from URL query parameters (?slotId=... or ?assignmentId=...)
  useEffect(() => {
    if (paramSlotId && todaySlots.length > 0) {
      const slot = todaySlots.find((s) => s.id === paramSlotId);
      if (slot) {
        setSelectedSlotId(slot.id);
        setTitle(`${slot.subjectName} — ${slot.className}`);
        const matchingAssignment = assignments.find(
          (a) => a.classId === slot.classId && a.subjectId === slot.subjectId
        );
        if (matchingAssignment) setSelectedAssignmentId(matchingAssignment.id);
        return;
      }
    }
    if (paramAssignmentId && assignments.length > 0) {
      const asgn = assignments.find((a) => a.id === paramAssignmentId);
      if (asgn) {
        setSelectedAssignmentId(asgn.id);
        setTitle(`${asgn.subjectName} — ${asgn.className}`);
        return;
      }
    }
    if (!selectedAssignmentId && !selectedSlotId && assignments.length > 0 && !isAdmin) {
      const first = assignments[0];
      setSelectedAssignmentId(first.id);
      setTitle(`${first.subjectName} — ${first.className}`);
    }
  }, [paramSlotId, paramAssignmentId, todaySlots, assignments, isAdmin, selectedAssignmentId, selectedSlotId]);

  const selectedAssignment = useMemo(
    () => assignments.find((a) => a.id === selectedAssignmentId) || null,
    [assignments, selectedAssignmentId]
  );

  const selectedSlot = useMemo(
    () => todaySlots.find((s) => s.id === selectedSlotId) || null,
    [todaySlots, selectedSlotId]
  );

  const effectiveClassId = selectedSlot?.classId || selectedAssignment?.classId || null;

  // Sync org defaults when loaded
  useEffect(() => {
    if (!org) return;
    setDuration(org.defaultSessionDuration ?? 45);
    setRadius(Math.max(20, Math.min(500, org.location?.radius ?? 50)));
  }, [org]);

  // Update expected headcount whenever selected class or active session changes
  useEffect(() => {
    if (!org || !profile) return;
    const targetClassId = activeSession?.classId || effectiveClassId;
    let active = true;
    const loadCount = async () => {
      try {
        if (targetClassId) {
          const classStudents = await fetchUsersByClass(org.id, targetClassId);
          if (active) setTotalExpected(classStudents.filter((p) => p.status === 'active').length);
        } else if (isAdmin) {
          const mgrs = await fetchOrgUsers(org.id, 'manager');
          if (active) setTotalExpected(mgrs.filter((p) => p.status === 'active').length);
        } else {
          const mems = await fetchManagerMembers(org.id, profile.uid);
          if (active) setTotalExpected(mems.filter((p) => p.status === 'active').length);
        }
      } catch {
        // Ignore transient count failure
      }
    };
    loadCount();
    return () => {
      active = false;
    };
  }, [org, profile, isAdmin, activeSession?.classId, effectiveClassId]);

  // Read high-accuracy GPS
  const refreshGPS = useCallback(async () => {
    setLocating(true);
    setGpsError('');
    try {
      const reading = await getCurrentPosition();
      setLat(Number(reading.lat.toFixed(6)));
      setLng(Number(reading.lng.toFixed(6)));
      setGpsAccuracy(reading.accuracy);
    } catch {
      setGpsError(t('session.gpsError'));
    } finally {
      setLocating(false);
    }
  }, [t]);

  const attachToOpenSession = useCallback(async (existing: AttendanceSession) => {
    const fresh = await rotateSessionSecret({ sessionId: existing.id });
    tokenIssuedAtMsRef.current = Date.now();
    endsAtMsRef.current = existing.endsAt?.toMillis?.() ?? 0;
    setCurrentToken(fresh.token);
    setCurrentCode(fresh.code);
    setSecondsLeft(ROTATION_SECONDS);
    setSessionRemainingSec(Math.max(0, Math.floor((endsAtMsRef.current - Date.now()) / 1000)));
    setActiveSession(existing);
  }, []);

  // On mount: check for already open sessions by this teacher/admin
  useEffect(() => {
    if (!org || !profile) return;
    let mounted = true;

    const init = async () => {
      try {
        const openList = await fetchOpenSessionsByOwner(org.id, profile.uid);
        if (!mounted) return;
        setOtherOpenSessions(openList);

        // If user explicitly came via ?slotId= or ?assignmentId= for a different subject, let them see existing or start new
        if (openList.length > 0 && !paramSlotId && !paramAssignmentId) {
          await attachToOpenSession(openList[0]);
        } else {
          refreshGPS();
        }
      } catch {
        refreshGPS();
      }
    };

    init();
    return () => {
      mounted = false;
    };
  }, [org, profile, paramSlotId, paramAssignmentId, attachToOpenSession, refreshGPS]);

  // Subscribe to session doc, attendance list, and rejected attempts while active
  useEffect(() => {
    if (!activeSession?.id || !org) return;
    const sessionId = activeSession.id;
    const unsubSess = subscribeSession(sessionId, (s) => {
      if (!s || s.status === 'closed') {
        setCurrentToken('');
        setCurrentCode('');
        setActiveSession(null);
      } else {
        endsAtMsRef.current = s.endsAt?.toMillis?.() ?? endsAtMsRef.current;
        setActiveSession(s);
      }
    });
    const unsubAtt = subscribeSessionAttendance(org.id, sessionId, setMarkedRecords);
    const unsubAttempts = subscribeSessionAttempts(org.id, sessionId, setAttempts);

    return () => {
      unsubSess();
      unsubAtt();
      unsubAttempts();
    };
  }, [activeSession?.id, org]);

  // Screen Wake Lock API while a session is live
  useEffect(() => {
    if (!activeSession) return;
    let released = false;

    const requestWakeLock = async () => {
      try {
        const nav = navigator as unknown as {
          wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
        };
        if (nav.wakeLock && !released) {
          wakeLockRef.current = await nav.wakeLock.request('screen');
          setWakeLockOn(true);
        }
      } catch {
        setWakeLockOn(false);
      }
    };

    requestWakeLock();

    const handleVis = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVis);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', handleVis);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      setWakeLockOn(false);
    };
  }, [activeSession?.id]);

  // Wall-clock synchronized 10-second QR & 6-digit code rotation timer + session countdown
  useEffect(() => {
    if (!activeSession?.id) return;
    const sessionId = activeSession.id;
    let aborted = false;
    isRotatingRef.current = false;

    const tickLoop = async () => {
      if (aborted) return;

      const now = Date.now();
      const endMs = endsAtMsRef.current;
      const rem = endMs > 0 ? Math.max(0, Math.floor((endMs - now) / 1000)) : 0;
      setSessionRemainingSec(rem);

      if (endMs > 0 && rem <= 0) {
        aborted = true;
        window.clearInterval(interval);
        setCurrentToken('');
        setCurrentCode('');
        try {
          await closeAttendanceSession(sessionId, profile);
        } catch {
          // Ignore
        }
        setActiveSession(null);
        return;
      }

      const elapsedSec = (now - tokenIssuedAtMsRef.current) / 1000;
      const left = Math.max(0, Math.ceil(ROTATION_SECONDS - elapsedSec));
      setSecondsLeft(left);

      if (elapsedSec >= 9.6 && !isRotatingRef.current) {
        isRotatingRef.current = true;
        setRotating(true);
        try {
          const next = await rotateSessionSecret({ sessionId });
          if (aborted) return;
          tokenIssuedAtMsRef.current = Date.now();
          setCurrentToken(next.token);
          setCurrentCode(next.code);
          setSecondsLeft(ROTATION_SECONDS);
        } catch {
          // Retry on next tick
        } finally {
          isRotatingRef.current = false;
          if (!aborted) setRotating(false);
        }
      }
    };

    const interval = window.setInterval(tickLoop, 250);
    return () => {
      aborted = true;
      isRotatingRef.current = false;
      window.clearInterval(interval);
    };
  }, [activeSession?.id, profile]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await (projectorRef.current || document.documentElement).requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen denial
    }
  };

  const handleSelectSlot = (slot: TimetableSlot) => {
    setSelectedSlotId(slot.id);
    const matching = assignments.find(
      (a) => a.classId === slot.classId && a.subjectId === slot.subjectId
    );
    setSelectedAssignmentId(matching?.id || '');
    setTitle(`${slot.subjectName} — ${slot.className}`);
  };

  const handleSelectAssignment = (asgnId: string) => {
    setSelectedAssignmentId(asgnId);
    setSelectedSlotId('');
    const asgn = assignments.find((a) => a.id === asgnId);
    if (asgn) {
      setTitle(`${asgn.subjectName} — ${asgn.className}`);
    }
  };

  const handleStartSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !profile) return;
    setStarting(true);
    try {
      const src = selectedSlot || selectedAssignment;
      const computedTitle =
        title.trim() ||
        (src ? `${src.subjectName} — ${src.className}` : t('session.startTitle'));

      const { session, token, code } = await startAttendanceSession({
        org,
        owner: profile,
        title: computedTitle,
        durationMinutes: duration,
        lat,
        lng,
        radius,
        departmentId: src?.departmentId || null,
        departmentName: src?.departmentName || '',
        classId: src?.classId || null,
        className: src?.className || '',
        subjectId: src?.subjectId || null,
        subjectName: src?.subjectName || '',
        subjectCode: src?.subjectCode || '',
        semester: src?.semester || '',
        section: src?.section || '',
        classroom: selectedSlot?.classroom || '',
        timetableSlotId: selectedSlot?.id || null,
      });
      tokenIssuedAtMsRef.current = Date.now();
      endsAtMsRef.current = session.endsAt?.toMillis?.() ?? Date.now() + duration * 60 * 1000;
      setCurrentToken(token);
      setCurrentCode(code);
      setSecondsLeft(ROTATION_SECONDS);
      setSessionRemainingSec(duration * 60);
      setActiveSession(session);
      showToast(t('session.startedToast'), 'success');
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_SESSION_EXISTS') {
        showToast(t('session.duplicateSessionErr'), 'error');
      } else {
        showToast(t(getFirebaseErrorKey(err)), 'error');
      }
    } finally {
      setStarting(false);
    }
  };

  const handleExtend = async () => {
    if (!activeSession) return;
    try {
      const nextEnds = await extendAttendanceSession(activeSession.id, activeSession.endsAt, 10);
      endsAtMsRef.current = nextEnds.toMillis();
      setActiveSession((prev) => (prev ? { ...prev, endsAt: nextEnds } : prev));
      showToast(t('session.extendedToast'), 'success');
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    }
  };

  const handleClose = async () => {
    if (!activeSession) return;
    const sessionId = activeSession.id;
    setCurrentToken('');
    setCurrentCode('');
    setActiveSession(null);
    setOtherOpenSessions((prev) => prev.filter((s) => s.id !== sessionId));
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
      await closeAttendanceSession(sessionId, profile);
      showToast(t('session.closedToast'), 'info');
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    }
  };

  const qrPayload = useMemo(() => {
    if (!activeSession || !currentToken) return '';
    return JSON.stringify({ s: activeSession.id, t: currentToken });
  }, [activeSession, currentToken]);

  const formattedRemaining = useMemo(() => {
    const mins = Math.floor(sessionRemainingSec / 60);
    const secs = sessionRemainingSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, [sessionRemainingSec]);

  const ringRadius = 158;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - secondsLeft / ROTATION_SECONDS);

  const attemptReasonLabel = (reason: string) => {
    if (reason === 'outside_radius') return t('mark.reasonOutside');
    if (reason === 'device_already_used') return t('mark.reasonDevice');
    return t('mark.reasonExpired');
  };

  // LIVE PROJECTOR SCREEN
  if (activeSession) {
    return (
      <Layout title={t('session.projectorMode')}>
        <div
          ref={projectorRef}
          className={`${
            isFullscreen
              ? 'min-h-screen bg-[#FAF9F6] dark:bg-[#0F0F11] p-6 sm:p-10 overflow-y-auto'
              : ''
          } space-y-6`}
        >
          {/* Top Bar with LIVE Status & Subject/Class Metadata */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-600/12 dark:bg-emerald-500/20 border border-emerald-600/30 dark:border-emerald-500/40 px-2.5 py-1 text-xs font-bold tracking-wider text-emerald-700 dark:text-emerald-300 uppercase">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600 dark:bg-emerald-400" />
                  </span>
                  {t('session.liveBadge')}
                </span>
                <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
                  {activeSession.subjectName
                    ? `${activeSession.subjectName}${activeSession.subjectCode ? ` (${activeSession.subjectCode})` : ''}`
                    : activeSession.title || t('session.startTitle')}
                </h2>
              </div>
              <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400 flex flex-wrap items-center gap-2 tabular-nums">
                {activeSession.className && (
                  <>
                    <span className="font-medium text-stone-700 dark:text-stone-300">
                      {activeSession.className}
                    </span>
                    <span>·</span>
                  </>
                )}
                {activeSession.classroom && (
                  <>
                    <span>{activeSession.classroom}</span>
                    <span>·</span>
                  </>
                )}
                <span className="font-mono">
                  {t('session.sessionIdLabel')}: {activeSession.id.slice(0, 6).toUpperCase()}
                </span>
                <span>·</span>
                <span>
                  {t('session.endsIn')}: <strong>{formattedRemaining}</strong>
                </span>
                <span>·</span>
                <span>
                  {t('session.radiusLabel')}: {activeSession.location.radius} {t('common.meters')}
                </span>
                {wakeLockOn && (
                  <>
                    <span>·</span>
                    <span>{t('session.wakeLockActive')}</span>
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleFullscreen}
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#161619] hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2 text-xs font-medium"
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
                <span>{isFullscreen ? t('session.exitFullscreen') : t('session.fullscreen')}</span>
              </button>
              <button
                type="button"
                onClick={handleExtend}
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-[#161619] hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2 text-xs font-medium"
              >
                <PlusCircle className="w-4 h-4 text-[#C25E00]" />
                <span>{t('session.extendBtn')}</span>
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-xs font-medium"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>{t('session.closeBtn')}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Projector QR + 6-digit Live Code */}
            <div className="lg:col-span-7 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6 sm:p-10 flex flex-col items-center text-center">
              <div className="relative flex items-center justify-center">
                <svg
                  width="340"
                  height="340"
                  viewBox="0 0 340 340"
                  className="-rotate-90 w-[236px] h-[236px] min-[390px]:w-[280px] min-[390px]:h-[280px] sm:w-[340px] sm:h-[340px]"
                  aria-hidden="true"
                >
                  <circle
                    cx="170"
                    cy="170"
                    r={ringRadius}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="6"
                    className="text-stone-200 dark:text-stone-800"
                  />
                  <circle
                    cx="170"
                    cy="170"
                    r={ringRadius}
                    fill="none"
                    stroke="#C25E00"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringOffset}
                    style={{ transition: 'stroke-dashoffset 0.9s linear' }}
                  />
                </svg>

                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="rounded-2xl bg-white p-3 min-[390px]:p-4 sm:p-5 border border-stone-200 shadow-xs [&_svg]:w-[144px] [&_svg]:h-[144px] min-[390px]:[&_svg]:w-[176px] min-[390px]:[&_svg]:h-[176px] sm:[&_svg]:w-[200px] sm:[&_svg]:h-[200px]">
                    {qrPayload && (
                      <QRCodeSVG
                        value={qrPayload}
                        size={isFullscreen ? 230 : 200}
                        level="M"
                        fgColor="#1C1917"
                        bgColor="#FFFFFF"
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-center gap-3 text-sm text-stone-600 dark:text-stone-300 tabular-nums">
                <span>{rotating ? t('session.rotatingToken') : t('session.rotatesIn')}</span>
                <span
                  className={`font-mono text-xl font-bold px-2.5 py-0.5 rounded-lg border ${
                    secondsLeft <= 3
                      ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                      : 'border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-50'
                  }`}
                >
                  {secondsLeft}
                  {t('session.seconds')}
                </span>
              </div>

              {/* 6-digit Live Code */}
              <div className="mt-6 w-full max-w-sm rounded-2xl border border-stone-200 dark:border-stone-800 bg-[#FAF9F6] dark:bg-stone-900/70 px-4 sm:px-6 py-4 sm:py-5">
                <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                  {t('session.liveCodeLabel')}
                </p>
                <p className="mt-2 font-mono text-3xl min-[390px]:text-4xl sm:text-5xl font-bold tracking-[0.18em] sm:tracking-[0.22em] text-stone-900 dark:text-stone-50 tabular-nums">
                  {currentCode ? `${currentCode.slice(0, 3)} ${currentCode.slice(3)}` : '--- ---'}
                </p>
              </div>
            </div>

            {/* Live Counter + Marked List + Rejected Attempts */}
            <div className="lg:col-span-5 space-y-5">
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5 text-[#C25E00]" />
                  <span className="text-sm font-medium text-stone-600 dark:text-stone-400">
                    {t('session.markedCounter')}
                  </span>
                </div>
                <p className="text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
                  {formatNumber(markedRecords.length)}
                  <span className="text-base font-normal text-stone-400">
                    {' '}
                    / {formatNumber(totalExpected)}
                  </span>
                </p>
              </div>

              <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 mb-3">
                  {t('session.markedListTitle')} ({formatNumber(markedRecords.length)})
                </h3>
                {markedRecords.length === 0 ? (
                  <p className="text-xs text-stone-500 dark:text-stone-400 py-6 text-center">
                    {t('session.noMarkedYet')}
                  </p>
                ) : (
                  <div className="max-h-72 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800">
                    {markedRecords.map((rec) => (
                      <div
                        key={rec.id}
                        className="py-2.5 flex items-center justify-between gap-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-stone-900 dark:text-stone-100 truncate">
                            {rec.personName}
                          </p>
                          <p className="text-xs font-mono text-stone-500 tabular-nums">
                            {rec.personMemberId}
                            {rec.distanceMeters !== undefined ? ` · ${rec.distanceMeters}m` : ''}
                            {rec.timestamp ? ` · ${formatTime(rec.timestamp.toDate())}` : ''}
                          </p>
                        </div>
                        <span className="text-xs font-semibold shrink-0 text-emerald-700 dark:text-emerald-400">
                          {t(`common.${rec.status}`)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>
                      {t('session.rejectedTitle')} ({formatNumber(attempts.length)})
                    </span>
                  </h3>
                </div>
                {attempts.length === 0 ? (
                  <p className="text-xs text-stone-500 dark:text-stone-400 py-3">
                    {t('session.noRejectedYet')}
                  </p>
                ) : (
                  <div className="max-h-52 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800">
                    {attempts.map((a) => (
                      <div key={a.id} className="py-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-stone-900 dark:text-stone-100">
                            {a.personName} ({a.personId || '—'})
                          </span>
                          <span className="text-stone-400 tabular-nums">
                            {formatTime(a.time?.toDate?.())}
                          </span>
                        </div>
                        <p className="mt-0.5 text-red-700 dark:text-red-400">
                          {attemptReasonLabel(a.reason)}
                          {a.distance !== null && a.distance !== undefined
                            ? ` · ${a.distance} ${t('common.meters')} ${t('session.awayLabel')}`
                            : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // SESSION SETUP FORM
  return (
    <Layout title={t('session.startTitle')}>
      <div className="max-w-3xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {t('session.startTitle')}
            </h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {t('session.startSubtitle')}
            </p>
          </div>

          <Link
            to="/attendance/manual"
            className="inline-flex items-center gap-2 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] hover:bg-stone-50 dark:hover:bg-stone-800 px-3.5 py-2 text-xs font-medium text-stone-700 dark:text-stone-300 whitespace-nowrap self-start"
          >
            <Wrench className="w-3.5 h-3.5 text-amber-600" />
            <span>{t('session.openBackupLink')}</span>
          </Link>
        </div>

        {/* Resume already-open sessions if any */}
        {otherOpenSessions.length > 0 && (
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 space-y-2.5">
            <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
              {t('session.resumeActivePrompt')}
            </p>
            <div className="flex flex-wrap gap-2">
              {otherOpenSessions.map((sess) => (
                <button
                  key={sess.id}
                  type="button"
                  onClick={() => attachToOpenSession(sess)}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white px-3.5 py-2 text-xs font-medium"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
                  <span>{sess.subjectName ? `${sess.subjectName} · ${sess.className}` : sess.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick pick from Today's Scheduled Lectures */}
        {todaySlots.length > 0 && (
          <section className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
              <CalendarClock className="w-4 h-4 text-[#C25E00]" />
              <span>{t('session.todayLecturesQuickPick')}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {todaySlots.map((slot) => {
                const active = selectedSlotId === slot.id;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => handleSelectSlot(slot)}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-[#C25E00] bg-amber-50/60 dark:bg-amber-950/20'
                        : 'border-stone-200 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/40'
                    }`}
                  >
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                      {slot.subjectName}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5">
                      {slot.className}
                      {slot.classroom ? ` · ${slot.classroom}` : ''}
                    </p>
                    <p className="text-[11px] font-mono text-[#C25E00] mt-1 tabular-nums">
                      {formatTimeRange12h(slot.startTime, slot.endTime)}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <form
          onSubmit={handleStartSession}
          className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-7 space-y-6"
        >
          {/* Assigned Class & Subject Selector */}
          {assignments.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5 flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-[#C25E00]" />
                <span>{t('session.selectAssignedSubject')}</span>
              </label>
              <select
                value={selectedAssignmentId}
                onChange={(e) => handleSelectAssignment(e.target.value)}
                className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
              >
                {isAdmin && (
                  <option value="">{t('session.generalStaffSession')}</option>
                )}
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.subjectName} ({a.subjectCode || '—'}) — {a.className}
                    {isAdmin ? ` · ${a.teacherName}` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                {t('session.subjectScopeHint')}
              </p>
            </div>
          )}

          {/* Session Title */}
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
              {t('session.sessionTitleLabel')}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('session.sessionTitlePlaceholder')}
              className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
            />
          </div>

          {/* Duration & Radius */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-2">
                {t('session.durationLabel')}
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {DURATIONS.map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setDuration(mins)}
                    className={`py-2.5 rounded-xl border text-xs font-medium tabular-nums transition-colors ${
                      duration === mins
                        ? 'border-[#C25E00] bg-amber-50/70 dark:bg-amber-950/30 text-[#C25E00]'
                        : 'border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800'
                    }`}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-stone-700 dark:text-stone-300">
                  {t('session.radiusLabel')}
                </label>
                <span className="font-mono text-sm font-semibold text-[#C25E00] tabular-nums">
                  {radius} {t('common.meters')}
                </span>
              </div>
              <input
                type="range"
                min={20}
                max={500}
                step={5}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full accent-[#C25E00] cursor-pointer"
              />
              <div className="mt-1 flex justify-between text-[11px] text-stone-400 tabular-nums">
                <span>20 {t('common.meters')}</span>
                <span>250 {t('common.meters')}</span>
                <span>500 {t('common.meters')}</span>
              </div>
            </div>
          </div>

          {/* Interactive Leaflet Map */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                  {t('session.locationLabel')}
                </label>
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                  {t('session.locationHint')}
                </p>
              </div>
              <button
                type="button"
                disabled={locating}
                onClick={refreshGPS}
                className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 px-3 py-1.5 text-xs font-medium"
              >
                <Crosshair className="w-3.5 h-3.5 text-[#C25E00]" />
                <span>{locating ? t('session.locatingGps') : t('session.refreshGps')}</span>
              </button>
            </div>

            {gpsError && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{gpsError}</p>
            )}

            <LocationPickerMap
              lat={lat}
              lng={lng}
              radius={radius}
              onChange={(nextLat, nextLng) => {
                setLat(nextLat);
                setLng(nextLng);
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500 dark:text-stone-400 font-mono tabular-nums">
              <span>
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </span>
              {gpsAccuracy !== null && (
                <span>
                  {t('session.gpsReady')}: ±{gpsAccuracy} {t('common.meters')}
                </span>
              )}
            </div>

            {org && !org.location?.enabled && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t('session.locationCheckOffNote')}
              </p>
            )}
          </div>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <span className="text-xs text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>
                {effectiveClassId
                  ? `${selectedSlot?.className || selectedAssignment?.className}: ${formatNumber(totalExpected)}`
                  : `${targetRoleLabel}: ${formatNumber(totalExpected)}`}
              </span>
            </span>

            <button
              type="submit"
              disabled={starting}
              className="w-full sm:w-auto min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white px-6 py-3 text-sm font-medium transition-colors"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{starting ? t('session.starting') : t('session.startBtn')}</span>
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};
