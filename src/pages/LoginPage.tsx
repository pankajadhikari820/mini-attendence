import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../hooks/useTranslation';
import { getFirebaseErrorKey } from '../utils/helpers';
import { Logo } from '../components/Logo';
import { LanguageToggle } from '../components/LanguageToggle';
import { ThemeToggle } from '../components/ThemeToggle';
import { getHomePathForRole } from '../components/ProtectedRoute';

export const LoginPage: React.FC = () => {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectFrom = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user && profile) {
      if (profile.status === 'pending' || profile.status === 'inactive') {
        navigate('/pending', { replace: true });
      } else if (
        redirectFrom &&
        redirectFrom.startsWith('/') &&
        !redirectFrom.startsWith('/login') &&
        !redirectFrom.startsWith('/register') &&
        !redirectFrom.startsWith('/pending')
      ) {
        if (
          redirectFrom.startsWith('/mark') &&
          (profile.role === 'admin' || profile.role === 'super_admin' || profile.role === 'parent')
        ) {
          navigate(getHomePathForRole(profile.role), { replace: true });
        } else {
          navigate(redirectFrom, { replace: true });
        }
      } else {
        navigate(getHomePathForRole(profile.role), { replace: true });
      }
    }
  }, [user, profile, navigate, redirectFrom]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    } catch (err) {
      setError(t(getFirebaseErrorKey(err)));
      setSubmitting(false);
    }
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
        <div className="w-full max-w-md rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-6 sm:p-8 shadow-xs">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
            {t('auth.loginTitle')}
          </h1>
          <p className="mt-1.5 text-sm text-stone-500 dark:text-stone-400">
            {t('auth.loginSubtitle')}
          </p>

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5"
              >
                {t('auth.emailLabel')}
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-sm font-medium text-stone-700 dark:text-stone-300"
                >
                  {t('auth.passwordLabel')}
                </label>
                <Link
                  to="/forgot-password"
                  className="text-xs font-medium text-[#C25E00] hover:underline"
                >
                  {t('auth.forgotLink')}
                </Link>
              </div>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white py-2.5 text-sm font-medium transition-colors"
            >
              {submitting ? t('common.loading') : t('auth.loginBtn')}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-stone-500 dark:text-stone-400">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="font-medium text-[#C25E00] hover:underline">
              {t('auth.createAccountLink')}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
};
