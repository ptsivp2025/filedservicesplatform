/**
 * lib/notifikasi/katalog.ts - daftar EVENT yang dikenal notification engine.
 *
 * Satu event = satu kejadian bisnis ("akun baru dibuat", "kode OTP reset
 * password"), bukan satu pesan. Kanal mana yang dipakai untuk event itu -
 * in-app saja, WhatsApp saja, atau keduanya - ditentukan terpisah dari sini
 * (lihat `bawaanKanal` di bawah untuk nilai bawaan).
 *
 * Sebelumnya katalog ini juga memuat event ticket/reminder/design-project
 * dari modul-modul Work Management yang sudah dibuang saat repo ini
 * ditransformasikan jadi Field Service Platform (lihat
 * docs/field-service-audit.md) - baris-baris itu ikut dibuang karena tidak
 * ada satu pun titik pengiriman yang menyebutkan kunci-kuncinya lagi. Event
 * Field Service (assignment PIC, evidence ditolak, dsb.) akan ditambahkan ke
 * sini saat titik pengirimannya benar-benar dibuat, bukan lebih dulu.
 */

export type KategoriEvent = 'system';

export interface DefinisiEvent {
  key: string;
  label: string;
  kategori: KategoriEvent;
  /** Kanal yang aktif kalau belum ada pengaturan admin untuk event ini. */
  bawaanKanal: Array<'in_app' | 'whatsapp'>;
}

/**
 * Event yang saklarnya BENAR-BENAR BERLAKU.
 *
 * Ini pembedaan yang penting dan harus jujur. Setelan per-event hanya
 * berpengaruh pada titik pengiriman yang menyebutkan kunci event-nya - lewat
 * kirimNotifikasi() (lib/notifikasi/router.ts) atau lewat parameter `event`
 * pada sendWA/sendWANotif (lib/wa.ts). Titik yang belum menyebutkannya hanya
 * tunduk pada SAKLAR INDUK kanal, bukan pada centang per-event.
 *
 * Tanpa daftar ini, Admin Panel menampilkan 22 centang yang tampak setara
 * padahal sebagian tidak mengubah apa pun - admin mematikan sebuah kejadian,
 * centangnya tersimpan, lalu pesannya tetap terkirim. Itu lebih buruk
 * daripada tidak punya setelan sama sekali.
 *
 * Bertambah seiring titik pengirimannya dianotasi. Satu-satunya aturan:
 * JANGAN menambahkan kunci ke sini sebelum titik pengirimannya benar-benar
 * menyebutkan kunci itu.
 */
export const EVENT_TERSAMBUNG: ReadonlySet<string> = new Set<string>([
  //  Lewat kirimNotifikasi() (router)
  'system.account_created',      // modal-bersama.tsx - WA selamat datang
  'fs.pic_assigned',              // field-service/page.tsx PicSubTab/BulkAssignModal - WA/Telegram ke PIC
  'fs.revision_requested',        // field-service/page.tsx ReviewTab.kirimRevisi() - WA/Telegram ke PIC
  //  Lewat parameter `event` pada sendWA/sendWANotif/sendFonnteWA (lib/wa.ts)
  'system.password_reset',       // forgot-password: kode OTP
]);

/** Apakah saklar per-event untuk kunci ini benar-benar berpengaruh? */
export function eventTersambung(key: string): boolean {
  return EVENT_TERSAMBUNG.has(key);
}

export const KATALOG_EVENT: DefinisiEvent[] = [
  { key: 'system.user_registered',    label: 'Akun baru menunggu persetujuan',    kategori: 'system',      bawaanKanal: ['in_app'] },
  { key: 'system.account_created',    label: 'Akun baru dibuat Admin - WA selamat datang', kategori: 'system', bawaanKanal: ['whatsapp'] },
  { key: 'system.password_reset',     label: 'Kode OTP reset password',           kategori: 'system',      bawaanKanal: ['whatsapp'] },
  // in_app SENGAJA tidak ikut bawaan - lonceng notifikasi in-app sudah
  // dilepas dari header dashboard (tidak ada lagi UI yang menampilkannya),
  // jadi WhatsApp/Telegram satu-satunya kanal yang benar-benar sampai.
  { key: 'fs.pic_assigned',           label: 'PIC baru di-assign ke lokasi',       kategori: 'system',      bawaanKanal: ['whatsapp'] },
  { key: 'fs.revision_requested',     label: 'Client meminta revisi',             kategori: 'system',      bawaanKanal: ['whatsapp'] },
];

export function cariEvent(key: string): DefinisiEvent | undefined {
  return KATALOG_EVENT.find(e => e.key === key);
}
