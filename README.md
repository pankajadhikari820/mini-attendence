# Smart Campus Attendance Management System

A production-ready, multi-organization **Smart Campus Attendance Management System** built with React 19, TypeScript, Tailwind CSS v4, Recharts, Leaflet (OpenStreetMap), SheetJS (`xlsx`), jsPDF, and Firebase (Authentication + Cloud Firestore — **100% Spark/free plan compatible**, zero Cloud Functions or paid Storage required).

---

## Key Architecture & Features

- **Strictly 3 Attendance Statuses**: `PRESENT`, `ABSENT`, `LEAVE` across the entire frontend, backend services, reports, analytics, exports, and Firestore Security Rules. Legacy `'late'` records are safely normalized to `'present'` via `normalizeAttendanceStatus()`.
- **Zero Biometric / Face Recognition**: Pure QR + GPS + Firebase Auth + Firestore Security Rules verification.
- **5-Role RBAC Hierarchy**:
  - `super_admin` — Multi-organization overview (`/super-admin`)
  - `admin` — Organization / College Administrator (`/admin`, `/academics`, `/timetable`, `/audit-logs`, `/reports`)
  - `manager` — Teacher / Faculty (`/manager`, `/attendance`, `/attendance/manual`, `/timetable`, `/reports`)
  - `member` — Student (`/member`, `/mark`, `/timetable`, `/leaves`)
  - `parent` — Read-Only Linked Student Portal (`/parent`, `/timetable`)
- **Multiple Teachers & Subject-Wise Live Attendance**:
  - Multiple teachers can independently run concurrent live rotating QR sessions for their assigned classes & subjects on the same day.
  - Each live session uses an independent `sessionId` and deterministic attendance document ID `${orgId}_${sessionId}_${personUid}` (manual subject-wise backup uses `${orgId}_${date}_${subjectId}_${personUid}`), preventing subject collisions on the same date.
  - Real-time `onSnapshot()` subscription on Student Dashboard (`/member`) and Mark Attendance (`/mark`) surfaces active live sessions instantly, with separate error states (`loading`, `empty`, `permission-denied`, `index-required`, `network`, `expired`) and a working **Check again** retry action.
- **Anti-Proxy Security (`firestore.rules` — Spark Plan Compatible)**:
  - Rotating 10-second cryptographic tokens stored in owner-only `sessionSecrets/{sessionId}`.
  - Server-side TTL verification (`request.time <= secret.tokenUpdatedAt + duration.value(10, 's')`).
  - GPS geofence verification (flat-earth distance formula enforced in Firestore rules).
  - Atomic one-device-per-session lock (`sessionDevices/{sessionId}_{deviceId}`) via `runTransaction`.
- **Academic Structure (`/academics`)**: Departments, Classes/Sections, Subjects, Faculty-Class-Subject Assignments, and Parent Verification & Direct Linking.
- **Smart Timetable (`/timetable`)**: Weekly Mon–Sat schedule grid with automatic **Teacher**, **Class/Section**, and **Classroom** overlap conflict detection, plus 1-click **Start Attendance** pre-filling the live session.
- **Digital Student ID Card**: Official ID card with student photo (compressed JPEG stored Spark-safely in Firestore), enrollment number, 6-character unique ID, academic class metadata, static verification QR, PNG download, Print, and jsPDF card export.
- **Low Attendance Alert System**: Configurable threshold (default 75%), real-time shortage detection (overall + subject-wise), and one-click deduplicated alerts (`lowatt_${orgId}_${YYYY-MM}_${studentUid}_${targetUid}`) to students, faculty, and verified parents.
- **Immutable Audit Logs (`/audit-logs`)**: Append-only audit trail (`allow update, delete: if false;` in `firestore.rules`) with filter, search, and Excel export.
- **Advanced Analytics & Exports (`/reports`)**: Overall KPIs, Daily Trend chart, Subject-wise chart, Class breakdown, Shortage list, Monthly Register, multi-sheet **Excel (`.xlsx`)**, **CSV**, and **branded PDF** reports.
- **Bilingual (English / हिंदी) & PWA**: Full English and Hindi localization, light/dark mode, and installable PWA support.

---

## Firebase Setup & Deployment (`attendence-92251`)

The Firebase configuration is already set in `src/firebase.ts`. Complete these steps in the [Firebase Console](https://console.firebase.google.com/) or via Firebase CLI:

### 1. Authentication
- Enable **Email/Password** under **Build → Authentication → Sign-in method**.
- Add your deployed domain(s) under **Authentication → Settings → Authorized domains**.

### 2. Deploy Firestore Security Rules & Composite Indexes
```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Or copy `firestore.rules` into **Firestore Database → Rules** and create the composite indexes defined in `firestore.indexes.json`:

| Collection | Fields |
|---|---|
| `users` | `orgId` (Asc), `role` (Asc) |
| `users` | `orgId` (Asc), `managerId` (Asc) |
| `users` | `orgId` (Asc), `classId` (Asc) |
| `users` | `orgId` (Asc), `isDemo` (Asc) |
| `userIds` | `orgId` (Asc), `isDemo` (Asc) |
| `sessions` | `orgId` (Asc), `status` (Asc) |
| `sessions` | `orgId` (Asc), `ownerUid` (Asc), `status` (Asc) |
| `sessions` | `orgId` (Asc), `classId` (Asc), `status` (Asc) |
| `sessions` | `orgId` (Asc), `ownerRole` (Asc), `status` (Asc) |
| `attempts` | `orgId` (Asc), `sessionId` (Asc), `time` (Desc) |
| `attendance` | `orgId` (Asc), `date` (Asc) |
| `attendance` | `orgId` (Asc), `sessionId` (Asc) |
| `attendance` | `orgId` (Asc), `managerId` (Asc), `date` (Asc) |
| `attendance` | `orgId` (Asc), `classId` (Asc), `date` (Asc) |
| `attendance` | `orgId` (Asc), `personUid` (Asc), `date` (Desc) |
| `attendance` | `orgId` (Asc), `isDemo` (Asc) |
| `facultyAssignments` | `orgId` (Asc), `teacherUid` (Asc) |
| `facultyAssignments` | `orgId` (Asc), `classId` (Asc) |
| `timetableSlots` | `orgId` (Asc), `classId` (Asc) |
| `timetableSlots` | `orgId` (Asc), `teacherUid` (Asc) |
| `parentLinks` | `orgId` (Asc), `parentUid` (Asc) |
| `parentLinks` | `orgId` (Asc), `studentUid` (Asc) |
| `auditLogs` | `orgId` (Asc), `timestamp` (Desc) |
| `leaves` | `orgId` (Asc), `toUid` (Asc), `createdAt` (Desc) |
| `leaves` | `orgId` (Asc), `personUid` (Asc), `createdAt` (Desc) |
| `announcements` | `orgId` (Asc), `createdAt` (Desc) |
| `notifications` | `toUid` (Asc), `createdAt` (Desc) |

---

## Spark Plan vs. Blaze Plan Notes

- **Fully Supported on Spark (Free) Plan**: All authentication, real-time live QR sessions, 10s token validation, GPS radius checks, one-device locks, student photo / college logo uploads (compressed JPEG data URLs), parent portal, timetable conflict checks, audit logs, Excel/PDF exports, and in-app deduplicated low-attendance notifications.
- **Requires Blaze Plan (Optional Future Enhancement)**: Scheduled background cron email/SMS/push notifications sent automatically while no admin/teacher has the app open would require Firebase Cloud Functions + an external email/SMS provider.

---

## Local Development & Build

```bash
npm install
npm run dev
npm run build
```

> **Note**: Camera QR scanning and high-accuracy GPS require **HTTPS** (or `localhost`).
