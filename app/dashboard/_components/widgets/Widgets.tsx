'use client';

/**
 * Widgets.tsx - Widget Registry.
 *
 * Setiap peran melihat SATU hal utama, bukan kumpulan kartu:
 *   Admin/Supervisor -> Control Room (siklus berjalan, masalah, drill-down)
 *   PIC              -> Tugas Weekend Saya
 *   Client           -> Ringkasan Review
 *
 * Yang dihapus dari registry lama dan alasannya:
 *  - 'requires-attention': isinya sudah jadi bagian "Perlu Perhatian" di
 *    dalam Control Room. Menampilkan hal yang sama dua kali di satu layar
 *    menambah keramaian tanpa menambah informasi.
 *  - 'verifikasi-status-chart' (donat status untuk client): pertanyaan
 *    client adalah "berapa yang sudah saya setujui dan mana yang perlu
 *    dilihat", yang dijawab angka + daftar di RingkasanReviewClient. Donat
 *    hanya mengubah angka yang sama menjadi bentuk yang lebih lambat dibaca.
 */

import {
  type WidgetProps, type WidgetSize, type WidgetDef,
  WidgetCard, EmptyState, Loading,
} from './primitives';
import { TugasWeekendSaya, RingkasanReviewClient } from './FieldServiceWidgets';
import { ControlRoomWidget } from './ControlRoomWidget';
import { ExecutionWidget } from './ExecutionWidget';
import { hasFullAccess } from '@/lib/constants';
export type { WidgetProps, WidgetSize, WidgetDef };
export { WidgetCard, EmptyState, Loading };

const provider = (u: Parameters<WidgetDef['permission']>[0]) =>
  hasFullAccess(u) || u.fs_role === 'PROVIDER_ADMIN' || u.fs_role === 'PROVIDER_SUPERVISOR';

const client = (u: Parameters<WidgetDef['permission']>[0]) =>
  u.fs_role === 'CLIENT_ADMIN' || u.fs_role === 'CLIENT_MANAGER' || u.fs_role === 'CLIENT_VIEWER';

export const WIDGETS: WidgetDef[] = [
  {
    // Ruang kendali operasional - hal PERTAMA yang dilihat provider.
    id: 'control-room',
    permission: provider,
    priority: 5, size: 'full', Component: ControlRoomWidget,
  },
  {
    // Alat bantu (bukti GPS/foto per pekerjaan + export). Prioritas jauh di
    // bawah dan tertutup secara default - dibutuhkan saat menelusuri satu
    // kasus, bukan saat memantau keadaan harian.
    id: 'execution-detail',
    permission: provider,
    priority: 20, size: 'full', Component: ExecutionWidget,
  },
  {
    id: 'tugas-weekend-pic',
    permission: u => u.fs_role === 'FIELD_PIC',
    priority: 5, size: 'lg', Component: TugasWeekendSaya,
  },
  {
    id: 'review-client',
    permission: client,
    priority: 5, size: 'lg', Component: RingkasanReviewClient,
  },
];
