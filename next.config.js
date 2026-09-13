const { execSync } = require('child_process');
const { version } = require('./package.json');

/** Commit pendek + waktu build - dipakai VersionFooter (footer versi seperti
 *  referensi "v0.1.23 • 22a46f9 • 03 Sep 2026, 11.14"). Git selalu tersedia
 *  saat build di Vercel (checkout dari commit yang sama), jadi ini aman utk
 *  produksi - fallback 'dev' murni utk lingkungan tanpa git (jarang). */
function gitSha() {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'dev'; }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_GIT_SHA: gitSha(),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          // geolocation=(self): dibutuhkan Field Service untuk GPS check-in/out
          // (instruksi field-service §20, §27) — tetap diblokir untuk konteks
          // pihak ketiga/iframe, hanya diizinkan untuk origin platform sendiri.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          // Paksa HTTPS (Vercel selalu HTTPS). Reversible — tanpa preload.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // CSP minimal yang AMAN (tidak membatasi script/style inline supaya app
          // & Tailwind tidak rusak). Menutup vektor: plugin/objek, base-uri hijack,
          // dan clickjacking lintas-situs. CSP script-src penuh butuh test terpisah.
          { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

module.exports = nextConfig