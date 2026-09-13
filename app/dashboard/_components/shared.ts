export interface User {
  id: string;
  username: string;
  password?: string;
  full_name: string;
  role: string;
  team_type?: string;
  phone_number?: string;
  sales_division?: string;
  jabatan?: string;
  atasan_id?: string | null;  // atasan langsung - pohon hierarki Struktur Organisasi
  allowed_menus?: string[];
  created_at?: string;    // used to calculate days pending for Pending Approval users
  is_internal_sales?: boolean; // Guest/Sales internal (IVP/MVI) vs external - untuk routing pipeline
  /** 'full' | 'guest' - toggle akses setara admin di modul data. Lihat lib/constants.ts hasFullAccess(). */
  access_level?: string;
  /** Chat ID Telegram pribadi, terisi hanya lewat verifikasi - lihat app/api/notifikasi/telegram/route.ts aksi 'hubungkan'. */
  telegram_chat_id?: string | null;
  /** Field Service role tambahan - lihat docs/field-service-architecture.md §3. */
  fs_role?: string | null;
}

export interface MenuItem {
  title: string;
  icon: string;
  gradient: string;
  description: string;
  key: string;
  items: {
    name: string;
    url: string;
    icon: string;
    external?: boolean;
    embed?: boolean;
    internal?: boolean;
  }[];
}

// Notification Types

export interface NotificationItem {
  id: string;
  type: 'ticket' | 'require' | 'reminder';
  title: string;
  subtitle: string;
  time: string;
  url: string;
  internalUrl?: string;
  menuTitle: string;
  /**
   * Id record TUJUAN untuk deep-link (dipakai destinasi membuka detailnya
   * langsung, bukan cuma daftar). Untuk notif dari tickets/project_requests/
   * reminders/form_reviews, `id` di atas SUDAH id record aslinya - refId
   * tidak perlu diisi. HANYA notifikasi dari tabel `notifications` (personal)
   * butuh ini terpisah, karena `id`-nya di sana adalah id baris notifikasi
   * itu sendiri (dipakai utk mark-as-read), bukan id record yang dituju -
   * itu ada di kolom ref_id.
   */
  refId?: string;
}


// Hierarki jabatan & aturan CC - satu sumber kebenaran di lib/jabatan.ts,
// re-export agar call-site lama tetap jalan.
export { JABATAN_LIST, JABATAN_CONFIG, JABATAN_CC_RULES, type JabatanType } from '@/lib/jabatan';


// Account Settings Modal

// Menu modul lama dihapus saat repo ini dikonversi jadi Field Service & Proof
// of Execution platform. Tambahkan kunci menu Field Service di sini begitu
// halamannya dibangun (lihat juga allMenuItems di app/dashboard/page.tsx).
/**
 * Seluruh menu yang bisa diberikan per akun/peran.
 *
 * 'field-service' DITAMBAHKAN: sebelumnya ia tidak pernah ada di daftar ini,
 * sehingga satu-satunya cara membuka menu Operations untuk sebuah akun adalah
 * memberinya "Full Access" - yang berarti memberi SELURUH menu sekaligus.
 * Akibatnya peran Supervisor terpaksa dibuat access_level='full' hanya demi
 * bisa melihat Assign PIC. Dengan kuncinya ada di sini, aksesnya bisa
 * diberikan sendiri tanpa membuka semuanya.
 */
export const ALL_MENU_KEYS = [
  'dashboard',
  'field-service',
  'teknisi',
  'client-review',
];

/**
 * Menu yang TIDAK ikut diberikan otomatis saat user baru dibuat.
 * Admin/superadmin tetap melihatnya (mereka bypass allowed_menus), tapi anggota
 * team baru harus diberi akses manual lewat Admin Panel.
 */
export const RESTRICTED_MENU_KEYS: string[] = ['teknisi', 'client-review'];

/**
 * Default allowed_menus untuk user BARU. Sengaja dipisah dari ALL_MENU_KEYS:
 * ALL_MENU_KEYS = daftar lengkap untuk selector di Admin Panel,
 * DEFAULT_MENU_KEYS = yang benar-benar dicentang saat user dibuat.
 */
export const DEFAULT_MENU_KEYS = ALL_MENU_KEYS.filter(k => !RESTRICTED_MENU_KEYS.includes(k));

/**
 * Paket menu bergaya SALES - dipakai kelompok PTS yang di Admin Panel ->
 * Kelompok disetel "Tampilan Dashboard: Seperti Sales" (lihat `dashboard`
 * di lib/kelompok.ts).
 *
 * Isinya mengikuti apa yang benar-benar dipakai akun Sales/Marketing di
 * basis data ini: mengajukan jadwal & request design, membuat ticket,
 * mengisi form review, membaca Learning Center - TANPA Daily Report,
 * Incentive PTS, KPI Team, maupun Unit Movement yang memang urusan tim
 * internal.
 *
 * Disaring lewat ALL_MENU_KEYS supaya tidak bisa memuat kunci yang tidak
 * punya menu sungguhan. Akun Sales lama menyimpan 'form-require-project' di
 * allowed_menus padahal tidak ada satu pun menu berkunci itu - kunci hantu
 * yang tidak membuka apa-apa, dan tidak perlu ikut diwariskan ke sini.
 *
 * Hanya soal MENU: role akun tidak ikut berubah, jadi PTS Daerah tetap bisa
 * ditugaskan jadwal dan tetap tercatat bagiannya di Incentive PTS - yang
 * berubah hanya apa yang ia lihat di layarnya sendiri.
 */
export const SALES_MENU_KEYS = ALL_MENU_KEYS.filter(k => ['dashboard'].includes(k));

export const ALL_MENU_LABELS: Record<string, { label: string; icon: string }> = {
  'dashboard': { label: 'Dashboard', icon: '📊' },
  'field-service': { label: 'Operations (Field Service)', icon: '🛠️' },
  'teknisi': { label: 'Tugas Hari Ini (Teknisi)', icon: '✅' },
  'client-review': { label: 'Client Review', icon: '🔍' },
};

export const ROLE_BADGE: Record<string, string> = {
  superadmin: 'bg-rose-100 text-rose-700 border-rose-200',
  admin: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  team: 'bg-blue-100 text-blue-700 border-blue-200',
  team_pts: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  guest: 'bg-amber-100 text-amber-700 border-amber-200',
};


// Notif Bell props (from NotifBell section)
export interface NotifBellProps {
  icon: string;
  label: string;
  count: number;
  color: string;
  bgColor: string;
  borderColor: string;
  dotColor: string;
  items: NotificationItem[];
  onItemClick: (item: NotificationItem) => void;
  /** Hanya dipakai lonceng Notifikasi personal (tabel `notifications`) - keempat
   *  lonceng lain (Ticket/Require/Reminder/Review) berasal dari status record
   *  asli, bukan flag is_read, jadi tidak butuh "tandai semua dibaca". */
  onMarkAllRead?: () => void;
}


// Admin Panel props
export interface AdminPanelModalProps {
  initialTab: 'settings' | 'merek' | 'integrasi' | 'rilis' | 'projects';
  onClose: () => void;
}
