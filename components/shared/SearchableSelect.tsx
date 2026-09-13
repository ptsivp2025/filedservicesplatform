'use client';

/**
 * Combobox dengan pencarian - pengganti `<select>` polos untuk pilihan yang
 * bisa berjumlah ratusan/ribuan (Project, Lokasi, Area, Execution Point).
 * `<select>` native tetap dipakai untuk pilihan yang memang selalu pendek
 * (status filter, dsb) - ini khusus yang cardinality-nya bisa besar.
 *
 * Dipindah dari app/field-service/page.tsx (dulu lokal di sana) supaya bisa
 * dipakai juga oleh widget Dashboard (Execution dipindah ke sana).
 */

import React, { useEffect, useRef, useState } from 'react';

const inputCls = 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-400 bg-white';

export function SearchableSelect({ value, onChange, options, placeholder, disabled }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [buka, setBuka] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const dipilih = options.find(o => o.value === value);

  useEffect(() => {
    if (!buka) return;
    const tutup = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setBuka(false); };
    document.addEventListener('mousedown', tutup);
    return () => document.removeEventListener('mousedown', tutup);
  }, [buka]);

  const qBersih = q.trim().toLowerCase();
  const tersaring = qBersih ? options.filter(o => o.label.toLowerCase().includes(qBersih)) : options;

  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={disabled} onClick={() => { setBuka(b => !b); setQ(''); }}
        className={`${inputCls} text-left flex items-center justify-between gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}>
        <span className={`truncate ${dipilih ? 'text-slate-800' : 'text-slate-400'}`}>{dipilih?.label ?? placeholder ?? '— pilih —'}</span>
        <span className="text-slate-400 text-[10px] flex-shrink-0">▼</span>
      </button>
      {buka && (
        // z-[1100]: sama seperti dropdown hasil pencarian alamat di MapPicker -
        // harus melebihi z-index internal Leaflet (sampai 1000) supaya tidak
        // tertutup peta kalau combobox ini kebetulan ada di dekatnya.
        <div className="absolute z-[1100] mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Cari…" autoComplete="off"
            className="w-full text-sm px-3 py-2 border-b border-slate-100 outline-none" />
          <div className="max-h-56 overflow-y-auto">
            {tersaring.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-3">Tidak ada yang cocok.</p>
            ) : tersaring.map(o => (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setBuka(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 truncate"
                style={o.value === value ? { background: 'rgba(67,56,202,0.06)', fontWeight: 700 } : undefined}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
