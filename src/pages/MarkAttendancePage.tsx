import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CalendarClock,
  Camera,
  CameraOff,
  CheckCircle2,
  ClipboardList,
  MapPin,
  QrCode,
  RefreshCw,
  Search,
  CheckSquare,
  Square,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type {
  AttendanceRecord,
  AttendanceStatus,
  FacultyAssignment,
  UserProfile,
} from '../types';
import {
  bulkMarkAttendance,
  fetchAttendanceForManager,
  fetchAttendanceForOrg,
  markAttendanceManual,
  markAttendanceViaQR,
  type QRScanResult,
} from '../services/attendanceService';
import { subscribeFacultyAssignments } from '../services/academicService';
import { fetchManagerMembers, fetchOrgUsers, fetchUsersByClass } from '../services/userService';
import {
  getFirebaseErrorKey,
  getInitials,
  getOrgDateString,
  playBeep,
  triggerVibration,
} from '../utils/helpers';
import { Layout } from '../components/Layout';
import { CardSkeleton, EmptyState } from '../components/Skeletons';

// Strictly ONLY 3 statuses: PRESENT, ABSENT, LEAVE
const STATUSES: AttendanceStatus[] = ['present', 'absent', 'leave'];

export const MarkAttendancePage: React.FC = () => {
  const { profile, org, getRoleLabel } = useAuth();
  const { t, formatNumber } = useTranslation();
  const { showToast } = useToast();

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
  const today = useMemo(() => getOrgDateString(org?.timezone || 'Asia/Kolkata'), [org?.timezone]);
  const [tab, setTab] = useState<'scan' | 'manual'>('scan');

  // Assigned classes & subjects for subject-wise backup marking
  const [assignments, setAssignments] = useState<FacultyAssignment[]>([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>('');

  // Scanner state
  const [cameraRunning, setCameraRunning] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState('');
  const [lastResult, setLastResult] = useState<QRScanResult | null>(null);
  const [scannedTodayCount, setScannedTodayCount] = useState(0);
  const [processingScan, setProcessingScan] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const cooldownMapRef = useRef<Map<string, number>>(new Map());
  const busyScanRef = useRef(false);

  // Manual state
  const [selectedDate, setSelectedDate] = useState(today);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [dateRecords, setDateRecords] = useState<Map<string, AttendanceRecord>>(new Map());
  const [loadingManual, setLoadingManual] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [notesByUid, setNotesByUid] = useState<Record<string, string>>({});
  const [checkedUids, setCheckedUids] = useState<Set<string>>(new Set());
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  const canEditSelectedDate = isAdmin || selectedDate === today;

  useEffect(() => {
    if (!org || !profile) return;
    return subscribeFacultyAssignments(
      org.id,
      (list: FacultyAssignment[]) => {
        setAssignments(list);
        if (!selectedAssignmentId && list.length > 0 && !isAdmin) {
          setSelectedAssignmentId(list[0].id);
        }
      },
      isAdmin ? undefined : profile.uid
    );
  }, [org, profile, isAdmin, selectedAssignmentId]);

  const selectedAssignment = useMemo(
    () => assignments.find((a) => a.id === selectedAssignmentId) || null,
    [assignments, selectedAssignmentId]
  );

  // Load subordinates/class students and attendance for selectedDate & subject
  const loadManualData = useCallback(async () => {
    if (!org || !profile) return;
    setLoadingManual(true);
    try {
      let directPeople: UserProfile[] = [];
      let recs: AttendanceRecord[] = [];

      if (selectedAssignment) {
        [directPeople, recs] = await Promise.all([
          fetchUsersByClass(org.id, selectedAssignment.classId),
          isAdmin
            ? fetchAttendanceForOrg(org.id, {
                date: selectedDate,
                classId: selectedAssignment.classId,
                subjectId: selectedAssignment.subjectId,
              })
            : fetchAttendanceForManager(org.id, profile.uid, {
                date: selectedDate,
                subjectId: selectedAssignment.subjectId,
              }),
        ]);
      } else if (isAdmin) {
        [directPeople, recs] = await Promise.all([
          fetchOrgUsers(org.id, 'manager'),
          fetchAttendanceForOrg(org.id, { date: selectedDate }),
        ]);
      } else {
        [directPeople, recs] = await Promise.all([
          fetchManagerMembers(org.id, profile.uid),
          fetchAttendanceForManager(org.id, profile.uid, { date: selectedDate }),
        ]);
      }

      const activeDirect = directPeople.filter((p) => p.status === 'active');
      setPeople(activeDirect);

      const map = new Map<string, AttendanceRecord>();
      const notes: Record<string, string> = {};
      for (const r of recs) {
        if (selectedAssignment && r.subjectId && r.subjectId !== selectedAssignment.subjectId) {
          continue;
        }
        map.set(r.personUid, r);
        if (r.note) notes[r.personUid] = r.note;
      }
      setDateRecords(map);
      setNotesByUid(notes);

      if (selectedDate === today) {
        const directUidSet = new Set(activeDirect.map((p) => p.uid));
        const todayCount = Array.from(map.values()).filter(
          (r) => directUidSet.has(r.personUid) && r.status === 'present'
        ).length;
        setScannedTodayCount(todayCount);
      }
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setLoadingManual(false);
    }
  }, [org, profile, isAdmin, selectedAssignment, selectedDate, today, showToast, t]);

  useEffect(() => {
    loadManualData();
  }, [loadManualData]);

  const stopCamera = useCallback(async () => {
    const instance = scannerRef.current;
    scannerRef.current = null;
    if (instance) {
      try {
        if (instance.isScanning) await instance.stop();
        instance.clear();
      } catch {
        // Ignore
      }
    }
    setCameraRunning(false);
  }, []);

  const handleDecodedQR = useCallback(
    async (decodedText: string) => {
      if (!org || !profile) return;
      const now = Date.now();
      const lastTime = cooldownMapRef.current.get(decodedText) || 0;
      if (now - lastTime < 2000) return;
      if (busyScanRef.current) return;

      cooldownMapRef.current.set(decodedText, now);
      busyScanRef.current = true;
      setProcessingScan(true);

      try {
        const res = await markAttendanceViaQR({
          rawText: decodedText,
          org,
          marker: profile,
          subjectMeta: selectedAssignment
            ? {
                departmentId: selectedAssignment.departmentId || null,
                departmentName: selectedAssignment.departmentName || '',
                classId: selectedAssignment.classId,
                className: selectedAssignment.className,
                subjectId: selectedAssignment.subjectId,
                subjectName: selectedAssignment.subjectName,
                subjectCode: selectedAssignment.subjectCode || '',
              }
            : undefined,
        });
        setLastResult(res);
        if (res.ok) {
          playBeep(true);
          triggerVibration(true);
          setScannedTodayCount((c) => c + 1);
          if (selectedDate === today) {
            loadManualData();
          }
        } else {
          playBeep(false);
          triggerVibration(false);
        }
      } catch {
        playBeep(false);
        triggerVibration(false);
        setLastResult({ ok: false, code: 'invalidQr' });
      } finally {
        busyScanRef.current = false;
        setProcessingScan(false);
      }
    },
    [org, profile, selectedAssignment, selectedDate, today, loadManualData]
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
        const scanner = new Html5Qrcode('qr-reader');
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: mode },
          { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 },
          (decodedText) => {
            handleDecodedQR(decodedText);
          },
          () => {}
        );
        setCameraRunning(true);
      } catch {
        setCameraError(t('attendance.cameraPermissionDesc'));
        setCameraRunning(false);
      }
    },
    [facingMode, stopCamera, handleDecodedQR, t]
  );

  const handleSwitchCamera = async () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    if (cameraRunning) await startCamera(next);
  };

  useEffect(() => {
    if (tab !== 'scan' && cameraRunning) stopCamera();
  }, [tab, cameraRunning, stopCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const filteredPeople = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.memberId || '').toLowerCase().includes(q) ||
        (p.rollNumber || '').toLowerCase().includes(q) ||
        (p.enrollmentNumber || '').toLowerCase().includes(q)
    );
  }, [people, searchQuery]);

  const subjectMeta = selectedAssignment
    ? {
        departmentId: selectedAssignment.departmentId || null,
        departmentName: selectedAssignment.departmentName || '',
        classId: selectedAssignment.classId,
        className: selectedAssignment.className,
        subjectId: selectedAssignment.subjectId,
        subjectName: selectedAssignment.subjectName,
        subjectCode: selectedAssignment.subjectCode || '',
      }
    : undefined;

  const handleSingleMark = async (person: UserProfile, status: AttendanceStatus) => {
    if (!org || !profile || !canEditSelectedDate) return;
    setSavingUid(person.uid);
    try {
      await markAttendanceManual({
        org,
        marker: profile,
        person,
        date: selectedDate,
        status,
        note: notesByUid[person.uid] || '',
        subjectMeta,
      });
      showToast(t('attendance.savedToast'), 'success');
      await loadManualData();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSavingUid(null);
    }
  };

  const handleSelectAllPresent = () => {
    if (checkedUids.size === filteredPeople.length) {
      setCheckedUids(new Set());
    } else {
      setCheckedUids(new Set(filteredPeople.map((p) => p.uid)));
    }
  };

  const toggleCheck = (uid: string) => {
    setCheckedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const handleSaveBulkPresent = async () => {
    if (!org || !profile || !canEditSelectedDate || checkedUids.size === 0) return;
    setBulkSaving(true);
    try {
      const entries = people
        .filter((p) => checkedUids.has(p.uid))
        .map((person) => ({
          person,
          status: 'present' as AttendanceStatus,
          note: notesByUid[person.uid] || '',
        }));
      await bulkMarkAttendance({
        org,
        marker: profile,
        entries,
        date: selectedDate,
        subjectMeta,
      });
      showToast(t('attendance.bulkSavedToast'), 'success');
      setCheckedUids(new Set());
      await loadManualData();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setBulkSaving(false);
    }
  };

  const targetRoleLabel = selectedAssignment
    ? `${selectedAssignment.subjectName} · ${selectedAssignment.className}`
    : isAdmin
    ? getRoleLabel('manager')
    : getRoleLabel('member');

  return (
    <Layout title={t('attendance.title')}>
      <div className="space-y-6">
        {/* Backup Mode Banner */}
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/30 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-xs sm:text-sm text-amber-900 dark:text-amber-200">
            {t('attendance.backupNotice')}
          </p>
          <Link
            to="/attendance"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#C25E00] hover:underline whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t('attendance.backToLive')}</span>
          </Link>
        </div>

        {/* Header & Mode Switch */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {t('attendance.title')}
            </h2>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400 flex flex-wrap items-center gap-2">
              <span>{targetRoleLabel}</span>
              <span>·</span>
              <span className="tabular-nums">
                {t('attendance.scannedToday')}:{' '}
                <strong className="text-stone-900 dark:text-stone-100">
                  {formatNumber(scannedTodayCount)}
                </strong>
              </span>
              {org?.location?.enabled && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 text-[#C25E00]">
                    <MapPin className="w-3.5 h-3.5" />
                    GPS
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:inline-flex w-full sm:w-auto p-1 rounded-xl bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 sm:self-start">
            <button
              type="button"
              onClick={() => setTab('scan')}
              className={`min-h-[40px] px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap inline-flex items-center justify-center gap-1.5 ${
                tab === 'scan'
                  ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400'
              }`}
            >
              <QrCode className="w-4 h-4 shrink-0" />
              <span>{t('attendance.tabScan')}</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('manual')}
              className={`min-h-[40px] px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap inline-flex items-center justify-center gap-1.5 ${
                tab === 'manual'
                  ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400'
              }`}
            >
              <ClipboardList className="w-4 h-4 shrink-0" />
              <span>{t('attendance.tabManual')}</span>
            </button>
          </div>
        </div>

        {/* Assigned Class / Subject Selector */}
        {assignments.length > 0 && (
          <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <label className="text-xs font-semibold text-stone-600 dark:text-stone-300 flex items-center gap-1.5 whitespace-nowrap">
              <BookOpen className="w-4 h-4 text-[#C25E00]" />
              <span>{t('session.selectAssignedSubject')}:</span>
            </label>
            <select
              value={selectedAssignmentId}
              onChange={(e) => setSelectedAssignmentId(e.target.value)}
              className="flex-1 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
            >
              {isAdmin && <option value="">{t('session.generalStaffSession')}</option>}
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.subjectName} ({a.subjectCode || '—'}) — {a.className}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* SCAN QR TAB */}
        {tab === 'scan' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-6">
              <div className="relative overflow-hidden rounded-xl bg-stone-950 min-h-[290px] sm:min-h-[340px] flex items-center justify-center">
                <div id="qr-reader" className="w-full" />
                {!cameraRunning && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-stone-100 dark:bg-stone-900">
                    <Camera className="w-10 h-10 text-stone-400 mb-3" />
                    <p className="text-sm font-medium text-stone-800 dark:text-stone-200 max-w-xs">
                      {cameraError || t('attendance.cameraActiveHint')}
                    </p>
                    <button
                      type="button"
                      onClick={() => startCamera(facingMode)}
                      className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-6 py-3 text-base font-medium transition-colors"
                    >
                      <Camera className="w-5 h-5" />
                      <span>{t('attendance.startCamera')}</span>
                    </button>
                  </div>
                )}
              </div>

              {cameraError && !cameraRunning && (
                <div className="mt-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 text-xs text-amber-900 dark:text-amber-200">
                  <p className="font-semibold">{t('attendance.cameraPermissionTitle')}</p>
                  <p className="mt-1">{t('attendance.cameraPermissionDesc')}</p>
                </div>
              )}

              <div className="mt-4 grid grid-cols-1 min-[360px]:grid-cols-2 gap-3">
                {cameraRunning ? (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 py-3 text-sm font-medium text-stone-800 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-800"
                  >
                    <CameraOff className="w-4 h-4 shrink-0" />
                    <span>{t('attendance.stopCamera')}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => startCamera(facingMode)}
                    className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white py-3 text-sm font-medium"
                  >
                    <Camera className="w-4 h-4 shrink-0" />
                    <span>{t('attendance.startCamera')}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSwitchCamera}
                  className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 py-3 text-sm font-medium text-stone-800 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-800"
                >
                  <RefreshCw className="w-4 h-4 shrink-0" />
                  <span>{t('attendance.switchCamera')}</span>
                </button>
              </div>
            </div>

            <div className="lg:col-span-5 space-y-4">
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                    {t('attendance.scannedToday')}
                  </span>
                  <span className="text-2xl font-bold tabular-nums text-[#C25E00]">
                    {formatNumber(scannedTodayCount)}
                  </span>
                </div>
              </div>

              {processingScan && (
                <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6 text-center text-sm text-stone-500">
                  {t('common.loading')}
                </div>
              )}

              {lastResult && !processingScan && (
                <div
                  role="status"
                  className={`rounded-2xl border p-6 ${
                    lastResult.ok
                      ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30'
                      : 'border-red-300 dark:border-red-800 bg-red-50/70 dark:bg-red-950/30'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold shrink-0 ${
                        lastResult.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                      }`}
                    >
                      {lastResult.personName ? (
                        getInitials(lastResult.personName)
                      ) : lastResult.ok ? (
                        <CheckCircle2 className="w-7 h-7" />
                      ) : (
                        <AlertCircle className="w-7 h-7" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-semibold ${
                          lastResult.ok
                            ? 'text-emerald-800 dark:text-emerald-300'
                            : 'text-red-800 dark:text-red-300'
                        }`}
                      >
                        {t(`attendance.${lastResult.code}`)}
                      </p>
                      {lastResult.personName && (
                        <p className="mt-0.5 text-lg font-bold text-stone-900 dark:text-stone-100 truncate">
                          {lastResult.personName}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-stone-600 dark:text-stone-400 font-mono tabular-nums">
                        {lastResult.memberId ? `${lastResult.memberId}` : ''}
                        {lastResult.timeStr ? ` · ${lastResult.timeStr}` : ''}
                        {lastResult.distance !== undefined ? ` · ${lastResult.distance}m` : ''}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MANUAL TAB (Strictly PRESENT / ABSENT / LEAVE) */}
        {tab === 'manual' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex flex-col sm:flex-row gap-3 flex-1">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('attendance.manualSearchPlaceholder')}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent pl-10 pr-4 py-2 text-sm"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs text-stone-500 whitespace-nowrap">
                    {t('attendance.selectDate')}
                  </label>
                  <input
                    type="date"
                    value={selectedDate}
                    max={today}
                    disabled={!isAdmin}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm disabled:opacity-60"
                  />
                </div>
              </div>

              {canEditSelectedDate && filteredPeople.length > 0 && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleSelectAllPresent}
                    className="inline-flex items-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 px-3.5 py-2 text-sm font-medium hover:bg-stone-50 dark:hover:bg-stone-800"
                  >
                    {checkedUids.size === filteredPeople.length ? (
                      <CheckSquare className="w-4 h-4 text-[#C25E00]" />
                    ) : (
                      <Square className="w-4 h-4 text-stone-400" />
                    )}
                    <span>{t('attendance.markAllPresent')}</span>
                  </button>

                  {checkedUids.size > 0 && (
                    <button
                      type="button"
                      disabled={bulkSaving}
                      onClick={handleSaveBulkPresent}
                      className="rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white px-4 py-2 text-sm font-medium"
                    >
                      {bulkSaving
                        ? t('common.saving')
                        : `${t('attendance.markSelectedBtn')} (${checkedUids.size})`}
                    </button>
                  )}
                </div>
              )}
            </div>

            <p className="text-xs text-stone-500 dark:text-stone-400">
              {isAdmin
                ? t('attendance.adminCanCorrectAny')
                : canEditSelectedDate
                ? t('attendance.canCorrectToday')
                : t('attendance.cannotCorrectPast')}
            </p>

            {loadingManual ? (
              <CardSkeleton rows={5} />
            ) : filteredPeople.length === 0 ? (
              <EmptyState
                title={t('attendance.noActivePeople')}
                description={t('people.emptyDesc')}
              />
            ) : (
              <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] divide-y divide-stone-100 dark:divide-stone-800">
                {filteredPeople.map((person) => {
                  const rec = dateRecords.get(person.uid);
                  const isChecked = checkedUids.has(person.uid);
                  return (
                    <div
                      key={person.uid}
                      className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {canEditSelectedDate && (
                          <button
                            type="button"
                            onClick={() => toggleCheck(person.uid)}
                            aria-label={`Select ${person.name}`}
                            className="mt-0.5 text-stone-400 hover:text-[#C25E00]"
                          >
                            {isChecked ? (
                              <CheckSquare className="w-5 h-5 text-[#C25E00]" />
                            ) : (
                              <Square className="w-5 h-5" />
                            )}
                          </button>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                            {person.name}
                          </p>
                          <p className="text-xs font-mono text-stone-500 dark:text-stone-400">
                            {person.memberId}
                            {rec ? ` · ${t(`common.${rec.status}`)} (${t(`common.${rec.method}`)})` : ''}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <input
                          type="text"
                          value={notesByUid[person.uid] || ''}
                          onChange={(e) =>
                            setNotesByUid((prev) => ({ ...prev, [person.uid]: e.target.value }))
                          }
                          placeholder={t('attendance.notePlaceholder')}
                          disabled={!canEditSelectedDate}
                          className="rounded-lg border border-stone-200 dark:border-stone-800 bg-transparent px-3 py-1.5 text-xs w-full sm:w-40"
                        />

                        <div className="grid grid-cols-3 gap-1.5">
                          {STATUSES.map((st) => {
                            const active = rec?.status === st;
                            const activeStyle =
                              st === 'present'
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : st === 'absent'
                                ? 'bg-red-600 text-white border-red-600'
                                : 'bg-sky-600 text-white border-sky-600';
                            const StatusIcon =
                              st === 'present'
                                ? CheckCircle2
                                : st === 'absent'
                                ? XCircle
                                : CalendarClock;
                            return (
                              <button
                                key={st}
                                type="button"
                                disabled={!canEditSelectedDate || savingUid === person.uid}
                                onClick={() => handleSingleMark(person, st)}
                                className={`min-h-[40px] px-2 sm:px-3 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap inline-flex items-center justify-center gap-1 ${
                                  active
                                    ? activeStyle
                                    : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800'
                                }`}
                              >
                                <StatusIcon className="w-3.5 h-3.5 shrink-0" />
                                <span>{t(`common.${st}`)}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};
