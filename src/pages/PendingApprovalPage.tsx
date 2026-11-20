import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clock, LogOut, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { Logo } from '../components/Logo';
import { LanguageToggle } from '../components/LanguageToggle';
import { ThemeToggle } from '../components/ThemeToggle';

export const PendingApprovalPage: React.FC = () => {
  const { profile, org, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const isInactive = profile?.status === 'inactive';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] dark:bg-[#0F0F11] flex flex-col">
      <header className="max-w-6xl w-full mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-8 text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-[#C25E00] mx-auto flex items-center justify-center">
            {isInactive ? <ShieldAlert className="w-6 h-6" /> : <Clock className="w-6 h-6" />}
          </div>

          <h1 className="mt-5 text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
            {isInactive ? t('auth.inactiveTitle') : t('auth.pendingTitle')}
          </h1>

          {!isInactive && (
            <p className="mt-2 text-sm font-medium text-stone-700 dark:text-stone-300">
              {t('auth.pendingSubtitle')}
            </p>
          )}

          <p className="mt-2.5 text-sm text-stone-500 dark:text-stone-400 leading-relaxed">
            {isInactive ? t('auth.inactiveDesc') : t('auth.pendingDesc')}
          </p>

          {profile && (
            <div className="mt-6 rounded-xl bg-stone-50 dark:bg-stone-900/70 border border-stone-200/80 dark:border-stone-800 px-4 py-3 text-xs text-stone-600 dark:text-stone-400 space-y-1">
              <p className="font-medium text-stone-900 dark:text-stone-100">{profile.name}</p>
              <p>{profile.email}</p>
              {org && <p>{org.name}</p>}
            </div>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="mt-6 w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 dark:border-stone-700 py-2.5 text-sm font-medium text-stone-800 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>{t('common.logout')}</span>
          </button>
        </div>
      </main>
    </div>
  );
};
