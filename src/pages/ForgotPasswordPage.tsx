import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { AlertCircle, ArrowLeft, CheckCircle2, Mail, Send } from 'lucide-react';
import { auth } from '../firebase';
import { useTranslation } from '../hooks/useTranslation';
import { getFirebaseErrorKey } from '../utils/helpers';
import { Logo } from '../components/Logo';
import { LanguageToggle } from '../components/LanguageToggle';
import { ThemeToggle } from '../components/ThemeToggle';

export const ForgotPasswordPage: React.FC = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      setError(t(getFirebaseErrorKey(err)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] dark:bg-[#0F0F11] flex flex-col">
      <header className="max-w-6xl w-full mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <Link to="/" className="shrink-0">
          <Logo />
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-md rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#161619] p-5 sm:p-8 shadow-xs">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
            {t('auth.forgotTitle')}
          </h1>
          <p className="mt-1.5 text-sm text-stone-500 dark:text-stone-400">
            {t('auth.forgotSubtitle')}
          </p>

          {error && (
            <div className="mt-5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 flex items-start gap-2.5 text-sm text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {sent ? (
            <div className="mt-6 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-4 flex items-start gap-2.5 text-sm text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
              <span>{t('auth.resetSent')}</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1.5">
                  {t('auth.emailLabel')}
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent pl-10 pr-3.5 py-2.5 min-h-[44px] text-sm focus:outline-none focus:ring-2 focus:ring-[#C25E00]/30 focus:border-[#C25E00]"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] disabled:opacity-60 text-white py-3 min-h-[46px] text-sm font-medium transition-colors"
              >
                <Send className="w-4 h-4 shrink-0" />
                <span>{loading ? t('common.loading') : t('auth.sendResetBtn')}</span>
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-sm">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 font-medium text-[#C25E00] hover:underline"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t('auth.backToLogin')}</span>
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
};
