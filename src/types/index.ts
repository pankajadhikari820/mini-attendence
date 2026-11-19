import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'manager' | 'member';
export type UserStatus = 'pending' | 'active' | 'inactive';
export type OrgType = 'College' | 'School' | 'Coaching' | 'Company' | 'Other';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave';
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
  roleLabels: RoleLabels;
  lateAfter: string; // "HH:MM" e.g. "09:30"
  timezone: string; // e.g. "Asia/Kolkata"
  location: OrgLocation;
  defaultSessionDuration?: number; // 15 | 30 | 60 | 120 minutes
  lowAttendanceThreshold: number; // default 75
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
  role: UserRole;
  orgId: string;
  managerId: string | null;
  memberId: string; // 6-char unique ID e.g. PAN482
  status: UserStatus;
  managerCode?: string;
  language: LanguageCode;
  isDemo?: boolean;
  createdAt?: Timestamp | null;
}

export interface AttendanceRecord {
  id: string; // `${orgId}_${date}_${personUid}`
  orgId: string;
  personUid: string;
  personName: string;
  personMemberId?: string;
  role: 'manager' | 'member';
  managerId: string | null;
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
  ownerRole: 'admin' | 'manager';
  title: string;
  status: SessionStatus;
  durationMinutes: number;
  locationCheckEnabled: boolean;
  location: SessionLocation;
  markedCount: number;
  startedAt?: Timestamp | null;
  endsAt?: Timestamp | null;
}

export interface SessionSecret {
  ownerUid: string;
  orgId: string;
  active: boolean;
  token: string;
  prevToken?: string;
  code: string;
  prevCode?: string;
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
  audience: 'all' | 'managers' | 'members';
  managerId: string | null;
  text: string;
  isDemo?: boolean;
  createdAt?: Timestamp | null;
}

export interface AppNotification {
  id: string;
  orgId: string;
  toUid: string;
  type: 'approval' | 'leave' | 'announcement' | 'attendance';
  text: string;
  read: boolean;
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
