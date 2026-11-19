# Smart Attendance System

A multi-organization, QR-based attendance platform built with React, TypeScript, Tailwind CSS, and Firebase (Authentication + Cloud Firestore). Supports a clean three-tier hierarchy (**Organization Admin → Managers → Members**), instant **English / हिंदी** language switching, dark mode, CSV bulk import, CSV/PDF reports, monthly register sheets, leave management, announcements, optional GPS location verification, and installable PWA support.

---

## Features

- **Multi-Organization Hierarchy**: Strict data isolation across organizations. Customize role names per organization (e.g. *Teacher / Student*, *Faculty / Student*, *Team Lead / Employee*).
- **QR & Manual Attendance**: Continuous camera scanning (`html5-qrcode`) with sound + vibration feedback, front/back camera switch, 2-second duplicate cooldown, automatic "Late" detection after configurable cut-off time, optional GPS radius verification, and "Mark all present" bulk manual mode.
- **Account Creation Without Signing Out**: Uses a secondary Firebase App instance (`initializeApp(config, "secondary")`) when Admins/Managers add people directly, automatically sending a password-setup reset email.
- **Onboarding Options**: Direct add, CSV bulk import with validation preview, and self-registration via 6-character Organization Code or Manager Code (with approval workflow).
- **QR & Printable ID Cards**: Deterministic JSON QR payloads `{ orgId, uid, memberId }`, crisp PNG download, and printable ID card view.
- **Dashboards & Reports**: Role-specific dashboards, 7/30-day charts, low-attendance alerts, monthly member calendar, monthly register sheet view, CSV & PDF exports.
- **Leave Requests, Notices & Notifications**: Approved leaves automatically appear as `Leave` on attendance calendars and reports.
- **Bilingual (English / हिंदी)**: Instant switch in the header and landing page, persisted in `localStorage` and Firestore user profiles.
- **Demo Data Controls**: Admin Settings includes **Load demo data** (3 Managers, 15 Members, 30 days of realistic attendance) and **Delete demo data**.

---

## Firebase Setup Steps (`attendence-92251`)

The Firebase web configuration is already configured in `src/firebase.ts`. Complete the following steps in the [Firebase Console](https://console.firebase.google.com/) for project **`attendence-92251`**:

### 1. Enable Email/Password Authentication
1. Open **Build → Authentication → Sign-in method**.
2. Enable **Email/Password** and click **Save**.
3. Under **Authentication → Settings → Authorized domains**, add your deployed domain(s) (e.g. your Cloud Run / Firebase Hosting domain and `localhost` for local development).

### 2. Create Cloud Firestore Database (`asia-south1`)
1. Open **Build → Firestore Database → Create database**.
2. Choose location **`asia-south1` (Mumbai)** (or your preferred region).
3. Start in **Production mode**.

### 3. Publish Firestore Security Rules
1. Open **Firestore Database → Rules** (or deploy via Firebase CLI: `firebase deploy --only firestore:rules`).
2. Copy the entire contents of `firestore.rules` from this repository and click **Publish**.

### 4. Create Composite Indexes
The app uses equality-scoped queries so core screens work immediately. For optimal query performance at scale, deploy `firestore.indexes.json` (`firebase deploy --only firestore:indexes`) or create the following composite indexes in **Firestore → Indexes**:

| Collection | Fields |
|---|---|
| `users` | `orgId` (Asc), `role` (Asc) |
| `users` | `orgId` (Asc), `managerId` (Asc) |
| `users` | `orgId` (Asc), `isDemo` (Asc) |
| `attendance` | `orgId` (Asc), `date` (Asc) |
| `attendance` | `orgId` (Asc), `managerId` (Asc), `date` (Asc) |
| `attendance` | `orgId` (Asc), `personUid` (Asc), `date` (Desc) |
| `attendance` | `orgId` (Asc), `isDemo` (Asc) |
| `leaves` | `orgId` (Asc), `toUid` (Asc), `createdAt` (Desc) |
| `leaves` | `orgId` (Asc), `personUid` (Asc), `createdAt` (Desc) |
| `announcements` | `orgId` (Asc), `createdAt` (Desc) |
| `notifications` | `toUid` (Asc), `createdAt` (Desc) |

---

## Local Development & Build

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

> **Camera Note**: Browser camera access for QR scanning requires **HTTPS** (or `localhost`).

---

## Project Structure

```text
├── firestore.rules           # Strict multi-tenant Firestore security rules
├── firestore.indexes.json    # Composite Firestore index definitions
├── public/                   # PWA icons (SVG + 180/192/512/maskable PNGs)
└── src/
    ├── firebase.ts           # Firebase SDK + secondary app helper
    ├── types/                # TypeScript models
    ├── i18n/                 # en.json & hi.json dictionaries
    ├── context/              # Auth, Language, Theme, Toast contexts
    ├── hooks/                # useTranslation, usePWAInstall, useOnlineStatus
    ├── services/             # Firestore services (org, user, attendance, leave, communication, demo)
    ├── utils/                # Timezone, Haversine, audio/vibration, error mapping helpers
    ├── components/           # Layout, QRCardModal, PeopleManagerView, ProtectedRoute, toggles
    └── pages/                # Landing, Auth, Dashboards, Mark Attendance, Leaves, Notices, Reports, Settings
```
