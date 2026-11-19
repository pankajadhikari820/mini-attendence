import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import en from '../i18n/en.json';
import hi from '../i18n/hi.json';
import type { LanguageCode } from '../types';
import { formatLocaleDate, formatLocaleNumber, formatLocaleTime } from '../utils/helpers';

const dictionaries: Record<LanguageCode, Record<string, unknown>> = { en, hi };

function lookupKey(dict: Record<string, unknown>, key: string): string {
  const parts = key.split('.');
  let current: unknown = dict;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof current === 'string' ? current : key;
}

export interface LanguageContextValue {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode, syncProfile?: boolean) => void;
  toggleLanguage: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatDate: (dateStr: string, opts?: Intl.DateTimeFormatOptions) => string;
  formatTime: (date: Date | null | undefined) => string;
  formatNumber: (num: number) => string;
}

export const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<LanguageCode>(() => {
    if (typeof window === 'undefined') return 'en';
    const saved = localStorage.getItem('sas_lang');
    return saved === 'hi' ? 'hi' : 'en';
  });

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem('sas_lang', language);
  }, [language]);

  const setLanguage = useCallback((lang: LanguageCode, syncProfile = true) => {
    setLanguageState(lang);
    localStorage.setItem('sas_lang', lang);
    document.documentElement.lang = lang;
    if (syncProfile && auth.currentUser) {
      updateDoc(doc(db, 'users', auth.currentUser.uid), { language: lang }).catch(() => {
        // Ignore if user doc not yet created
      });
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'en' ? 'hi' : 'en', true);
  }, [language, setLanguage]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      let value = lookupKey(dictionaries[language], key);
      if (value === key) {
        value = lookupKey(dictionaries.en, key);
      }
      if (vars && typeof value === 'string') {
        let interpolated = value;
        Object.entries(vars).forEach(([k, v]) => {
          interpolated = interpolated.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        });
        return interpolated;
      }
      return value;
    },
    [language]
  );

  const formatDate = useCallback(
    (dateStr: string, opts?: Intl.DateTimeFormatOptions) => formatLocaleDate(dateStr, language, opts),
    [language]
  );

  const formatTime = useCallback(
    (date: Date | null | undefined) => formatLocaleTime(date, language),
    [language]
  );

  const formatNumber = useCallback(
    (num: number) => formatLocaleNumber(num, language),
    [language]
  );

  return (
    <LanguageContext.Provider
      value={{ language, setLanguage, toggleLanguage, t, formatDate, formatTime, formatNumber }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
