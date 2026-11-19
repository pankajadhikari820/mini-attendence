import React from 'react';
import { useTranslation } from '../hooks/useTranslation';

interface LogoProps {
  compact?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ compact = false }) => {
  const { t } = useTranslation();

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <svg
        width="28"
        height="28"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="32" height="32" rx="8" fill="#C25E00" />
        <rect x="7" y="7" width="7" height="7" rx="1.5" stroke="#FAF9F6" strokeWidth="1.8" />
        <rect x="9.3" y="9.3" width="2.4" height="2.4" rx="0.5" fill="#FAF9F6" />
        <rect x="18" y="7" width="7" height="7" rx="1.5" stroke="#FAF9F6" strokeWidth="1.8" />
        <rect x="20.3" y="9.3" width="2.4" height="2.4" rx="0.5" fill="#FAF9F6" />
        <rect x="7" y="18" width="7" height="7" rx="1.5" stroke="#FAF9F6" strokeWidth="1.8" />
        <rect x="9.3" y="20.3" width="2.4" height="2.4" rx="0.5" fill="#FAF9F6" />
        <path
          d="M18 21.6L20.5 24.1L25.4 18.8"
          stroke="#FAF9F6"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!compact && (
        <span className="font-semibold tracking-tight text-stone-900 dark:text-stone-100 text-base">
          {t('brand')}
        </span>
      )}
    </span>
  );
};
