import type { CapacitorConfig } from '@capacitor/cli';

/**
 * APK ini adalah pembungkus native (WebView) di sekitar situs Next.js yang
 * SUDAH live di Vercel — bukan build statis terpisah. Alasan: app ini punya
 * API routes/session/cookie (auth, RPC Supabase) yang butuh server Next.js
 * jalan; men-static-export-nya akan mematahkan login & semua fitur server.
 * Konsekuensinya: technician tetap butuh koneksi internet saat memakai app
 * (sama seperti sekarang di browser) — wajar, karena check-in/check-out juga
 * memanggil Supabase lewat internet.
 *
 * GANTI url di bawah ini ke domain Vercel produksi kamu sebelum build APK.
 */
const config: CapacitorConfig = {
  appId: 'com.indovisual.fieldservice',
  appName: 'Field Service',
  webDir: 'public',
  server: {
    url: 'https://GANTI-DENGAN-DOMAIN-VERCEL-KAMU.vercel.app',
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
