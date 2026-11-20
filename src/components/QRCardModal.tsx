import React, { useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import jsPDF from 'jspdf';
import { Download, FileText, Printer, ShieldAlert, X } from 'lucide-react';
import type { Organization, UserProfile } from '../types';
import { useTranslation } from '../hooks/useTranslation';
import { getInitials } from '../utils/helpers';

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
    type: 'student_id',
    orgId: org.id,
    uid: person.uid,
    id: person.memberId,
  });

  const enrollmentDisplay = person.enrollmentNumber || person.rollNumber || '—';
  const academicLine = [
    person.courseName,
    person.semester,
    person.section,
  ]
    .filter(Boolean)
    .join(' · ') || person.className || '';

  const handleDownloadPDF = () => {
    const sourceCanvas = canvasWrapRef.current?.querySelector('canvas');
    const qrDataUrl = sourceCanvas ? sourceCanvas.toDataURL('image/png') : '';

    // Standard portrait ID card PDF (86mm x 130mm)
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [86, 132],
    });

    // Background & card frame
    pdf.setFillColor(250, 249, 246);
    pdf.rect(0, 0, 86, 132, 'F');
    pdf.setDrawColor(214, 211, 209);
    pdf.setLineWidth(0.5);
    pdf.roundedRect(3, 3, 80, 126, 3, 3, 'S');

    // Top accent bar
    pdf.setFillColor(194, 94, 0);
    pdf.rect(3, 3, 80, 14, 'F');

    // College Logo (if configured) + Name
    if (org.logoUrl && org.logoUrl.startsWith('data:image/')) {
      try {
        pdf.addImage(org.logoUrl, 'JPEG', 6, 5, 10, 10);
      } catch {
        // Ignore invalid image format
      }
    }
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text(org.name.slice(0, 32), 43, 10, { align: 'center' });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.5);
    pdf.text('OFFICIAL DIGITAL IDENTITY CARD', 43, 14.2, { align: 'center' });

    // Student Photo or Initials Box
    if (person.photoUrl && person.photoUrl.startsWith('data:image/')) {
      try {
        pdf.addImage(person.photoUrl, 'JPEG', 31, 21, 24, 24);
      } catch {
        pdf.setFillColor(231, 229, 228);
        pdf.roundedRect(31, 21, 24, 24, 3, 3, 'F');
      }
    } else {
      pdf.setFillColor(231, 229, 228);
      pdf.roundedRect(31, 21, 24, 24, 3, 3, 'F');
      pdf.setTextColor(68, 64, 60);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text(getInitials(person.name), 43, 35, { align: 'center' });
    }

    // Student Name & Role
    pdf.setTextColor(28, 25, 23);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(person.name.slice(0, 28), 43, 52, { align: 'center' });

    pdf.setTextColor(120, 113, 108);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.text(`${roleLabel} · ID: ${person.memberId || '—'}`, 43, 56.5, { align: 'center' });

    // Academic Metadata Grid
    let y = 62;
    pdf.setDrawColor(231, 229, 228);
    pdf.line(8, y - 2, 78, y - 2);

    const rows: Array<[string, string]> = [
      ['Enrollment / Roll', enrollmentDisplay],
      ...(person.departmentName ? [['Department', person.departmentName] as [string, string]] : []),
      ...(academicLine ? [['Class / Sem / Sec', academicLine] as [string, string]] : []),
      ...(person.phone ? [['Phone', person.phone] as [string, string]] : []),
    ];

    pdf.setFontSize(7);
    for (const [label, value] of rows) {
      pdf.setTextColor(120, 113, 108);
      pdf.setFont('helvetica', 'normal');
      pdf.text(label, 8, y + 2);
      pdf.setTextColor(28, 25, 23);
      pdf.setFont('helvetica', 'bold');
      pdf.text(value.slice(0, 28), 78, y + 2, { align: 'right' });
      y += 5;
    }

    // QR Code
    const qrY = Math.max(y + 2, 84);
    if (qrDataUrl) {
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(25, qrY, 36, 36, 2, 2, 'F');
      pdf.addImage(qrDataUrl, 'PNG', 27, qrY + 2, 32, 32);
    }

    pdf.setTextColor(120, 113, 108);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(5.5);
    pdf.text('For campus verification & faculty backup scan only.', 43, 125.5, { align: 'center' });

    pdf.save(`${person.memberId || person.name.replace(/\s+/g, '_')}-ID-Card.pdf`);
  };

  const handleDownloadPNG = () => {
    const sourceCanvas = canvasWrapRef.current?.querySelector('canvas');
    if (!sourceCanvas) return;

    const outCanvas = document.createElement('canvas');
    const W = 560;
    const H = 760;
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
    ctx.fillRect(16, 16, W - 32, 82);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 22px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(org.name, W / 2, 56);
    ctx.font = '500 13px "DM Sans", sans-serif';
    ctx.fillText('DIGITAL IDENTITY CARD', W / 2, 80);

    ctx.fillStyle = '#1C1917';
    ctx.font = '700 28px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(person.name, W / 2, 146);

    ctx.fillStyle = '#57534E';
    ctx.font = '600 18px "JetBrains Mono", monospace';
    ctx.fillText(`${person.memberId || '—'}  ·  ${roleLabel}`, W / 2, 180);

    if (academicLine) {
      ctx.fillStyle = '#78716C';
      ctx.font = '500 16px "DM Sans", sans-serif';
      ctx.fillText(academicLine, W / 2, 212);
    }

    if (person.enrollmentNumber || person.rollNumber) {
      ctx.fillStyle = '#78716C';
      ctx.font = '500 15px "JetBrains Mono", monospace';
      ctx.fillText(`Enrollment: ${enrollmentDisplay}`, W / 2, 240);
    }

    const qrSize = 320;
    const qrX = (W - qrSize) / 2;
    const qrY = 276;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(qrX - 18, qrY - 18, qrSize + 36, qrSize + 36);
    ctx.drawImage(sourceCanvas, qrX, qrY, qrSize, qrSize);

    ctx.fillStyle = '#78716C';
    ctx.font = '400 14px "DM Sans", sans-serif';
    ctx.fillText('For campus identity & faculty backup scan only', W / 2, H - 46);

    const link = document.createElement('a');
    link.download = `${person.memberId || person.name.replace(/\s+/g, '_')}-ID.png`;
    link.href = outCanvas.toDataURL('image/png');
    link.click();
  };

  const handlePrintCard = () => {
    const sourceCanvas = canvasWrapRef.current?.querySelector('canvas');
    const qrDataUrl = sourceCanvas ? sourceCanvas.toDataURL('image/png') : '';
    const printArea = document.createElement('div');
    printArea.className = 'print-only fixed inset-0 bg-white flex items-center justify-center p-8 z-[999]';
    printArea.innerHTML = `
      <div style="width:330px;border:1px solid #d6d3d1;border-radius:16px;overflow:hidden;font-family:'DM Sans',sans-serif;background:#fff;color:#1c1917;">
        <div style="background:#C25E00;color:#fff;padding:16px;text-align:center;">
          <div style="font-size:14px;font-weight:700;">${org.name}</div>
          <div style="font-size:10px;opacity:0.9;margin-top:2px;letter-spacing:0.08em;">DIGITAL IDENTITY CARD</div>
        </div>
        <div style="padding:20px;text-align:center;">
          ${
            person.photoUrl
              ? `<img src="${person.photoUrl}" style="width:76px;height:76px;border-radius:14px;object-fit:cover;margin:0 auto 12px;border:2px solid #e7e5e4;" />`
              : ''
          }
          <div style="font-size:20px;font-weight:700;margin-bottom:4px;">${person.name}</div>
          <div style="font-size:13px;color:#57534e;font-family:monospace;margin-bottom:8px;">${person.memberId || '—'} · ${roleLabel}</div>
          ${academicLine ? `<div style="font-size:12px;color:#57534e;margin-bottom:4px;">${academicLine}</div>` : ''}
          ${person.departmentName ? `<div style="font-size:11px;color:#78716c;margin-bottom:10px;">${person.departmentName}</div>` : ''}
          <img src="${qrDataUrl}" style="width:190px;height:190px;margin:12px auto;display:block;" alt="QR Code" />
          <div style="font-size:11px;color:#78716c;margin-top:8px;">Enrollment / Roll: ${enrollmentDisplay}</div>
          <div style="font-size:10px;color:#a8a29e;margin-top:10px;">Campus identity card · Not valid for self-attendance</div>
        </div>
      </div>
    `;
    document.body.appendChild(printArea);
    window.print();
    document.body.removeChild(printArea);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 no-print">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-6 shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            {t('qr.digitalIdTitle')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="inline-flex items-center justify-center w-10 h-10 -mr-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Official Digital Student ID Card Preview */}
        <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-[#FAF9F6] dark:bg-stone-950 overflow-hidden">
          <div className="bg-[#C25E00] px-4 sm:px-5 py-4 text-white flex items-center gap-3">
            {org.logoUrl && (
              <img
                src={org.logoUrl}
                alt={org.name}
                className="w-10 h-10 rounded-xl object-cover bg-white/15 p-0.5 shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold truncate">{org.name}</p>
              <p className="text-[11px] uppercase tracking-wider text-white/85">
                {t('qr.officialCardLabel')}
              </p>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="flex items-center gap-3.5 sm:gap-4">
              {person.photoUrl ? (
                <img
                  src={person.photoUrl}
                  alt={person.name}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover border border-stone-200 dark:border-stone-700 shrink-0"
                />
              ) : (
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-200 flex items-center justify-center text-lg font-bold shrink-0">
                  {getInitials(person.name)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h4 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 truncate">
                  {person.name}
                </h4>
                <p className="text-xs font-mono text-[#C25E00] font-semibold mt-0.5">
                  {person.memberId || '—'} · {roleLabel}
                </p>
                {academicLine && (
                  <p className="text-xs text-stone-600 dark:text-stone-400 mt-0.5 truncate">
                    {academicLine}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 pt-3.5 border-t border-stone-200 dark:border-stone-800 grid grid-cols-2 gap-2.5 text-xs">
              <div>
                <span className="text-stone-400 block">{t('qr.enrollmentNo')}</span>
                <span className="font-mono font-medium text-stone-800 dark:text-stone-200">
                  {enrollmentDisplay}
                </span>
              </div>
              <div>
                <span className="text-stone-400 block">{t('academics.department')}</span>
                <span className="font-medium text-stone-800 dark:text-stone-200 truncate block">
                  {person.departmentName || '—'}
                </span>
              </div>
              {person.phone && (
                <div>
                  <span className="text-stone-400 block">{t('common.phone')}</span>
                  <span className="font-mono text-stone-700 dark:text-stone-300">
                    {person.phone}
                  </span>
                </div>
              )}
              <div>
                <span className="text-stone-400 block">{t('common.status')}</span>
                <span className="font-medium text-emerald-700 dark:text-emerald-400 capitalize">
                  {person.status}
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-col items-center">
              <div
                ref={canvasWrapRef}
                className="inline-flex items-center justify-center rounded-xl bg-white p-3.5 border border-stone-200"
              >
                <QRCodeCanvas value={qrValue} size={164} level="M" includeMargin={false} />
              </div>
              <p className="mt-2.5 text-[11px] text-stone-500 dark:text-stone-400 text-center flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>{t('qr.idCardSecurityNote')}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 min-[380px]:grid-cols-3 gap-2">
          <button
            type="button"
            onClick={handleDownloadPDF}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#C25E00] hover:bg-[#A84F00] text-white px-3 py-2.5 min-h-[42px] text-xs font-medium transition-colors"
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span>{t('qr.downloadPdf')}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadPNG}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-700 px-3 py-2.5 min-h-[42px] text-xs font-medium transition-colors"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>PNG</span>
          </button>
          <button
            type="button"
            onClick={handlePrintCard}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-700 px-3 py-2.5 min-h-[42px] text-xs font-medium transition-colors"
          >
            <Printer className="w-4 h-4 shrink-0" />
            <span>{t('qr.printCard')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
