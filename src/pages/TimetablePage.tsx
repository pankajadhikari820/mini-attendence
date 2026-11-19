import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Play, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type {
  AcademicClass,
  FacultyAssignment,
  Subject,
  TimetableSlot,
  UserProfile,
} from '../types';
import {
  createTimetableSlot,
  deleteTimetableSlot,
  detectTimetableConflicts,
  fetchClasses,
  fetchFacultyAssignments,
  fetchLinkedStudentsForParent,
  fetchSubjects,
  fetchTimetableForOrg,
  subscribeTimetableForClass,
  subscribeTimetableForTeacher,
} from '../services/academicService';
import { fetchOrgUsers } from '../services/userService';
import {
  formatTimeRange12h,
  getFirebaseErrorKey,
  getOrgWeekdayIndex,
} from '../utils/helpers';
import { Layout } from '../components/Layout';
import { CardSkeleton, EmptyState } from '../components/Skeletons';

const WEEKDAYS = [
  { day: 1, en: 'Monday', hi: 'सोमवार' },
  { day: 2, en: 'Tuesday', hi: 'मंगलवार' },
  { day: 3, en: 'Wednesday', hi: 'बुधवार' },
  { day: 4, en: 'Thursday', hi: 'गुरुवार' },
  { day: 5, en: 'Friday', hi: 'शुक्रवार' },
  { day: 6, en: 'Saturday', hi: 'शनिवार' },
];

export const TimetablePage: React.FC = () => {
  const { profile, org } = useAuth();
  const { t, language } = useTranslation();
  const { showToast } = useToast();

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
  const isTeacher = profile?.role === 'manager';
  const todayWeekday = useMemo(
    () => getOrgWeekdayIndex(org?.timezone || 'Asia/Kolkata'),
    [org?.timezone]
  );

  const [loading, setLoading] = useState(true);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [classes, setClasses] = useState<AcademicClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<UserProfile[]>([]);
  const [assignments, setAssignments] = useState<FacultyAssignment[]>([]);
  const [filterClassId, setFilterClassId] = useState<string>('all');
  const [filterTeacherUid, setFilterTeacherUid] = useState<string>('all');

  // Admin add-slot form state
  const [dayOfWeek, setDayOfWeek] = useState<number>(todayWeekday === 0 ? 1 : todayWeekday);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [formClassId, setFormClassId] = useState('');
  const [formSubjectId, setFormSubjectId] = useState('');
  const [formTeacherUid, setFormTeacherUid] = useState('');
  const [formRoom, setFormRoom] = useState('');
  const [saving, setSaving] = useState(false);

  const loadAdminMeta = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    try {
      const [allSlots, clsList, subList, allUsers, asgns] = await Promise.all([
        fetchTimetableForOrg(org.id),
        fetchClasses(org.id),
        fetchSubjects(org.id),
        fetchOrgUsers(org.id, 'manager'),
        fetchFacultyAssignments(org.id),
      ]);
      setSlots(allSlots);
      setClasses(clsList);
      setSubjects(subList);
      const activeMgrs = (allUsers as UserProfile[]).filter((u: UserProfile) => u.status === 'active');
      setTeachers(activeMgrs);
      setAssignments(asgns);
      if (!formClassId && clsList[0]) setFormClassId(clsList[0].id);
      if (!formSubjectId && subList[0]) setFormSubjectId(subList[0].id);
      if (!formTeacherUid && activeMgrs[0]) setFormTeacherUid(activeMgrs[0].uid);
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setLoading(false);
    }
  }, [org, formClassId, formSubjectId, formTeacherUid, showToast, t]);

  useEffect(() => {
    if (!org || !profile) return;

    if (isAdmin) {
      loadAdminMeta();
      return;
    }

    if (isTeacher) {
      setLoading(true);
      return subscribeTimetableForTeacher(org.id, profile.uid, (list: TimetableSlot[]) => {
        setSlots(list);
        setLoading(false);
      });
    }

    if (profile.role === 'member') {
      if (!profile.classId) {
        setSlots([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      return subscribeTimetableForClass(org.id, profile.classId, (list: TimetableSlot[]) => {
        setSlots(list);
        setLoading(false);
      });
    }

    if (profile.role === 'parent') {
      setLoading(true);
      let unsub: (() => void) | undefined;
      fetchLinkedStudentsForParent(profile)
        .then((children) => {
          const firstClassId = children.find((c) => c.classId)?.classId;
          if (!firstClassId) {
            setSlots([]);
            setLoading(false);
            return;
          }
          unsub = subscribeTimetableForClass(org.id, firstClassId, (list) => {
            setSlots(list);
            setLoading(false);
          });
        })
        .catch(() => setLoading(false));
      return () => {
        if (unsub) unsub();
      };
    }
  }, [org, profile, isAdmin, isTeacher, loadAdminMeta]);

  // Live conflict detection before Admin saves a new timetable slot
  const pendingConflicts = useMemo(() => {
    if (!isAdmin || !formClassId || !formTeacherUid || !startTime || !endTime) return [];
    return detectTimetableConflicts(slots, {
      dayOfWeek,
      startTime,
      endTime,
      classId: formClassId,
      teacherUid: formTeacherUid,
      classroom: formRoom,
    });
  }, [isAdmin, slots, dayOfWeek, startTime, endTime, formClassId, formTeacherUid, formRoom]);

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !profile) return;
    if (pendingConflicts.length > 0) {
      showToast(t('timetable.conflictBlocked'), 'error');
      return;
    }
    const cls = classes.find((c) => c.id === formClassId);
    const sub = subjects.find((s) => s.id === formSubjectId);
    const te = teachers.find((x) => x.uid === formTeacherUid);
    if (!cls || !sub || !te) return;

    setSaving(true);
    try {
      await createTimetableSlot({
        orgId: org.id,
        dayOfWeek,
        startTime,
        endTime,
        academicClass: cls,
        subject: sub,
        teacher: te,
        classroom: formRoom.trim() || cls.classroom || '',
        actor: profile,
      });
      showToast(t('common.saved'), 'success');
      await loadAdminMeta();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Auto-fill teacher when Admin picks a Class + Subject that already has an assignment
  useEffect(() => {
    if (!isAdmin || !formClassId || !formSubjectId) return;
    const match = assignments.find(
      (a) => a.classId === formClassId && a.subjectId === formSubjectId
    );
    if (match) setFormTeacherUid(match.teacherUid);
  }, [isAdmin, formClassId, formSubjectId, assignments]);

  const visibleSlots = useMemo(() => {
    return slots.filter((s) => {
      if (filterClassId !== 'all' && s.classId !== filterClassId) return false;
      if (filterTeacherUid !== 'all' && s.teacherUid !== filterTeacherUid) return false;
      return true;
    });
  }, [slots, filterClassId, filterTeacherUid]);

  return (
    <Layout title={t('nav.timetable')}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
              {t('timetable.title')}
            </h2>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {t('timetable.subtitle')}
            </p>
          </div>

          {isAdmin && (classes.length > 0 || teachers.length > 0) && (
            <div className="flex flex-wrap gap-2">
              <select
                value={filterClassId}
                onChange={(e) => setFilterClassId(e.target.value)}
                className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] px-3 py-2 text-xs sm:text-sm"
              >
                <option value="all">{t('academics.allClasses')}</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={filterTeacherUid}
                onChange={(e) => setFilterTeacherUid(e.target.value)}
                className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] px-3 py-2 text-xs sm:text-sm"
              >
                <option value="all">{t('timetable.allTeachers')}</option>
                {teachers.map((te) => (
                  <option key={te.uid} value={te.uid}>
                    {te.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Admin Add Lecture Slot with Live Conflict Detection */}
        {isAdmin && (
          <form
            onSubmit={handleAddSlot}
            className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 space-y-4"
          >
            <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              {t('timetable.addSlotTitle')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">{t('timetable.day')}</label>
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs sm:text-sm"
                >
                  {WEEKDAYS.map((w) => (
                    <option key={w.day} value={w.day}>
                      {language === 'hi' ? w.hi : w.en}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t('timetable.startTime')}</label>
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-xs sm:text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t('timetable.endTime')}</label>
                <input
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-xs sm:text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t('academics.classSection')}</label>
                <select
                  required
                  value={formClassId}
                  onChange={(e) => setFormClassId(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs sm:text-sm"
                >
                  <option value="">—</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t('academics.subject')}</label>
                <select
                  required
                  value={formSubjectId}
                  onChange={(e) => setFormSubjectId(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs sm:text-sm"
                >
                  <option value="">—</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t('academics.teacher')}</label>
                <select
                  required
                  value={formTeacherUid}
                  onChange={(e) => setFormTeacherUid(e.target.value)}
                  className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-xs sm:text-sm"
                >
                  <option value="">—</option>
                  {teachers.map((te) => (
                    <option key={te.uid} value={te.uid}>
                      {te.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <input
                type="text"
                value={formRoom}
                onChange={(e) => setFormRoom(e.target.value)}
                placeholder={t('academics.classroom')}
                className="sm:w-56 rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-xs sm:text-sm"
              />
              <button
                type="submit"
                disabled={saving || pendingConflicts.length > 0 || !formClassId || !formSubjectId || !formTeacherUid}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-50 text-white px-5 py-2 text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                <span>{t('timetable.addSlotBtn')}</span>
              </button>
            </div>

            {pendingConflicts.length > 0 && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs text-red-800 dark:text-red-300 space-y-1"
              >
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{t('timetable.conflictDetected')}</span>
                </p>
                {pendingConflicts.map((c, idx) => (
                  <p key={idx}>• {c.message}</p>
                ))}
              </div>
            )}
          </form>
        )}

        {/* Weekly Grid */}
        {loading ? (
          <CardSkeleton rows={4} />
        ) : visibleSlots.length === 0 ? (
          <EmptyState
            title={t('timetable.emptyTitle')}
            description={t('timetable.emptyDesc')}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {WEEKDAYS.map((w) => {
              const daySlots = visibleSlots.filter((s) => s.dayOfWeek === w.day);
              const isToday = todayWeekday === w.day;
              return (
                <section
                  key={w.day}
                  className={`rounded-2xl border bg-white dark:bg-[#161619] p-4 space-y-3 ${
                    isToday
                      ? 'border-[#C25E00] ring-1 ring-[#C25E00]/30'
                      : 'border-stone-200 dark:border-stone-800'
                  }`}
                >
                  <div className="flex items-center justify-between pb-2 border-b border-stone-100 dark:border-stone-800">
                    <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 text-[#C25E00]" />
                      <span>{language === 'hi' ? w.hi : w.en}</span>
                    </h3>
                    {isToday && (
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#C25E00]">
                        {t('common.today')}
                      </span>
                    )}
                  </div>

                  {daySlots.length === 0 ? (
                    <p className="text-xs text-stone-400 py-4 text-center">
                      {t('timetable.noClassesDay')}
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {daySlots.map((slot) => (
                        <div
                          key={slot.id}
                          className="rounded-xl border border-stone-200/80 dark:border-stone-800 bg-[#FAF9F6] dark:bg-stone-900/60 p-3 space-y-1.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                                {slot.subjectName}
                              </p>
                              <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
                                {slot.className}
                              </p>
                            </div>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteTimetableSlot(slot.id);
                                  showToast(t('common.deleted'), 'info');
                                  await loadAdminMeta();
                                }}
                                aria-label={t('common.delete')}
                                className="text-stone-400 hover:text-red-600 p-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500 dark:text-stone-400">
                            <span className="font-mono tabular-nums text-[#C25E00]">
                              {formatTimeRange12h(slot.startTime, slot.endTime)}
                            </span>
                            <span className="truncate">
                              {slot.teacherName}
                              {slot.classroom ? ` · ${slot.classroom}` : ''}
                            </span>
                          </div>

                          {(isTeacher || isAdmin) && isToday && (
                            <Link
                              to={`/attendance?slotId=${slot.id}`}
                              className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-[#C25E00] hover:bg-[#A84F00] text-white px-3 py-1.5 text-xs font-medium"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>{t('teacher.startLectureBtn')}</span>
                            </Link>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
};
