# Smart Attendance System

A multi-organization, QR-based attendance platform built with React, TypeScript, Tailwind CSS, Leaflet (OpenStreetMap), and Firebase (Authentication + Cloud Firestore — Spark/free plan compatible, zero Cloud Functions required). Supports a clean three-tier hierarchy (**Organization Admin → Managers → Members**), instant **English / हिंदी** language switching, dark mode, CSV bulk import, CSV/PDF reports, monthly register sheets, leave management, announcements, live rotating QR sessions with GPS verification, and installable PWA support.

---

## Features

- **Multi-Organization Hierarchy**: Strict data isolation across organizations. Customize role names per organization (e.g. *Teacher / Student*, *Faculty / Student*, *Team Lead / Employee*).
- **Globally Unique 6-Character ID**: Every Admin, Manager, and Member receives a unique 6-character ID (`3 uppercase English letters + 3 digits`, e.g. `PAN482`, `RAH071`) reserved atomically via a Firestore transaction in `userIds/{ID}`. If a name is typed in Hindi, the form asks for the English spelling used for the ID.
- **Live Rotating QR Sessions (Primary Attendance Mode)**:
  - Admins start sessions for Managers; Managers start sessions for their own Members.
  - Setup includes optional title, duration (`15 / 30 / 60 / 120` min), allowed radius (`20 – 500` m, default `50` m), and high-accuracy GPS plotted on an interactive **Leaflet + OpenStreetMap** map (no API key needed) with a draggable pin and radius circle.
  - **Projector Mode**: Full-screen view with Screen Wake Lock API, large QR rotating every **10 seconds** (`{ "s": sessionId, "t": token }`) with a countdown ring, synchronized **6-digit live code**, live `"Marked: X / Y"` counter, real-time marked feed, real-time `"Rejected attempts"` list, `"Extend 10 min"`, and `"Close session"`.
- **Self-Marking Page (`/mark`)**:
  - Automatic GPS verification (`"You are 12 m from the class ✓"` / `"You are 340 m away ✗"`), rejecting readings with accuracy > 100 m.
  - Two tabs: **Scan QR** (live rotating QR camera scanner) and **Enter ID** (6-char own ID + 6-digit live code).
  - Automatically marks **Late** after the organization's `lateAfter` cut-off time.
- **Zero-Cloud-Functions Security (`firestore.rules`)**:
  - Rotating secrets stored in `sessionSecrets/{sessionId}` (readable/writable only by the session starter, verified server-side by Firestore Security Rules).
  - Current token/code valid max 15 seconds; previous token/code valid 5 seconds after rotation for network delay.
  - Server-side flat-earth radius check (`cosLat`, `math.sqrt`, `math.pow`) enforced in `firestore.rules`.
  - Atomic one-device-per-session lock via `sessionDevices/{sessionId}_{deviceId}` written in the same `writeBatch` as the attendance record.
  - Failed attempts logged to `attempts/{id}` and shown live on the session screen.
- **Manual / ID-Card Backup (`/attendance/manual`)**:
  - Personal ID card QR encodes `{ orgId, uid, id }`.
  - Records marked manually or via backup ID-card scan are tagged `"manual"` and highlighted in yellow in Reports (both on-screen and in PDF exports).
- **Account Creation Without Signing Out**: Uses a secondary Firebase App instance (`initializeApp(config, "secondary")`) when Admins/Managers add people directly, automatically sending a password-setup reset email.
- **Dashboards, Reports, Leaves & Notices**: Role-specific dashboards, 7/30-day charts, low-attendance alerts, monthly member calendar, monthly register sheet view, CSV & PDF exports, leave approvals, and announcements.
- **Bilingual (English / हिंदी) & PWA**: Instant switch in header and landing page, persisted in `localStorage` and Firestore user profiles.

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
Deploy `firestore.indexes.json` (`firebase deploy --only firestore:indexes`) or create the following composite indexes in **Firestore → Indexes**:

| Collection | Fields |
|---|---|
| `users` | `orgId` (Asc), `role` (Asc) |
| `users` | `orgId` (Asc), `managerId` (Asc) |
| `users` | `orgId` (Asc), `isDemo` (Asc) |
| `userIds` | `orgId` (Asc), `isDemo` (Asc) |
| `sessions` | `orgId` (Asc), `ownerUid` (Asc), `status` (Asc) |
| `attempts` | `orgId` (Asc), `sessionId` (Asc), `time` (Desc) |
| `attendance` | `orgId` (Asc), `date` (Asc) |
| `attendance` | `orgId` (Asc), `sessionId` (Asc) |
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

> **Camera & GPS Note**: Browser camera access for QR scanning and high-accuracy GPS require **HTTPS** (or `localhost`).

---

## Project Structure

```text
├── firestore.rules           # Multi-tenant + live rotating QR & GPS security rules (no Cloud Functions)
├── firestore.indexes.json    # Composite Firestore index definitions
├── public/                   # PWA icons (SVG + 180/192/512/maskable PNGs)
└── src/
    ├── firebase.ts           # Firebase SDK + secondary app helper
    ├── types/                # TypeScript models (Org, User, Session, Secret, Attempt, Attendance)
    ├── i18n/                 # en.json & hi.json dictionaries
    ├── context/              # Auth, Language, Theme, Toast contexts
    ├── hooks/                # useTranslation, usePWAInstall, useOnlineStatus
    ├── services/             # org, user, session, attendance, leave, communication, demo services
    ├── utils/                # 6-char ID generator, crypto token/code, GPS/flat-earth distance, audio/vibration
    ├── components/           # Layout, LocationPickerMap, QRCardModal, PeopleManagerView, ProtectedRoute
    └── pages/                # Landing, Auth, Dashboards, StartAttendance, MarkYourAttendance, Backup, Reports, Settings
```
