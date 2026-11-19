import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation';
import { Logo } from '../components/Logo';

export const NotFoundPage: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-[#FAF9F6] dark:bg-[#0F0F11] flex flex-col items-center justify-center px-4 text-center">
      <Logo />
      <p className="mt-8 font-mono text-sm font-semibold text-[#C25E00]">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
        {t('notFound.title')}
      </h1>
      <p className="mt-2 text-sm text-stone-500 dark:text-stone-400 max-w-sm">
        {t('notFound.desc')}
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center justify-center rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-5 py-2.5 text-sm font-medium transition-colors"
      >
        {t('notFound.goHome')}
      </Link>
    </div>
  );
};
