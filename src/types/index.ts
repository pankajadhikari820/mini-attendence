import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'super_admin' | 'admin' | 'manager' | 'member' | 'parent';
export type UserStatus = 'pending' | 'active' | 'inactive';
export type OrgType = 'College' | 'School' | 'Coaching' | 'Company' | 'Other';
// Strictly 3 attendance statuses across the entire platform (no LATE status)
export type AttendanceStatus = 'present' | 'absent' | 'leave';
export type AttendanceMethod = 'live_qr' | 'live_code' | 'qr' | 'manual';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';
export type LanguageCode = 'en' | 'hi';
export type SessionStatus = 'open' | 'closed';

export interface RoleLabels {
  manager: string;
  member: string;
}

export interface OrgLocation {
  lat: number;
  lng: number;
  radius: number; // default radius in meters (20-500)
  enabled: boolean; // default ON (true)
}

export interface Organization {
  id: string;
  name: string;
  type: OrgType;
  orgCode: string;
  adminUid: string;
  logoUrl?: string;
  address?: string;
  roleLabels: RoleLabels;
  timezone: string; // e.g. "Asia/Kolkata"
  location: OrgLocation;
  defaultSessionDuration?: number; // 15 | 30 | 60 | 120 minutes
  lowAttendanceThreshold: number; // default 75
  status?: 'active' | 'suspended';
  counters: {
    manager: number;
    member: number;
  };
  hasDemoData?: boolean;
  createdAt?: Timestamp | null;
}

export interface UserProfile {
  uid: string;
  name: string;
  englishName?: string;
  email: string;
  phone: string;
  rollNumber?: string;
  enrollmentNumber?: string;
  photoUrl?: string;
  role: UserRole;
  orgId: string;
  managerId: string | null;
  memberId: string; // 6-char unique ID e.g. PAN482
  status: UserStatus;
  managerCode?: string;
  language: LanguageCode;
  // Academic metadata (for Students & Faculty)
  departmentId?: string;
  departmentName?: string;
  courseName?: string;
  classId?: string;
  className?: string;
  semester?: string;
  section?: string;
  enrolledSubjectIds?: string[];
  // Teacher's selected institution students for their class list
  selectedStudentUids?: string[];
  // Parent portal links
  linkedStudentUids?: string[]; // on Parent profile
  parentUids?: string[]; // on Student profile
  isDemo?: boolean;
  createdAt?: Timestamp | null;
}

export interface Department {
  id: string;
  orgId: string;
  name: string;
  code: string;
  createdAt?: Timestamp | null;
}

export interface AcademicClass {
  id: string;
  orgId: string;
  departmentId: string;
  departmentName: string;
  courseName: string; // e.g. "BCA AI & DS"
  semester: string; // e.g. "2"
  section: string; // e.g. "C"
  roomNumber?: string; // e.g. "Room 204"
  classroom?: string; // alias for roomNumber
  name: string; // formatted e.g. "BCA AI & DS - Sem 2 - Sec C"
  createdAt?: Timestamp | null;
}

export interface Subject {
  id: string;
  orgId: string;
  departmentId: string;
  departmentName?: string;
  classId?: string;
  className?: string;
  name: string; // e.g. "Mathematics"
  code: string; // e.g. "MTH201"
  credits?: number;
  createdAt?: Timestamp | null;
}

export interface FacultyAssignment {
  id: string;
  orgId: string;
  teacherUid: string;
  teacherName: string;
  teacherMemberId: string;
  departmentId: string;
  departmentName?: string;
  classId: string;
  className: string;
  courseName: string;
  semester: string;
  section: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  createdAt?: Timestamp | null;
}

export interface TimetableSlot {
  id: string;
  orgId: string;
  dayOfWeek: number; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  startTime: string; // "09:00"
  endTime: string; // "10:00"
  classId: string;
  className: string;
  courseName: string;
  semester: string;
  section: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  teacherUid: string;
  teacherName: string;
  roomNumber: string;
  classroom?: string; // alias for roomNumber
  departmentId?: string;
  departmentName?: string;
  createdAt?: Timestamp | null;
}

export interface ParentLink {
  id: string;
  orgId: string;
  parentUid: string;
  parentName: string;
  parentEmail: string;
  studentUid: string;
  studentName: string;
  studentMemberId: string;
  relationship?: string;
  status: 'pending' | 'verified' | 'rejected';
  createdAt?: Timestamp | null;
  verifiedAt?: Timestamp | null;
}

export interface AuditLog {
  id: string;
  orgId: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  action:
    | 'attendance.created'
    | 'attendance.updated'
    | 'attendance.bulk_marked'
    | 'session.started'
    | 'session.closed'
    | 'leave.requested'
    | 'leave.approved'
    | 'leave.rejected'
    | 'user.created'
    | 'user.updated'
    | 'user.approved'
    | 'user.rejected'
    | 'user.status_changed'
    | 'user.role_changed'
    | 'user.deleted'
    | 'parent.linked'
    | 'academic.updated'
    | 'timetable.updated'
    | 'settings.updated'
    | 'alert.low_attendance_sent';
  targetCollection: string;
  targetType?: string;
  targetId: string;
  summary: string;
  metadata?: Record<string, string | number | boolean | null>;
  timestamp?: Timestamp | null;
  createdAt?: Timestamp | null;
}

export interface AttendanceRecord {
  id: string; // Session-scoped: `${orgId}_${sessionId}_${personUid}` or Manual: `${orgId}_${date}_${subjectId || 'general'}_${personUid}`
  orgId: string;
  personUid: string;
  personName: string;
  personMemberId?: string;
  role: 'manager' | 'member';
  managerId: string | null;
  teacherUid?: string | null;
  teacherName?: string;
  departmentId?: string;
  classId?: string;
  className?: string;
  semester?: string;
  section?: string;
  subjectId?: string;
  subjectName?: string;
  subjectCode?: string;
  date: string; // YYYY-MM-DD in org timezone
  timestamp?: Timestamp | null;
  status: AttendanceStatus;
  method: AttendanceMethod;
  markedBy: string;
  note: string;
  sessionId?: string;
  lat?: number;
  lng?: number;
  accuracy?: number;
  distanceMeters?: number;
  deviceId?: string;
  submittedToken?: string;
  submittedCode?: string;
  isDemo?: boolean;
}

export interface SessionLocation {
  lat: number;
  lng: number;
  cosLat: number;
  radius: number; // meters (20-500)
}

export interface AttendanceSession {
  id: string;
  orgId: string;
  ownerUid: string;
  ownerName: string;
  teacherName?: string; // alias for ownerName
  ownerRole: 'admin' | 'manager';
  title: string;
  date?: string; // YYYY-MM-DD
  status: SessionStatus;
  durationMinutes: number;
  locationCheckEnabled: boolean;
  location: SessionLocation;
  markedCount: number;
  // Subject / Class scoping for multi-teacher lectures
  departmentId?: string;
  classId?: string;
  className?: string;
  courseName?: string;
  semester?: string;
  section?: string;
  subjectId?: string;
  subjectName?: string;
  subjectCode?: string;
  roomNumber?: string;
  classroom?: string; // alias for roomNumber
  timetableSlotId?: string;
  startTimeLabel?: string;
  endTimeLabel?: string;
  startedAt?: Timestamp | null;
  endsAt?: Timestamp | null;
  closedAt?: Timestamp | null;
}

export interface SessionSecret {
  ownerUid: string;
  orgId: string;
  active: boolean;
  token: string;
  code: string;
  rotationSeq?: number;
  tokenUpdatedAt?: Timestamp | null;
}

export interface AttendanceAttempt {
  id: string;
  orgId: string;
  sessionId: string;
  ownerUid: string;
  personUid: string;
  personName: string;
  personId: string;
  reason: string;
  distance: number | null;
  time?: Timestamp | null;
}

export interface LeaveRequest {
  id: string;
  orgId: string;
  personUid: string;
  personName: string;
  personRole: 'manager' | 'member';
  personMemberId?: string;
  classId?: string;
  toUid: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: LeaveStatus;
  comment: string;
  isDemo?: boolean;
  createdAt?: Timestamp | null;
}

export interface Announcement {
  id: string;
  orgId: string;
  fromUid: string;
  fromName: string;
  fromRole: 'admin' | 'manager';
  audience: 'all' | 'managers' | 'members' | 'parents';
  managerId: string | null;
  classId?: string | null;
  text: string;
  isDemo?: boolean;
  createdAt?: Timestamp | null;
}

export interface AppNotification {
  id: string;
  orgId: string;
  toUid: string;
  type: 'approval' | 'leave' | 'announcement' | 'attendance' | 'low_attendance' | 'timetable';
  text: string;
  read: boolean;
  dedupeKey?: string;
  isDemo?: boolean;
  createdAt?: Timestamp | null;
}

export interface ContactMessage {
  name: string;
  email: string;
  message: string;
  createdAt?: Timestamp | null;
}

export interface QRPayload {
  type?: 'student_id';
  orgId: string;
  uid: string;
  id?: string;
  memberId?: string;
}

export interface LiveSessionQRPayload {
  s: string; // sessionId
  t: string; // rotating 128-bit token
}

export interface OrgCodeLookup {
  orgId: string;
  orgName: string;
  roleLabels: RoleLabels;
}

export interface ManagerCodeLookup {
  orgId: string;
  managerUid: string;
  managerName: string;
  orgName: string;
  roleLabels: RoleLabels;
}
