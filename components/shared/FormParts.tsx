'use client';

/**
 * Shared form helpers - sama persis dipakai di reminder-schedule & form-review.
 */

/**
 * Ukuran label & header sengaja kecil.
 *
 * Form create kini bertata letak tiga kolom dalam satu layar; tiap kolom cuma
 * selebar ~470px. Ukuran yang nyaman saat form masih satu kolom lebar membuat
 * isian di sini berdesakan dan justru memaksa gulir - yang persis ingin
 * dihindari oleh tata letak satu layar itu.
 */
export function FormField({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  // Menautkan label ke isiannya
  // <label> yang hanya berdiri di atas isian TIDAK menamainya: secara program
  // keduanya tidak berhubungan, jadi isiannya terbaca tanpa nama sama sekali.
  // Membungkus isian di DALAM <label> membuat tautannya berlaku tanpa perlu
  // id - dan tanpa perlu menyentuh ratusan pemanggil untuk menambahkan id
  // satu per satu, yang pasti menyisakan sebagian terlewat.
  //
  // Ini juga membuat label bisa diklik untuk memfokuskan isiannya, seperti
  // yang sudah diharapkan orang dari sebuah label.
  return (
    <label className="block">
      <span className="block text-[10px] font-bold mb-1 tracking-widest uppercase" style={{ color: '#94a3b8' }}>{label}</span>
      {children}
    </label>
  );
}

export function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-1.5 pb-1.5 border-b" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
      {/* Emoji di sini murni hiasan judul: dibiarkan terbaca, pembaca layar
          mengeja namanya ("wajah tersenyum", "map") sebelum judul aslinya. */}
      <span className="text-sm" aria-hidden="true">{icon}</span>
      <span className="text-xs font-bold tracking-wide text-slate-700">{title}</span>
    </div>
  );
}

export function SectionHeaderSmall({ icon, title, warna = '#94a3b8', chip }: {
  icon: string; title: string; warna?: string;
  /** Latar belakang chip gelap semi-transparan di bawah teks - WAJIB dipakai
   *  kalau heading ini duduk LANGSUNG di atas gradasi (bukan di dalam kartu
   *  putih). Percobaan pertama cuma mengganti `warna` jadi putih ternyata
   *  TIDAK CUKUP (dilaporkan user via screenshot kedua): gradasi diagonal
   *  Dashboard berubah dari terang ke gelap sepanjang halaman, jadi satu
   *  warna teks tetap tidak kontras di bagian yang kebetulan terang -
   *  tidak ada satu warna teks pun yang aman di SEMUA titik gradasi. Chip
   *  gelap solid di belakang teks menjamin kontras di mana pun heading ini
   *  ditaruh, karena warna latar di BAWAH teks selalu sama (bukan ikut
   *  warna gradasi di titik itu). */
  chip?: boolean;
}) {
  return (
    <p className={`text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5 w-fit ${chip ? 'px-2 py-1 rounded-md' : ''}`}
      style={{ color: warna, background: chip ? 'rgba(30,27,46,0.45)' : undefined }}>
      <span aria-hidden="true">{icon}</span>{title}
    </p>
  );
}

export function InfoRow({ icon, label, value }: { icon: string; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
      <span className="text-base flex-shrink-0" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold tracking-widest uppercase" style={{ color: '#64748b' }}>{label}</p>
        <p className="text-sm font-semibold text-slate-800 break-words">{value}</p>
      </div>
    </div>
  );
}

/**
 * InfoLine - compact print-style row untuk detail popup (style dari ticketing)
 */
export function InfoLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="py-2 border-b border-gray-100 last:border-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mr-1.5">{label}:</span>
      <span className="text-sm text-slate-800 font-medium">{value}</span>
    </div>
  );
}
