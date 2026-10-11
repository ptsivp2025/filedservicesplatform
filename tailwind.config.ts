import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      screens: {
        /**
         * satulayar - dipakai form yang tata letaknya tiga kolom sekaligus.
         *
         * Tidak memakai lebar saja, dan itu disengaja. Zoom Chrome 125%
         * MENGECILKAN lebar viewport CSS: layar 1366px jadi 1092px, dan
         * breakpoint xl (1280px) langsung menjatuhkan tata letaknya jadi
         * satu kolom - padahal layarnya laptop yang sama, hanya tulisannya
         * diperbesar. Menumpuk ke bawah di situ salah sasaran.
         *
         * Yang sebenarnya membedakan laptop dari ponsel bukan lebar,
         * melainkan alat penunjuknya. `pointer: fine` berarti ada mouse atau
         * trackpad - dan itu tidak berubah walau di-zoom berapa pun. Ponsel
         * dan tablet menjawab `pointer: coarse`, jadi mereka tetap menumpuk
         * seperti sebelumnya.
         *
         * Batas 900px tetap ada untuk laptop supaya tiga kolom tidak
         * dipaksakan saat jendelanya benar-benar sempit (zoom 175% ke atas,
         * atau jendela yang dikecilkan setengah layar).
         */
        satulayar: {
          raw: '(min-width: 1280px), ((pointer: fine) and (min-width: 900px))',
        },

        /**
         * formulir - dipakai grid form pendek (2-3 kolom) di Admin Panel yang
         * sebelumnya memakai `sm:` polos.
         *
         * CATATAN PENTING - jangan mengulangi salah diagnosis yang sama:
         * breakpoint ini BUKAN yang memperbaiki bug "form Tambah Akun
         * berantakan di HP". Penyebab bug itu adalah `col-span-2`/`col-span-3`
         * TANPA prefix di dalam grid yang mobile-nya `grid-cols-1`: CSS Grid
         * membuat KOLOM IMPLISIT selebar isinya untuk menampung span itu,
         * jadi kolom pertama tergencet sampai ~55px dan labelnya melimpah
         * menimpa kolom sebelahnya. Perbaikannya ada di komponennya
         * (col-span ikut diberi prefix breakpoint yang sama dengan gridnya),
         * bukan di sini. Kalau suatu saat ada grid tampak berantakan di HP,
         * periksa col-span anak-anaknya LEBIH DULU sebelum menyalahkan
         * breakpoint.
         *
         * Yang breakpoint ini kerjakan hanya satu: menahan form pendek tetap
         * 1 kolom di layar sentuh sempit, walau lebar viewport CSS-nya
         * dilaporkan besar (mis. "Force enable zoom" Android yang menimpa
         * `maximum-scale=1`). Batas 900px tetap meloloskan tablet - layar
         * selebar itu memang muat 2-3 kolom walau layarnya sentuh.
         */
        formulir: {
          raw: '(min-width: 900px), ((pointer: fine) and (min-width: 640px))',
        },

        /**
         * Ambang munculnya sidebar (diambil dari Sales Management Platform).
         * MURNI lebar, tanpa syarat pointer: mode "Situs desktop" Chrome ponsel
         * melaporkan ~980px lalu mengecilkan halaman - dengan ambang lg
         * (1024px) yang didapat justru bilah bawah ponsel + teks yang
         * diperkecil 0,7x. Pada 900px ke atas sidebar memang muat.
         */
        sidebar: { raw: '(min-width: 900px)' },
        /** Layar sentuh yang melapor selebar desktop - huruf header dinaikkan. */
        sentuhlebar: { raw: '(pointer: coarse) and (min-width: 900px)' },
      },

      /**
       * Token di bawah ADITIF - namanya baru semua, jadi tidak ada satu pun
       * kelas yang sudah dipakai berubah artinya. Nilainya sengaja sama persis
       * dengan yang sudah dipakai (lihat lib/desain.ts), supaya memindahkan
       * satu komponen ke token tidak mengubah tampilannya sedikit pun -
       * hanya memberinya nama.
       */
      borderRadius: {
        kecil: '0.5rem',    // lencana, chip, tombol ikon      (= rounded-lg)
        kontrol: '0.75rem', // input, tombol, baris daftar     (= rounded-xl)
        kartu: '1rem',      // kartu, panel, badan modal       (= rounded-2xl)
        panel: '1.5rem',    // panel besar: kartu login        (= rounded-3xl)
      },
      boxShadow: {
        kartu: '0 4px 24px rgba(0,0,0,0.10)',
        dropdown: '0 8px 32px rgba(0,0,0,0.18)',
        modal: '0 8px 40px rgba(0,0,0,0.18)',
        toast: '0 4px 32px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06)',
        // Bayangan rendah khusus kartu bento - kartu yang rapat bersebelahan
        // tidak saling "menumpuk" secara visual.
        bento: '0 1px 3px rgba(15,23,42,0.06), 0 8px 24px -12px rgba(15,23,42,0.18)',
      },
      colors: {
        /** Warna merek dari database - lihat tulisWarnaKeCSS di lib/merek.ts. */
        merek: {
          DEFAULT: 'var(--merek-utama)',
          dua: 'var(--merek-utama-2)',
          aksen: 'var(--merek-aksen)',
          tembus: 'var(--merek-utama-tembus)',
        },
        /**
         * Palet aksen 50-900 (pola Sales Management Platform). Nilainya
         * variabel CSS yang DITURUNKAN dari warna utama merek oleh
         * tulisWarnaKeCSS - warna yang dipilih Admin di Dashboard Setting
         * langsung mengalir ke seluruh kelas aksen-* tanpa menyentuh satu
         * komponen pun. Format "R G B" supaya alpha Tailwind tetap jalan.
         */
        aksen: {
          50:  'rgb(var(--aksen-50)  / <alpha-value>)',
          100: 'rgb(var(--aksen-100) / <alpha-value>)',
          200: 'rgb(var(--aksen-200) / <alpha-value>)',
          300: 'rgb(var(--aksen-300) / <alpha-value>)',
          400: 'rgb(var(--aksen-400) / <alpha-value>)',
          500: 'rgb(var(--aksen-500) / <alpha-value>)',
          600: 'rgb(var(--aksen-600) / <alpha-value>)',
          700: 'rgb(var(--aksen-700) / <alpha-value>)',
          800: 'rgb(var(--aksen-800) / <alpha-value>)',
          900: 'rgb(var(--aksen-900) / <alpha-value>)',
          DEFAULT: 'rgb(var(--aksen-700) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
