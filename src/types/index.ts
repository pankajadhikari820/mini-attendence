import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'admin' | 'manager' | 'member';
export type UserStatus = 'pending' | 'active' | 'inactive';
export type OrgType = 'College' | 'School' | 'Coaching' | 'Company' | 'Other';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave';
export type AttendanceMethod = 'qr' | 'manual';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';
export type LanguageCode = 'en' | 'hi';

export interface RoleLabels {
  manager: string;
  member: string;
}

export interface OrgLocation {
  lat: number;
  lng: number;
  radius: number; // in meters
  enabled: boolean;
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
  email: string;
  phone: string;
  rollNumber?: string;
  role: UserRole;
  orgId: string;
  managerId: string | null;
  memberId: string;
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
  isDemo?: boolean;
}

export interface LeaveRequest {
  id: string;
  orgId: string;
  personUid: string;
  personName: string;
  personRole: 'manager' | 'member';
  personMemberId?: string;
  toUid: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
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
  managerId: string | null; // set when a Manager posts to their own members
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
  memberId: string;
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
