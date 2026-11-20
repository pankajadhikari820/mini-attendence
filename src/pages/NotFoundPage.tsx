import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { Logo } from '../components/Logo';

export const NotFoundPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-[#FAF9F6] dark:bg-[#0F0F11] flex flex-col items-center justify-center px-4 text-center">
      <Logo />
      <div className="mt-8 w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-[#C25E00] flex items-center justify-center">
        <Compass className="w-6 h-6" />
      </div>
      <p className="mt-4 font-mono text-sm font-semibold text-[#C25E00]">404</p>
      <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
        {t('notFound.title')}
      </h1>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400 max-w-sm">
        {t('notFound.desc')}
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-5 py-2.5 min-h-[44px] text-sm font-medium transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>{t('notFound.goHome')}</span>
      </Link>
    </div>
  );
};
