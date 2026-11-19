import React from 'react';
import { useTranslation } from '../hooks/useTranslation';

export const LanguageToggle: React.FC = () => {
  const { language, setLanguage } = useTranslation();

  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex items-center rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-100/70 dark:bg-stone-900 p-0.5 text-xs font-medium shrink-0"
    >
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={`px-2 py-1 rounded-md transition-colors whitespace-nowrap ${
          language === 'en'
            ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
            : 'text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
        }`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLanguage('hi')}
        className={`px-2 py-1 rounded-md transition-colors whitespace-nowrap ${
          language === 'hi'
            ? 'bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 shadow-xs'
            : 'text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
        }`}
      >
        हिं
      </button>
    </div>
  );
};
