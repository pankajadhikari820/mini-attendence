import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Building,
  Check,
  GraduationCap,
  Link2,
  Plus,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from '../context/ToastContext';
import type {
  AcademicClass,
  Department,
  FacultyAssignment,
  ParentLink,
  Subject,
  UserProfile,
} from '../types';
import {
  assignFacultyToSubject,
  createAcademicClass,
  createDepartment,
  createSubject,
  deleteAcademicClass,
  deleteDepartment,
  deleteFacultyAssignment,
  deleteSubject,
  fetchClasses,
  fetchDepartments,
  fetchFacultyAssignments,
  fetchParentLinks,
  fetchSubjects,
  linkParentDirectly,
  rejectParentLink,
  verifyParentLink,
} from '../services/academicService';
import { fetchOrgUsers } from '../services/userService';
import { getFirebaseErrorKey } from '../utils/helpers';
import { Layout } from '../components/Layout';
import { CardSkeleton, EmptyState } from '../components/Skeletons';

type TabId = 'departments' | 'classes' | 'subjects' | 'assignments' | 'parents';

export const AcademicsPage: React.FC = () => {
  const { profile, org } = useAuth();
  const { t, formatNumber } = useTranslation();
  const { showToast } = useToast();

  const [tab, setTab] = useState<TabId>('assignments');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [classes, setClasses] = useState<AcademicClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [assignments, setAssignments] = useState<FacultyAssignment[]>([]);
  const [parentLinks, setParentLinks] = useState<ParentLink[]>([]);
  const [teachers, setTeachers] = useState<UserProfile[]>([]);
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [parents, setParents] = useState<UserProfile[]>([]);

  // Form states
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');

  const [clsDeptId, setClsDeptId] = useState('');
  const [clsCourse, setClsCourse] = useState('');
  const [clsSemester, setClsSemester] = useState('Sem 1');
  const [clsSection, setClsSection] = useState('Sec A');
  const [clsRoom, setClsRoom] = useState('');

  const [subDeptId, setSubDeptId] = useState('');
  const [subName, setSubName] = useState('');
  const [subCode, setSubCode] = useState('');

  const [asgnTeacherUid, setAsgnTeacherUid] = useState('');
  const [asgnClassId, setAsgnClassId] = useState('');
  const [asgnSubjectId, setAsgnSubjectId] = useState('');

  const [linkParentUid, setLinkParentUid] = useState('');
  const [linkStudentUid, setLinkStudentUid] = useState('');
  const [linkRel, setLinkRel] = useState('Parent');

  const loadAll = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    try {
      const [depts, cls, subs, asgns, pLinks, allUsers] = await Promise.all([
        fetchDepartments(org.id),
        fetchClasses(org.id),
        fetchSubjects(org.id),
        fetchFacultyAssignments(org.id),
        fetchParentLinks(org.id),
        fetchOrgUsers(org.id),
      ]);
      setDepartments(depts);
      setClasses(cls);
      setSubjects(subs);
      setAssignments(asgns);
      setParentLinks(pLinks);

      const mgrs = allUsers.filter((u) => u.role === 'manager' && u.status === 'active');
      const mems = allUsers.filter((u) => u.role === 'member' && u.status === 'active');
      const pars = allUsers.filter((u) => u.role === 'parent');
      setTeachers(mgrs);
      setStudents(mems);
      setParents(pars);

      if (!clsDeptId && depts[0]) setClsDeptId(depts[0].id);
      if (!subDeptId && depts[0]) setSubDeptId(depts[0].id);
      if (!asgnTeacherUid && mgrs[0]) setAsgnTeacherUid(mgrs[0].uid);
      if (!asgnClassId && cls[0]) setAsgnClassId(cls[0].id);
      if (!asgnSubjectId && subs[0]) setAsgnSubjectId(subs[0].id);
      if (!linkParentUid && pars[0]) setLinkParentUid(pars[0].uid);
      if (!linkStudentUid && mems[0]) setLinkStudentUid(mems[0].uid);
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setLoading(false);
    }
  }, [org, clsDeptId, subDeptId, asgnTeacherUid, asgnClassId, asgnSubjectId, linkParentUid, linkStudentUid, showToast, t]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const studentNameMap = useMemo(() => {
    const m = new Map<string, UserProfile>();
    for (const s of students) m.set(s.uid, s);
    return m;
  }, [students]);

  const handleAddDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !profile || !deptName.trim()) return;
    setSaving(true);
    try {
      await createDepartment({
        orgId: org.id,
        name: deptName,
        code: deptCode,
        actor: profile,
      });
      setDeptName('');
      setDeptCode('');
      showToast(t('common.saved'), 'success');
      await loadAll();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !profile || !clsCourse.trim()) return;
    setSaving(true);
    try {
      const dept = departments.find((d) => d.id === clsDeptId);
      const displayName = [clsCourse.trim(), clsSemester.trim(), clsSection.trim()]
        .filter(Boolean)
        .join(' · ');
      await createAcademicClass({
        orgId: org.id,
        departmentId: dept?.id || null,
        departmentName: dept?.name || '',
        name: displayName,
        courseName: clsCourse.trim(),
        semester: clsSemester.trim(),
        section: clsSection.trim(),
        classroom: clsRoom.trim(),
        actor: profile,
      });
      setClsCourse('');
      setClsRoom('');
      showToast(t('common.saved'), 'success');
      await loadAll();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !profile || !subName.trim()) return;
    setSaving(true);
    try {
      const dept = departments.find((d) => d.id === subDeptId);
      await createSubject({
        orgId: org.id,
        departmentId: dept?.id || null,
        departmentName: dept?.name || '',
        name: subName.trim(),
        code: subCode.trim(),
        actor: profile,
      });
      setSubName('');
      setSubCode('');
      showToast(t('common.saved'), 'success');
      await loadAll();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !profile || !asgnTeacherUid || !asgnClassId || !asgnSubjectId) return;
    const teacher = teachers.find((x) => x.uid === asgnTeacherUid);
    const cls = classes.find((x) => x.id === asgnClassId);
    const sub = subjects.find((x) => x.id === asgnSubjectId);
    if (!teacher || !cls || !sub) return;

    const duplicate = assignments.some(
      (a) =>
        a.teacherUid === teacher.uid &&
        a.classId === cls.id &&
        a.subjectId === sub.id
    );
    if (duplicate) {
      showToast(t('academics.assignmentExists'), 'info');
      return;
    }

    setSaving(true);
    try {
      await assignFacultyToSubject({
        orgId: org.id,
        teacher,
        academicClass: cls,
        subject: sub,
        actor: profile,
      });
      showToast(t('common.saved'), 'success');
      await loadAll();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDirectParentLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !profile || !linkParentUid || !linkStudentUid) return;
    const par = parents.find((p) => p.uid === linkParentUid);
    const stu = students.find((s) => s.uid === linkStudentUid);
    if (!par || !stu) return;

    setSaving(true);
    try {
      await linkParentDirectly({
        orgId: org.id,
        parent: par,
        student: stu,
        relationship: linkRel,
        actor: profile,
      });
      showToast(t('academics.parentLinkedToast'), 'success');
      await loadAll();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyParent = async (link: ParentLink) => {
    if (!profile) return;
    try {
      await verifyParentLink(link, profile);
      showToast(t('academics.parentVerifiedToast'), 'success');
      await loadAll();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    }
  };

  const handleRejectParent = async (link: ParentLink) => {
    if (!profile) return;
    try {
      await rejectParentLink(link, profile);
      showToast(t('people.rejectedToast'), 'info');
      await loadAll();
    } catch (err) {
      showToast(t(getFirebaseErrorKey(err)), 'error');
    }
  };

  const pendingLinkCount = parentLinks.filter((l) => l.status === 'pending').length;

  const tabs: Array<{ id: TabId; label: string; icon: React.FC<{ className?: string }>; count: number }> = [
    { id: 'assignments', label: t('academics.tabAssignments'), icon: UserCheck, count: assignments.length },
    { id: 'classes', label: t('academics.tabClasses'), icon: GraduationCap, count: classes.length },
    { id: 'subjects', label: t('academics.tabSubjects'), icon: BookOpen, count: subjects.length },
    { id: 'departments', label: t('academics.tabDepartments'), icon: Building, count: departments.length },
    { id: 'parents', label: t('academics.tabParents'), icon: Link2, count: pendingLinkCount },
  ];

  return (
    <Layout title={t('nav.academics')}>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
            {t('academics.title')}
          </h2>
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
            {t('academics.subtitle')}
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-stone-200 dark:border-stone-800 pb-3">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors ${
                  active
                    ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                    : 'border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
                <span className="font-mono text-xs opacity-75 tabular-nums">
                  {formatNumber(item.count)}
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <CardSkeleton rows={4} />
        ) : (
          <>
            {/* FACULTY ASSIGNMENTS TAB */}
            {tab === 'assignments' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <form
                  onSubmit={handleAddAssignment}
                  className="lg:col-span-4 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 space-y-4"
                >
                  <h3 className="text-base font-semibold">{t('academics.assignFacultyTitle')}</h3>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {t('academics.assignFacultyHint')}
                  </p>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t('academics.teacher')}</label>
                    <select
                      required
                      value={asgnTeacherUid}
                      onChange={(e) => setAsgnTeacherUid(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
                    >
                      <option value="">—</option>
                      {teachers.map((te) => (
                        <option key={te.uid} value={te.uid}>
                          {te.name} ({te.memberId})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t('academics.classSection')}</label>
                    <select
                      required
                      value={asgnClassId}
                      onChange={(e) => setAsgnClassId(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
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
                      value={asgnSubjectId}
                      onChange={(e) => setAsgnSubjectId(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
                    >
                      <option value="">—</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} {s.code ? `(${s.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={saving || !asgnTeacherUid || !asgnClassId || !asgnSubjectId}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-50 text-white py-2.5 text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t('academics.assignBtn')}</span>
                  </button>
                </form>

                <div className="lg:col-span-8">
                  {assignments.length === 0 ? (
                    <EmptyState
                      title={t('academics.noAssignments')}
                      description={t('academics.assignFacultyHint')}
                    />
                  ) : (
                    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] divide-y divide-stone-100 dark:divide-stone-800">
                      {assignments.map((a) => (
                        <div key={a.id} className="p-4 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                              {a.subjectName}
                              {a.subjectCode ? (
                                <span className="ml-1.5 font-mono text-xs text-stone-400">
                                  {a.subjectCode}
                                </span>
                              ) : null}
                            </p>
                            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 truncate">
                              {a.teacherName} · {a.className}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteFacultyAssignment(a.id);
                              showToast(t('common.deleted'), 'info');
                              await loadAll();
                            }}
                            aria-label={t('common.delete')}
                            className="p-2 rounded-lg text-stone-400 hover:text-red-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CLASSES & SECTIONS TAB */}
            {tab === 'classes' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <form
                  onSubmit={handleAddClass}
                  className="lg:col-span-4 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 space-y-4"
                >
                  <h3 className="text-base font-semibold">{t('academics.addClassTitle')}</h3>
                  {departments.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium mb-1">{t('academics.department')}</label>
                      <select
                        value={clsDeptId}
                        onChange={(e) => setClsDeptId(e.target.value)}
                        className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
                      >
                        <option value="">—</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium mb-1">{t('academics.courseName')}</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. BCA AI & DS"
                      value={clsCourse}
                      onChange={(e) => setClsCourse(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">{t('academics.semester')}</label>
                      <input
                        type="text"
                        placeholder="Sem 2"
                        value={clsSemester}
                        onChange={(e) => setClsSemester(e.target.value)}
                        className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t('academics.section')}</label>
                      <input
                        type="text"
                        placeholder="Sec C"
                        value={clsSection}
                        onChange={(e) => setClsSection(e.target.value)}
                        className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t('academics.classroom')}</label>
                    <input
                      type="text"
                      placeholder="e.g. Room 204 / Lab 2"
                      value={clsRoom}
                      onChange={(e) => setClsRoom(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white py-2.5 text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t('academics.addClassBtn')}</span>
                  </button>
                </form>

                <div className="lg:col-span-8">
                  {classes.length === 0 ? (
                    <EmptyState
                      title={t('academics.noClasses')}
                      description={t('academics.subtitle')}
                    />
                  ) : (
                    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] divide-y divide-stone-100 dark:divide-stone-800">
                      {classes.map((c) => (
                        <div key={c.id} className="p-4 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                              {c.name}
                            </p>
                            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                              {c.departmentName || t('academics.department')}
                              {c.classroom ? ` · ${c.classroom}` : ''}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteAcademicClass(c.id);
                              showToast(t('common.deleted'), 'info');
                              await loadAll();
                            }}
                            aria-label={t('common.delete')}
                            className="p-2 rounded-lg text-stone-400 hover:text-red-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SUBJECTS TAB */}
            {tab === 'subjects' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <form
                  onSubmit={handleAddSubject}
                  className="lg:col-span-4 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 space-y-4"
                >
                  <h3 className="text-base font-semibold">{t('academics.addSubjectTitle')}</h3>
                  {departments.length > 0 && (
                    <div>
                      <label className="block text-xs font-medium mb-1">{t('academics.department')}</label>
                      <select
                        value={subDeptId}
                        onChange={(e) => setSubDeptId(e.target.value)}
                        className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
                      >
                        <option value="">—</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium mb-1">{t('academics.subjectName')}</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Mathematics"
                      value={subName}
                      onChange={(e) => setSubName(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t('academics.subjectCode')}</label>
                    <input
                      type="text"
                      placeholder="e.g. MTH201"
                      value={subCode}
                      onChange={(e) => setSubCode(e.target.value.toUpperCase())}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-sm font-mono uppercase"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white py-2.5 text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t('academics.addSubjectBtn')}</span>
                  </button>
                </form>

                <div className="lg:col-span-8">
                  {subjects.length === 0 ? (
                    <EmptyState
                      title={t('academics.noSubjects')}
                      description={t('academics.subtitle')}
                    />
                  ) : (
                    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] divide-y divide-stone-100 dark:divide-stone-800">
                      {subjects.map((s) => (
                        <div key={s.id} className="p-4 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100 truncate">
                              {s.name}
                              {s.code ? (
                                <span className="ml-2 font-mono text-xs text-stone-400">
                                  {s.code}
                                </span>
                              ) : null}
                            </p>
                            {s.departmentName && (
                              <p className="text-xs text-stone-500 mt-0.5">{s.departmentName}</p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteSubject(s.id);
                              showToast(t('common.deleted'), 'info');
                              await loadAll();
                            }}
                            aria-label={t('common.delete')}
                            className="p-2 rounded-lg text-stone-400 hover:text-red-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* DEPARTMENTS TAB */}
            {tab === 'departments' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <form
                  onSubmit={handleAddDepartment}
                  className="lg:col-span-4 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 space-y-4"
                >
                  <h3 className="text-base font-semibold">{t('academics.addDeptTitle')}</h3>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t('common.name')}</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Computer Science"
                      value={deptName}
                      onChange={(e) => setDeptName(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t('academics.deptCode')}</label>
                    <input
                      type="text"
                      placeholder="e.g. CSE"
                      value={deptCode}
                      onChange={(e) => setDeptCode(e.target.value.toUpperCase())}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3 py-2 text-sm font-mono uppercase"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white py-2.5 text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{t('academics.addDeptBtn')}</span>
                  </button>
                </form>

                <div className="lg:col-span-8">
                  {departments.length === 0 ? (
                    <EmptyState
                      title={t('academics.noDepts')}
                      description={t('academics.subtitle')}
                    />
                  ) : (
                    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] divide-y divide-stone-100 dark:divide-stone-800">
                      {departments.map((d) => (
                        <div key={d.id} className="p-4 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                              {d.name}
                            </p>
                            {d.code && <p className="text-xs font-mono text-stone-400">{d.code}</p>}
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteDepartment(d.id);
                              showToast(t('common.deleted'), 'info');
                              await loadAll();
                            }}
                            aria-label={t('common.delete')}
                            className="p-2 rounded-lg text-stone-400 hover:text-red-600 hover:bg-stone-100 dark:hover:bg-stone-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* PARENT VERIFICATION & LINKING TAB */}
            {tab === 'parents' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <form
                  onSubmit={handleDirectParentLink}
                  className="lg:col-span-4 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 space-y-4"
                >
                  <h3 className="text-base font-semibold">{t('academics.directLinkParentTitle')}</h3>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {t('academics.directLinkParentHint')}
                  </p>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t('common.parent')}</label>
                    <select
                      required
                      value={linkParentUid}
                      onChange={(e) => setLinkParentUid(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
                    >
                      <option value="">—</option>
                      {parents.map((p) => (
                        <option key={p.uid} value={p.uid}>
                          {p.name} ({p.email})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t('academics.student')}</label>
                    <select
                      required
                      value={linkStudentUid}
                      onChange={(e) => setLinkStudentUid(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
                    >
                      <option value="">—</option>
                      {students.map((s) => (
                        <option key={s.uid} value={s.uid}>
                          {s.name} ({s.memberId})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t('auth.relationshipLabel')}</label>
                    <select
                      value={linkRel}
                      onChange={(e) => setLinkRel(e.target.value)}
                      className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 text-sm"
                    >
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Guardian">Guardian</option>
                      <option value="Parent">Parent</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={saving || !linkParentUid || !linkStudentUid}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-50 text-white py-2.5 text-sm font-medium"
                  >
                    <Link2 className="w-4 h-4" />
                    <span>{t('academics.linkBtn')}</span>
                  </button>
                </form>

                <div className="lg:col-span-8">
                  {parentLinks.length === 0 ? (
                    <EmptyState
                      title={t('academics.noParentLinks')}
                      description={t('academics.directLinkParentHint')}
                    />
                  ) : (
                    <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] divide-y divide-stone-100 dark:divide-stone-800">
                      {parentLinks.map((link) => {
                        const studentObj = studentNameMap.get(link.studentUid);
                        return (
                          <div key={link.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                                {link.parentName} ({link.relationship}) →{' '}
                                {studentObj?.name || link.studentName || link.studentMemberId}
                              </p>
                              <p className="text-xs text-stone-500 font-mono mt-0.5">
                                {link.parentEmail} · ID: {link.studentMemberId}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {link.status === 'pending' ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleVerifyParent(link)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 text-xs font-medium"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    <span>{t('dashboard.approve')}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRejectParent(link)}
                                    className="rounded-lg border border-stone-200 dark:border-stone-700 p-1.5 text-stone-500 hover:text-red-600"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <span
                                  className={`text-xs font-semibold uppercase ${
                                    link.status === 'verified'
                                      ? 'text-emerald-700 dark:text-emerald-400'
                                      : 'text-red-600'
                                  }`}
                                >
                                  {link.status}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
};
