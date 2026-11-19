import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { Organization, UserProfile } from '../types';
import { useLanguage } from './LanguageContext';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  org: Organization | null;
  loading: boolean;
  logout: () => Promise<void>;
  getRoleLabel: (role: 'manager' | 'member') => string;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const { setLanguage, t } = useLanguage();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setProfile(null);
        setOrg(null);
        setProfileLoading(false);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    setProfileLoading(true);
    const unsubProfile = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setProfile({ ...data, uid: snap.id });
          if (data.language === 'hi' || data.language === 'en') {
            const savedLocal = localStorage.getItem('sas_lang');
            if (!savedLocal) {
              setLanguage(data.language, false);
            }
          }
        } else {
          setProfile(null);
        }
        setProfileLoading(false);
      },
      () => {
        setProfileLoading(false);
      }
    );
    return unsubProfile;
  }, [user, setLanguage]);

  useEffect(() => {
    if (!profile?.orgId) {
      setOrg(null);
      return;
    }
    const unsubOrg = onSnapshot(
      doc(db, 'organizations', profile.orgId),
      (snap) => {
        if (snap.exists()) {
          setOrg({ ...(snap.data() as Omit<Organization, 'id'>), id: snap.id });
        } else {
          setOrg(null);
        }
      },
      () => {
        // Pending users may not have full org read access yet
      }
    );
    return unsubOrg;
  }, [profile?.orgId]);

  const logout = useCallback(async () => {
    await signOut(auth);
    setProfile(null);
    setOrg(null);
  }, []);

  const getRoleLabel = useCallback(
    (role: 'manager' | 'member') => {
      const custom = org?.roleLabels?.[role];
      if (custom && custom.trim()) {
        // If org kept default English label and UI is Hindi, translate cleanly
        if (custom === 'Manager' && role === 'manager') return t('common.manager');
        if (custom === 'Member' && role === 'member') return t('common.member');
        return custom;
      }
      return role === 'manager' ? t('common.manager') : t('common.member');
    },
    [org?.roleLabels, t]
  );

  const loading = !authReady || profileLoading;

  return (
    <AuthContext.Provider value={{ user, profile, org, loading, logout, getRoleLabel }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
