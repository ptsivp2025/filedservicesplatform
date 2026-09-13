'use client';

/**
 * VersionFooter.tsx - "v0.1.23 • 22a46f9 • 03 Sep 2026, 11.14", persis pola
 * yang direferensikan user (MicroCMS). Nilainya diisi next.config.js saat
 * build (NEXT_PUBLIC_APP_VERSION dari package.json, commit pendek lewat
 * `git rev-parse`, waktu build) - bukan hardcode, jadi selalu menunjuk
 * commit/build yang sungguhan sedang berjalan.
 */
export function VersionFooter({ className = '' }: { className?: string }) {
  const versi = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';
  const sha = process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev';
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME;
  const tanggal = buildTime
    ? new Date(buildTime).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
      + ', ' + new Date(buildTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <p className={`text-[11px] text-slate-400 tracking-wide ${className}`}>
      v{versi} <span className="mx-1.5 text-slate-300">•</span> {sha}
      {tanggal && <><span className="mx-1.5 text-slate-300">•</span> {tanggal}</>}
    </p>
  );
}
