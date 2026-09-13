/**
 * lib/csv.ts - bikin & unduh CSV dari data yang SUDAH ada di layar (tidak
 * query ulang). Dipindah dari app/field-service/page.tsx supaya bisa dipakai
 * juga oleh widget Dashboard (Execution dipindah ke sana, tidak lagi jadi
 * tab terpisah di Field Service). Escape sesuai RFC 4180: kutip field yang
 * mengandung koma, kutip ganda, atau baris baru.
 */
export function unduhCsv(namaBerkas: string, header: string[], baris: (string | number | null)[][]) {
  const escape = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const teks = [header, ...baris].map(b => b.map(escape).join(',')).join('\n');
  const blob = new Blob(['﻿' + teks], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = namaBerkas;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
