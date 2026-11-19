import React, { useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Download, Printer, X } from 'lucide-react';
import type { Organization, UserProfile } from '../types';
import { useTranslation } from '../hooks/useTranslation';

interface QRCardModalProps {
  person: UserProfile;
  org: Organization;
  roleLabel: string;
  onClose: () => void;
}

export const QRCardModal: React.FC<QRCardModalProps> = ({
  person,
  org,
  roleLabel,
  onClose,
}) => {
  const { t } = useTranslation();
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  const qrValue = JSON.stringify({
    orgId: org.id,
    uid: person.uid,
    id: person.memberId,
  });

  const handleDownloadQR = () => {
    const sourceCanvas = canvasWrapRef.current?.querySelector('canvas');
    if (!sourceCanvas) return;

    // Build a clean printable PNG with org name, person name, member ID, and QR code
    const outCanvas = document.createElement('canvas');
    const W = 560;
    const H = 700;
    outCanvas.width = W;
    outCanvas.height = H;
    const ctx = outCanvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#FAF9F6';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#E7E5E4';
    ctx.lineWidth = 4;
    ctx.strokeRect(16, 16, W - 32, H - 32);

    ctx.fillStyle = '#C25E00';
    ctx.fillRect(16, 16, W - 32, 12);

    ctx.fillStyle = '#78716C';
    ctx.font = '600 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(org.name, W / 2, 74);

    ctx.fillStyle = '#1C1917';
    ctx.font = '700 28px Inter, sans-serif';
    ctx.fillText(person.name, W / 2, 118);

    ctx.fillStyle = '#57534E';
    ctx.font = '500 18px "JetBrains Mono", monospace';
    ctx.fillText(`${person.memberId}  ·  ${roleLabel}`, W / 2, 152);

    // Draw white frame behind QR
    const qrSize = 360;
    const qrX = (W - qrSize) / 2;
    const qrY = 190;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(qrX - 18, qrY - 18, qrSize + 36, qrSize + 36);
    ctx.drawImage(sourceCanvas, qrX, qrY, qrSize, qrSize);

    ctx.fillStyle = '#78716C';
    ctx.font = '400 16px Inter, sans-serif';
    ctx.fillText('Smart Attendance System', W / 2, H - 48);

    const link = document.createElement('a');
    link.download = `${person.memberId || person.name.replace(/\s+/g, '_')}-QR.png`;
    link.href = outCanvas.toDataURL('image/png');
    link.click();
  };

  const handlePrintCard = () => {
    const sourceCanvas = canvasWrapRef.current?.querySelector('canvas');
    const qrDataUrl = sourceCanvas ? sourceCanvas.toDataURL('image/png') : '';
    const printArea = document.createElement('div');
    printArea.className = 'print-only fixed inset-0 bg-white flex items-center justify-center p-8 z-[999]';
    printArea.innerHTML = `
      <div style="width:320px;border:1px solid #d6d3d1;border-radius:16px;padding:24px;text-align:center;font-family:Inter,sans-serif;background:#fff;color:#1c1917;">
        <div style="height:6px;background:#C25E00;border-radius:3px;margin-bottom:18px;"></div>
        <div style="font-size:12px;color:#78716c;font-weight:600;margin-bottom:6px;">${org.name}</div>
        <div style="font-size:20px;font-weight:700;margin-bottom:4px;">${person.name}</div>
        <div style="font-size:13px;color:#57534e;font-family:monospace;margin-bottom:18px;">${person.memberId} · ${roleLabel}</div>
        <img src="${qrDataUrl}" style="width:210px;height:210px;margin:0 auto;display:block;" alt="QR Code" />
        ${person.rollNumber ? `<div style="font-size:12px;color:#78716c;margin-top:12px;">Roll/Emp: ${person.rollNumber}</div>` : ''}
        <div style="font-size:11px;color:#a8a29e;margin-top:14px;">Smart Attendance System</div>
      </div>
    `;
    document.body.appendChild(printArea);
    window.print();
    document.body.removeChild(printArea);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 no-print">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            {t('qr.title')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-[#FAF9F6] dark:bg-stone-950 p-5 text-center">
          <p className="text-xs font-medium text-stone-500 dark:text-stone-400">{org.name}</p>
          <h4 className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">
            {person.name}
          </h4>
          <p className="mt-0.5 text-xs font-mono text-stone-600 dark:text-stone-400">
            {person.memberId || '—'} · {roleLabel}
          </p>

          <div
            ref={canvasWrapRef}
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-white p-4 border border-stone-200"
          >
            <QRCodeCanvas value={qrValue} size={200} level="M" includeMargin={false} />
          </div>

          <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">{t('qr.scanHint')}</p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleDownloadQR}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#C25E00] hover:bg-[#A84F00] text-white px-3.5 py-2.5 text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>{t('qr.downloadQr')}</span>
          </button>
          <button
            type="button"
            onClick={handlePrintCard}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-700 px-3.5 py-2.5 text-sm font-medium transition-colors"
          >
            <Printer className="w-4 h-4" />
            <span>{t('qr.printCard')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
