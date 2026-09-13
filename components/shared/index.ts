// Shared UI Components
// Pattern standar dipakai di semua platform KECUALI piket-showroom.
// Basis: ticketing platform.

export { MiniPieChart } from './MiniPieChart';
// Bentuk baku ringkasan (kepala panel + chip angka + donat berlegenda +
// tabel ringkas). Pakai ini untuk ringkasan BARU, jangan menyusun gaya
// sendiri per halaman - lihat catatan di RingkasanPanel.tsx.
export { KartuRingkas, ChipAngka, DonutLegenda, TabelRingkas, type ItemLegenda } from './RingkasanPanel';
// Kit visual satu-satunya untuk layar operasional (Dashboard/Review/
// Locations/Siklus). Pakai ini, jangan menyusun kartu KPI/header drill-down
// sendiri per halaman - itu sumber ketidakkonsistenan yang dikeluhkan user.
export {
  Kartu as KartuOperasional, JudulPanel, UbinKpi, Bar2, warnaProgres,
  BarisDrill, LencanaMasalah, Kosong as KosongOperasional, HeaderDrill,
  TipGrafik, DialogBesar, WARNA, type IkonOperasional,
} from './PanelOperasional';
// Kabar yang muncul sendiri saat halaman dibuka (bukan menunggu diklik) -
// dipakai per role di /teknisi dan /dashboard, lihat komentar di berkasnya.
export { PopupNotifikasiProaktif, type ButirNotifProaktif } from './PopupNotifikasiProaktif';
// Grafik deret waktu. Lihat Charts.tsx.
export { MiniSpark, MonthBarChart, DonutChart, TrendBadge, hitungDelta } from './Charts';
export {
  ViewIconBtn, EditIconBtn, DeleteIconBtn, RescheduleIconBtn,
  DuplicateIconBtn, CompleteIconBtn, ActionGroup,
  FlowchartIconBtn, PrintIconBtn, ApproveIconBtn, ReopenIconBtn, OverdueIconBtn,
} from './ActionIcons';
export { Toast, InlineToast, type Notif } from './Toast';
export { LoadingScreen, InlineSpinner } from './LoadingScreen';
export { FormField, SectionHeader, SectionHeaderSmall, InfoRow, InfoLine } from './FormParts';
export { StarRating } from './StarRating';
export { PageHeader } from './PageHeader';
export { ConfirmDialog, type ConfirmState } from './ConfirmDialog';
export { LoadingSpinner, EmptyState, ListEmptyState, ErrorState } from './EmptyState';
// Riwayat perubahan sebuah record, dari yang dicatat logAudit().
export { AuditTrailPanel, type AuditEntry } from './AuditTrailPanel';
// Diagram tahapan untuk alur bertahap, mis. routing_status Request Schedule.
export { FlowSteps, type FlowStep } from './FlowSteps';
export { MultiDatePicker } from './MultiDatePicker';
export { MobileListCard, MobileCardBadge, type MobileCardField } from './MobileListCard';
// Username kadang berupa nama pendek, kadang berupa email penuh. Awalan @ hanya
// dipasang pada yang pertama - lihat catatan di Username.tsx.
export { Username, formatUsername } from './Username';
// Kartu ringkasan angka - satu implementasi untuk semua modul, supaya gayanya
// tidak menyimpang lagi seperti saat markup-nya disalin per halaman.
export { StatCard, StatCardGrid, type StatCardItem } from './StatCard';
export { SearchableSelect } from './SearchableSelect';
export { ModalPortal } from './ModalPortal';
export { AdminEditFields } from './AdminEditFields';
// Tombol penutup form. Satu tempat supaya label "Submit Form" tidak menyimpang
// lagi jadi "Save Ticket"/"Tambah Reminder" di modul yang berbeda.
export { BatalButton, SubmitFormButton } from './FormActions';
// Logo & identitas merek (bisa diubah dari Admin Panel - lihat lib/merek.ts).
export { LogoMerek } from './LogoMerek';
// Kerangka modal baku - lihat komentar di Modal.tsx sebelum membuat popup baru.
export { Modal, TombolModal, type ModalProps } from './Modal';
// "v0.1.23 • 22a46f9 • 03 Sep 2026, 11.14" - footer versi/build.
export { VersionFooter } from './VersionFooter';
// Masonry berbasis pengukuran DOM asli (bukan CSS grid/columns yang cuma
// menebak) - dipakai untuk kartu/kolom dengan tinggi tidak seragam supaya
// tidak ada ruang kosong tersisa. Lihat komentar di Masonry.tsx.
export { Masonry } from './Masonry';
