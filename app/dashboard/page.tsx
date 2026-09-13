'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, setDbToken } from '@/lib/supabase';
import { setSession, clearSession, getSession, startSessionWatcher } from '@/lib/auth';
import { isAdmin as checkIsAdmin, hasFullAccess, SESSION_DURATION_MS } from '@/lib/constants';
import {
  User, MenuItem, NotificationItem,
  ALL_MENU_KEYS, ALL_MENU_LABELS, ROLE_BADGE,
  AdminPanelModalProps,
} from './_components/shared';
import {
  UserProfileModal,
  AdminPanelModal,
} from './_components/Modals';
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const [adminPanelTab, setAdminPanelTab] = useState<'settings' | 'integrasi' | 'projects'>('settings');
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
        { name: 'Content', url: '/field-service?tab=content', icon: '🖼️', internal: true },
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
      if (tab === 'settings' || tab === 'integrasi') setAdminPanelTab(tab);
      setShowAdminPanel(true);
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

  // SHARED HEADER JSX
  const renderHeader = (withBackBtn = false) => (
    <div className="bg-white/80 backdrop-blur-md shadow-md flex-shrink-0" style={{ borderBottom: '1px solid rgba(0,0,0,0.08)', position: 'relative', zIndex: 50 }}>
      <div className="w-full px-3 md:px-4 py-3 md:py-3.5">
        <div className="flex items-center justify-between gap-2 md:gap-4">
          {/* LEFT: Logo */}
          <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
            <LogoMerek ukuran="sm" className="md:hidden" />
            <LogoMerek ukuran="md" className="hidden md:flex" />
            <div>
              <div className="flex items-center gap-1.5 md:gap-2.5">
                <h1 className="text-sm md:text-xl font-bold text-slate-800 tracking-tight leading-tight">
                  <span className="hidden sm:inline">{merek.namaPlatform}</span>
                  <span className="sm:hidden">{merek.namaPlatformSingkat}</span>
                </h1>
                <span className="hidden sm:inline text-slate-300 font-light">|</span>
                <span className="hidden sm:inline text-xs md:text-sm font-bold tracking-wide" style={{ color: merek.warnaAksen }}>{merek.namaPortal}</span>
              </div>
              <p className="text-slate-500 text-[10px] md:text-xs font-medium mt-0.5 hidden sm:block">{merek.namaPerusahaan}</p>
            </div>
          </div>

          {/* CENTER — spacer */}
          <div className="flex-1" />

          {/* RIGHT */}
          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
            {/* Konteks siklus + lonceng notifikasi. Sebelumnya sudut ini
                kosong sama sekali dalam mode sidebar, padahal notifikasi
                in-app sudah lama ditulis ke database tanpa pernah punya
                tempat untuk dilihat. */}
            {currentUser && (
              <HeaderKanan userId={currentUser.id} onBuka={handleNotifNavigate} />
            )}
            {/* Tidak ada lagi tombol hamburger header di mobile - dulu ia
                membuka sidebar desktop penuh (duplikat bottom nav). Satu
                pintu masuk saja ke "More" (lewat tab paling kanan bottom
                nav, lihat MobileMorePanel), bukan dua jalan berbeda menuju
                hal yang sama. */}
            {/* User badge — hanya di main menu (non-sidebar), hidden di mobile kecil */}
            {!showSidebar && (
              <div className="hidden md:flex items-center gap-2.5 px-4 py-2 rounded-xl border border-slate-200/80 bg-white/70 backdrop-blur-sm">
                <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #fde68a, #f59e0b)', color: '#78350f' }}>
                  {currentUser?.full_name?.charAt(0)?.toUpperCase() ?? 'U'}
                </div>
                <div className="leading-tight">
                  <p className="text-xs font-bold text-slate-800">{currentUser?.full_name}</p>
                  <p className="text-[9px] font-bold tracking-widest uppercase text-amber-600">{currentUser?.role}</p>
                </div>
              </div>
            )}

            {/* Mobile: avatar only */}
            {!showSidebar && (
              <div className="md:hidden w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #fde68a, #f59e0b)', color: '#78350f' }}>
                {currentUser?.full_name?.charAt(0)?.toUpperCase() ?? 'U'}
              </div>
            )}

            {/* User Profile — hidden di mobile */}
            {!showSidebar && (
              <button onClick={() => setShowUserProfile(true)}
                className="hidden md:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', color: '#065f46' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(16,185,129,0.15)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(16,185,129,0.08)'; }}>
                <svg aria-hidden="true" focusable="false" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                User Profile
              </button>
            )}

            {/* Sign Out */}
            {!showSidebar && (
              <button onClick={handleLogout}
                className="flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)', color: '#b91c1c' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.13)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.07)'; }}>
                <svg aria-hidden="true" focusable="false" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            )}
          </div>
        </div>
      </div>

    </div>
  );

  // MODAL RENDERS (shared)
  const renderModals = () => (
    <>
      {showAdminPanel && <AdminPanelModal initialTab={adminPanelTab} onClose={() => setShowAdminPanel(false)} />}
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
        {/* SIDEBAR - DESKTOP-ONLY sekarang ("hidden md:flex"). Sebelumnya
            sidebar ini juga dirender di mobile (di-translate keluar layar
            lalu digeser masuk sebagai drawer lewat hamburger) - itu artinya
            struktur navigasi desktop TETAP ada di DOM/alur mobile, cuma
            disembunyikan pakai transform. Efeknya persis keluhan user:
            membuka hamburger memunculkan seluruh pohon menu desktop
            (Dashboard/Operations/My Work/Client) berdampingan dengan bottom
            nav yang sudah berisi menu yang sama - dua sistem navigasi
            berebut layar sekaligus. Sekarang sidebar ini TIDAK PERNAH ada di
            alur visual mobile sama sekali; navigasi mobile sepenuhnya lewat
            MobileBottomNav + MobileMorePanel (akun/menu lain), lihat
            render-nya di bawah. */}
        <div
          className={`
            hidden md:flex flex-col transition-all duration-300 ease-in-out flex-shrink-0
            ${sidebarCollapsed ? 'md:w-[64px]' : 'md:w-[272px]'}
            md:relative
          `}
          style={{
            background: merek.warnaSidebar,
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: '2px 0 20px rgba(0,0,0,0.10)',
            borderRight: '1px solid rgba(0,0,0,0.07)',
          }}
        >
          {/* Top accent line - warnaAksen, sama dengan warna label portal di header */}
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${merek.warnaAksen}, transparent)` }} />

          {/* Collapse button — absolute top-right. hidden md:flex - collapse ke
              rail ikon-saja SENGAJA desktop-only. Sebelumnya tombol ini bisa
              dipencet di mobile juga (tanpa penjaga responsif), menghasilkan
              rail 48px sempit yang ditumpuk lagi dengan overlay drawer mobile -
              itulah sidebar mobile yang terlihat berantakan/aneh yang
              dilaporkan user. Navigasi utama mobile sekarang lewat bottom nav
              (lihat MobileBottomNav di bawah render sidebar ini). */}
          {!sidebarCollapsed && (
            <button aria-label="Collapse sidebar"
              onClick={() => setSidebarCollapsed(true)}
              className="hidden md:flex absolute top-2 right-2 z-10 w-6 h-6 rounded-md items-center justify-center transition-all"
              style={{ color: '#cbd5e1' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#64748b'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#cbd5e1'; }}
              title="Collapse sidebar"
            >
              <svg aria-hidden="true" focusable="false" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* ── SIDEBAR SCROLLABLE CONTENT ── */}
          <div className="flex-1 overflow-y-auto py-3 px-2.5" style={{ scrollbarWidth: 'none' }}>

            {menuLoading ? (
              <div className="flex items-center justify-center py-10">
                <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'rgba(226,168,75,0.35)', borderTopColor: '#e2a84b' }} />
              </div>
            ) : sidebarCollapsed ? (
              /* Collapsed: icon-only */
              <div className="space-y-1">
                {/* Expand button - top */}
                <button aria-label="Main Menu"
                  onClick={() => setSidebarCollapsed(false)}
                  className="w-full h-9 rounded-lg flex items-center justify-center transition-all mb-1"
                  style={{ color: '#94a3b8' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#334155'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8'; }}
                  title="Main Menu"
                >
                  <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => { setShowDashboardPanel(true); setShowTicketing(false); setIframeUrl(null); }}
                  title="Dashboard"
                  aria-label="Dashboard"
                  aria-current={showDashboardPanel ? 'page' : undefined}
                  className="w-full h-9 rounded-lg flex items-center justify-center text-base transition-all"
                  style={showDashboardPanel
                    ? { background: 'rgba(200,134,29,0.15)', border: '1px solid rgba(200,134,29,0.35)', color: '#92600a' }
                    : { background: 'transparent', border: '1px solid transparent', color: '#64748b' }}
                >🏠</button>
                {visibleMenuItems.map((menu) => (
                  <div key={menu.key}>
                    {menu.items.map((item, itemIndex) => {
                      const isActive = !showDashboardPanel && ((showTicketing && item.internal && internalUrl === item.url) || (iframeUrl === item.url));
                      return (
                        <button
                          key={itemIndex}
                          onClick={() => { setShowDashboardPanel(false); handleMenuClick(item, menu.title); }}
                          title={`${menu.title} — ${item.name}`}
                          className="relative w-full h-9 rounded-lg flex items-center justify-center text-base transition-all"
                          style={
                            isActive
                              ? { background: 'rgba(200,134,29,0.15)', border: '1px solid rgba(200,134,29,0.35)', color: '#92600a' }
                              : { background: 'transparent', border: '1px solid transparent', color: '#64748b' }
                          }
                          onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.06)'; }}
                          onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                        >
                          {/* item.icon dulu (per-ITEM), MENU_ICONS[menu.key] cuma
                              fallback untuk kategori legacy 1-item di mana key
                              kategori kebetulan = identitas item-nya. Sebelumnya
                              MENU_ICONS[menu.key] dipakai duluan - benar untuk
                              kategori 1-item, tapi utk kategori banyak-item
                              (Operations/My Work/Client) semua sub-item ikut
                              tampil ikon KATEGORI yang sama (bug: "icon aneh",
                              5 tombol Operations semua terlihat sama). */}
                          <span>{item.icon}</span>
                          {/* Antrean request jadwal muncul DI SINI — di menu yang
                              benar-benar memuatnya, bukan di ikon Admin Panel. */}
                          {menu.key === 'reminder-schedule' && isFullAccess && pendingRequests > 0 && (
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                              {pendingRequests}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              /* Expanded: full nav */
              <div className="space-y-4">

                {/* ── Dashboard/Home item (untuk SEMUA role — homepage adaptif) ── */}
                <div>
                  <button
                    onClick={() => { setShowDashboardPanel(true); setShowTicketing(false); setIframeUrl(null); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all"
                    style={showDashboardPanel
                      ? { background: 'rgba(200,134,29,0.12)', border: '1px solid rgba(200,134,29,0.30)', color: '#92600a' }
                      : { background: 'transparent', border: '1px solid transparent', color: '#475569' }}
                    onMouseEnter={e => { if (!showDashboardPanel) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.04)'; } }}
                    onMouseLeave={e => { if (!showDashboardPanel) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; } }}
                  >
                    <span className="w-5 h-5 text-sm flex items-center justify-center flex-shrink-0">🏠</span>
                    <span className="text-sm font-semibold truncate">Dashboard</span>
                    {showDashboardPanel && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />}
                  </button>
                </div>

                {/* Project selector GLOBAL - satu titik kontrol untuk semua
                    menu Operations & widget Dashboard, persis "Select
                    tenant" di referensi (MicroCMS): pilih sekali di sini,
                    semua menu di bawah menyesuaikan project yang sama -
                    tidak perlu pilih ulang project di tiap halaman. */}
                {bisaPilihFsProject && (
                  <div>
                    <select value={fsSelectedProjectId} onChange={e => pilihFsProject(e.target.value)}
                      className="w-full text-sm font-semibold px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-slate-700">
                      <option value="">— Select project —</option>
                      {fsProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {!fsSelectedProjectId && fsProjects.length > 0 && (
                      <p className="mt-1.5 px-1 text-[11px] font-semibold text-amber-700 flex items-center gap-1.5">
                        <span aria-hidden="true">🏢</span> Select project to access Operations menus
                      </p>
                    )}
                  </div>
                )}

                {/* Field Service section */}
                {visibleMenuItems.filter(m => FIELD_SERVICE_KEYS.includes(m.key)).length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-1 mb-1.5">
                      <span className="text-[10px] font-bold tracking-[0.14em] uppercase" style={{ color: 'rgba(0,0,0,0.38)' }}>Operations</span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(0,0,0,0.08)' }} />
                    </div>
                    <div className="space-y-0.5">
                      {visibleMenuItems.filter(m => FIELD_SERVICE_KEYS.includes(m.key)).flatMap(menu =>
                        menu.items.map((item, itemIndex) => {
                          const isActive = (showTicketing && item.internal && internalUrl === item.url) || (iframeUrl === item.url);
                          return (
                            <button
                              key={`${menu.key}-${itemIndex}`}
                              onClick={() => handleMenuClick(item, menu.title)}
                              aria-current={isActive ? 'page' : undefined}
                              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all"
                              style={isActive
                                ? { background: 'rgba(67,56,202,0.10)', border: '1px solid rgba(67,56,202,0.25)', color: '#3730a3' }
                                : { background: 'transparent', border: '1px solid transparent', color: '#334155' }}
                              onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(67,56,202,0.05)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(67,56,202,0.12)'; } }}
                              onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; } }}
                            >
                              <span
                                className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors text-sm"
                                style={{
                                  background: isActive ? 'rgba(67,56,202,0.15)' : 'rgba(0,0,0,0.06)',
                                  color: isActive ? '#3730a3' : '#64748b',
                                }}
                              >
                                {item.icon}
                              </span>
                              <span className="flex-1 truncate text-sm font-medium">{item.name}</span>
                              {isActive && (
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#4338ca' }} />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* Teknisi section */}
                {visibleMenuItems.filter(m => TEKNISI_KEYS.includes(m.key)).length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-1 mb-1.5">
                      <span className="text-[10px] font-bold tracking-[0.14em] uppercase" style={{ color: 'rgba(0,0,0,0.38)' }}>My Work</span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(0,0,0,0.08)' }} />
                    </div>
                    <div className="space-y-0.5">
                      {visibleMenuItems.filter(m => TEKNISI_KEYS.includes(m.key)).flatMap(menu =>
                        menu.items.map((item, itemIndex) => {
                          const isActive = (showTicketing && item.internal && internalUrl === item.url) || (iframeUrl === item.url);
                          return (
                            <button
                              key={`${menu.key}-${itemIndex}`}
                              onClick={() => handleMenuClick(item, menu.title)}
                              aria-current={isActive ? 'page' : undefined}
                              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all"
                              style={isActive
                                ? { background: 'rgba(5,150,105,0.10)', border: '1px solid rgba(5,150,105,0.25)', color: '#047857' }
                                : { background: 'transparent', border: '1px solid transparent', color: '#334155' }}
                              onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(5,150,105,0.05)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(5,150,105,0.12)'; } }}
                              onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; } }}
                            >
                              <span
                                className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors text-sm"
                                style={{
                                  background: isActive ? 'rgba(5,150,105,0.15)' : 'rgba(0,0,0,0.06)',
                                  color: isActive ? '#047857' : '#64748b',
                                }}
                              >
                                {item.icon}
                              </span>
                              <span className="flex-1 truncate text-sm font-medium">{item.name}</span>
                              {isActive && (
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#059669' }} />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* Client Review section */}
                {visibleMenuItems.filter(m => CLIENT_REVIEW_KEYS.includes(m.key)).length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-1 mb-1.5">
                      <span className="text-[10px] font-bold tracking-[0.14em] uppercase" style={{ color: 'rgba(0,0,0,0.38)' }}>Client</span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(0,0,0,0.08)' }} />
                    </div>
                    <div className="space-y-0.5">
                      {visibleMenuItems.filter(m => CLIENT_REVIEW_KEYS.includes(m.key)).flatMap(menu =>
                        menu.items.map((item, itemIndex) => {
                          const isActive = (showTicketing && item.internal && internalUrl === item.url) || (iframeUrl === item.url);
                          return (
                            <button
                              key={`${menu.key}-${itemIndex}`}
                              onClick={() => handleMenuClick(item, menu.title)}
                              aria-current={isActive ? 'page' : undefined}
                              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all"
                              style={isActive
                                ? { background: 'rgba(217,119,6,0.10)', border: '1px solid rgba(217,119,6,0.25)', color: '#b45309' }
                                : { background: 'transparent', border: '1px solid transparent', color: '#334155' }}
                              onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(217,119,6,0.05)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(217,119,6,0.12)'; } }}
                              onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; } }}
                            >
                              <span
                                className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors text-sm"
                                style={{
                                  background: isActive ? 'rgba(217,119,6,0.15)' : 'rgba(0,0,0,0.06)',
                                  color: isActive ? '#b45309' : '#64748b',
                                }}
                              >
                                {item.icon}
                              </span>
                              <span className="flex-1 truncate text-sm font-medium">{item.name}</span>
                              {isActive && (
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#d97706' }} />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* Learning Center section */}
                {visibleMenuItems.filter(m => LEARNING_KEYS.includes(m.key)).length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-1 mb-1.5">
                      <span className="text-[10px] font-bold tracking-[0.14em] uppercase" style={{ color: 'rgba(0,0,0,0.38)' }}>Learning</span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(0,0,0,0.08)' }} />
                    </div>
                    <div className="space-y-0.5">
                      {visibleMenuItems.filter(m => LEARNING_KEYS.includes(m.key)).map(menu => {
                        if (menu.items.length === 1) {
                          const item = menu.items[0];
                          const isActive = (showTicketing && item.internal && internalUrl === item.url) || (iframeUrl === item.url);
                          const isTourHL = tourHighlightKey === menu.key;
                          return (
                            <button
                              key={menu.key}
                              id={`tour-menu-${menu.key}`}
                              onClick={() => handleMenuClick(item, menu.title)}
                              aria-current={isActive ? 'page' : undefined}
                              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all"
                              style={
                                isTourHL
                                  ? { background: 'rgba(250,204,21,0.13)', border: '1.5px solid rgba(250,204,21,0.65)', color: '#334155', animation: 'tourMenuPulse 1.6s ease-in-out infinite', position: 'relative', zIndex: 1510 }
                                  : isActive
                                    ? { background: 'rgba(67,56,202,0.10)', border: '1px solid rgba(67,56,202,0.25)', color: '#3730a3' }
                                    : { background: 'transparent', border: '1px solid transparent', color: '#334155' }
                              }
                              onMouseEnter={e => { if (!isActive && !isTourHL) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(67,56,202,0.05)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(67,56,202,0.12)'; } }}
                              onMouseLeave={e => { if (!isActive && !isTourHL) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; } }}
                            >
                              <span
                                className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors"
                                style={{
                                  background: isActive ? 'rgba(67,56,202,0.15)' : 'rgba(0,0,0,0.06)',
                                  color: isActive ? '#3730a3' : '#64748b',
                                }}
                              >
                                {MENU_ICONS[menu.key] ?? <span>{menu.icon}</span>}
                              </span>
                              <span className="flex-1 truncate text-sm font-medium">{menu.title}</span>
                              {isActive && (
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#4338ca' }} />
                              )}
                            </button>
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                )}

                {/* Project section */}
                {visibleMenuItems.filter(m => PROJECT_KEYS.includes(m.key)).length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-1 mb-1.5">
                      <span className="text-[10px] font-bold tracking-[0.14em] uppercase" style={{ color: 'rgba(0,0,0,0.38)' }}>Project</span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(0,0,0,0.08)' }} />
                    </div>
                    <div className="space-y-0.5">
                      {visibleMenuItems.filter(m => PROJECT_KEYS.includes(m.key)).map(menu => {
                        if (menu.items.length === 1) {
                          const item = menu.items[0];
                          const isActive = (showTicketing && item.internal && internalUrl === item.url) || (iframeUrl === item.url);
                          const isTourHL = tourHighlightKey === menu.key;
                          return (
                            <button
                              key={menu.key}
                              id={`tour-menu-${menu.key}`}
                              onClick={() => handleMenuClick(item, menu.title)}
                              aria-current={isActive ? 'page' : undefined}
                              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all"
                              style={
                                isTourHL
                                  ? { background: 'rgba(250,204,21,0.13)', border: '1.5px solid rgba(250,204,21,0.65)', color: '#334155', animation: 'tourMenuPulse 1.6s ease-in-out infinite', position: 'relative', zIndex: 1510 }
                                  : isActive
                                    ? { background: 'rgba(200,134,29,0.11)', border: '1px solid rgba(200,134,29,0.28)', color: '#92600a' }
                                    : { background: 'transparent', border: '1px solid transparent', color: '#334155' }
                              }
                              onMouseEnter={e => { if (!isActive && !isTourHL) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.05)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,0,0,0.06)'; } }}
                              onMouseLeave={e => { if (!isActive && !isTourHL) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; } }}
                            >
                              <span
                                className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors"
                                style={{
                                  background: isActive ? 'rgba(200,134,29,0.18)' : 'rgba(0,0,0,0.06)',
                                  color: isActive ? '#92600a' : '#64748b',
                                }}
                              >
                                {MENU_ICONS[menu.key] ?? <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" strokeWidth={2} /></svg>}
                              </span>
                              <span className="flex-1 truncate text-sm font-medium">{menu.title}</span>
                              {isActive && (
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#c8861d' }} />
                              )}
                            </button>
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                )}

                {/* Internal Daily section */}
                {visibleMenuItems.filter(m => INTERNAL_DAILY_KEYS.includes(m.key)).length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-1 mb-1.5">
                      <span className="text-[10px] font-bold tracking-[0.14em] uppercase" style={{ color: 'rgba(0,0,0,0.38)' }}>Internal Daily</span>
                      <div className="flex-1 h-px" style={{ background: 'rgba(0,0,0,0.08)' }} />
                    </div>
                    <div className="space-y-0.5">
                      {visibleMenuItems.filter(m => INTERNAL_DAILY_KEYS.includes(m.key)).flatMap(menu =>
                        menu.items.map((item, itemIndex) => {
                          const isActive = (showTicketing && item.internal && internalUrl === item.url) || (iframeUrl === item.url);
                          const isTourHL = tourHighlightKey === menu.key;
                          return (
                            <button
                              key={`${menu.key}-${itemIndex}`}
                              id={`tour-menu-${menu.key}`}
                              onClick={() => handleMenuClick(item, menu.title)}
                              aria-current={isActive ? 'page' : undefined}
                              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all"
                              style={
                                isTourHL
                                  ? { background: 'rgba(250,204,21,0.13)', border: '1.5px solid rgba(250,204,21,0.65)', color: '#334155', animation: 'tourMenuPulse 1.6s ease-in-out infinite', position: 'relative', zIndex: 1510 }
                                  : isActive
                                    ? { background: 'rgba(200,134,29,0.11)', border: '1px solid rgba(200,134,29,0.28)', color: '#92600a' }
                                    : { background: 'transparent', border: '1px solid transparent', color: '#334155' }
                              }
                              onMouseEnter={e => { if (!isActive && !isTourHL) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.05)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,0,0,0.06)'; } }}
                              onMouseLeave={e => { if (!isActive && !isTourHL) { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; } }}
                            >
                              <span
                                className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-colors"
                                style={{
                                  background: isActive ? 'rgba(200,134,29,0.18)' : 'rgba(0,0,0,0.06)',
                                  color: isActive ? '#92600a' : '#64748b',
                                }}
                              >
                                {MENU_ICONS[menu.key] ?? <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" strokeWidth={2} /></svg>}
                              </span>
                              <span className="flex-1 truncate text-sm font-medium">{item.name}</span>
                          {/* Antrean request jadwal muncul DI SINI — di menu yang
                              benar-benar memuatnya, bukan di ikon Admin Panel. */}
                              {menu.key === 'reminder-schedule' && isFullAccess && pendingRequests > 0 && (
                                <span className="text-[10px] font-black bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none flex-shrink-0">
                                  {pendingRequests}
                                </span>
                              )}
                              {item.external && !item.embed && (
                                <svg aria-hidden="true" focusable="false" className="w-3 h-3 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              )}
                              {isActive && !item.external && (
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#c8861d' }} />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}


              </div>
            )}
          </div>

          {/* ── SIDEBAR FOOTER: User + Admin + Sign Out ── */}
          <div className="flex-shrink-0" style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
            {sidebarCollapsed ? (
              /* Collapsed footer */
              <div className="py-2 px-1.5 flex flex-col items-center gap-1.5">
                {/* Avatar */}
                <button aria-label={currentUser?.full_name ?? ''}
                  onClick={() => setShowUserProfile(true)}
                  className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 transition-all"
                  style={{ background: 'linear-gradient(135deg, #fde68a, #f59e0b)', color: '#78350f' }}
                  title={currentUser?.full_name ?? ''}
                >
                  {currentUser?.full_name?.charAt(0)?.toUpperCase() ?? 'U'}
                </button>

                {/* Admin */}
                {isAdmin && (
                  <button
                    onClick={() => { setAdminPanelTab('settings'); setShowAdminPanel(true); }}
                    className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                    style={{ color: '#94a3b8' }}
                    title={pendingUsers > 0 ? `Admin Panel — ${pendingUsers} user menunggu persetujuan` : 'Admin Panel'}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#4338ca'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.1)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {pendingUsers > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">{pendingUsers}</span>
                    )}
                  </button>
                )}

                {/* Sign out */}
                <button aria-label="Sign Out"
                  onClick={handleLogout}
                  className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
                  style={{ color: '#94a3b8' }}
                  title="Sign Out"
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#b91c1c'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.07)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            ) : (
              /* Expanded footer */
              <div className="p-3 space-y-1">

                {/* User profile row */}
                <button
                  onClick={() => setShowUserProfile(true)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all text-left"
                  style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.06)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.07)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(200,134,29,0.22)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.03)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(0,0,0,0.06)'; }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #fde68a, #f59e0b)', color: '#78350f' }}
                  >
                    {currentUser?.full_name?.charAt(0)?.toUpperCase() ?? 'U'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate leading-tight" style={{ color: '#1e293b' }}>{currentUser?.full_name ?? '-'}</p>
                    <p className="text-[10px] font-bold tracking-widest uppercase mt-0.5" style={{ color: '#c8861d' }}>{currentUser?.role ?? '-'}</p>
                  </div>
                  <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0" style={{ color: '#94a3b8' }}>
                    <svg aria-hidden="true" focusable="false" className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>

                {/* Administration - dulu cuma tombol "Admin Panel" lepas
                    tanpa label kategori. Label kecil ini menyamakannya
                    secara visual dengan kategori navigasi lain (Operations/
                    My Work/Client) sesuai brief transformasi IA - modal di
                    baliknya (Users & Roles via tab "settings", Settings
                    lain via tab merek/integrasi/rilis) sudah menyatukan
                    kedua konsep itu, tidak perlu dipecah jadi 2 link. */}
                {isAdmin && (
                  <>
                    <p className="px-3 pt-2 pb-1 text-[10px] font-bold tracking-widest uppercase text-slate-400">Administration</p>
                    <button
                      onClick={() => { setAdminPanelTab('settings'); setShowAdminPanel(true); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all"
                      style={{ color: '#64748b', border: '1px solid transparent' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.07)'; (e.currentTarget as HTMLButtonElement).style.color = '#4338ca'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.18)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#64748b'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; }}
                    >
                      <svg aria-hidden="true" focusable="false" className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span>Users & Roles / Settings</span>
                      {pendingUsers > 0 && (
                        <span className="ml-auto text-[10px] font-black bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none">{pendingUsers}</span>
                      )}
                    </button>
                  </>
                )}

                {/* Sign out */}
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all"
                  style={{ color: '#94a3b8', border: '1px solid transparent' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#b91c1c'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.15)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; }}
                >
                  <svg aria-hidden="true" focusable="false" className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign out
                </button>

              </div>
            )}
          </div>
        </div>

        {/* BOTTOM NAV - SATU-SATUNYA navigasi di mobile ("buat menu nya di
            bawah bukan di samping selayaknya menu umum di mobile aplikasi" -
            permintaan user; lalu ditegaskan ulang lebih keras: sidebar
            desktop TIDAK BOLEH muncul sama sekali di alur mobile). Dibatasi
            maksimal 3 menu utama + Home + More — bukan menjejalkan SELURUH
            menu jadi tombol yang makin kecil tiap peran punya menu makin
            banyak. Menu yang tidak muat, plus akun/admin/sign-out, pindah ke
            MobileMorePanel (lembar terpisah, BUKAN sidebar desktop yang
            disempitkan). */}
        <MobileBottomNav
          primaryItems={mobilePrimaryItems}
          showDashboardPanel={showDashboardPanel}
          showTicketing={showTicketing}
          internalUrl={internalUrl}
          iframeUrl={iframeUrl}
          moreActive={mobileMoreOpen}
          onHome={() => { setShowDashboardPanel(true); setShowTicketing(false); setIframeUrl(null); }}
          onMenuClick={handleMenuClick}
          onMore={() => setMobileMoreOpen(o => !o)}
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
          onMenuClick={(item, judul) => { setMobileMoreOpen(false); handleMenuClick(item, judul); }}
          onProfil={() => { setMobileMoreOpen(false); setShowUserProfile(true); }}
          onAdminPanel={() => { setMobileMoreOpen(false); setAdminPanelTab('settings'); setShowAdminPanel(true); }}
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
            kontennya dan penguncian ini tidak berlaku. */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 pb-14 md:pb-0">
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
            {showDashboardPanel && currentUser ? (
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
 * Bottom tab bar - navigasi utama di layar mobile, menggantikan sidebar
 * (yang di mobile jadi drawer sekunder saja - lihat komentar di titik
 * pemanggilannya). Mengikuti pola navigasi mobile standar: ikon + label,
 * maksimal 5 item, item level-teratas saja (tidak ada sub-navigasi di
 * dalamnya) - `visibleMenuItems` sudah difilter per role, jadi jumlah
 * tombolnya otomatis pendek untuk kebanyakan akun (Technician/Client
 * biasanya cuma 1-2 kategori × 1 item).
 */
interface MenuBaris { menu: MenuItem; item: MenuItem['items'][0]; }

function MobileBottomNav({
  primaryItems, showDashboardPanel, showTicketing, internalUrl, iframeUrl, moreActive, onHome, onMenuClick, onMore,
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
}) {
  return (
    // SATU-SATUNYA navigasi mobile - tidak ada lagi sidebar desktop yang
    // bisa muncul bersamaan (lihat penjelasan di render sidebar di atas).
    <nav aria-label="Navigasi utama"
      className="md:hidden fixed bottom-0 left-0 right-0 z-[195] flex items-stretch bg-white border-t border-slate-200"
      style={{ boxShadow: '0 -2px 12px rgba(0,0,0,0.06)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <button type="button" onClick={onHome} aria-current={showDashboardPanel && !moreActive ? 'page' : undefined}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px]"
        style={{ color: showDashboardPanel && !moreActive ? '#92600a' : '#64748b' }}>
        <span className="text-lg leading-none">🏠</span>
        <span className="text-[10px] font-bold truncate max-w-full px-1">Dashboard</span>
      </button>
      {primaryItems.map(({ menu, item }, idx) => {
        const isActive = !moreActive && !showDashboardPanel && ((showTicketing && item.internal && internalUrl === item.url) || (iframeUrl === item.url));
        return (
          <button key={`${menu.key}-${idx}`} type="button" onClick={() => onMenuClick(item, menu.title)}
            aria-current={isActive ? 'page' : undefined}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] min-w-0">
            <span className="text-lg leading-none" style={{ color: isActive ? '#92600a' : '#64748b' }}>{item.icon}</span>
            <span className="text-[10px] font-bold truncate max-w-full px-1" style={{ color: isActive ? '#92600a' : '#64748b' }}>{item.name}</span>
          </button>
        );
      })}
      {/* More - satu-satunya pintu ke menu yang tidak muat, akun, admin
          panel, dan sign out. Ini BUKAN membuka sidebar desktop - lembar
          sendiri (MobileMorePanel) yang gayanya didesain untuk mobile. */}
      <button type="button" onClick={onMore} aria-expanded={moreActive} aria-label="Menu lainnya dan akun"
        className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px]"
        style={{ color: moreActive ? '#92600a' : '#64748b' }}>
        <svg aria-hidden="true" focusable="false" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </svg>
        <span className="text-[10px] font-bold truncate max-w-full px-1">More</span>
      </button>
    </nav>
  );
}

/**
 * MobileMorePanel - "lembar" mobile yang BUKAN sidebar desktop yang
 * disempitkan. Isinya dua kelompok: menu yang tidak muat di bottom nav
 * (kalau ada), dan Akun (Profil/Admin Panel/Sign Out) - yang di layar
 * sidebar-mode sebelumnya HANYA bisa dijangkau lewat sidebar desktop yang
 * dibuka sebagai drawer di mobile (persis keluhan user: logout susah
 * dijangkau). Di sini keduanya jadi satu tempat pasti, bergaya tombol besar
 * sentuh-ramah, bukan baris rapat ala sidebar.
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
  if (!buka) return null;
  return (
    <div className="md:hidden fixed inset-0 z-[600]" role="dialog" aria-modal="true" aria-label="Menu lainnya">
      <div aria-hidden="true" className="absolute inset-0" style={{ background: 'rgba(15,23,42,0.45)' }} onClick={onTutup} />
      <div className="absolute left-0 right-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white shadow-2xl"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
        <div className="w-9 h-1 rounded-full bg-slate-200 mx-auto mt-2.5 mb-1" aria-hidden="true" />
        <div className="px-4 pt-2 pb-3 flex items-center justify-between border-b border-slate-100">
          <p className="text-sm font-bold text-slate-800">Menu Lainnya</p>
          <button type="button" onClick={onTutup} aria-label="Tutup"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
            <svg aria-hidden="true" focusable="false" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {overflowItems.length > 0 && (
          <div className="px-2 py-2 border-b border-slate-100">
            <p className="px-2.5 pt-1 pb-1.5 text-[10px] font-bold tracking-widest uppercase text-slate-400">Menu</p>
            {overflowItems.map(({ menu, item }, idx) => {
              const isActive = (showTicketing && item.internal && internalUrl === item.url) || (iframeUrl === item.url);
              return (
                <button key={`${menu.key}-${idx}`} type="button" onClick={() => onMenuClick(item, menu.title)}
                  className="w-full flex items-center gap-3 px-2.5 py-3 rounded-xl text-left min-h-[44px]"
                  style={isActive ? { background: 'rgba(200,134,29,0.10)', color: '#92600a' } : { color: '#334155' }}>
                  <span className="text-lg flex-shrink-0" aria-hidden="true">{item.icon}</span>
                  <span className="text-[14px] font-semibold truncate">{item.name}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="px-2 py-2">
          <p className="px-2.5 pt-1 pb-1.5 text-[10px] font-bold tracking-widest uppercase text-slate-400">Akun</p>
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #fde68a, #f59e0b)', color: '#78350f' }}>
              {currentUser?.full_name?.charAt(0)?.toUpperCase() ?? 'U'}
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-slate-800 truncate">{currentUser?.full_name ?? '-'}</p>
              <p className="text-[10px] font-bold tracking-widest uppercase text-amber-600">{currentUser?.role ?? '-'}</p>
            </div>
          </div>
          <button type="button" onClick={onProfil}
            className="w-full flex items-center gap-3 px-2.5 py-3 rounded-xl text-left min-h-[44px] text-slate-700">
            <svg aria-hidden="true" focusable="false" className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span className="text-[14px] font-semibold">Profil Saya</span>
          </button>
          {isAdmin && (
            <button type="button" onClick={onAdminPanel}
              className="w-full flex items-center gap-3 px-2.5 py-3 rounded-xl text-left min-h-[44px] text-slate-700">
              <svg aria-hidden="true" focusable="false" className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-[14px] font-semibold flex-1">Users & Roles / Settings</span>
              {pendingUsers > 0 && (
                <span className="text-[10px] font-black bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none flex-shrink-0">{pendingUsers}</span>
              )}
            </button>
          )}
          <button type="button" onClick={onLogout}
            className="w-full flex items-center gap-3 px-2.5 py-3 rounded-xl text-left min-h-[44px] text-red-600">
            <svg aria-hidden="true" focusable="false" className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="text-[14px] font-bold">Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
