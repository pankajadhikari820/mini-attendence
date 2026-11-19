import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: "AIzaSyB4O0_f2y6D3No4kKw3PALtfO_6v2s6lAQ",
  authDomain: "attendence-92251.firebaseapp.com",
  projectId: "attendence-92251",
  storageBucket: "attendence-92251.firebasestorage.app",
  messagingSenderId: "327288246371",
  appId: "1:327288246371:web:bf97d084314aa9ea726856",
  measurementId: "G-FQP60QRQRP"
};

const app = getApps().some((a) => a.name === '[DEFAULT]')
  ? getApp()
  : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

function getSecondaryAuth() {
  const existing = getApps().find((a) => a.name === 'secondary');
  const secondaryApp = existing ?? initializeApp(firebaseConfig, 'secondary');
  return getAuth(secondaryApp);
}

/**
 * Creates a Firebase Auth account using a secondary Firebase App instance
 * so the currently logged-in Admin or Manager is NOT signed out.
 * Also sends a password-reset email so the new person can set their own password.
 */
export async function createSecondaryAccount(
  email: string,
  tempPassword?: string
): Promise<{ uid: string; resetEmailSent: boolean }> {
  const secondaryAuth = getSecondaryAuth();
  const generatedPassword =
    tempPassword ||
    `Tmp!${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

  try {
    const cred = await createUserWithEmailAndPassword(
      secondaryAuth,
      email.trim().toLowerCase(),
      generatedPassword
    );
    const uid = cred.user.uid;

    let resetEmailSent = false;
    try {
      await sendPasswordResetEmail(secondaryAuth, email.trim().toLowerCase());
      resetEmailSent = true;
    } catch {
      // Non-fatal: account is created; admin can remind user to use Forgot Password
      resetEmailSent = false;
    }

    await signOut(secondaryAuth);
    return { uid, resetEmailSent };
  } catch (err) {
    try {
      await signOut(secondaryAuth);
    } catch {
      // Ignore cleanup error
    }
    throw err;
  }
}
