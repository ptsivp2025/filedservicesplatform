'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, setDbToken } from '@/lib/supabase';
import { setSession, clearSession, getSession, startSessionWatcher } from '@/lib/auth';
import { isAdmin as checkIsAdmin, hasFullAccess, SESSION_DURATION_MS } from '@/lib/constants';
import {
  User, MenuItem, NotificationItem,
  ALL_MENU_KEYS, ALL_MENU_LABELS, ROLE_BADGE,
} from './_components/shared';
import {
  UserProfileModal,
  AdminPanelHalaman,
} from './_components/Modals';
import { BAGIAN_ADMIN, URUTAN_KELOMPOK_ADMIN, type SeksiAdmin } from './_components/admin-bagian';
import PermissionAwareDashboard from './_components/widgets/PermissionAwareDashboard';
import { HeaderKanan } from './_components/HeaderKanan';
import OnboardingTour, { JelajahiButton } from './_components/OnboardingTour';
import { useMerek, gradasiPanelLogin, gradasiLatarPlatform, angkaTembus } from '@/lib/merek';
import SessionExpiryBanner from '@/app/_components/SessionExpiryBanner';
import { ModalPortal, LogoMerek, VersionFooter, PopupNotifikasiProaktif, type ButirNotifProaktif } from '@/components/shared';

export default function Dashboard() {
  const router = useRouter();
  const merek = useMerek();
  // Guard: ensure auto-navigation to first menu only happens ONCE per login session
  // (prevents race-condition re-fires when currentUser/showSidebar update multiple times)
  const autoNavigatedRef = useRef(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  /**
   * Popup notifikasi proaktif (kanan-atas, muncul sendiri). Sumbernya SAMA
   * dengan lonceng HeaderKanan (tabel notifications) - isinya sudah tertarget
   * per jobdesk peran karena setiap event server (fs_notif/fs_notif_peran)
   * menulis baris berbeda untuk Admin ("check-out perlu persetujuan"),
   * Supervisor (idem), dan Client ("deployment siap direview"). Yang
   * berubah di sini cuma CARANYA muncul - otomatis begitu login, bukan
   * menunggu lonceng diklik.
   */
  const [notifProaktif, setNotifProaktif] = useState<{ id: string; title: string; body: string | null; action_url: string | null }[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginErr, setLoginErr] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [registerErr, setRegisterErr] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [showRegPwd, setShowRegPwd] = useState(false);
  const [showRegConfirmPwd, setShowRegConfirmPwd] = useState(false);
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  /* Animasi kartu login saat berpindah masuk  daftar.
     'masuk'       kartu tumbuh keluar dari koper (adegan penuh diputar ulang)
     'tukarKeluar' kartu lama menyusut & memudar, isinya belum diganti
     'tukarMasuk'  isi sudah berganti, kartu baru muncul sementara koper berputar */
  const [animKartu, setAnimKartu] = useState<'masuk' | 'tukarKeluar' | 'tukarMasuk'>('masuk');
  /* Login sudah lolos, tapi halaman login belum ditinggalkan: tombol berubah
     jadi tanda centang dan koper menutup kembali. Lihat catatan di handleLogin
     soal kenapa perpindahannya sengaja ditunda. */
  const [masukBerhasil, setMasukBerhasil] = useState(false);
  /* Dashboard baru saja menggantikan halaman login: ia tumbuh keluar dari
     koper. Kelasnya dilepas lagi setelah animasinya habis - lihat catatan di
     app/globals.css soal kenapa transform tidak boleh menetap di akar
     dashboard. */
  const [dasborMuncul, setDasborMuncul] = useState(false);
  const sudahMasukRef = useRef(false);
  /* Perpindahan ke dashboard. Aman dipanggil berkali-kali: hanya yang pertama
     yang berlaku, sehingga pemberitahuan animasi dan jaring pengaman waktu
     tidak mungkin saling bertabrakan. */
  const masukKeDashboard = useCallback(() => {
    if (sudahMasukRef.current) return;
    sudahMasukRef.current = true;
    setDasborMuncul(true);
    setIsLoggedIn(true);
    setShowSidebar(true);
    setShowDashboardPanel(true);
    window.setTimeout(() => setDasborMuncul(false), 700);
  }, []);
  /* Naik tiap kali animasi kartu perlu diulang. Dipakai sebagai key React
     supaya animasi CSS benar-benar dijalankan lagi, bukan diabaikan karena
     elemennya dianggap sama. */
  const [putaranAnim, setPutaranAnim] = useState(0);
  const jedaTukarRef = useRef<number | null>(null);
  const [registerForm, setRegisterForm] = useState({
    full_name: '',
    username: '',
    password: '',
    confirm_password: '',
    phone_number: '',
  });
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);
  // Forgot password flow
  const [showForgot, setShowForgot] = useState(false);
  const [forgotStep, setForgotStep] = useState<'request' | 'verify'>('request');
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPwd, setForgotNewPwd] = useState('');
  const [forgotConfirmPwd, setForgotConfirmPwd] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMsg, setForgotMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [forgotMaskedPhone, setForgotMaskedPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [menuLoading, setMenuLoading] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [tourVisible, setTourVisible] = useState(false);
  const [tourHighlightKey, setTourHighlightKey] = useState<string | null>(null);
  const [showDashboardPanel, setShowDashboardPanel] = useState(false);

  /* Perpindahan antara form masuk dan form daftar.
     Ke DAFTAR  : kartu ditutup dulu 240 ms, baru isinya diganti - kalau tidak,
                  isi baru terlihat menyusut keluar dan efek tukarnya rusak,
                  karena React mengganti isi pada saat diklik, bukan di tengah
                  animasi. Kopernya berputar di tempat.
     Ke MASUK   : seluruh adegan koper diputar ulang dari nol, dan kartunya
                  tumbuh lagi dari dalam koper. */
  const pindahForm = useCallback((keDaftar: boolean) => {
    if (jedaTukarRef.current) window.clearTimeout(jedaTukarRef.current);
    if (keDaftar) {
      setAnimKartu('tukarKeluar');
      jedaTukarRef.current = window.setTimeout(() => {
        setShowRegister(true);
        setRegisterErr('');
        setAnimKartu('tukarMasuk');
        setPutaranAnim((n) => n + 1);
      }, 240);
    } else {
      setShowRegister(false);
      setRegisterErr('');
      setRegisterSuccess(false);
      setAnimKartu('masuk');
      setPutaranAnim((n) => n + 1);
    }
  }, []);
  useEffect(() => () => { if (jedaTukarRef.current) window.clearTimeout(jedaTukarRef.current); }, []);

  const [showSidebar, setShowSidebar] = useState(false);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [iframeTitle, setIframeTitle] = useState<string>('');
  const [showTicketing, setShowTicketing] = useState(false);
  const [internalUrl, setInternalUrl] = useState<string>('/ticketing');
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  /**
   * Project selector GLOBAL di sidebar - persis referensi user (MicroCMS
   * "Select tenant"): satu tempat, semua menu Field Service (Lokasi/
   * Execution Point/Assignment/Content) dan widget Dashboard menyesuaikan
   * ke situ, bukan pilih project ulang di tiap halaman. Sinkron lewat
   * sessionStorage key yang SAMA dengan yang sudah dipakai field-service/
   * page.tsx & ExecutionWidget (fs_selected_project_id) - jadi tidak perlu
   * bikin sumber kebenaran baru, cuma memberi SATU titik kontrol yang selalu
   * terlihat (bukan diulang per tab).
   */
  const [fsProjects, setFsProjects] = useState<{ id: string; name: string }[]>([]);
  const [fsSelectedProjectId, setFsSelectedProjectId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return sessionStorage.getItem('fs_selected_project_id') ?? '';
  });

  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminPanelTab, setAdminPanelTab] = useState<SeksiAdmin>('settings');
  /**
   * Dua antrean yang menunggu tindakan admin, sengaja DIPISAH karena
   * diselesaikan di tempat berbeda: pendingUsers di Admin Panel > User
   * Management, pendingRequests di Request Schedule. Menjumlahkannya jadi satu
   * badge membuat angka merah muncul di panel yang tidak memuat antreannya.
   */
  const [pendingUsers, setPendingUsers] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);
  /*
    Modul di dalam iframe minta layar penuh - dipakai saat peserta sedang
    mengerjakan Quiz.

    Modal yang dibuat DI DALAM iframe hanya bisa menutupi area iframe-nya; di
    luar itu sidebar dan bilah atas tetap terlihat, dan tombol-tombolnya tetap
    bisa diklik. Untuk quiz berbatas waktu itu bukan sekadar soal tampilan:
    satu klik menu di luar sana mengganti isi iframe, dan pengerjaannya hilang
    di tengah jalan.

    Jadi iframe-nya sendiri yang dinaikkan ke seluruh layar, atas permintaan
    modul di dalamnya lewat postMessage.
  */
  const [layarPenuh, setLayarPenuh] = useState(false);

  const [visibleMenuItems, setVisibleMenuItems] = useState<MenuItem[]>([]);

  // Menu modul lama (Learning Center/Tech Note/Reminder/Ticketing/dst) dihapus
  // saat repo ini dikonversi jadi Field Service & Proof of Execution platform.
  //
  // "Field Service" di sini HANYA kategori (title) - klik pada kategorinya
  // sendiri tidak melakukan apa-apa, hanya sub-item di `items` yang membuka
  // sesuatu. Tiap sub-item membuka app/field-service/page.tsx yang SAMA lewat
  // iframe internal (?tab= membedakan tab mana yang aktif saat halaman itu
  // dimuat) - jadi tetap satu halaman dengan satu tab bar di dalamnya
  // (Project -> Lokasi -> Execution Point -> Assign PIC berbagi pilihan
  // project/lokasi yang sama), hanya sekarang bisa dibuka langsung dari
  // sidebar tanpa harus klik tab di dalamnya dulu. Admin-only (lihat gerbang
  // hasFullAccess di dashboard sidebar untuk link ini).
  const allMenuItems: MenuItem[] = [
    {
      // "Operations" (bukan "Field Service") - kategori navigasi disusun
      // berdasar tugas operasional, bukan nama modul database. Monitoring
      // Execution sendiri sengaja TETAP di Dashboard, bukan dipisah jadi
      // item navigasi baru - itu keputusan eksplisit sebelumnya ("EXECUTION
      // buat apa? mending semua tampung di menu DASHBOARD").
      //
      // Dulu 5 item (Projects/Locations/Execution Points/Assignments/
      // Content) - user: "banyak page mubazir". Sekarang 2:
      //   - Projects PINDAH ke Admin Panel (pengaturan struktural, jarang
      //     dibuka, cuma Provider Admin - lihat modal-projects.tsx).
      //   - Execution Points + Assignments DILEBUR ke Locations (satu
      //     table: lokasi + PIC + titik TV + status, edit lewat
      //     LocationDetailModal) - lihat app/field-service/page.tsx.
      key: 'field-service',
      title: 'Operations',
      icon: '🛠️',
      gradient: 'from-indigo-600 to-indigo-500',
      description: 'Locations (termasuk Execution Points & Assign PIC) dan Content. Monitoring Execution ada di Dashboard, Projects ada di Admin Panel.',
      items: [
        // Siklus paling atas: inilah objek yang menggerakkan seluruh operasi
        // (buat siklus -> assign -> kerjakan -> review -> tutup -> bersihkan).
        // Lokasi & konten adalah master data yang melayaninya.
        { name: 'Siklus & Riwayat', url: '/field-service?tab=cycles', icon: '🗓️', internal: true },
        { name: 'Locations', url: '/field-service?tab=locations', icon: '📍', internal: true },
        // Content sengaja TIDAK lagi jadi menu: siklus mingguan berjalan
        // otomatis di hari yang dipilih Admin tanpa harus memilih konten
        // dulu - fokusnya melacak orang, jadwal, dan evidence. Data konten
        // lama tetap tersimpan di database.
      ],
    },
    {
      key: 'teknisi',
      title: 'My Work',
      icon: '✅',
      gradient: 'from-emerald-600 to-emerald-500',
      description: 'Check-in / check-out lokasi tugas hari ini.',
      items: [
        { name: 'Tugas Hari Ini', url: '/teknisi', icon: '✅', internal: true },
      ],
    },
    {
      // Dibuka juga oleh Admin/Supervisor, bukan cuma akun client - fungsi
      // databasenya (fs_review_tv) memang mengizinkan provider memutuskan,
      // dan admin perlu bisa menolong saat client belum sempat memeriksa.
      key: 'client-review',
      title: 'Client',
      icon: '🔍',
      gradient: 'from-amber-600 to-amber-500',
      description: 'Verifikasi hasil eksekusi atau minta revisi.',
      items: [
        { name: 'Reviews', url: '/field-service?tab=review', icon: '🔍', internal: true },
      ],
    },
  ];

  useEffect(() => {
    if (!currentUser) return;
    setMenuLoading(true);
    const timer = setTimeout(() => {
      const allowed = currentUser.allowed_menus;
      /*
        Yang melewati saringan allowed_menus bukan cuma admin/superadmin,
        tapi juga akun Team yang diberi toggle "Full Access" di Admin Panel.
        Full Access artinya SELURUH menu tampil tanpa ada yang disembunyikan -
        kalau di sini hanya role admin yang dilewatkan, pemegang Full Access
        tetap kehilangan menu yang tidak tercentang di allowed_menus-nya, dan
        satu-satunya cara membukanya jadi mencentang menu satu per satu.
      */
      if (!allowed || hasFullAccess(currentUser)) {
        setVisibleMenuItems(allMenuItems);
      } else {
        // Always use allMenuItems order (code order), not allowed_menus DB order
        setVisibleMenuItems(allMenuItems.filter(m => allowed.includes(m.key)));
      }
      setMenuLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [currentUser]);

  const handleLogin = async () => {
    if (loginLoading) return;
    setLoginLoading(true);
    setLoginErr('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginForm.username, password: loginForm.password }),
      });
      const result = await res.json();
      if (!res.ok || !result.user) { setLoginErr(result.error || 'Email atau password salah!'); return; }
      const data = result.user;
      if (data.team_type === 'Pending Approval') {
        setLoginErr('Akun kamu masih menunggu persetujuan admin. Kamu akan dihubungi setelah akun diaktifkan.');
        return;
      }
      setCurrentUser(data);
      setSession(data);
      // Pasang token PostgREST supaya seluruh query berikutnya membawa
      // identitas user - inilah yang membuat policy RLS bisa menyaring.
      setDbToken(result.db_token ?? null);
      // Permission-Aware Dashboard = homepage utk SEMUA role. Semua mendarat di
      // dashboard home (widget adaptif); tidak lagi auto-lompat ke menu pertama.
      autoNavigatedRef.current = true; // matikan auto-navigate useEffect

      /* Perpindahan ke dashboard ditunda supaya animasi penutup (lc-bongkar di
         globals.css) sempat jalan sampai habis. 1500ms = jeda 270ms + durasi
         1230ms milik animasi terakhir; angka ini WAJIB ikut berubah setiap
         durasi di globals.css diubah, kalau tidak halaman login dilepas dari
         DOM di tengah gerakan. Penundaan ini hanya dibayar saat orang benar
         benar menekan tombol login. */
      setMasukBerhasil(true);
      const pakaiAnimasi = typeof window !== 'undefined'
        && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.setTimeout(masukKeDashboard, pakaiAnimasi ? 1500 : 0);
    } catch { setLoginErr('Login gagal. Coba lagi.'); } finally { setLoginLoading(false); }
  };

  const handleForgotRequest = async () => {
    if (!forgotUsername.trim()) { setForgotMsg({ type: 'error', text: 'Masukkan username.' }); return; }
    setForgotLoading(true); setForgotMsg(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) { setForgotMsg({ type: 'error', text: data.error }); return; }
      setForgotMaskedPhone(data.maskedPhone ?? '');
      setForgotStep('verify');
      setForgotMsg({ type: 'success', text: data.message ?? 'OTP dikirim.' });
    } catch { setForgotMsg({ type: 'error', text: 'Gagal mengirim OTP.' }); }
    finally { setForgotLoading(false); }
  };

  const handleForgotVerify = async () => {
    if (!forgotOtp || !forgotNewPwd) { setForgotMsg({ type: 'error', text: 'Isi semua field.' }); return; }
    if (forgotNewPwd !== forgotConfirmPwd) { setForgotMsg({ type: 'error', text: 'Konfirmasi password tidak cocok.' }); return; }
    setForgotLoading(true); setForgotMsg(null);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: forgotUsername, otp: forgotOtp, newPassword: forgotNewPwd }),
      });
      const data = await res.json();
      if (!res.ok) { setForgotMsg({ type: 'error', text: data.error }); return; }
      setForgotMsg({ type: 'success', text: 'Password berhasil diubah! Silakan login.' });
      setTimeout(() => {
        setShowForgot(false); setForgotStep('request');
        setForgotUsername(''); setForgotOtp(''); setForgotNewPwd(''); setForgotConfirmPwd('');
        setForgotMsg(null);
      }, 2000);
    } catch { setForgotMsg({ type: 'error', text: 'Gagal mereset password.' }); }
    finally { setForgotLoading(false); }
  };

  const handleRegister = async () => {
    const { full_name, username, password, confirm_password } = registerForm;
    if (!full_name.trim()) { setRegisterErr('Nama lengkap wajib diisi!'); return; }
    if (!username.trim()) { setRegisterErr('Email wajib diisi!'); return; }
    // Registrasi baru WAJIB email valid (disimpan di kolom username). Akun lama
    // yang terlanjur pakai username non-email tidak terpengaruh.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username.trim())) { setRegisterErr('Masukkan alamat email yang valid (contoh: nama@perusahaan.com).'); return; }
    if (!password || password.length < 8) { setRegisterErr('Password minimal 8 karakter!'); return; }
    if (!/[A-Z]/.test(password)) { setRegisterErr('Password harus mengandung minimal 1 huruf kapital!'); return; }
    if (!/[0-9]/.test(password)) { setRegisterErr('Password harus mengandung minimal 1 angka!'); return; }
    if (password !== confirm_password) { setRegisterErr('Konfirmasi password tidak cocok!'); return; }
    setRegisterErr('');

    setRegisterLoading(true);
    try {
      // Seluruh pendaftaran dikerjakan di server - lihat /api/auth/register.
      //
      // Sebelumnya peramban memeriksa username ganda lalu menulis sendiri ke
      // tabel users. Keduanya menuntut tabel itu terbuka untuk pengunjung yang
      // belum login, dan "terbuka" berlaku untuk SELURUH tabel: siapa pun yang
      // memegang anon key bisa membaca 74 akun beserta nama, username, dan
      // nomor teleponnya. Username di sini adalah pengenal login, jadi daftar
      // itu sekaligus menyerahkan daftar sasaran yang lengkap.
      //
      // Role akun (Admin/User/Technician/View) TIDAK diminta di sini -
      // pendaftaran publik selalu jatuh ke "Pending Approval", role
      // sesungguhnya ditentukan admin lewat Admin Panel -> Account Settings ->
      // Pending, sama seperti sebelumnya.
      const daftarRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: full_name.trim(),
          username: username.trim().toLowerCase(),
          password,
          phone_number: registerForm.phone_number.trim() || null,
        }),
      });
      const hasilDaftar = await daftarRes.json().catch(() => ({}));
      if (!daftarRes.ok) {
        setRegisterErr(hasilDaftar.error || 'Pendaftaran gagal.');
        setRegisterLoading(false);
        return;
      }
      setRegisterSuccess(true);
      setRegisterForm({ full_name: '', username: '', password: '', confirm_password: '', phone_number: '' });
    } catch (err: any) {
      setRegisterErr('Registrasi gagal: ' + err.message);
    }
    setRegisterLoading(false);
  };

  const handleLogout = () => {
    autoNavigatedRef.current = false; // reset so next login re-navigates correctly
    setIsLoggedIn(false); setCurrentUser(null);
    /* Wajib: tanpa ini `masukBerhasil` tetap true selamanya, dan begitu
       halaman login dirender ulang setelah logout, kelas .lc-bongkar terpasang
       lagi dari awal. Animasinya `forwards`, jadi halaman yang baru saja muncul
       langsung terbongkar dan menyisakan layar kosong - persis bug yang dulu
       dilaporkan. sudahMasukRef juga direset supaya login BERIKUTNYA bisa
       memicu urutan keluar lagi, bukan cuma yang pertama. */
    setMasukBerhasil(false);
    setDasborMuncul(false);
    sudahMasukRef.current = false;
    clearSession();
    setShowSidebar(false); setIframeUrl(null); setShowTicketing(false); setInternalUrl('/ticketing');
    setShowAdminPanel(false); setShowUserProfile(false);
    router.push('/dashboard');
  };

  // Auto-navigate sales/guest to first allowed menu when sidebar opens
  // Uses autoNavigatedRef so this runs EXACTLY ONCE per login - no race conditions
  useEffect(() => {
    if (!isLoggedIn || !currentUser || !showSidebar) return;
    if (autoNavigatedRef.current) return; // already navigated this session
    const role = currentUser.role?.toLowerCase() ?? '';
    const isSalesGuest = ['guest','sales'].includes(role);
    // Full Access diperlakukan seperti admin: mendarat di panel dashboard,
    // bukan dilempar ke menu pertama yang tercentang.
    const isRegularTeam = role === 'team' && !hasFullAccess(currentUser)
      && !(currentUser.allowed_menus ?? []).includes('dashboard') && currentUser.jabatan !== 'Supervisor';
    if (isSalesGuest || isRegularTeam) {
      // Navigate to VISUAL FIRST menu - matches sidebar category order: LEARNING  PROJECT  INTERNAL DAILY
      // Using allowed[0] was wrong because sidebar groups by category, not by allowed_menus order
      const allowed = currentUser.allowed_menus ?? [];
      const categoryOrderedKey = [
        ...LEARNING_KEYS.filter(k => allowed.includes(k)),
        ...PROJECT_KEYS.filter(k => allowed.includes(k)),
        ...INTERNAL_DAILY_KEYS.filter(k => allowed.includes(k)),
      ][0] ?? null;
      const firstMenu = categoryOrderedKey
        ? allMenuItems.find(m => m.key === categoryOrderedKey)
        : null;
      if (!firstMenu) return;
      autoNavigatedRef.current = true; // mark before state updates to prevent concurrent fires
      const firstItem = firstMenu.items?.[0];
      const firstTitle = firstMenu.title ?? '';
      if (firstItem && firstItem.internal) {
        setIframeLoading(true);
        setInternalUrl(firstItem.url);
        setIframeTitle(`${firstTitle} - ${firstItem.name}`);
        setShowTicketing(true);
      } else if (firstItem && firstItem.embed && !firstItem.external) {
        setIframeLoading(true);
        setIframeUrl(firstItem.url);
        setIframeTitle(`${firstTitle} - ${firstItem.name}`);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, showSidebar, currentUser]);

  const handleMenuClick = (item: MenuItem['items'][0], menuTitle: string) => {
    if (item.external && !item.embed) { window.open(item.url, '_blank'); return; }
    setMobileMoreOpen(false); // close overlay on mobile
    setShowAdminPanel(false);
    setIframeUrl(null); setShowTicketing(false); setInternalUrl('/ticketing'); setShowDashboardPanel(false);
    setIframeLoading(true);
    setTimeout(() => {
      if (item.internal) {
        setShowSidebar(true); setShowTicketing(true);
        setInternalUrl(item.url);
        setIframeTitle(`${menuTitle} - ${item.name}`);
      } else if (item.embed) {
        setShowSidebar(true); setIframeUrl(item.url);
        setIframeTitle(`${menuTitle} - ${item.name}`);
      }
    }, 150);
  };

  // Admin Panel kini HALAMAN di area isi (pola Sales), bukan modal - menu
  // lain dimatikan supaya sidebar hanya menandai satu tempat aktif.
  const bukaAdminPanel = (tab: SeksiAdmin = 'settings') => {
    setMobileMoreOpen(false);
    setAdminPanelTab(tab);
    setShowAdminPanel(true);
    setShowSidebar(true);
    setShowDashboardPanel(false);
    setIframeUrl(null); setShowTicketing(false);
  };

  // Buka menu berdasarkan key (dipakai widget dashboard: Quick Action, "Lihat semua").
  const openMenuByKey = (key: string) => {
    const menu = allMenuItems.find(m => m.key === key);
    const item = menu?.items?.[0];
    if (menu && item) handleMenuClick(item, menu.title);
  };

  // Dibaca sekali per pemuatan halaman - lonceng sendiri sudah polling tiap
  // menit untuk badge-nya; popup ini cuma perlu tahu "ada yang belum dibaca
  // saat login", bukan mengejar detik demi detik.
  useEffect(() => {
    if (!currentUser) return;
    let batal = false;
    (async () => {
      const { data } = await supabase.from('notifications')
        .select('id, title, body, action_url')
        .eq('user_id', currentUser.id).eq('is_read', false)
        .order('created_at', { ascending: false }).limit(20);
      if (!batal) setNotifProaktif((data ?? []) as typeof notifProaktif);
    })();
    return () => { batal = true; };
  }, [currentUser]);

  const handleNotifNavigate = (navInternalUrl: string, title: string, refId?: string) => {
    // M16 (docs/UX-WORKFLOW-AUDIT.md): sebagian notifikasi (mis. "user baru
    // mendaftar") tidak menunjuk ke HALAMAN, tapi ke tab Admin Panel - modal
    // terpisah, bukan bagian dari sistem iframe/route di bawah. action_url
    // "admin:<tab>" sengaja BUKAN route sungguhan, dikenali khusus di sini.
    if (navInternalUrl.startsWith('admin:')) {
      const tab = navInternalUrl.slice('admin:'.length);
      bukaAdminPanel(BAGIAN_ADMIN.some(b => b.kunci === tab) ? (tab as SeksiAdmin) : 'settings');
      return;
    }
    // Deep-link: ?open=<id record> supaya halaman tujuan bisa langsung
    // membuka detailnya, bukan cuma daftar - lihat pemakaian di masing-masing
    // page.tsx (ticketing/reminder-schedule/form-require-project/form-review).
    const urlDenganTarget = refId
      ? `${navInternalUrl}${navInternalUrl.includes('?') ? '&' : '?'}open=${encodeURIComponent(refId)}`
      : navInternalUrl;
    setIframeUrl(null); setShowTicketing(false); setInternalUrl('/ticketing'); setIframeTitle(''); setShowDashboardPanel(false);
    setTimeout(() => {
      setShowTicketing(true);
      setInternalUrl(urlDenganTarget);
      setIframeTitle(title);
      setShowSidebar(true);
    }, 150);
  };

  /*
    Turunkan lagi dari layar penuh begitu isi iframe-nya berganti.

    Pesan IFRAME_MODAL_CLOSE dikirim modul saat komponennya dilepas - dan itu
    tidak selalu sempat terjadi: bila induk mengganti alamat iframe (mis. dari
    notifikasi), dokumen di dalamnya dibuang tanpa sempat berpamitan. Tanpa
    penurunan di sini, layar penuh menempel pada halaman berikutnya dan
    sidebar tidak bisa dijangkau lagi.
  */
  useEffect(() => { setLayarPenuh(false); }, [iframeUrl, showTicketing]);

  // postMessage bridge
  // Receives CC_NAVIGATE messages from Command Center iframe and routes to the
  // matching menu item, so Quick Access buttons in Command Center work seamlessly.
  useEffect(() => {
    const handleMsg = (e: MessageEvent) => {
      if (!e.data) return;
      // Permintaan layar penuh dari modul di dalam iframe. Hanya dilayani bila
      // asalnya sama - pesan dari halaman lain tidak boleh bisa menutupi
      // seluruh layar pengguna.
      if (e.data.type === 'IFRAME_MODAL_OPEN' || e.data.type === 'IFRAME_MODAL_CLOSE') {
        if (e.origin !== window.location.origin) return;
        setLayarPenuh(e.data.type === 'IFRAME_MODAL_OPEN');
        return;
      }
      if (e.data.type !== 'CC_NAVIGATE') return;
      const url: string = e.data.url ?? '';
      if (!url) return;
      // Find the menu item whose url matches
      const match = allMenuItems.flatMap(m => m.items.map(it => ({ it, menu: m })))
        .find(({ it }) => it.url === url);
      if (match) {
        handleMenuClick(match.it, match.menu.title);
      } else {
        // Fallback: open as internal iframe directly
        setIframeUrl(null); setShowTicketing(true); setInternalUrl(url);
        setIframeTitle(''); setShowDashboardPanel(false); setIframeLoading(true);
      }
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMenuItems]);

  const handleBackToDashboard = () => {
    // Tidak kembali ke card view - untuk admin/supervisor: dashboard panel
    // Untuk sales/guest: navigasikan ke menu pertama yang tersedia
    setIframeUrl(null); setShowTicketing(false); setInternalUrl('/ticketing'); setIframeTitle('');
    const role = currentUser?.role?.toLowerCase() ?? '';
    const isAdm = ['admin','superadmin'].includes(role) || hasFullAccess(currentUser) ||
      (role === 'team' && (currentUser?.jabatan === 'Supervisor' || (currentUser?.allowed_menus ?? []).includes('dashboard')));
    if (isAdm) {
      setShowDashboardPanel(true);
    } else {
      // sales/guest: navigate to VISUAL first menu (category order, matches sidebar)
      const catOrdered = [
        ...visibleMenuItems.filter(m => LEARNING_KEYS.includes(m.key)),
        ...visibleMenuItems.filter(m => PROJECT_KEYS.includes(m.key)),
        ...visibleMenuItems.filter(m => INTERNAL_DAILY_KEYS.includes(m.key)),
      ];
      const firstMenu = catOrdered[0];
      const firstItem = firstMenu?.items?.[0];
      const firstTitle = firstMenu?.title ?? '';
      if (firstItem) {
        setIframeLoading(true);
        if (firstItem.internal) {
          setInternalUrl(firstItem.url);
          setIframeTitle(`${firstTitle} - ${firstItem.name}`);
          setShowTicketing(true);
        } else if (firstItem.embed && !firstItem.external) {
          setIframeUrl(firstItem.url);
          setIframeTitle(`${firstTitle} - ${firstItem.name}`);
        }
      }
    }
  };

  useEffect(() => {
    const load = async () => {
      const parsed = getSession<User>();
      if (!parsed) { setLoading(false); return; }
      try {
        setCurrentUser(parsed);
        setIsLoggedIn(true);
        const { data, error } = await supabase.from('users').select('id,username,full_name,role,team_type,sales_division,jabatan,phone_number,allowed_menus,access_level,fs_role').eq('id', parsed.id).single();
        const userData: User = (!error && data) ? data : parsed;
        if (!error && data) {
          setCurrentUser(data);
          setSession(data);
        }
        // Permission-Aware Dashboard = homepage utk SEMUA role. Semua mendarat di
        // dashboard home saat reload; tidak lagi auto-lompat ke menu pertama.
        autoNavigatedRef.current = true; // matikan auto-navigate useEffect
        setShowSidebar(true); setShowDashboardPanel(true);
      } catch { /* ignore */ }
      setLoading(false);
    };
    load();
  }, []);

  // isAdmin TETAP admin/superadmin murni - khusus tombol Admin Panel (kelola
  // akun, bukan sekadar lihat data). Lihat lib/constants.ts hasFullAccess.
  const isAdmin = ['admin', 'superadmin'].includes(currentUser?.role?.toLowerCase() ?? '');
  // Admin/superadmin, ATAU akun Team PTS dengan toggle "Full Access" aktif
  // (mis. Manager PTS) - dipakai untuk hal yang BUKAN kelola akun: lihat
  // badge pending, akses KPI penuh, dst.
  const isFullAccess = isAdmin || hasFullAccess(currentUser);

  // KPI: admin/full-access + PTS supervisor + sales supervisor (harus ada allowed_menus dashboard) + team member with dashboard permission
  const isPTSSupervisor = currentUser?.role === 'team'
    && ['Team PTS IVP', 'Team PTS UMP', 'Team PTS MVI'].includes(currentUser?.team_type ?? '')
    && currentUser?.jabatan === 'Supervisor';
  const isSalesSupervisor = ['guest', 'sales'].includes(currentUser?.role?.toLowerCase() ?? '')
    && ['Supervisor', 'Manager', 'Deputy General Manager', 'General Manager', 'Direktur'].includes(currentUser?.jabatan ?? '')
    && (currentUser?.allowed_menus ?? []).includes('dashboard');
  const hasTeamDashboardAccess = currentUser?.role === 'team'
    && (currentUser?.allowed_menus ?? []).includes('dashboard');
  const canAccessKPI = isFullAccess || isPTSSupervisor || isSalesSupervisor || hasTeamDashboardAccess;

  useEffect(() => {
    if (!isFullAccess) return;

    const refreshPendingCount = () => {
      // Hitung (1) user pending approval + (2) request jadwal sales yang belum di-assign
      Promise.all([
        supabase.from('users')
          .select('id', { count: 'exact', head: true })
          .eq('team_type', 'Pending Approval'),
        supabase.from('reminders')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_to', '')
          .eq('status', 'pending')
          .ilike('notes', '%[REQUEST SALES]%'),
      ]).then(([userRes, reminderRes]) => {
        setPendingUsers((userRes as any).count ?? 0);
        setPendingRequests((reminderRes as any).count ?? 0);
      });
    };

    refreshPendingCount();

    // Realtime: update badge saat ada request jadwal baru atau user baru daftar
    const ch = supabase.channel('admin-pending-count-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, () => {
        setTimeout(refreshPendingCount, 400);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
        setTimeout(refreshPendingCount, 400);
      })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
    // Dep-nya isFullAccess, bukan isAdmin: penjaga di atas memakai isFullAccess,
    // jadi untuk akun Full Access non-admin nilai isAdmin tidak pernah berubah
    // dan efek ini tidak pernah dijalankan ulang - badge-nya tidak muncul.
  }, [isFullAccess]);

  const INTERNAL_KEYS = ['reminder-schedule', 'request-design-project', 'form-bast', 'ticket-troubleshooting', 'picket-showroom', 'kpi-team'];
  const PROJECT_KEYS = ['reminder-schedule', 'request-design-project', 'form-bast', 'ticket-troubleshooting', 'incentive-pts', 'project-progress'];
  const INTERNAL_DAILY_KEYS = ['picket-showroom', 'daily-report', 'database-pts', 'unit-movement'];
  const FIELD_SERVICE_KEYS = ['field-service'];
  const TEKNISI_KEYS = ['teknisi'];
  const CLIENT_REVIEW_KEYS = ['client-review'];
  const LEARNING_KEYS = ['kpi-team', 'learning-center', 'tech-note'];

  const projectMenuItems = visibleMenuItems.filter(m => PROJECT_KEYS.includes(m.key));
  const internalMenuItems = visibleMenuItems.filter(m => INTERNAL_DAILY_KEYS.includes(m.key));
  const learningMenuItems = visibleMenuItems.filter(m => LEARNING_KEYS.includes(m.key));

  // Selector project GLOBAL cuma relevan untuk yang punya akses menu
  // Field Service (Operations) - Client/Technician sudah scoped otomatis
  // lewat RLS/halaman masing-masing, tidak perlu "pilih project" manual.
  const bisaPilihFsProject = visibleMenuItems.some(m => m.key === 'field-service');

  // Navigasi mobile: Home + maksimal 3 menu utama di bottom nav, sisanya
  // (kalau ada) pindah ke MobileMorePanel bersama akun/admin/sign-out -
  // supaya bottom nav tidak makin sempit tiap peran punya menu makin banyak,
  // dan supaya ada SATU tempat pasti untuk logout di mobile (lihat
  // MobileMorePanel di bawah, dan keluhan user soal logout yang sebelumnya
  // cuma bisa lewat sidebar desktop yang dibuka sebagai drawer).
  const MOBILE_NAV_CAP = 3;
  const semuaMenuItemMobile = visibleMenuItems.flatMap(menu => menu.items.map(item => ({ menu, item })));
  const mobilePrimaryItems = semuaMenuItemMobile.slice(0, MOBILE_NAV_CAP);
  const mobileOverflowItems = semuaMenuItemMobile.slice(MOBILE_NAV_CAP);

  // Kelompok sidebar disusun menurut PEKERJAAN (pola Sales Management
  // Platform), bukan menurut kunci modul. Kelompok Project/Learning memakai
  // judul menu karena kategori itu berisi satu item per menu.
  const KELOMPOK_SIDEBAR: { label: string; keys: string[]; denganBeranda?: boolean; pakaiJudulMenu?: boolean }[] = [
    { label: 'Kerja Harian', keys: TEKNISI_KEYS, denganBeranda: true },
    { label: 'Operasional', keys: FIELD_SERVICE_KEYS },
    { label: 'Review Client', keys: CLIENT_REVIEW_KEYS },
    { label: 'Project', keys: PROJECT_KEYS, pakaiJudulMenu: true },
    { label: 'Internal Daily', keys: INTERNAL_DAILY_KEYS },
    { label: 'Learning', keys: LEARNING_KEYS, pakaiJudulMenu: true },
  ];
  const menuAktif = (item: MenuItem['items'][0]) =>
    !showAdminPanel && !showDashboardPanel && ((showTicketing && Boolean(item.internal) && internalUrl === item.url) || iframeUrl === item.url);

  useEffect(() => {
    if (!bisaPilihFsProject || !currentUser) return;
    // Provider Admin/Supervisor tetap lihat SEMUA project (pola yang sama
    // dipakai di ExecutionWidget/Widgets.tsx - "admin lihat semua"). Selain
    // itu (mis. Field PIC) cuma project yang jadi member dia di
    // fs_project_members (migrasi 020) - "account pastinya di-regist sesuai
    // project yang terselect".
    const bolehSemuaProject = isFullAccess || currentUser.fs_role === 'PROVIDER_ADMIN' || currentUser.fs_role === 'PROVIDER_SUPERVISOR';
    (async () => {
      if (bolehSemuaProject) {
        const { data } = await supabase.from('fs_projects').select('id, name').order('name');
        const daftarSemua = (data ?? []) as { id: string; name: string }[];
        setFsProjects(daftarSemua);
        // Bug nyata (dilaporkan lewat screenshot): cabang admin ini TIDAK
        // PERNAH auto-pilih walau project cuma satu - auto-pilih hanya ada
        // di cabang member terbatas di bawah. Akibatnya selector sidebar
        // tetap kosong ("— Select project —") sementara halaman di dalam
        // iframe (yang punya logika auto-pilihnya sendiri) sudah jalan
        // normal - dua bagian layar seolah tidak sinkron padahal cuma
        // selector sidebar-nya yang lupa diisi.
        if (daftarSemua.length === 1 && !fsSelectedProjectId) {
          pilihFsProject(daftarSemua[0].id);
        }
        return;
      }
      const { data: memberRows } = await supabase
        .from('fs_project_members')
        .select('fs_projects(id, name)')
        .eq('user_id', currentUser.id);
      const daftar = ((memberRows ?? []) as unknown as { fs_projects: { id: string; name: string } | null }[])
        .map(r => r.fs_projects)
        .filter((p): p is { id: string; name: string } => !!p)
        .sort((a, b) => a.name.localeCompare(b.name));
      setFsProjects(daftar);
      // Auto-pilih kalau cuma member 1 project - tidak perlu klik lagi,
      // makin dekat ke UX referensi (tenant-terkunci).
      if (daftar.length === 1 && !fsSelectedProjectId) {
        pilihFsProject(daftar[0].id);
      }
    })();
  }, [bisaPilihFsProject, currentUser, isFullAccess]);

  // Dengarkan resolusi project dari sumber LAIN (ControlRoomWidget/
  // ExecutionWidget lewat projectAktif() di lib/fs-cycle.ts) - efek di atas
  // dan projectAktif() sama-sama query fs_projects sendiri-sendiri untuk
  // auto-pilih, dan siapa pun yang selesai LEBIH DULU tidak pernah
  // memberitahu yang lain. Akibatnya (dilaporkan user via screenshot):
  // dropdown "Select project" sempat terlihat kosong padahal widget
  // Dashboard di bawahnya sudah menampilkan data (untuk project yang SAMA,
  // yang sudah di-auto-pilih widget itu sendiri lewat projectAktif()) -
  // bukan kebocoran data (RLS tetap membatasi ke project milik user yang
  // sedang login), tapi dua bagian layar yang belum sinkron dan
  // membingungkan/mencurigakan buat dilihat. Cuma mengadopsi kalau
  // dropdown ini SENDIRI belum punya pilihan - tidak menimpa project yang
  // sudah dipilih manual oleh user.
  useEffect(() => {
    const dengarkan = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) setFsSelectedProjectId(prev => prev || id);
    };
    window.addEventListener('fs:project-resolved', dengarkan);
    return () => window.removeEventListener('fs:project-resolved', dengarkan);
  }, []);

  /** Naik tiap kali project aktif diganti SAAT iframe field-service/teknisi
   *  sedang terbuka - dipakai bagian dari key iframe di bawah supaya iframe
   *  remount (baca ulang sessionStorage) TANPA mengubah nilai internalUrl
   *  itu sendiri (yang dipakai perbandingan isActive sidebar - kalau ikut
   *  berubah, highlight menu yang sedang aktif jadi salah). */
  const [fsReloadNonce, setFsReloadNonce] = useState(0);
  /** Sama seperti fsReloadNonce, tapi untuk PermissionAwareDashboard (widget
   *  ExecutionWidget/RequiresAttentionWidget) saat project diganti sementara
   *  user sedang di layar Dashboard home, bukan di iframe Field Service. */
  const [dasborReloadNonce, setDasborReloadNonce] = useState(0);

  /** Ganti project aktif dari selector sidebar - satu titik kontrol untuk
   *  semua menu Field Service & widget Dashboard (persis "Select tenant" di
   *  referensi user). Key sessionStorage SAMA dengan yang sudah dibaca
   *  field-service/page.tsx & ExecutionWidget saat mount, jadi cukup PAKSA
   *  keduanya remount (bukan bikin channel postMessage baru) supaya
   *  langsung ikut project yang baru dipilih tanpa reload manual oleh user. */
  const pilihFsProject = (id: string) => {
    setFsSelectedProjectId(id);
    try { sessionStorage.setItem('fs_selected_project_id', id); } catch { /* diam - sekadar kenyamanan */ }
    if (showTicketing && (internalUrl.startsWith('/field-service') || internalUrl.startsWith('/teknisi'))) {
      setIframeLoading(true);
      setFsReloadNonce(n => n + 1);
    }
    if (showDashboardPanel) setDasborReloadNonce(n => n + 1);
  };

  const MENU_ICONS: Record<string, React.ReactElement> = {
    'learning-center': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>,
	'picket-showroom': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
    'reminder-schedule': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
    'request-design-project': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>,
    'form-bast': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>,
    'ticket-troubleshooting': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" /></svg>,
    'daily-report': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
    'database-pts': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" /></svg>,
    'unit-movement': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>,
    'incentive-pts': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    'tech-note': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
    'project-progress': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m4 10V11m4 6v-4M4 19h16a1 1 0 001-1V6a1 1 0 00-1-1H4a1 1 0 00-1 1v12a1 1 0 001 1z" /></svg>,
    'kpi-team': <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
    };

  function MenuLoadingOverlay() {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'rgba(226,168,75,0.3)', borderTopColor: '#e2a84b' }} />
          <p className="text-white/70 text-sm font-medium tracking-wide">Memuat menu...</p>
        </div>
      </div>
    );
  }

  function AnalyticsIframe() {
    const [iframeState, setIframeState] = useState<'loading' | 'ready' | 'error'>('loading');
    return (
      <div style={{ animation: 'fadeInUp 0.35s ease forwards', opacity: 0, height: '85vh', position: 'relative' }}>
        {iframeState === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/10 rounded-3xl z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'rgba(226,168,75,0.3)', borderTopColor: '#e2a84b' }} />
              <p className="text-white/70 text-sm">Memuat analytics...</p>
            </div>
          </div>
        )}
        {iframeState === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/5 rounded-3xl z-10">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="text-4xl">📊</span>
              <p className="text-white/80 font-semibold">Analytics tidak dapat dimuat</p>
              <p className="text-white/50 text-sm">Coba refresh halaman</p>
              <button onClick={() => setIframeState('loading')} className="mt-2 bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all">
                Coba Lagi
              </button>
            </div>
          </div>
        )}
        <iframe
          src="/analytics-dashboard"
          className="w-full h-full border-0 rounded-3xl overflow-hidden"
          style={{ boxShadow: '0 4px 32px rgba(0,0,0,0.12)', opacity: iframeState === 'ready' ? 1 : 0, transition: 'opacity 0.3s' }}
          title="Analytics Dashboard"
          onLoad={() => setIframeState('ready')}
          onError={() => setIframeState('error')}
        />
      </div>
    );
  }

  const renderMenuCard = (menu: MenuItem, index: number, accentColor: string) => {
    const isSingleInternal = menu.items.length === 1 && menu.items[0].internal;
    return (
      <div key={menu.key}
        className={`rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 bg-white ${isSingleInternal ? 'cursor-pointer group' : ''}`}
        style={{ animation: `fadeInUp 0.5s ease forwards`, animationDelay: `${index * 80}ms`, opacity: 0 }}
        onClick={isSingleInternal ? () => handleMenuClick(menu.items[0], menu.title) : undefined}
      >
        <div className={`bg-gradient-to-br ${menu.gradient} ${isSingleInternal ? 'p-6 md:p-8' : 'p-5 md:p-6'} relative overflow-hidden`}>
          <div className="absolute inset-0 opacity-10">
            <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full bg-white" />
            <div className="absolute -left-2 -bottom-2 w-16 h-16 rounded-full bg-white" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="text-4xl">{menu.icon}</div>
              <h3 className="text-xl font-bold tracking-tight text-white leading-tight">{menu.title}</h3>
            </div>
            <p className="text-white/90 text-sm font-medium line-clamp-2">{menu.description}</p>
          </div>
        </div>
        {!isSingleInternal && (
          <div className="p-5 space-y-3">
            {menu.items.map((item, itemIndex) => (
              <button key={itemIndex} onClick={e => { e.stopPropagation(); handleMenuClick(item, menu.title); }}
                className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-slate-300 text-slate-800 px-5 py-4 rounded-md font-semibold shadow-sm hover:shadow-md transition-all text-right flex items-center justify-end gap-4 group/item">
                {item.external && !item.embed ? (
                  <svg aria-hidden="true" focusable="false" className="w-5 h-5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                ) : (
                  <svg aria-hidden="true" focusable="false" className="w-5 h-5 text-slate-400 transition-transform group-hover/item:-translate-x-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                )}
                <span className="flex-1 text-sm tracking-wide text-right">{item.name}</span>
                <div className="w-10 h-10 bg-white rounded-md shadow-sm flex items-center justify-center text-xl border border-slate-200 group-hover/item:scale-110 transition-transform flex-shrink-0">{item.icon}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // LOADING
  if (loading) {
    return (
      <div className="flex items-center justify-center bg-cover bg-center bg-fixed" style={{ backgroundImage: 'url(/field-service-bg.jpg)', minHeight: '100dvh' }}>
        <div className="flex flex-col items-center gap-4 px-10 py-8 rounded-2xl" style={{ background: 'rgba(255,255,255,0.92)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
          <div className="w-12 h-12 rounded-full border-4 border-t-rose-600 border-rose-200 animate-spin" />
          <p className="text-slate-700 font-semibold">Memuat portal...</p>
        </div>
      </div>
    );
  }

  // LOGIN / REGISTER SCREEN
  if (!isLoggedIn) {
    return (
      // SATU background penuh utk seluruh halaman (tidak dipotong per panel) -
      // tiap panel hanya overlay transparan di atas gambar yang sama.
      <>
      {/* Seluruh isi halaman login ada di dalam bungkus ini supaya bisa dihisap
          masuk ke koper sebagai satu benda. Lapisan kopernya SENGAJA di luar —
          kalau ikut di dalam, kopernya akan menghisap dirinya sendiri. */}
      <div className={`${masukBerhasil ? 'lc-bongkar' : ''} flex bg-cover bg-center bg-fixed`}
        style={{ minHeight: '100dvh', ...(merek.gambarLatar ? { backgroundImage: `url(${merek.gambarLatar})` } : { background: gradasiLatarPlatform(merek) }) }}>
        {/* ── LEFT: panel branding (desktop) — overlay merah transparan, gambar tembus dari bg penuh ── */}
        <div className={`hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 text-white overflow-hidden ${masukBerhasil ? 'lc-bongkar-kiri' : ''}`}
          style={{ background: gradasiPanelLogin(merek) }}>
          <div className="flex items-center gap-2.5">
            <LogoMerek ukuran="lg" gaya="tembus" />
            <span className="text-lg font-bold tracking-tight">{merek.namaPlatform} <span className="font-normal text-white/75">· {merek.namaPortal}</span></span>
          </div>
          <div className="max-w-md">
            <h1 className="text-4xl font-black leading-tight mb-4">{merek.judulLogin}</h1>
            <p className="text-white/85 text-base leading-relaxed mb-8">{merek.subjudulLogin}</p>
            <div className="flex flex-wrap gap-2.5">
              {[['📍', 'Location Master'], ['✅', 'GPS Check-in'], ['📸', 'Evidence'], ['🔍', 'Client Verification']].map(([ic, l]) => (
                <span key={l} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/12 backdrop-blur text-sm font-semibold border border-white/15">{ic} {l}</span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-white/55 text-xs">© 2026 {merek.namaPerusahaan}</p>
            <span className="text-white/30 text-xs">•</span>
            <VersionFooter className="!text-white/45" />
          </div>
        </div>

        {/* ── RIGHT: panel form — overlay PUTIH transparan di atas bg penuh (biar tidak
            contrast), form dlm kartu frosted ── */}
        <div className={`relative overflow-hidden flex-1 flex items-center justify-center p-4 sm:p-8 ${masukBerhasil ? 'lc-bongkar-kanan' : ''}`}
          style={{ background: merek.gambarLatar ? `rgba(255,255,255,${angkaTembus(merek.tembusKanan, 0.55)})` : '#f8fafc' }}>
          <div
            key={putaranAnim}
            className={`lc-kartu ${
              animKartu === 'masuk' ? 'lc-kartu-masuk'
                : animKartu === 'tukarKeluar' ? 'lc-tukar-keluar' : 'lc-tukar-masuk'
            } w-full ${showRegister ? 'max-w-2xl' : 'max-w-md'} bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-6 sm:p-8`}
          >
            <div className="mb-8">
              {/* Logo kecil — hanya mobile (di desktop logo ada di panel kiri) */}
              <div className="flex lg:hidden items-center gap-2.5 mb-6">
                <LogoMerek ukuran="lg" />
                <span className="text-lg font-bold text-slate-800">{merek.namaPlatform} <span className="text-slate-400 font-normal">· {merek.namaPortal}</span></span>
              </div>
              <h2 className="text-3xl font-bold text-slate-800 tracking-tight">{showRegister ? 'Buat Akun Baru' : 'Selamat Datang'}</h2>
              <p className="text-slate-500 text-sm mt-1.5">{showRegister ? 'Lengkapi data untuk mendaftar. Akun akan diverifikasi admin.' : 'Masuk ke akun Anda untuk melanjutkan'}</p>
            </div>

            {!showRegister && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold mb-2 text-slate-600 tracking-widest uppercase">Email</label>
                  <input type="text" value={loginForm.username} onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 focus:border-rose-500 focus:ring-2 focus:ring-rose-100 transition-all bg-white text-slate-800 font-medium text-sm outline-none"
                    placeholder="email@perusahaan.com" onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-2 text-slate-600 tracking-widest uppercase">Password</label>
                  <div className="relative">
                    <input type={showLoginPwd ? 'text' : 'password'} value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                      className="w-full border border-slate-200 rounded-xl pl-4 pr-11 py-3 focus:border-rose-500 focus:ring-2 focus:ring-rose-100 transition-all bg-white text-slate-800 font-medium text-sm outline-none"
                      placeholder="Enter your password" onKeyDown={(e) => { if (e.key === 'Enter') { setLoginErr(''); handleLogin(); } }} />
                    <button type="button" onClick={() => setShowLoginPwd(v => !v)} tabIndex={-1}
                      aria-label={showLoginPwd ? 'Sembunyikan password' : 'Tampilkan password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                      {showLoginPwd ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" y1="2" x2="22" y2="22" /></svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></svg>
                      )}
                    </button>
                  </div>
                </div>
                {loginErr && (
                  <div className="px-4 py-2.5 rounded-xl text-sm font-medium text-red-700 bg-red-50 border border-red-200">
                    {loginErr}
                  </div>
                )}
                <button onClick={handleLogin} disabled={loginLoading || masukBerhasil} className="w-full text-white py-3.5 rounded-xl font-bold shadow-lg transition-all tracking-wide text-sm mt-2 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:opacity-90"
                  style={{ background: `linear-gradient(to right, ${merek.warnaUtama}, ${merek.warnaUtama2})` }}>
                  {masukBerhasil ? (
                    <>
                      {/* Kepastian bahwa passwordnya benar — inilah yang orang
                          tunggu, dan ia tampil seketika, tidak menunggu animasi. */}
                      <svg aria-hidden="true" focusable="false" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      Berhasil masuk
                    </>
                  ) : loginLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Memverifikasi...
                    </>
                  ) : (
                    <>🔐 Sign In to Portal</>
                  )}
                </button>
                <p className="text-center text-xs text-slate-400 pt-1">
                  Belum punya akun? <button onClick={() => pindahForm(true)} className="text-indigo-600 font-bold hover:underline">Daftar di sini</button>
                  <span className="mx-2 text-slate-300">|</span>
                  <button onClick={() => { setShowForgot(true); setForgotStep('request'); setForgotMsg(null); }} className="font-bold hover:underline" style={{ color: merek.warnaUtama }}>Lupa Password?</button>
                </p>
              </div>
            )}

            {showRegister && (
              <div>
                {registerSuccess ? (
                  <div className="text-center py-6">
                    <div className="text-5xl mb-4">✅</div>
                    <h3 className="font-bold text-slate-800 text-lg mb-2">Pendaftaran Berhasil!</h3>
                    <p className="text-slate-500 text-sm mb-4">
                      Akun kamu akan diverifikasi oleh admin. Kamu akan dihubungi setelah akun diaktifkan.
                    </p>
                    <button onClick={() => pindahForm(false)} className="text-white px-6 py-2.5 rounded-xl font-bold text-sm transition-all hover:opacity-90" style={{ background: merek.warnaUtama }}>Kembali ke Login</button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                      {/* Kolom Kiri */}
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-bold mb-1.5 text-slate-600 tracking-widest uppercase">Nama Lengkap *</label>
                          <input type="text" value={registerForm.full_name} onChange={e => setRegisterForm({ ...registerForm, full_name: e.target.value })}
                            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all" placeholder="Nama lengkap" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold mb-1.5 text-slate-600 tracking-widest uppercase">Email *</label>
                          <input type="email" value={registerForm.username} onChange={e => setRegisterForm({ ...registerForm, username: e.target.value })}
                            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all" placeholder="email@perusahaan.com" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold mb-1.5 text-slate-600 tracking-widest uppercase">Password *</label>
                          <div className="relative">
                            <input type={showRegPwd ? 'text' : 'password'} value={registerForm.password} onChange={e => setRegisterForm({ ...registerForm, password: e.target.value })}
                              className="w-full border border-slate-200 rounded-xl pl-4 pr-11 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all" placeholder="min. 8 karakter, ada kapital & angka" />
                            <button type="button" onClick={() => setShowRegPwd(v => !v)} tabIndex={-1}
                              aria-label={showRegPwd ? 'Sembunyikan password' : 'Tampilkan password'}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                              {showRegPwd ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" y1="2" x2="22" y2="22" /></svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></svg>
                              )}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold mb-1.5 text-slate-600 tracking-widest uppercase">Konfirmasi Password *</label>
                          <div className="relative">
                            <input type={showRegConfirmPwd ? 'text' : 'password'} value={registerForm.confirm_password} onChange={e => setRegisterForm({ ...registerForm, confirm_password: e.target.value })}
                              className="w-full border border-slate-200 rounded-xl pl-4 pr-11 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all" placeholder="ulangi password" />
                            <button type="button" onClick={() => setShowRegConfirmPwd(v => !v)} tabIndex={-1}
                              aria-label={showRegConfirmPwd ? 'Sembunyikan password' : 'Tampilkan password'}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                              {showRegConfirmPwd ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" y1="2" x2="22" y2="22" /></svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></svg>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                      {/* Kolom Kanan */}
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs font-bold mb-1.5 text-slate-600 tracking-widest uppercase">No. HP</label>
                          <input type="text" value={registerForm.phone_number} onChange={e => setRegisterForm({ ...registerForm, phone_number: e.target.value })}
                            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all" placeholder="08xx..." />
                        </div>
                        <p className="text-[11.5px] text-slate-400 leading-relaxed">
                          Akun akan berstatus <b>menunggu persetujuan</b> setelah mendaftar — admin akan
                          menetapkan role (Admin/User/Technician/View) saat mengaktifkannya.
                        </p>
                      </div>
                    </div>
                    {registerErr && (
                      <div className="px-4 py-2.5 rounded-xl text-sm font-medium text-red-700 bg-red-50 border border-red-200">{registerErr}</div>
                    )}
                    <button onClick={() => { setRegisterErr(''); handleRegister(); }} disabled={registerLoading}
                      className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 text-white py-3.5 rounded-xl font-bold shadow-lg transition-all text-sm disabled:opacity-60 flex items-center justify-center gap-2">
                      {registerLoading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                      📝 Daftar Akun
                    </button>
                    <p className="text-center text-xs text-slate-400">Sudah punya akun? <button onClick={() => pindahForm(false)} className="font-bold hover:underline" style={{ color: merek.warnaUtama }}>Login</button></p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Forgot Password Modal (login page) ── */}
        {showForgot && (
        <ModalPortal>
          <div role="dialog" aria-modal="true" className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-800">🔐 Reset Password</h3>
                <button aria-label="Tutup" onClick={() => setShowForgot(false)} className="text-slate-400 hover:text-slate-600 font-bold text-lg leading-none">✕</button>
              </div>
              {forgotMsg && (
                <div className={`px-3 py-2 rounded-lg text-xs font-semibold ${forgotMsg.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                  {forgotMsg.text}
                </div>
              )}
              {forgotStep === 'request' ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">Masukkan email (atau username lama) kamu. Kode OTP akan dikirim ke nomor WhatsApp yang terdaftar.</p>
                  <input type="text" value={forgotUsername} onChange={e => setForgotUsername(e.target.value)}
                    placeholder="Email / Username" onKeyDown={e => e.key === 'Enter' && handleForgotRequest()}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none" />
                  <button onClick={handleForgotRequest} disabled={forgotLoading}
                    className="w-full text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-60 transition-all hover:opacity-90" style={{ background: merek.warnaUtama }}>
                    {forgotLoading ? 'Mengirim...' : 'Kirim Kode OTP'}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">Masukkan kode 6-digit yang dikirim ke WA <strong>{forgotMaskedPhone}</strong>, lalu buat password baru.</p>
                  <input type="text" value={forgotOtp} onChange={e => setForgotOtp(e.target.value)}
                    placeholder="Kode OTP (6 digit)" maxLength={6}
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-center tracking-widest font-bold focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none" />
                  <input type="password" value={forgotNewPwd} onChange={e => setForgotNewPwd(e.target.value)}
                    placeholder="Password baru (min. 8, ada kapital & angka)"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none" />
                  <input type="password" value={forgotConfirmPwd} onChange={e => setForgotConfirmPwd(e.target.value)}
                    placeholder="Konfirmasi password baru"
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:border-rose-400 focus:ring-2 focus:ring-rose-100 outline-none" />
                  <div className="flex gap-2">
                    <button onClick={() => { setForgotStep('request'); setForgotMsg(null); }}
                      className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition-all">Kembali</button>
                    <button onClick={handleForgotVerify} disabled={forgotLoading}
                      className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-60 transition-all hover:opacity-90" style={{ background: merek.warnaUtama }}>
                      {forgotLoading ? 'Menyimpan...' : 'Reset Password'}
                    </button>
                  </div>
                  <button onClick={handleForgotRequest} disabled={forgotLoading}
                    className="w-full text-xs text-slate-400 hover:text-rose-500 transition-all">
                    Kirim ulang OTP
                  </button>
                </div>
              )}
            </div>
          </div>
        </ModalPortal>
        )}
      </div>
      </>
    );
  }

  // Header pola Sales Management Platform: bilah putih setinggi 56px yang
  // membentang penuh DI ATAS sidebar - identitas platform di kiri, konteks
  // siklus + lonceng + avatar di kanan. Sama di setiap halaman, termasuk di
  // ponsel saat sidebar tidak ada.
  const renderHeader = () => (
    <header className="sticky top-0 z-50 flex-shrink-0 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="px-3 sm:px-5 h-14 flex items-center gap-3">
        <button type="button"
          onClick={() => { if (showSidebar) { setShowAdminPanel(false); setShowDashboardPanel(true); setShowTicketing(false); setIframeUrl(null); } }}
          className="flex items-center gap-2.5 min-w-0 flex-shrink-0 text-left">
          <LogoMerek ukuran="sm" />
          <span className="min-w-0 hidden sm:block">
            <span className="block text-[14px] sentuhlebar:text-[16px] font-black text-slate-900 leading-tight truncate">
              {merek.namaPlatform}
              {merek.namaPortal && (
                <span className="font-bold ml-1.5" style={{ color: merek.warnaAksen }}>{merek.namaPortal}</span>
              )}
            </span>
            <span className="block text-[10px] sentuhlebar:text-[12px] text-slate-400 leading-tight truncate">
              {merek.namaPerusahaan || 'Platform internal'}
            </span>
          </span>
          <span className="sm:hidden text-[13px] font-black text-slate-900 truncate">
            {merek.namaPlatformSingkat || merek.namaPlatform}
          </span>
        </button>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5 min-w-0">
          {currentUser && (
            <HeaderKanan userId={currentUser.id} onBuka={handleNotifNavigate} />
          )}
          {currentUser && (
            <button type="button" onClick={() => setShowUserProfile(true)}
              aria-label={`Profil ${currentUser.full_name ?? ''}`}
              className="hidden sidebar:inline-flex items-center gap-2 pl-1 pr-2.5 py-1 min-h-[34px] rounded-full border border-slate-200 bg-white hover:bg-slate-50 transition-colors">
              <Inisial nama={currentUser.full_name ?? ''} />
              <span className="text-[12px] font-semibold text-slate-700 max-w-[140px] truncate">{currentUser.full_name}</span>
            </button>
          )}
          {/* Tampilan awal (sebelum sidebar dimuat) tidak punya kartu
              pengguna di sidebar - tombol Keluar ditaruh di header. */}
          {!showSidebar && (
            <button type="button" onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 min-h-[34px] rounded-kontrol border border-slate-200 bg-slate-50 text-[12px] font-semibold text-slate-500 hover:text-[#e34948] hover:bg-slate-100 transition-colors">
              {IkonGaris(PATH_IKON.keluar, 15)}
              <span className="hidden sm:inline">Keluar</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );

  // MODAL RENDERS (shared)
  const renderModals = () => (
    <>
      {showUserProfile && currentUser && <UserProfileModal currentUser={currentUser} onClose={() => setShowUserProfile(false)} />}
    </>
  );

  // VIEW: NO SIDEBAR (main dashboard)
  if (!showSidebar) {
    return (
      <div className={`${dasborMuncul ? 'lc-dasbor-muncul' : ''} flex flex-col bg-cover bg-center bg-fixed`} style={{ height: '100dvh', ...(merek.gambarLatarDasbor ? { backgroundImage: `url(${merek.gambarLatarDasbor})` } : { background: gradasiLatarPlatform(merek) }) }}>
        {renderModals()}
        {/* ── Jelajahi Button (always visible while logged-in, before sidebar loads) ── */}
        {currentUser && !tourVisible && (
          <JelajahiButton onClick={() => setShowTour(true)} />
        )}
        {renderHeader()}

        <div className="flex-1 overflow-y-auto overflow-x-hidden py-6 px-4 md:px-8">
          <div className="max-w-[1600px] mx-auto space-y-8">
            {menuLoading ? <MenuLoadingOverlay /> : (
              <>
                {/* ── Analytics Dashboard — admin, PTS sup, sales sup ── */}
                {canAccessKPI && currentUser && (
                  <AnalyticsIframe />
                )}
				{/* ── Learning Center section (BARU) ── */}
                {learningMenuItems.length > 0 && (
                  <div style={{ animation: 'fadeInUp 0.45s ease 0.2s forwards', opacity: 0 }}>
                    <div className="inline-flex items-center gap-2 mb-4 px-4 py-2 rounded-xl"
                      style={{ background: 'rgba(15,23,42,0.72)', backdropFilter: 'blur(8px)', boxShadow: '0 2px 12px rgba(0,0,0,0.25)' }}>
                      <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #60a5fa, #4338ca)' }}>
                        <svg aria-hidden="true" focusable="false" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 14l9-5-9-5-9 5 9 5z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                        </svg>
                      </div>
                      <span className="text-white font-bold text-sm tracking-wide">Learning Center</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                      {learningMenuItems.map((menu, i) => renderMenuCard(menu, i, '#4338ca'))}
                    </div>
                  </div>
                )}
                {/* Project section */}
                {projectMenuItems.length > 0 && (
                  <div style={{ animation: 'fadeInUp 0.45s ease forwards', opacity: 0 }}>
                    <div className="inline-flex items-center gap-2 mb-4 px-4 py-2 rounded-xl"
                      style={{ background: 'rgba(15,23,42,0.72)', backdropFilter: 'blur(8px)', boxShadow: '0 2px 12px rgba(0,0,0,0.25)' }}>
                      <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #38bdf8, #0284c7)' }}>
                        <svg aria-hidden="true" focusable="false" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <span className="text-white font-bold text-sm tracking-wide">Project</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                      {projectMenuItems.map((menu, i) => renderMenuCard(menu, i, '#0ea5e9'))}
                    </div>
                  </div>
                )}

                {/* Internal Daily section */}
                {internalMenuItems.length > 0 && (
                  <div style={{ animation: 'fadeInUp 0.45s ease 0.1s forwards', opacity: 0 }}>
                    <div className="inline-flex items-center gap-2 mb-4 px-4 py-2 rounded-xl"
                      style={{ background: 'rgba(15,23,42,0.72)', backdropFilter: 'blur(8px)', boxShadow: '0 2px 12px rgba(0,0,0,0.25)' }}>
                      <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #34d399, #059669)' }}>
                        <svg aria-hidden="true" focusable="false" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <span className="text-white font-bold text-sm tracking-wide">Internal Daily</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                      {internalMenuItems.map((menu, i) => renderMenuCard(menu, i, '#10b981'))}
                    </div>
                  </div>
                )}

              </>
            )}
          </div>
        </div>

        <div className="bg-white/70 backdrop-blur-sm border-t border-slate-200/60 flex-shrink-0">
          <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-3 md:py-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <p className="text-slate-500 text-xs font-medium tracking-wide">© 2026 IndoVisual — Field Service Platform</p>
            <span className="text-slate-300 text-xs">•</span>
            <VersionFooter />
          </div>
        </div>

        <style>{`
          @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
          @keyframes dropIn { from { opacity: 0; transform: translateY(-8px) scale(0.97); } to { opacity: 1; transform: none; } }
        `}</style>
      </div>
    );
  }

  // VIEW: SIDEBAR
  return (
    <div className={`${dasborMuncul ? 'lc-dasbor-muncul' : ''} flex flex-col bg-cover bg-center bg-fixed`} style={{ height: '100dvh', ...(merek.gambarLatarDasbor ? { backgroundImage: `url(${merek.gambarLatarDasbor})` } : { background: gradasiLatarPlatform(merek) }) }}>
      {isLoggedIn && <SessionExpiryBanner />}
      {renderModals()}

      {/* ── Onboarding Tour + floating button (sidebar view — stable mount) ── */}
      {currentUser && (
        <>
          <OnboardingTour
            currentUser={currentUser}
            visibleMenuKeys={visibleMenuItems.map(m => m.key)}
            forceShow={showTour}
            onDone={() => setShowTour(false)}
            onHighlightKey={setTourHighlightKey}
            onVisibleChange={setTourVisible}
          />
          {!tourVisible && (
            <JelajahiButton onClick={() => setShowTour(true)} />
          )}
        </>
      )}
      {renderHeader()}
      {currentUser && notifProaktif.length > 0 && (
        <PopupNotifikasiProaktif
          kunciSesi={`fs-popup-dash-${currentUser.id}-${notifProaktif.map(n => n.id).join(',')}`}
          judul={notifProaktif.length === 1 ? 'Ada kabar baru untuk Anda' : `Ada ${notifProaktif.length} kabar belum dibaca`}
          warna="#1E40AF"
          butir={notifProaktif.map((n): ButirNotifProaktif => ({ teks: n.title }))}
          lihatLabel="Lihat"
          onLihat={() => {
            const pertama = notifProaktif[0];
            void supabase.from('notifications').update({ is_read: true }).in('id', notifProaktif.map(n => n.id));
            setNotifProaktif([]);
            // Yang ditampilkan cuma yang paling baru; sisanya (kalau ada) tetap
            // bisa dibuka lewat lonceng seperti biasa.
            if (pertama?.action_url) handleNotifNavigate(pertama.action_url, pertama.title);
          }}
        />
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* SIDEBAR - pola Sales Management Platform: putih polos, menu
            dikelompokkan menurut PEKERJAAN (Kerja Harian / Operasional /
            Review Client / Sistem), item aktif = latar aksen-50 + teks
            aksen-800. Desktop-only (breakpoint `sidebar` = 900px); di ponsel
            navigasi sepenuhnya lewat bilah bawah. */}
        <aside className="hidden sidebar:flex w-[228px] flex-shrink-0 flex-col bg-white border-r border-slate-200">
          <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto no-scrollbar px-2.5 py-3 flex flex-col gap-0.5">
            {menuLoading ? (
              <div className="flex items-center justify-center py-10">
                <span className="w-5 h-5 rounded-full border-2 border-aksen-200 border-t-aksen-700 animate-spin" aria-hidden="true" />
              </div>
            ) : (
              <>
                {/* Project selector GLOBAL - satu titik kontrol untuk semua
                    menu Operasional & widget Dashboard: pilih sekali di sini,
                    semua menu menyesuaikan project yang sama. */}
                {bisaPilihFsProject && (
                  <div className="mb-2">
                    <p className="px-3 pt-1 pb-1 text-[9px] font-bold text-slate-400 uppercase tracking-[0.14em]">Project</p>
                    <select value={fsSelectedProjectId} onChange={e => pilihFsProject(e.target.value)}
                      aria-label="Pilih project"
                      className="w-full text-[12px] font-semibold px-2.5 py-2 rounded-kontrol border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors">
                      <option value="">— Pilih project —</option>
                      {fsProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {!fsSelectedProjectId && fsProjects.length > 0 && (
                      <p className="mt-1.5 px-1 text-[10.5px] font-semibold text-aksen-800 leading-snug">
                        Pilih project dulu untuk membuka menu Operasional.
                      </p>
                    )}
                  </div>
                )}

                {KELOMPOK_SIDEBAR.map((kelompok) => {
                  const menus = visibleMenuItems.filter(m => kelompok.keys.includes(m.key));
                  // Kelompok tanpa satu pun menu untuk peran ini tidak
                  // ditampilkan - judul kelompok kosong hanya membingungkan.
                  if (menus.length === 0 && !kelompok.denganBeranda) return null;
                  const idJudul = `kelompok-${kelompok.label.replace(/\s+/g, '-')}`;
                  return (
                    <div key={kelompok.label} role="group" aria-labelledby={idJudul} className="flex flex-col gap-0.5 mb-2 last:mb-0">
                      <p id={idJudul} className="px-3 pt-1 pb-1 text-[9px] font-bold text-slate-400 uppercase tracking-[0.14em]">
                        {kelompok.label}
                      </p>
                      {kelompok.denganBeranda && (
                        <TautanSidebar
                          label="Dashboard"
                          ikon={IkonGaris(PATH_IKON.dashboard)}
                          aktif={showDashboardPanel}
                          onClick={() => { setShowAdminPanel(false); setShowDashboardPanel(true); setShowTicketing(false); setIframeUrl(null); }}
                        />
                      )}
                      {menus.flatMap(menu => menu.items.map((item, itemIndex) => (
                        <TautanSidebar
                          key={`${menu.key}-${itemIndex}`}
                          id={itemIndex === 0 ? `tour-menu-${menu.key}` : undefined}
                          label={kelompok.pakaiJudulMenu && menu.items.length === 1 ? menu.title : item.name}
                          ikon={ikonMenu(item, kelompok.pakaiJudulMenu ? MENU_ICONS[menu.key] : undefined)}
                          aktif={menuAktif(item)}
                          sorotTur={tourHighlightKey === menu.key}
                          lencana={menu.key === 'reminder-schedule' && isFullAccess && pendingRequests > 0 ? pendingRequests : 0}
                          eksternal={Boolean(item.external && !item.embed)}
                          onClick={() => { setShowDashboardPanel(false); handleMenuClick(item, menu.title); }}
                        />
                      )))}
                    </div>
                  );
                })}

                {isAdmin && (
                  <div role="group" aria-labelledby="kelompok-Sistem" className="flex flex-col gap-0.5">
                    <p id="kelompok-Sistem" className="px-3 pt-1 pb-1 text-[9px] font-bold text-slate-400 uppercase tracking-[0.14em]">Sistem</p>
                    <TautanSidebar
                      label="Admin Panel"
                      ikon={IkonGaris(PATH_IKON.admin)}
                      aktif={showAdminPanel}
                      lencana={pendingUsers}
                      onClick={() => bukaAdminPanel(showAdminPanel ? adminPanelTab : 'settings')}
                    />
                    {/* Sub-menu Admin Panel menempel DI SINI pada menu
                        induknya (pola Sales) - bukan panel navigasi kedua di
                        dalam area isi. */}
                    {showAdminPanel && (
                      <div className="ml-4 mt-1 mb-1 pl-2.5 border-l border-slate-200 flex flex-col gap-0.5">
                        {URUTAN_KELOMPOK_ADMIN.map(kelompok => {
                          const isi = BAGIAN_ADMIN.filter(b => b.kelompok === kelompok);
                          if (isi.length === 0) return null;
                          return (
                            <div key={kelompok} className="flex flex-col gap-0.5">
                              <p className="px-2 pt-1.5 pb-0.5 text-[9px] font-bold text-slate-400 uppercase tracking-[0.12em]">{kelompok}</p>
                              {isi.map(b => {
                                const ini = b.kunci === adminPanelTab;
                                return (
                                  <button key={b.kunci} type="button" aria-current={ini ? 'true' : undefined}
                                    onClick={() => setAdminPanelTab(b.kunci)}
                                    className={`flex items-center gap-2 px-2.5 py-2 rounded-kontrol text-left text-[12px] font-semibold transition-colors
                                                ${ini ? 'bg-aksen-50 text-aksen-800' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
                                    <span aria-hidden="true" className="text-[11px]">{b.ikon}</span>
                                    <span className="flex-1 truncate">{b.label}</span>
                                    {b.kunci === 'settings' && pendingUsers > 0 && (
                                      <span className="text-[9px] font-black bg-[#e34948] text-white rounded-full px-1.5 py-0.5 leading-none">{pendingUsers}</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </nav>

          {/* Kartu pengguna - profil + keluar, persis pola Sales. */}
          <div className="px-2.5 py-3 border-t border-slate-100">
            <button type="button" onClick={() => setShowUserProfile(true)}
              className="w-full text-left flex items-center gap-2.5 px-2 py-2 rounded-kontrol hover:bg-slate-50 transition-colors">
              <Inisial nama={currentUser?.full_name ?? ''} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-bold text-slate-800 truncate">{currentUser?.full_name ?? '-'}</span>
                <span className="block text-[10px] text-slate-400 capitalize">{currentUser?.role ?? '-'}</span>
              </span>
            </button>
            <button type="button" onClick={handleLogout}
              className="w-full mt-1 px-3 py-2 rounded-kontrol text-[12px] font-semibold text-slate-500 hover:bg-slate-50 hover:text-[#e34948] transition-colors text-left">
              Keluar
            </button>
          </div>
        </aside>

        {/* BILAH BAWAH - satu-satunya navigasi di ponsel (pola Sales):
            Dashboard + maksimal 3 menu utama + "Lainnya". Menu yang tidak
            muat, akun, Admin Panel, dan Keluar ada di panel Lainnya. Baris
            footer (hak cipta + versi) menempel di bawah ikon. */}
        <MobileBottomNav
          primaryItems={mobilePrimaryItems}
          showDashboardPanel={showDashboardPanel}
          showTicketing={showTicketing}
          internalUrl={internalUrl}
          iframeUrl={iframeUrl}
          moreActive={mobileMoreOpen}
          onHome={() => { setMobileMoreOpen(false); setShowAdminPanel(false); setShowDashboardPanel(true); setShowTicketing(false); setIframeUrl(null); }}
          onMenuClick={(item, judul) => { setMobileMoreOpen(false); setShowDashboardPanel(false); handleMenuClick(item, judul); }}
          onMore={() => setMobileMoreOpen(o => !o)}
          kaki={<KakiHalaman namaPlatform={merek.namaPlatform} ponsel />}
        />

        <MobileMorePanel
          buka={mobileMoreOpen}
          onTutup={() => setMobileMoreOpen(false)}
          currentUser={currentUser}
          isAdmin={isAdmin}
          pendingUsers={pendingUsers}
          overflowItems={mobileOverflowItems}
          showTicketing={showTicketing}
          internalUrl={internalUrl}
          iframeUrl={iframeUrl}
          onMenuClick={(item, judul) => { setMobileMoreOpen(false); setShowDashboardPanel(false); handleMenuClick(item, judul); }}
          onProfil={() => { setMobileMoreOpen(false); setShowUserProfile(true); }}
          onAdminPanel={() => bukaAdminPanel('settings')}
          onLogout={() => { setMobileMoreOpen(false); handleLogout(); }}
        />

        {/* MAIN CONTENT */}
        {/* Area modul dikunci PERSIS setinggi layar.
            Sebelumnya di sini ada overflow-y-auto, sehingga area ini bisa
            tumbuh melebihi layar dan iframe di dalamnya ikut lebih tinggi dari
            yang terlihat. Akibatnya setiap modal di SEMUA modul meleset:
            position:fixed di dalam iframe mengacu ke viewport iframe — kalau
            viewport itu lebih tinggi dari area terlihat, latar gelap modal
            berhenti di tengah layar dan isinya tidak pernah pas.

            Modul di dalam iframe sudah punya scroll sendiri (h-screen +
            overflow-hidden), jadi lapisan ini tidak boleh ikut men-scroll.
            min-h-0 wajib: tanpa itu flex-1 menolak menyusut di bawah tinggi
            kontennya dan penguncian ini tidak berlaku. Padding bawah di
            ponsel = tinggi bilah bawah + baris footer di dalamnya. */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden min-h-0 pb-[calc(74px+env(safe-area-inset-bottom))] sidebar:pb-0">
          <div className="flex-1 min-h-0 overflow-hidden relative">
            {/* ── Loading Bar (muncul saat menu diklik, hilang setelah iframe loaded) ── */}
            {iframeLoading && (
              <div className="absolute top-0 left-0 right-0 z-50 pointer-events-none">
                <div className="h-[3px] bg-slate-100 w-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      background: 'linear-gradient(90deg, #e2a84b, #f59e0b, #e2a84b)',
                      backgroundSize: '200% 100%',
                      animation: 'loadingBar 1.2s ease-in-out infinite',
                      width: '60%',
                    }}
                  />
                </div>
              </div>
            )}
            {showAdminPanel && isAdmin ? (
              <div className="w-full h-full overflow-hidden">
                <AdminPanelHalaman bagian={adminPanelTab} setBagian={setAdminPanelTab} />
              </div>
            ) : showDashboardPanel && currentUser ? (
              /* Permission-Aware Dashboard - widget adaptif per permission.
                 Background transparan (IVP bg tembus); hanya card yg opaque.
                 Analytics = launcher full-screen (bukan embed) utk yg berhak. */
              <div className="w-full h-full overflow-hidden relative"
                style={merek.gambarLatarDasbor
                  ? { backgroundImage: `url(${merek.gambarLatarDasbor})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: gradasiLatarPlatform(merek) }}>
                <PermissionAwareDashboard key={dasborReloadNonce} currentUser={currentUser} openMenu={openMenuByKey} openUrl={handleNotifNavigate}
                  onHubungkanTelegram={() => setShowUserProfile(true)} />
              </div>
            ) : showTicketing ? (
              // key={internalUrl} - wrapper ikut remount tiap ganti menu, jadi
              // animate-fade-in retrigger setiap kali ("harus ada animasi
              // bergerak sedikit ketika ganti page" - permintaan user).
              <div key={internalUrl} className={`animate-fade-in ${layarPenuh
                ? 'fixed inset-0 z-[300] bg-white overflow-hidden'
                : 'w-full h-full overflow-auto relative'}`}>
                {iframeLoading && (
                  <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-10 h-10 rounded-full border-[3px] border-t-transparent animate-spin" style={{ borderColor: 'rgba(226,168,75,0.25)', borderTopColor: '#e2a84b' }} />
                      <p className="text-slate-500 text-sm font-semibold tracking-wide">Memuat halaman...</p>
                    </div>
                  </div>
                )}
                <iframe
                  key={`${internalUrl}::${fsReloadNonce}`}
                  src={internalUrl}
                  className="w-full h-full border-0"
                  title={iframeTitle}
                  onLoad={() => setIframeLoading(false)}
                />
              </div>
            ) : iframeUrl ? (
              <div key={iframeUrl} className={`animate-fade-in ${layarPenuh
                ? 'fixed inset-0 z-[300] bg-white overflow-hidden'
                : 'w-full h-full overflow-auto relative'}`}>
                {iframeLoading && (
                  <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-10 h-10 rounded-full border-[3px] border-t-transparent animate-spin" style={{ borderColor: 'rgba(226,168,75,0.25)', borderTopColor: '#e2a84b' }} />
                      <p className="text-slate-500 text-sm font-semibold tracking-wide">Memuat halaman...</p>
                    </div>
                  </div>
                )}
                <iframe
                  key={iframeUrl}
                  src={iframeUrl}
                  className="w-full h-full border-0"
                  title={iframeTitle}
                  onLoad={() => setIframeLoading(false)}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400"
                style={merek.gambarLatarDasbor
                  ? { backgroundImage: `url(${merek.gambarLatarDasbor})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: gradasiLatarPlatform(merek) }}>
                <div className="text-center bg-white/75 rounded-2xl px-8 py-6 shadow-lg backdrop-blur-md">
                  <div className="text-5xl mb-3">📂</div>
                  <p className="font-semibold text-base text-slate-600">Pilih menu dari sidebar</p>
                  <p className="text-sm mt-1 text-slate-400">Klik salah satu menu di sebelah kiri untuk memulai</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <KakiHalaman namaPlatform={merek.namaPlatform} />

      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
        @keyframes dropIn { from { opacity: 0; transform: translateY(-8px) scale(0.97); } to { opacity: 1; transform: none; } }
        @keyframes loadingBar {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(80%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}

/**
 * Ikon garis satu bahasa visual (pola Sales Management Platform) untuk
 * sidebar dan bilah bawah. Item yang tidak punya padanan di PATH_IKON jatuh
 * ke ikon bawaan menunya, jadi menu modul lama tetap tampil.
 */
function IkonGaris(d: string, ukuran = 18) {
  return (
    <svg width={ukuran} height={ukuran} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const PATH_IKON: Record<string, string> = {
  dashboard: 'M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6V11h-6v9zm0-16v5h6V4h-6z',
  admin: 'M10.3 4.3a1.9 1.9 0 013.4 0l.5 1a1.9 1.9 0 002.3 1l1-.3a1.9 1.9 0 012.1 2.9l-.6.9a1.9 1.9 0 000 2.4l.6.9a1.9 1.9 0 01-2.1 2.9l-1-.3a1.9 1.9 0 00-2.3 1l-.5 1a1.9 1.9 0 01-3.4 0l-.5-1a1.9 1.9 0 00-2.3-1l-1 .3a1.9 1.9 0 01-2.1-2.9l.6-.9a1.9 1.9 0 000-2.4l-.6-.9a1.9 1.9 0 012.1-2.9l1 .3a1.9 1.9 0 002.3-1l.5-1z M12 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  lainnya: 'M5 12h.01M12 12h.01M19 12h.01',
  profil: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  keluar: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  '/field-service?tab=cycles': 'M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z',
  '/field-service?tab=locations': 'M12 21s7-5.686 7-11a7 7 0 10-14 0c0 5.314 7 11 7 11z M12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  '/field-service?tab=review': 'M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  '/teknisi': 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
};

function ikonMenu(item: MenuItem['items'][0], cadangan?: React.ReactNode, ukuran = 18): React.ReactNode {
  const d = PATH_IKON[item.url];
  if (d) return IkonGaris(d, ukuran);
  if (cadangan) return cadangan;
  return <span className="text-[15px] leading-none" aria-hidden="true">{item.icon}</span>;
}

/** Satu baris menu sidebar - aktif: latar aksen-50, teks aksen-800, ikon aksen-700. */
function TautanSidebar({ id, label, ikon, aktif, sorotTur, lencana = 0, eksternal, onClick }: {
  id?: string;
  label: string;
  ikon: React.ReactNode;
  aktif: boolean;
  sorotTur?: boolean;
  lencana?: number;
  eksternal?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button" id={id} onClick={onClick}
      aria-current={aktif ? 'page' : undefined}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-kontrol text-left text-[13px] font-semibold transition-colors
                  ${sorotTur
                    ? 'relative z-[1510] bg-amber-50 ring-2 ring-amber-300 text-slate-800'
                    : aktif
                      ? 'bg-aksen-50 text-aksen-800'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
    >
      <span className={`w-[19px] flex justify-center flex-shrink-0 ${aktif ? 'text-aksen-700' : 'text-slate-400'}`}>{ikon}</span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {lencana > 0 && (
        <span className="text-[10px] font-black bg-[#e34948] text-white rounded-full px-1.5 py-0.5 leading-none tabular-nums flex-shrink-0">
          {lencana}
        </span>
      )}
      {eksternal && IkonGaris('M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14', 12)}
    </button>
  );
}

function Inisial({ nama, besar }: { nama: string; besar?: boolean }) {
  const huruf = nama.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return (
    <span className={`${besar ? 'w-10 h-10 text-[13px]' : 'w-8 h-8 text-[11px]'} rounded-full bg-aksen-100 text-aksen-800 grid place-items-center font-black flex-shrink-0`}>
      {huruf || '?'}
    </span>
  );
}

/**
 * Footer pola Sales: hak cipta di kiri, identitas build (versi · commit ·
 * waktu build) di kanan - supaya saat ada laporan masalah, jelas versi mana
 * yang dipakai. Di layar lebar footer menempel di dasar kerangka; di ponsel
 * menjadi baris tipis di DALAM bilah navigasi bawah (varian `ponsel`).
 */
function KakiHalaman({ namaPlatform, ponsel }: { namaPlatform: string; ponsel?: boolean }) {
  const versi = process.env.NEXT_PUBLIC_APP_VERSION;
  const commit = process.env.NEXT_PUBLIC_GIT_SHA;
  const waktu = process.env.NEXT_PUBLIC_BUILD_TIME;
  const waktuBuild = waktu
    ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(waktu))
    : null;
  const tahun = new Date().getFullYear();

  if (ponsel) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-0.5 text-[9.5px] text-slate-400 leading-none">
        <span className="truncate min-w-0">© {tahun} {namaPlatform}</span>
        <span className="flex-shrink-0 tabular-nums">
          {versi && `v${versi}`}{commit && <> · <span className="font-mono">{commit}</span></>}
        </span>
      </div>
    );
  }

  return (
    <footer className="hidden sidebar:flex flex-shrink-0 h-9 border-t border-slate-200 bg-white/95 backdrop-blur px-5 items-center justify-between gap-3">
      <p className="text-[11px] text-slate-500 truncate min-w-0">© {tahun} {namaPlatform}</p>
      <p className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10.5px] font-medium text-slate-500 tabular-nums">
        {versi && <span>v{versi}</span>}
        {commit && <><span aria-hidden="true" className="text-slate-300">·</span><span className="font-mono">{commit}</span></>}
        {waktuBuild && <><span aria-hidden="true" className="text-slate-300">·</span><span>{waktuBuild}</span></>}
      </p>
    </footer>
  );
}

/**
 * Bilah bawah - navigasi utama di ponsel (pola Sales): ikon garis + label
 * kecil, aktif = aksen-700, sasaran sentuh minimal 56px. Maksimal 5 slot:
 * Dashboard + 3 menu utama + "Lainnya".
 */
interface MenuBaris { menu: MenuItem; item: MenuItem['items'][0]; }

function MobileBottomNav({
  primaryItems, showDashboardPanel, showTicketing, internalUrl, iframeUrl, moreActive, onHome, onMenuClick, onMore, kaki,
}: {
  primaryItems: MenuBaris[];
  showDashboardPanel: boolean;
  showTicketing: boolean;
  internalUrl: string;
  iframeUrl: string | null;
  moreActive: boolean;
  onHome: () => void;
  onMenuClick: (item: MenuItem['items'][0], menuTitle: string) => void;
  onMore: () => void;
  kaki?: React.ReactNode;
}) {
  const beranda = showDashboardPanel && !moreActive;
  return (
    <nav aria-label="Navigasi utama"
      className="sidebar:hidden fixed bottom-0 inset-x-0 z-[195] bg-white/[0.97] backdrop-blur border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
      <div className="flex">
        <button type="button" onClick={onHome} aria-current={beranda ? 'page' : undefined}
          className={`flex-1 min-h-[56px] flex flex-col items-center justify-center gap-0.5 py-2 ${beranda ? 'text-aksen-700' : 'text-slate-400'}`}>
          {IkonGaris(PATH_IKON.dashboard, 19)}
          <span className="text-[9.5px] font-bold leading-none">Dashboard</span>
        </button>
        {primaryItems.map(({ menu, item }, idx) => {
          const aktif = !moreActive && !showDashboardPanel && ((showTicketing && item.internal && internalUrl === item.url) || (iframeUrl === item.url));
          return (
            <button key={`${menu.key}-${idx}`} type="button" onClick={() => onMenuClick(item, menu.title)}
              aria-current={aktif ? 'page' : undefined}
              className={`flex-1 min-w-0 min-h-[56px] flex flex-col items-center justify-center gap-0.5 py-2 ${aktif ? 'text-aksen-700' : 'text-slate-400'}`}>
              {ikonMenu(item, undefined, 19)}
              <span className="text-[9.5px] font-bold leading-none truncate max-w-full px-1">{item.name}</span>
            </button>
          );
        })}
        <button type="button" onClick={onMore} aria-expanded={moreActive} aria-label="Menu lainnya dan akun"
          className={`flex-1 min-h-[56px] flex flex-col items-center justify-center gap-0.5 py-2 ${moreActive ? 'text-aksen-700' : 'text-slate-400'}`}>
          {IkonGaris(PATH_IKON.lainnya, 19)}
          <span className="text-[9.5px] font-bold leading-none">Lainnya</span>
        </button>
      </div>
      {kaki}
    </nav>
  );
}

/**
 * Panel "Lainnya" (pola Sales): kartu mengambang tepat di atas bilah bawah,
 * berisi akun + menu yang tidak muat sebagai ubin 3 kolom, lalu Profil /
 * Admin Panel / Keluar. Bukan sidebar desktop yang disempitkan.
 */
function MobileMorePanel({
  buka, onTutup, currentUser, isAdmin, pendingUsers, overflowItems,
  showTicketing, internalUrl, iframeUrl, onMenuClick, onProfil, onAdminPanel, onLogout,
}: {
  buka: boolean;
  onTutup: () => void;
  currentUser: User | null;
  isAdmin: boolean;
  pendingUsers: number;
  overflowItems: MenuBaris[];
  showTicketing: boolean;
  internalUrl: string;
  iframeUrl: string | null;
  onMenuClick: (item: MenuItem['items'][0], menuTitle: string) => void;
  onProfil: () => void;
  onAdminPanel: () => void;
  onLogout: () => void;
}) {
  useEffect(() => {
    if (!buka) return;
    const tutup = (e: KeyboardEvent) => { if (e.key === 'Escape') onTutup(); };
    window.addEventListener('keydown', tutup);
    return () => window.removeEventListener('keydown', tutup);
  }, [buka, onTutup]);

  if (!buka) return null;
  const ubin = 'min-h-[64px] rounded-kontrol flex flex-col items-center justify-center gap-1 px-1 transition-colors';
  return (
    <div className="sidebar:hidden fixed inset-0 z-[190]" onClick={onTutup}>
      <div className="absolute inset-0 bg-slate-900/30" aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Menu lainnya"
        className="absolute inset-x-3 bottom-[calc(84px+env(safe-area-inset-bottom))] max-h-[70vh] overflow-y-auto bg-white rounded-kartu border border-slate-200 shadow-modal p-2 animate-[naik_.18s_ease-out]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-2 py-2 mb-1 border-b border-slate-100">
          <Inisial nama={currentUser?.full_name ?? ''} besar />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-slate-800 truncate">{currentUser?.full_name ?? '-'}</p>
            <p className="text-[10.5px] text-slate-400 capitalize">{currentUser?.role ?? '-'}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {overflowItems.map(({ menu, item }, idx) => {
            const aktif = (showTicketing && item.internal && internalUrl === item.url) || (iframeUrl === item.url);
            return (
              <button key={`${menu.key}-${idx}`} type="button" onClick={() => onMenuClick(item, menu.title)}
                aria-current={aktif ? 'page' : undefined}
                className={`${ubin} ${aktif ? 'bg-aksen-50 text-aksen-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                {ikonMenu(item, undefined, 19)}
                <span className="text-[11px] font-bold text-center leading-tight">{item.name}</span>
              </button>
            );
          })}
          <button type="button" onClick={onProfil} className={`${ubin} text-slate-600 hover:bg-slate-50`}>
            {IkonGaris(PATH_IKON.profil, 19)}
            <span className="text-[11px] font-bold text-center leading-tight">Profil Saya</span>
          </button>
          {isAdmin && (
            <button type="button" onClick={onAdminPanel} className={`${ubin} relative text-slate-600 hover:bg-slate-50`}>
              {IkonGaris(PATH_IKON.admin, 19)}
              <span className="text-[11px] font-bold text-center leading-tight">Admin Panel</span>
              {pendingUsers > 0 && (
                <span className="absolute top-1.5 right-2 text-[9px] font-black bg-[#e34948] text-white rounded-full px-1.5 py-0.5 leading-none">{pendingUsers}</span>
              )}
            </button>
          )}
          <button type="button" onClick={onLogout} className={`${ubin} text-[#e34948] hover:bg-red-50`}>
            {IkonGaris(PATH_IKON.keluar, 19)}
            <span className="text-[11px] font-bold text-center leading-tight">Keluar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
