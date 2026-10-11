/**
 * Daftar bagian Admin Panel - pola lib/admin-bagian.ts milik Sales Management
 * Platform. Satu sumber untuk dua tempat: sub-menu di sidebar (layar lebar)
 * dan baris chip di atas isi (ponsel), supaya keduanya mustahil berbeda.
 *
 * Dikelompokkan menurut jenis pekerjaan admin, bukan menurut tabel:
 * siapa (Organisasi), seperti apa platform tampil (Tampilan), dan mesin di
 * belakangnya (Sistem).
 */

export type SeksiAdmin = 'settings' | 'peran' | 'audit' | 'merek' | 'integrasi' | 'rilis' | 'projects';
export type KelompokAdmin = 'Organisasi' | 'Tampilan' | 'Sistem';
export const URUTAN_KELOMPOK_ADMIN: KelompokAdmin[] = ['Organisasi', 'Tampilan', 'Sistem'];

export interface BagianAdmin {
  kunci: SeksiAdmin;
  label: string;
  ikon: string;
  kelompok: KelompokAdmin;
  judul: string;
  keterangan: string;
}

export const BAGIAN_ADMIN: BagianAdmin[] = [
  { kunci: 'settings', label: 'Pengguna', ikon: '👥', kelompok: 'Organisasi',
    judul: 'Pengguna', keterangan: 'Kelola akun dan peran (Admin / User / Technician / View).' },
  { kunci: 'peran', label: 'Hak Akses', ikon: '🔐', kelompok: 'Organisasi',
    judul: 'Peran & Hak Akses', keterangan: 'Menu per peran, dan sejauh mana tiap peran boleh bertindak.' },
  { kunci: 'projects', label: 'Projects & Members', ikon: '🏢', kelompok: 'Organisasi',
    judul: 'Projects & Members', keterangan: 'Tenant/client engagement dan siapa menjadi member project mana.' },
  { kunci: 'merek', label: 'Dashboard Setting', ikon: '🎨', kelompok: 'Tampilan',
    judul: 'Dashboard Setting', keterangan: 'Logo, nama platform, warna aksen, dan tampilan halaman login.' },
  { kunci: 'integrasi', label: 'Integrasi', ikon: '⚡', kelompok: 'Sistem',
    judul: 'Integrasi & Notifikasi', keterangan: 'Kanal notifikasi (In-App, WhatsApp, Telegram) dan event mana lewat kanal mana.' },
  { kunci: 'rilis', label: 'App Rilis', ikon: '📱', kelompok: 'Sistem',
    judul: 'App Rilis', keterangan: 'Riwayat dan unduhan APK Android technician, versi demi versi.' },
  { kunci: 'audit', label: 'Audit Log', ikon: '📜', kelompok: 'Sistem',
    judul: 'Jejak Audit', keterangan: 'Siapa mengubah apa dan kapan.' },
];

export function bagianAdmin(kunci: SeksiAdmin): BagianAdmin {
  return BAGIAN_ADMIN.find(b => b.kunci === kunci) ?? BAGIAN_ADMIN[0];
}
