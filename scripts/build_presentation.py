# -*- coding: utf-8 -*-
"""
build_presentation.py (v2) - Presentasi Field Service Platform.
Tema sama dengan versi sebelumnya (yang disukai user), tapi mockup layar
sekarang dibuat SEAKURAT MUNGKIN meniru data & tata letak platform yang
BENAR-BENAR berjalan (diperiksa langsung lewat browser sebelum file ini
ditulis) - bukan data karangan. Satu screenshot ASLI (halaman Technician
mobile) disisipkan langsung sebagai gambar.
"""
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

MAROON = RGBColor(0x8B, 0x11, 0x2E)
GOLD = RGBColor(0xC8, 0x86, 0x1D)
BLUE = RGBColor(0x1E, 0x40, 0xAF)
BLUE_LIGHT = RGBColor(0xEF, 0xF6, 0xFF)
GREEN = RGBColor(0x05, 0x96, 0x69)
AMBER = RGBColor(0xD9, 0x77, 0x06)
RED = RGBColor(0xDC, 0x26, 0x26)
SLATE_900 = RGBColor(0x0F, 0x17, 0x2A)
SLATE_700 = RGBColor(0x33, 0x41, 0x55)
SLATE_500 = RGBColor(0x64, 0x74, 0x8B)
SLATE_300 = RGBColor(0xCB, 0xD5, 0xE1)
SLATE_100 = RGBColor(0xF1, 0xF5, 0xF9)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
FONT = 'Segoe UI'

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]
SW, SH = prs.slide_width, prs.slide_height
SHOTS = r'C:\Users\userp\Documents\WORK FILE DHANY PTS\PENDING\AI\fieldserviceplatform\scripts\shots'


def add_slide():
    return prs.slides.add_slide(BLANK)


def set_bg(slide, color):
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = color


def box(slide, x, y, w, h, fill=None, line=None, line_w=None, shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=None):
    sp = slide.shapes.add_shape(shape, x, y, w, h)
    if fill is None: sp.fill.background()
    else: sp.fill.solid(); sp.fill.fore_color.rgb = fill
    if line is None: sp.line.fill.background()
    else: sp.line.color.rgb = line; sp.line.width = line_w or Pt(1)
    sp.shadow.inherit = False
    if radius is not None and shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        try: sp.adjustments[0] = radius
        except Exception: pass
    return sp


def txt(slide, x, y, w, h, text, size=14, color=SLATE_900, bold=False, align=PP_ALIGN.LEFT,
        anchor=MSO_ANCHOR.TOP, font=FONT, italic=False, line_spacing=1.0, wrap=True):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame; tf.word_wrap = wrap; tf.vertical_anchor = anchor
    tf.margin_left = 0; tf.margin_right = 0; tf.margin_top = 0; tf.margin_bottom = 0
    for i, line in enumerate(text.split('\n')):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align; p.line_spacing = line_spacing
        r = p.add_run(); r.text = line
        r.font.size = Pt(size); r.font.bold = bold; r.font.italic = italic
        r.font.name = font; r.font.color.rgb = color
    return tb


def bullets(slide, x, y, w, h, items, size=15, color=SLATE_700, gap=10, bullet_color=None):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame; tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(gap); p.line_spacing = 1.15
        if isinstance(item, tuple):
            head, body = item
            r1 = p.add_run(); r1.text = f'{head}  '; r1.font.bold = True
            r1.font.size = Pt(size); r1.font.name = FONT; r1.font.color.rgb = (bullet_color or MAROON)
            r2 = p.add_run(); r2.text = body
            r2.font.size = Pt(size); r2.font.name = FONT; r2.font.color.rgb = color
        else:
            r = p.add_run(); r.text = f'\u25CF  {item}'
            r.font.size = Pt(size); r.font.name = FONT; r.font.color.rgb = color
    return tb


def header_bar(slide, kicker, title):
    bar_h = Inches(1.05)
    box(slide, 0, 0, SW, bar_h, fill=MAROON, shape=MSO_SHAPE.RECTANGLE)
    box(slide, 0, bar_h - Pt(4), SW, Pt(4), fill=GOLD, shape=MSO_SHAPE.RECTANGLE)
    txt(slide, Inches(0.55), Inches(0.14), Inches(11), Inches(0.3), kicker.upper(), size=11.5, color=GOLD, bold=True)
    txt(slide, Inches(0.55), Inches(0.42), Inches(11.8), Inches(0.55), title, size=23, color=WHITE, bold=True)


def footer(slide, note=''):
    txt(slide, Inches(0.55), SH - Inches(0.38), Inches(9), Inches(0.3), note, size=9.5, color=SLATE_500)
    txt(slide, SW - Inches(2.2), SH - Inches(0.38), Inches(1.6), Inches(0.3), 'Field Service Platform', size=9.5, color=SLATE_300, align=PP_ALIGN.RIGHT)


def arrow_right(slide, x, y, w, h, color=SLATE_300):
    sp = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, x, y, w, h)
    sp.fill.solid(); sp.fill.fore_color.rgb = color; sp.line.fill.background(); sp.shadow.inherit = False


def flow_step(slide, x, y, w, h, num, title, desc, color=MAROON):
    box(slide, x, y, w, h, fill=WHITE, line=SLATE_300, line_w=Pt(1), radius=0.08)
    d = Inches(0.5)
    circ = slide.shapes.add_shape(MSO_SHAPE.OVAL, x + Inches(0.18), y + Inches(0.18), d, d)
    circ.fill.solid(); circ.fill.fore_color.rgb = color; circ.line.fill.background(); circ.shadow.inherit = False
    tf = circ.text_frame; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = str(num); r.font.size = Pt(18); r.font.bold = True; r.font.color.rgb = WHITE; r.font.name = FONT
    txt(slide, x + Inches(0.82), y + Inches(0.2), w - Inches(1.0), Inches(0.45), title, size=14.5, color=SLATE_900, bold=True)
    txt(slide, x + Inches(0.18), y + Inches(0.72), w - Inches(0.36), h - Inches(0.85), desc, size=11.5, color=SLATE_700, line_spacing=1.1)


def kpi_tile(slide, x, y, w, h, value, label, color, sub=None):
    box(slide, x, y, w, h, fill=WHITE, line=SLATE_300, line_w=Pt(0.75), radius=0.1)
    box(slide, x + Inches(0.13), y + Inches(0.12), Inches(0.34), Inches(0.34), fill=color, radius=0.5, shape=MSO_SHAPE.OVAL)
    txt(slide, x + Inches(0.15), y + Inches(0.42), w - Inches(0.3), Inches(0.4), str(value), size=19, bold=True, color=color)
    txt(slide, x + Inches(0.15), y + h - Inches(0.4), w - Inches(0.3), Inches(0.24), label, size=8.8, color=SLATE_700, bold=True)
    if sub:
        txt(slide, x + Inches(0.15), y + h - Inches(0.2), w - Inches(0.3), Inches(0.2), sub, size=7.3, color=SLATE_500)


def mini_donut(slide, x, y, size, center_txt, ring_color=BLUE):
    box(slide, x, y, size, size, fill=None, line=ring_color, line_w=Pt(9), shape=MSO_SHAPE.OVAL)
    tf_box = slide.shapes.add_textbox(x, y + size/2 - Inches(0.15), size, Inches(0.3))
    tf = tf_box.text_frame; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = center_txt; r.font.size = Pt(15); r.font.bold = True; r.font.color.rgb = SLATE_900; r.font.name = FONT


def legend_row(slide, x, y, color, label, value=None):
    box(slide, x, y + Inches(0.02), Inches(0.11), Inches(0.11), fill=color, shape=MSO_SHAPE.OVAL)
    t = label if value is None else f'{label}  {value}'
    txt(slide, x + Inches(0.18), y - Inches(0.03), Inches(2.6), Inches(0.22), t, size=9.5, color=SLATE_700)


def browser_frame(slide, x, y, w, h, page_bg=WHITE):
    """Bingkai jendela browser tipis - supaya mockup terlihat 'sebagai layar', bukan diagram lepas."""
    box(slide, x, y, w, h, fill=page_bg, line=SLATE_300, line_w=Pt(1.25), radius=0.02)
    bar = box(slide, x, y, w, Inches(0.22), fill=SLATE_100, shape=MSO_SHAPE.RECTANGLE)
    for i, c in enumerate([RED, AMBER, GREEN]):
        box(slide, x + Inches(0.08 + i*0.16), y + Inches(0.07), Inches(0.08), Inches(0.08), fill=c, shape=MSO_SHAPE.OVAL)


# =============================================================================
# SLIDE 1 - COVER
# =============================================================================
s = add_slide(); set_bg(s, MAROON)
box(s, 0, 0, SW, Inches(0.12), fill=GOLD, shape=MSO_SHAPE.RECTANGLE)
logo = box(s, Inches(0.9), Inches(0.9), Inches(0.8), Inches(0.8), fill=WHITE, radius=0.28)
tf = logo.text_frame; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
r = p.add_run(); r.text = '\U0001F3E2'; r.font.size = Pt(30)
txt(s, Inches(1.9), Inches(0.95), Inches(6), Inches(0.4), 'FIELD SERVICE PLATFORM', size=15, bold=True, color=GOLD)
txt(s, Inches(1.9), Inches(1.28), Inches(6), Inches(0.4), 'Proof of Execution \u00b7 IndoVisual Professional Tools', size=12, color=WHITE)
txt(s, Inches(0.9), Inches(2.7), Inches(11.5), Inches(1.6), 'Platform Kontrol Operasional\nDeployment Konten TV', size=42, bold=True, color=WHITE, line_spacing=1.05)
txt(s, Inches(0.9), Inches(4.35), Inches(10), Inches(0.9),
    'Dari rencana sampai bukti terverifikasi - semua pihak melihat kondisi yang sama, kapan saja.', size=17, color=RGBColor(0xF3, 0xD9, 0xC9))
labels = ['RENCANAKAN', 'TUGASKAN', 'KERJAKAN', 'BUKTIKAN', 'REVIEW', 'TUTUP']
bx = Inches(0.9); by = Inches(5.7)
for lab in labels:
    w = Inches(1.85)
    sp = box(s, bx, by, w, Inches(0.55), fill=RGBColor(0x6B, 0x0C, 0x24), radius=0.5)
    tf = sp.text_frame; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = lab; r.font.size = Pt(11); r.font.bold = True; r.font.color.rgb = WHITE; r.font.name = FONT
    bx += w + Inches(0.12)
txt(s, Inches(0.9), SH - Inches(0.7), Inches(6), Inches(0.4), 'Presentasi untuk Tim & Client \u00b7 2026', size=12, color=RGBColor(0xE8, 0xC7, 0xB2))

# =============================================================================
# SLIDE 2 - Apa & Mengapa
# =============================================================================
s = add_slide(); set_bg(s, WHITE)
header_bar(s, 'Pengantar', 'Apa yang Platform Ini Selesaikan?')
txt(s, Inches(0.55), Inches(1.3), Inches(11.5), Inches(0.5),
    'Sebelumnya: siapa mengerjakan apa, kapan, dan buktinya seperti apa - semua dicek manual lewat WhatsApp/Excel.', size=13.5, color=SLATE_500, italic=True)
cards = [
    ('\U0001F4CD', 'Ribuan Titik TV', 'Konten dipasang PIC di banyak gedung, banyak wilayah, tiap akhir pekan.', MAROON),
    ('\U0001F4F8', 'Bukti, Bukan Klaim', 'GPS check-in/out + foto per TV membuktikan pekerjaan benar dilakukan.', BLUE),
    ('\u2705', 'Client Memutuskan Sendiri', 'Client melihat hasil apa adanya dan memutuskan, dengan alasan tercatat.', GREEN),
    ('\U0001F512', 'Semua Tercatat', 'Setiap perubahan penting masuk jejak audit - bisa ditelusuri kapan saja.', GOLD),
]
cw, ch, gap = Inches(2.78), Inches(3.9), Inches(0.25)
cx = Inches(0.55); cy = Inches(2.0)
for icon, title, desc, color in cards:
    box(s, cx, cy, cw, ch, fill=WHITE, line=SLATE_300, line_w=Pt(1), radius=0.06)
    box(s, cx, cy, cw, Inches(0.12), fill=color, shape=MSO_SHAPE.RECTANGLE)
    icn = box(s, cx + Inches(0.25), cy + Inches(0.35), Inches(0.7), Inches(0.7), fill=SLATE_100, radius=0.5, shape=MSO_SHAPE.OVAL)
    tf = icn.text_frame; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = icon; r.font.size = Pt(24)
    txt(s, cx + Inches(0.25), cy + Inches(1.25), cw - Inches(0.5), Inches(0.7), title, size=15.5, bold=True, color=SLATE_900)
    txt(s, cx + Inches(0.25), cy + Inches(1.95), cw - Inches(0.5), ch - Inches(2.1), desc, size=11.5, color=SLATE_700, line_spacing=1.2)
    cx += cw + gap
footer(s, 'Field Service & Proof of Execution Platform')

# =============================================================================
# SLIDE 3 - Alur Kerja Utama
# =============================================================================
s = add_slide(); set_bg(s, WHITE)
header_bar(s, 'Cara Kerja', 'Satu Alur, Enam Langkah')
steps = [
    ('RENCANAKAN', 'Admin membuat Siklus\nWeekend & pilih konten', MAROON),
    ('TUGASKAN', 'PIC ditugaskan ke\nwilayah/gedung', GOLD),
    ('KERJAKAN', 'PIC check-in GPS,\nisi checklist per TV', BLUE),
    ('BUKTIKAN', 'Foto bukti tiap TV\n+ check-out GPS', BLUE),
    ('REVIEW', 'Client memeriksa &\nmemutuskan per TV', GREEN),
    ('TUTUP', 'Siklus ditutup, hasil\ntersimpan permanen', SLATE_700),
]
n = len(steps); margin = Inches(0.55); gap = Inches(0.15)
box_w = Emu(int((SW - 2*margin - gap*(n-1)) / n)); box_h = Inches(2.5); y0 = Inches(2.3)
x = margin
for i, (title, desc, color) in enumerate(steps):
    box(s, x, y0, box_w, box_h, fill=color, radius=0.08)
    txt(s, x + Inches(0.12), y0 + Inches(0.18), box_w - Inches(0.24), Inches(0.4), f'{i+1}', size=20, bold=True, color=WHITE)
    txt(s, x + Inches(0.12), y0 + Inches(0.7), box_w - Inches(0.24), Inches(0.5), title, size=13.5, bold=True, color=WHITE)
    txt(s, x + Inches(0.12), y0 + Inches(1.25), box_w - Inches(0.24), Inches(1.1), desc, size=10.5, color=WHITE, line_spacing=1.15)
    if i < n - 1: arrow_right(s, x + box_w - Inches(0.02), y0 + box_h/2 - Inches(0.15), gap + Inches(0.2), Inches(0.3))
    x += box_w + gap
txt(s, Inches(0.55), Inches(5.2), Inches(12.2), Inches(0.6),
    'Setiap panah = satu keputusan yang tercatat siapa & kapan melakukannya. Tidak ada langkah yang "diam-diam" berubah.',
    size=13, color=SLATE_500, italic=True, align=PP_ALIGN.CENTER)

# Contoh nyata angka siklus berjalan
box(s, Inches(2.2), Inches(6.0), Inches(8.9), Inches(1.0), fill=SLATE_100, radius=0.1)
txt(s, Inches(2.5), Inches(6.15), Inches(8.3), Inches(0.3), 'CONTOH SIKLUS BERJALAN SAAT INI: "Demo Cycle \u2014 September 2026"', size=10.5, bold=True, color=SLATE_500)
txt(s, Inches(2.5), Inches(6.45), Inches(8.3), Inches(0.4), '10 TV \u00b7 3 gedung \u00b7 2 wilayah  \u2192  4 selesai \u00b7 1 gagal \u00b7 1 perlu diulang \u00b7 3 sudah disetujui client (40%)', size=12.5, bold=True, color=MAROON)
footer(s)

# =============================================================================
# SLIDE 4 - Peran Pengguna
# =============================================================================
s = add_slide(); set_bg(s, WHITE)
header_bar(s, 'Pengguna', 'Empat Peran, Empat Sudut Pandang')
roles = [
    ('\U0001F6E1\uFE0F', 'ADMIN', 'Kontrol penuh platform', ['Buat & tutup siklus weekend', 'Kelola wilayah, gedung, titik TV & konten', 'Setujui check-out & pembersihan data', 'Lihat jejak audit seluruh sistem'], MAROON),
    ('\U0001F9ED', 'SUPERVISOR', 'Menjalankan operasi harian', ['Tugaskan PIC ke wilayah/gedung', 'Aktifkan siklus & buat daftar pekerjaan', 'Kirim siklus ke review client', 'Pantau dashboard operasional penuh'], GOLD),
    ('\U0001F527', 'TECHNICIAN (PIC)', 'Kerja lapangan', ['Lihat tugas hari ini saja (sederhana)', 'Check-in/out GPS di lokasi tugas', 'Isi checklist & foto tiap TV', 'Terima notifikasi kalau ada revisi'], BLUE),
    ('\U0001F441\uFE0F', 'CLIENT (VIEW)', 'Memeriksa hasil', ['Lihat progres siklus yang direview', 'Setujui atau minta ulang per TV', 'Sertakan alasan tiap keputusan', 'Tidak bisa mengubah data operasional'], GREEN),
]
cw = Inches(2.98); ch = Inches(4.6); gap = Inches(0.2); cx = Inches(0.55); cy = Inches(1.55)
for icon, name, sub, items, color in roles:
    box(s, cx, cy, cw, ch, fill=WHITE, line=SLATE_300, line_w=Pt(1), radius=0.06)
    box(s, cx, cy, cw, Inches(1.15), fill=color, radius=0.06)
    box(s, cx, cy + Inches(0.55), cw, Inches(0.6), fill=color, shape=MSO_SHAPE.RECTANGLE)
    txt(s, cx + Inches(0.2), cy + Inches(0.12), cw - Inches(0.4), Inches(0.5), icon, size=24)
    txt(s, cx + Inches(0.2), cy + Inches(0.58), cw - Inches(0.4), Inches(0.35), name, size=15, bold=True, color=WHITE)
    txt(s, cx + Inches(0.2), cy + Inches(1.28), cw - Inches(0.4), Inches(0.4), sub, size=11, italic=True, color=SLATE_500)
    bullets(s, cx + Inches(0.2), cy + Inches(1.75), cw - Inches(0.4), ch - Inches(1.9), items, size=10.8, gap=7, bullet_color=color)
    cx += cw + gap
footer(s, 'Akses tiap peran dijaga langsung oleh aturan database (RLS) - bukan sekadar tombol yang disembunyikan')

# =============================================================================
# SLIDE 5 - DASHBOARD MOCKUP AKURAT
# =============================================================================
s = add_slide(); set_bg(s, WHITE)
header_bar(s, 'Menu \u00b7 Dashboard', 'Ruang Kontrol Operasional')
mx, my, mw, mh = Inches(0.45), Inches(1.25), Inches(12.45), Inches(5.95)
browser_frame(s, mx, my, mw, mh, page_bg=SLATE_100)
cy0 = my + Inches(0.22)
# sidebar mockup
sbw = Inches(1.7)
box(s, mx, cy0, sbw, mh - Inches(0.22), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), shape=MSO_SHAPE.RECTANGLE)
txt(s, mx + Inches(0.12), cy0 + Inches(0.12), sbw - Inches(0.24), Inches(0.25), '\U0001F3E0 Dashboard', size=8.5, bold=True, color=MAROON)
navitems = ['Siklus & Riwayat', 'Locations', 'Content', 'Tugas Hari Ini', 'Reviews']
ny = cy0 + Inches(0.55)
for it in navitems:
    txt(s, mx + Inches(0.12), ny, sbw - Inches(0.24), Inches(0.22), it, size=7.8, color=SLATE_700)
    ny += Inches(0.32)
# header row inside app
hx = mx + sbw
box(s, hx, cy0, mw - sbw, Inches(0.5), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), shape=MSO_SHAPE.RECTANGLE)
txt(s, hx + Inches(0.15), cy0 + Inches(0.08), Inches(3), Inches(0.35), 'Halo, Admin \U0001F44B', size=10.5, bold=True, color=SLATE_900)
box(s, hx + mw - sbw - Inches(2.3), cy0 + Inches(0.07), Inches(2.15), Inches(0.36), fill=SLATE_100, radius=0.3)
txt(s, hx + mw - sbw - Inches(2.2), cy0 + Inches(0.1), Inches(2.0), Inches(0.3), 'Demo Cycle \u2014 Sep 2026 \u00b7 40%', size=7.5, bold=True, color=MAROON)
# cycle banner
by1 = cy0 + Inches(0.62)
box(s, hx + Inches(0.12), by1, mw - sbw - Inches(0.24), Inches(0.85), fill=MAROON, radius=0.08)
txt(s, hx + Inches(0.3), by1 + Inches(0.1), Inches(6), Inches(0.3), 'Demo Cycle \u2014 September 2026   [Sedang Berjalan]', size=10, bold=True, color=WHITE)
txt(s, hx + Inches(0.3), by1 + Inches(0.42), Inches(7), Inches(0.35), 'Pengerjaan 12\u201312 Sep \u00b7 Review 13\u201326 Sep \u2014 PIC sedang mengerjakan di lapangan.', size=8, color=RGBColor(0xF3, 0xD9, 0xC9))
box(s, hx + mw - sbw - Inches(2.6), by1 + Inches(0.24), Inches(1.15), Inches(0.4), fill=WHITE, radius=0.25)
txt(s, hx + mw - sbw - Inches(2.6), by1 + Inches(0.31), Inches(1.15), Inches(0.25), 'Lihat Peta', size=7.5, bold=True, color=MAROON, align=PP_ALIGN.CENTER)
box(s, hx + mw - sbw - Inches(1.35), by1 + Inches(0.24), Inches(1.3), Inches(0.4), fill=BLUE, radius=0.25)
txt(s, hx + mw - sbw - Inches(1.35), by1 + Inches(0.31), Inches(1.3), Inches(0.25), 'Kirim ke Review', size=7.2, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
# kpi row
kpis = [('10', 'Total TV', MAROON, '3 gedung \u00b7 2 wilayah'), ('4', 'Selesai', GREEN, '40% dari total'), ('4', 'Belum Dikerjakan', SLATE_500, None),
        ('1', 'Gagal', RED, 'TV mati / offline'), ('1', 'Perlu Diulang', AMBER, 'diminta client'), ('3', 'Disetujui Client', BLUE, '0/3 gedung tuntas')]
kw = (mw - sbw - Inches(0.24) - Inches(0.05)*5) / 6
kx = hx + Inches(0.12); ky = by1 + Inches(1.0)
for val, lab, color, sub in kpis:
    kpi_tile(s, kx, ky, kw, Inches(0.85), val, lab, color, sub)
    kx += kw + Inches(0.05)
# 3 bottom panels
py = ky + Inches(1.0)
pw = (mw - sbw - Inches(0.24) - Inches(0.1)*2) / 3
px = hx + Inches(0.12)
box(s, px, py, pw, Inches(1.9), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), radius=0.06)
txt(s, px + Inches(0.12), py + Inches(0.1), pw - Inches(0.24), Inches(0.22), 'PROGRES SIKLUS', size=7.5, bold=True, color=SLATE_500)
txt(s, px + Inches(0.12), py + Inches(0.35), pw - Inches(0.24), Inches(0.5), '40%', size=26, bold=True, color=RED)
txt(s, px + Inches(0.12), py + Inches(0.95), pw - Inches(0.24), Inches(0.2), '4 dari 10 TV', size=8, color=SLATE_500)
box(s, px + Inches(0.12), py + Inches(1.2), pw - Inches(0.7), Inches(0.1), fill=RED, radius=0.5)
px2 = px + pw + Inches(0.1)
box(s, px2, py, pw, Inches(1.9), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), radius=0.06)
txt(s, px2 + Inches(0.12), py + Inches(0.1), pw - Inches(0.24), Inches(0.22), 'KOMPOSISI STATUS TV', size=7.5, bold=True, color=SLATE_500)
mini_donut(s, px2 + Inches(0.15), py + Inches(0.35), Inches(1.0), '10', ring_color=GREEN)
legend_row(s, px2 + Inches(1.3), py + Inches(0.4), GREEN, 'Selesai', '4')
legend_row(s, px2 + Inches(1.3), py + Inches(0.66), SLATE_300, 'Belum', '4')
legend_row(s, px2 + Inches(1.3), py + Inches(0.92), RED, 'Gagal', '1')
legend_row(s, px2 + Inches(1.3), py + Inches(1.18), AMBER, 'Ulang', '1')
px3 = px2 + pw + Inches(0.1)
box(s, px3, py, pw, Inches(1.9), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), radius=0.06)
txt(s, px3 + Inches(0.12), py + Inches(0.1), pw - Inches(0.24), Inches(0.22), 'PROGRES PER WILAYAH', size=7.5, bold=True, color=SLATE_500)
txt(s, px3 + Inches(0.12), py + Inches(0.4), Inches(0.9), Inches(0.2), 'Bandung', size=7.5, color=SLATE_700)
box(s, px3 + Inches(1.0), py + Inches(0.4), pw - Inches(1.2), Inches(0.14), fill=SLATE_300, radius=0.3)
txt(s, px3 + Inches(0.12), py + Inches(0.75), Inches(0.9), Inches(0.2), 'Jakarta', size=7.5, color=SLATE_700)
box(s, px3 + Inches(1.0), py + Inches(0.75), (pw - Inches(1.2))*0.85, Inches(0.14), fill=GREEN, radius=0.3)
txt(s, px3 + Inches(0.12), py + Inches(1.15), pw - Inches(0.24), Inches(0.5), 'Penyebab kegagalan: TV mati / offline (1)', size=7.8, color=SLATE_500, italic=True)
footer(s, 'Angka & tata letak di atas persis dari aplikasi yang berjalan - bukan data ilustrasi')

# =============================================================================
# SLIDE 6 - PETA + SIKLUS (mockup akurat, full-width map)
# =============================================================================
s = add_slide(); set_bg(s, WHITE)
header_bar(s, 'Menu \u00b7 Siklus & Riwayat', 'Siklus Weekend + Peta Sebaran Gedung (Full-Lebar)')
mx, my, mw, mh = Inches(0.45), Inches(1.2), Inches(12.45), Inches(6.0)
browser_frame(s, mx, my, mw, mh, page_bg=SLATE_100)
cy0 = my + Inches(0.3)
txt(s, mx + Inches(0.25), cy0, Inches(6), Inches(0.3), 'Siklus Weekend', size=13, bold=True, color=MAROON)
box(s, mx + mw - Inches(3.6), cy0 - Inches(0.02), Inches(1.6), Inches(0.34), fill=WHITE, line=SLATE_300, line_w=Pt(0.75), radius=0.25)
txt(s, mx + mw - Inches(3.6), cy0 + Inches(0.05), Inches(1.6), Inches(0.22), 'Tugaskan PIC', size=7.5, bold=True, color=SLATE_700, align=PP_ALIGN.CENTER)
box(s, mx + mw - Inches(1.9), cy0 - Inches(0.02), Inches(1.65), Inches(0.34), fill=BLUE, radius=0.25)
txt(s, mx + mw - Inches(1.9), cy0 + Inches(0.05), Inches(1.65), Inches(0.22), '+ Buat Siklus Weekend', size=7.5, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
kpis2 = [('1', 'Siklus Berjalan', MAROON), ('10', 'TV Siklus Ini', BLUE), ('3', 'Gedung', GREEN), ('6', 'Perlu Perhatian', AMBER), ('0', 'Riwayat', SLATE_500)]
kw2 = (mw - Inches(0.5) - Inches(0.08)*4) / 5; kx = mx + Inches(0.25); ky = cy0 + Inches(0.45)
for val, lab, color in kpis2:
    kpi_tile(s, kx, ky, kw2, Inches(0.8), val, lab, color)
    kx += kw2 + Inches(0.08)
cardy = ky + Inches(0.95)
box(s, mx + Inches(0.25), cardy, mw - Inches(0.5), Inches(0.85), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), radius=0.08)
txt(s, mx + Inches(0.4), cardy + Inches(0.08), Inches(4), Inches(0.25), 'SIKLUS BERJALAN', size=8, bold=True, color=SLATE_500)
txt(s, mx + Inches(0.4), cardy + Inches(0.35), Inches(4.5), Inches(0.3), 'Demo Cycle \u2014 September 2026  [Sedang Berjalan]', size=10, bold=True, color=SLATE_900)
txt(s, mx + mw - Inches(4.6), cardy + Inches(0.15), Inches(2.0), Inches(0.5), '4/10 TV \u00b7 40% selesai', size=9, bold=True, color=RED)
box(s, mx + mw - Inches(2.5), cardy + Inches(0.2), Inches(2.15), Inches(0.4), fill=WHITE, line=BLUE, line_w=Pt(1), radius=0.3)
txt(s, mx + mw - Inches(2.5), cardy + Inches(0.27), Inches(2.15), Inches(0.25), 'Kirim ke Review Client', size=7.5, bold=True, color=BLUE, align=PP_ALIGN.CENTER)
mapy = cardy + Inches(1.0)
box(s, mx + Inches(0.25), mapy, mw - Inches(0.5), mh - (mapy - my) - Inches(0.25), fill=RGBColor(0xE9, 0xEF, 0xE4), line=SLATE_300, line_w=Pt(0.5), radius=0.03)
txt(s, mx + Inches(0.4), mapy + Inches(0.08), Inches(4), Inches(0.22), '\U0001F5FA\uFE0F PETA SEBARAN GEDUNG \u00b7 warna menandakan keadaan pekerjaan', size=8, bold=True, color=SLATE_700)
pin1 = box(s, mx + Inches(2.2), mapy + Inches(0.9), Inches(0.5), Inches(0.5), fill=RED, radius=0.5, shape=MSO_SHAPE.OVAL)
tf = pin1.text_frame; tf.vertical_anchor = MSO_ANCHOR.MIDDLE; p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
r = p.add_run(); r.text = '2'; r.font.size = Pt(13); r.font.bold = True; r.font.color.rgb = WHITE
txt(s, mx + Inches(1.7), mapy + Inches(1.45), Inches(1.6), Inches(0.4), 'Jakarta (Demo)\n7 TV', size=7.5, color=SLATE_700, align=PP_ALIGN.CENTER, line_spacing=1.1)
pin2 = box(s, mx + Inches(6.5), mapy + Inches(2.2), Inches(0.5), Inches(0.5), fill=GREEN, radius=0.5, shape=MSO_SHAPE.OVAL)
tf = pin2.text_frame; tf.vertical_anchor = MSO_ANCHOR.MIDDLE; p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
r = p.add_run(); r.text = '1'; r.font.size = Pt(13); r.font.bold = True; r.font.color.rgb = WHITE
txt(s, mx + Inches(6.0), mapy + Inches(2.75), Inches(1.6), Inches(0.4), 'Bandung (Demo)\n3 TV', size=7.5, color=SLATE_700, align=PP_ALIGN.CENTER, line_spacing=1.1)
footer(s, 'Peta ditumpuk penuh-lebar di bawah daftar siklus - tidak lagi dijepit jadi kolom sempit')

# =============================================================================
# SLIDE 7 - Locations & Content (mockup akurat)
# =============================================================================
s = add_slide(); set_bg(s, WHITE)
header_bar(s, 'Menu \u00b7 Locations & Content', 'Data Induk: Gedung, Titik TV & Konten')
# LOCATIONS half
lx, ly, lw, lh = Inches(0.45), Inches(1.2), Inches(6.15), Inches(6.0)
browser_frame(s, lx, ly, lw, lh, page_bg=SLATE_100)
cy = ly + Inches(0.3)
txt(s, lx + Inches(0.15), cy, Inches(3), Inches(0.25), 'LOCATIONS', size=11, bold=True, color=MAROON)
kpisL = [('10', 'Titik TV'), ('3', 'Lokasi'), ('2', 'Wilayah')]
kw3 = (lw - Inches(0.3) - Inches(0.06)*2) / 3; kx = lx + Inches(0.15); ky = cy + Inches(0.3)
for val, lab in kpisL:
    kpi_tile(s, kx, ky, kw3, Inches(0.65), val, lab, MAROON)
    kx += kw3 + Inches(0.06)
ty = ky + Inches(0.78)
box(s, lx + Inches(0.15), ty, lw - Inches(0.3), Inches(2.7), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), radius=0.06)
txt(s, lx + Inches(0.3), ty + Inches(0.08), Inches(3), Inches(0.22), 'Locations (3)', size=9, bold=True, color=SLATE_900)
rows = [('Grand Jakarta (Demo)', 'Installer Satu', '4 titik'), ('Central Jakarta (Demo)', 'Installer Dua', '3 titik'), ('Bandung Center (Demo)', 'Installer Tiga', '3 titik')]
ry = ty + Inches(0.45)
for nama, pic, tv in rows:
    txt(s, lx + Inches(0.3), ry, Inches(2.6), Inches(0.22), nama, size=8.3, bold=True, color=SLATE_900)
    txt(s, lx + Inches(2.9), ry, Inches(1.5), Inches(0.22), pic, size=8, color=SLATE_700)
    txt(s, lx + Inches(4.2), ry, Inches(0.8), Inches(0.22), tv, size=8, color=SLATE_700)
    b = box(s, lx + lw - Inches(1.35), ry - Inches(0.02), Inches(1.05), Inches(0.24), fill=RGBColor(0xDC, 0xFC, 0xE7), radius=0.4)
    txt(s, lx + lw - Inches(1.35), ry + Inches(0.02), Inches(1.05), Inches(0.18), 'TERCAKUP', size=6.8, bold=True, color=GREEN, align=PP_ALIGN.CENTER)
    ry += Inches(0.6)

# CONTENT half
rx, ryy, rw, rh = Inches(6.75), Inches(1.2), Inches(6.15), Inches(6.0)
browser_frame(s, rx, ryy, rw, rh, page_bg=SLATE_100)
cy = ryy + Inches(0.3)
txt(s, rx + Inches(0.15), cy, Inches(3), Inches(0.25), 'CONTENT', size=11, bold=True, color=BLUE)
kpisC = [('1', 'Total'), ('1', 'Aktif'), ('1', 'Berlaku Hari Ini'), ('0', 'Kedaluwarsa')]
kw4 = (rw - Inches(0.3) - Inches(0.06)*3) / 4; kx = rx + Inches(0.15); ky = cy + Inches(0.3)
for val, lab in kpisC:
    kpi_tile(s, kx, ky, kw4, Inches(0.65), val, lab, BLUE)
    kx += kw4 + Inches(0.06)
ty = ky + Inches(0.78)
box(s, rx + Inches(0.15), ty, rw - Inches(0.3), Inches(1.1), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), radius=0.06)
txt(s, rx + Inches(0.3), ty + Inches(0.1), Inches(4), Inches(0.22), 'Content Library (1)', size=9, bold=True, color=SLATE_900)
txt(s, rx + Inches(0.3), ty + Inches(0.45), Inches(3.2), Inches(0.22), 'Demo Content \u2014 September 2026  v1', size=8.3, bold=True, color=SLATE_900)
b = box(s, rx + Inches(3.7), ty + Inches(0.43), Inches(0.8), Inches(0.24), fill=RGBColor(0xDC, 0xFC, 0xE7), radius=0.4)
txt(s, rx + Inches(3.7), ty + Inches(0.47), Inches(0.8), Inches(0.18), 'AKTIF', size=6.8, bold=True, color=GREEN, align=PP_ALIGN.CENTER)
txt(s, rx + Inches(0.3), ty + Inches(0.75), Inches(4), Inches(0.22), '2026-09-09 \u2013 2026-09-23  \u00b7  Usage: 0', size=7.5, color=SLATE_500)
bullets(s, rx + Inches(0.15), ty + Inches(1.35), rw - Inches(0.4), Inches(3.3), [
    'Versi tersimpan otomatis (v1, v2, ...) - tidak menimpa',
    'Content Period terpisah dari tanggal pemasangan',
    'Kolom Usage: jumlah assignment aktif yang memakainya',
    'Laporan deployment per content untuk report ke client/marcom',
], size=11, gap=12, bullet_color=BLUE)
footer(s)

# =============================================================================
# SLIDE 8 - Client Review (mockup akurat)
# =============================================================================
s = add_slide(); set_bg(s, WHITE)
header_bar(s, 'Menu \u00b7 Reviews', 'Client Memutuskan, Bukan Sekadar Melihat')
mx, my, mw, mh = Inches(0.45), Inches(1.2), Inches(12.45), Inches(6.0)
browser_frame(s, mx, my, mw, mh, page_bg=SLATE_100)
cy0 = my + Inches(0.3)
box(s, mx + Inches(0.25), cy0, mw - Inches(0.5), Inches(0.55), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), radius=0.08)
txt(s, mx + Inches(0.4), cy0 + Inches(0.05), Inches(6), Inches(0.22), 'SIKLUS YANG DIREVIEW', size=7.5, bold=True, color=SLATE_500)
txt(s, mx + Inches(0.4), cy0 + Inches(0.26), Inches(6), Inches(0.25), 'Demo Cycle \u2014 September 2026  [Sedang Berjalan]', size=9.5, bold=True, color=SLATE_900)
kpis3 = [('3', 'Sudah Disetujui', GREEN), ('1', 'Menunggu Keputusan Anda', AMBER), ('1', 'Gagal di Lapangan', RED), ('1', 'Diminta Diulang', AMBER)]
kw5 = (mw - Inches(0.5) - Inches(0.08)*3) / 4; kx = mx + Inches(0.25); ky = cy0 + Inches(0.7)
for val, lab, color in kpis3:
    kpi_tile(s, kx, ky, kw5, Inches(0.75), val, lab, color)
    kx += kw5 + Inches(0.08)
py = ky + Inches(0.9)
pw = (mw - Inches(0.5) - Inches(0.1)*2) / 3
box(s, mx + Inches(0.25), py, pw, Inches(1.5), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), radius=0.06)
txt(s, mx + Inches(0.4), py + Inches(0.08), pw - Inches(0.3), Inches(0.2), 'PROGRES KESELURUHAN', size=7.3, bold=True, color=SLATE_500)
txt(s, mx + Inches(0.4), py + Inches(0.3), pw - Inches(0.3), Inches(0.5), '40%', size=24, bold=True, color=RED)
px2 = mx + Inches(0.25) + pw + Inches(0.1)
box(s, px2, py, pw, Inches(1.5), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), radius=0.06)
txt(s, px2 + Inches(0.15), py + Inches(0.08), pw - Inches(0.3), Inches(0.2), 'KOMPOSISI HASIL', size=7.3, bold=True, color=SLATE_500)
mini_donut(s, px2 + Inches(0.15), py + Inches(0.32), Inches(0.85), '10', ring_color=GREEN)
px3 = px2 + pw + Inches(0.1)
box(s, px3, py, pw, Inches(1.5), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), radius=0.06)
txt(s, px3 + Inches(0.15), py + Inches(0.08), pw - Inches(0.3), Inches(0.2), 'WILAYAH PERLU PERHATIAN', size=7.3, bold=True, color=SLATE_500)
txt(s, px3 + Inches(0.15), py + Inches(0.35), Inches(1.2), Inches(0.2), 'Bandung', size=7.8, color=SLATE_700)
txt(s, px3 + pw - Inches(1.1), py + Inches(0.35), Inches(1.0), Inches(0.2), '0%', size=7.8, bold=True, color=RED, align=PP_ALIGN.RIGHT)
txt(s, px3 + Inches(0.15), py + Inches(0.65), Inches(1.2), Inches(0.2), 'Jakarta', size=7.8, color=SLATE_700)
txt(s, px3 + pw - Inches(1.1), py + Inches(0.65), Inches(1.0), Inches(0.2), '57%', size=7.8, bold=True, color=AMBER, align=PP_ALIGN.RIGHT)
gy = py + Inches(1.65)
box(s, mx + Inches(0.25), gy, mw - Inches(0.5), mh - (gy - my) - Inches(0.2), fill=WHITE, line=SLATE_300, line_w=Pt(0.5), radius=0.06)
txt(s, mx + Inches(0.4), gy + Inches(0.08), Inches(5), Inches(0.2), 'HASIL PER GEDUNG', size=7.5, bold=True, color=SLATE_500)
grows = [('Bandung Center (Demo)', '0/3 terpasang', '3 belum', SLATE_500),
         ('Grand Jakarta (Demo)', '2/4 terpasang', '1 gagal \u00b7 1 ulang', RED),
         ('Central Jakarta (Demo)', '2/3 terpasang', '1 belum \u00b7 Setujui 1', AMBER)]
ry = gy + Inches(0.4)
for nama, prog, badge, color in grows:
    txt(s, mx + Inches(0.4), ry, Inches(3.5), Inches(0.22), nama, size=8.5, bold=True, color=SLATE_900)
    txt(s, mx + Inches(0.4), ry + Inches(0.22), Inches(3.5), Inches(0.2), prog, size=7.5, color=SLATE_500)
    txt(s, mx + mw - Inches(2.7), ry + Inches(0.08), Inches(2.4), Inches(0.22), badge, size=7.8, bold=True, color=color, align=PP_ALIGN.RIGHT)
    ry += Inches(0.55)
footer(s, 'Klik gedung untuk memeriksa tiap TV: foto bukti, PIC, waktu kerja - Setujui atau Minta Diulang')

# =============================================================================
# SLIDE 9 - Peran & Akses admin panel
# =============================================================================
s = add_slide(); set_bg(s, WHITE)
header_bar(s, 'Admin Panel', 'Peran & Akses: Dua Mode yang Sengaja Dibuat Berbeda')
mx, my, mw, mh = Inches(0.9), Inches(1.3), Inches(11.5), Inches(3.2)
box(s, mx, my, mw, mh, fill=WHITE, line=SLATE_300, line_w=Pt(1), radius=0.04)
box(s, mx + Inches(0.15), my + Inches(0.15), Inches(2.9), Inches(0.5), fill=BLUE_LIGHT, line=BLUE, line_w=Pt(1.5), radius=0.3)
txt(s, mx + Inches(0.35), my + Inches(0.22), Inches(1.6), Inches(0.3), 'Menu Per Role', size=11, bold=True, color=BLUE)
b1 = box(s, mx + Inches(2.15), my + Inches(0.23), Inches(0.8), Inches(0.24), fill=BLUE, radius=0.5)
txt(s, mx + Inches(2.15), my + Inches(0.27), Inches(0.8), Inches(0.18), 'EDITABLE', size=6.3, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
box(s, mx + Inches(3.2), my + Inches(0.15), Inches(2.7), Inches(0.5), fill=SLATE_100, line=SLATE_700, line_w=Pt(1.5), radius=0.3)
txt(s, mx + Inches(3.4), my + Inches(0.22), Inches(1.4), Inches(0.3), 'Peran & Akses', size=11, bold=True, color=SLATE_700)
b2 = box(s, mx + Inches(5.0), my + Inches(0.23), Inches(0.85), Inches(0.24), fill=SLATE_700, radius=0.5)
txt(s, mx + Inches(5.0), my + Inches(0.27), Inches(0.85), Inches(0.18), 'HANYA-BACA', size=6.3, bold=True, color=WHITE, align=PP_ALIGN.CENTER)

# panel kiri - editable
lx = mx + Inches(0.15); ly = my + Inches(0.85); lwp = mw/2 - Inches(0.3)
box(s, lx, ly, lwp, mh - Inches(1.0), fill=BLUE_LIGHT, line=BLUE, line_w=Pt(1.5), shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
txt(s, lx + Inches(0.2), ly + Inches(0.12), lwp - Inches(0.4), Inches(0.3), '\u270F\uFE0F Menu yang bisa dibuka untuk Admin', size=10.5, bold=True, color=BLUE)
chk = ['\u2611 Dashboard', '\u2610 Operations (Field Service)', '\u2610 Tugas Hari Ini (Teknisi)', '\u2610 Client Review']
cyy = ly + Inches(0.55)
for c in chk:
    txt(s, lx + Inches(0.2), cyy, lwp - Inches(0.4), Inches(0.25), c, size=10, color=SLATE_700)
    cyy += Inches(0.32)
txt(s, lx + Inches(0.2), cyy + Inches(0.05), lwp - Inches(0.4), Inches(0.4), '[ Simpan ]   [ Terapkan ke akun yang ada ]', size=9, bold=True, color=BLUE)

# panel kanan - readonly
rx = mx + mw/2 + Inches(0.15); ry2 = my + Inches(0.85); rwp = mw/2 - Inches(0.3)
box(s, rx, ry2, rwp, mh - Inches(1.0), fill=SLATE_100, line=SLATE_300, line_w=Pt(1.5), shape=MSO_SHAPE.ROUNDED_RECTANGLE, radius=0.05)
txt(s, rx + Inches(0.2), ry2 + Inches(0.12), rwp - Inches(0.4), Inches(0.3), '\U0001F512 Sejauh mana Admin boleh bertindak', size=10.5, bold=True, color=SLATE_700)
caps = ['\u2713 Kelola project & member', '\u2713 Buat & aktifkan siklus weekend', '\u2713 Setujui & hapus bukti permanen', '\u2713 Lihat jejak audit']
cyy = ry2 + Inches(0.55)
for c in caps:
    txt(s, rx + Inches(0.2), cyy, rwp - Inches(0.4), Inches(0.25), c, size=10, color=GREEN, bold=True)
    cyy += Inches(0.32)
txt(s, rx + Inches(0.2), cyy + Inches(0.05), rwp - Inches(0.4), Inches(0.4), 'Tidak ada yang bisa dicentang - dijaga langsung oleh database', size=9, italic=True, color=SLATE_500)

txt(s, Inches(0.9), Inches(4.75), Inches(11.5), Inches(1.5),
    'Sebelumnya dua bagian ini terlihat identik (dua kartu putih berdampingan) sehingga tidak jelas bedanya. '
    'Sekarang dipisah jadi dua TAB dengan bahasa visual berlawanan: biru bergaris putus-putus & ikon pensil untuk yang BISA diubah, '
    'abu-abu solid & ikon gembok untuk peta bacaan yang dijaga database - tidak bisa dicentang dari sini.',
    size=13.5, color=SLATE_700, line_spacing=1.35)
footer(s)

# =============================================================================
# SLIDE 10 - TECHNICIAN FLOW
# =============================================================================
s = add_slide(); set_bg(s, WHITE)
header_bar(s, 'Menu \u00b7 Tugas Hari Ini (Untuk PIC Lapangan)', 'Alur Kerja Technician - Dibuat Sesederhana Mungkin')
txt(s, Inches(0.55), Inches(1.25), Inches(12), Inches(0.4),
    'PIC HANYA melihat tugas miliknya sendiri hari itu - tiap layar cuma punya SATU tombol besar.', size=12.5, color=SLATE_500, italic=True)
pic_steps = [
    (1, 'Buka Aplikasi', 'Login sekali - langsung melihat daftar lokasi tugas hari ini.', '\U0001F4F1'),
    (2, 'Pilih Lokasi', 'Ketuk salah satu kartu gedung yang ditugaskan.', '\U0001F3E2'),
    (3, 'Check-In', 'Tekan tombol merah besar "Check-in" - GPS terbaca otomatis.', '\U0001F4CD'),
    (4, 'Isi Checklist TV', 'Untuk tiap TV: tandai Selesai/Gagal.', '\u2705'),
    (5, 'Ambil Foto', 'KETUK lingkaran kamera besar - kamera HP terbuka sendiri.', '\U0001F4F7'),
    (6, 'Check-Out', 'Tekan "Check-out" - TV belum selesai wajib diberi alasan.', '\U0001F6AA'),
]
cols = 3; cw = Inches(3.95); ch = Inches(2.0); gapx = Inches(0.12); gapy = Inches(0.15)
x0 = Inches(0.55); y0 = Inches(1.85)
for i, (num, title, desc, icon) in enumerate(pic_steps):
    col = i % cols; row = i // cols
    x = x0 + col * (cw + gapx); y = y0 + row * (ch + gapy)
    flow_step(s, x, y, cw, ch, num, f'{icon}  {title}', desc, color=[MAROON, GOLD, BLUE, BLUE, GOLD, MAROON][i])
txt(s, Inches(0.55), Inches(6.15), Inches(12.2), Inches(0.4),
    'Setelah Check-out: pekerjaan otomatis terkirim untuk direview - PIC tidak perlu lapor manual ke siapa pun.',
    size=12, bold=True, color=GREEN, align=PP_ALIGN.CENTER)
footer(s, 'Angka hasil kerja (selesai/gagal) DIHITUNG SISTEM dari checklist - bukan diketik manual oleh PIC')

# =============================================================================
# SLIDE 11 - MOBILE: real screenshot + mockup
# =============================================================================
s = add_slide(); set_bg(s, WHITE)
header_bar(s, 'Responsif', 'Tampilan Mobile - Diambil Langsung dari Aplikasi')

def phone_frame(slide, x, y, w, h):
    box(slide, x, y, w, h, fill=SLATE_900, radius=0.12)
    sx, sy, sw, sh = x + Inches(0.1), y + Inches(0.1), w - Inches(0.2), h - Inches(0.2)
    box(slide, sx, sy, sw, sh, fill=WHITE, radius=0.06)
    return sx, sy, sw, sh

# Phone 1: REAL screenshot (teknisi)
p1x, p1y, p1w, p1h = Inches(1.0), Inches(1.35), Inches(2.5), Inches(5.6)
sx, sy, sw, sh = phone_frame(s, p1x, p1y, p1w, p1h)
try:
    s.shapes.add_picture(f'{SHOTS}\\11-mobile-teknisi-home.png', sx, sy, width=sw, height=sh)
except Exception as e:
    box(s, sx, sy, sw, sh, fill=SLATE_100)
txt(s, p1x - Inches(0.3), p1y + p1h + Inches(0.12), p1w + Inches(0.6), Inches(0.6),
    'SCREENSHOT ASLI\nHalaman Technician (installer01)', size=10.5, bold=True, color=GREEN, align=PP_ALIGN.CENTER, line_spacing=1.1)

# Phone 2: mockup admin mobile dashboard
p2x = Inches(4.3)
sx2, sy2, sw2, sh2 = phone_frame(s, p2x, p1y, p1w, p1h)
box(s, sx2, sy2, sw2, Inches(0.55), fill=MAROON)
txt(s, sx2 + Inches(0.12), sy2 + Inches(0.08), sw2 - Inches(0.24), Inches(0.4), 'Halo, Admin \U0001F44B\nSabtu, 12 Sept 2026', size=7, bold=True, color=WHITE, line_spacing=1.1)
by = sy2 + Inches(0.65)
box(s, sx2 + Inches(0.12), by, sw2 - Inches(0.24), Inches(0.55), fill=MAROON, radius=0.1)
txt(s, sx2 + Inches(0.25), by + Inches(0.07), sw2 - Inches(0.5), Inches(0.4), 'Demo Cycle \u2014 Sep 2026\n4/10 TV \u00b7 40%', size=6.3, bold=True, color=WHITE, line_spacing=1.1)
kpi_y = by + Inches(0.68)
kvals = [('10', GREEN), ('4', BLUE), ('1', RED), ('3', GOLD)]
kxx = sx2 + Inches(0.12)
for i, (v, c) in enumerate(kvals):
    kw6 = (sw2 - Inches(0.36)) / 2
    row = i // 2; col = i % 2
    kpi_tile(s, sx2 + Inches(0.12) + col*(kw6+Inches(0.12)), kpi_y + row*Inches(0.65), kw6, Inches(0.55), v, ['Total TV', 'Selesai', 'Gagal', 'Disetujui'][i], c)
navy = sy2 + sh2 - Inches(0.55)
box(s, sx2, navy, sw2, Inches(0.55), fill=WHITE, line=SLATE_300, line_w=Pt(0.75))
navlabels = ['Home', 'Siklus', 'Locations', 'Content', 'More']
nx = sx2
for lab in navlabels:
    txt(s, nx, navy + Inches(0.18), sw2/5, Inches(0.3), lab, size=5.3, color=SLATE_500, align=PP_ALIGN.CENTER)
    nx += sw2/5
txt(s, p2x - Inches(0.3), p1y + p1h + Inches(0.12), p1w + Inches(0.6), Inches(0.6),
    'MOCKUP AKURAT\nDashboard Admin - menu di bawah layar', size=10.5, bold=True, color=SLATE_700, align=PP_ALIGN.CENTER, line_spacing=1.1)

# Phone 3: More panel mockup
p3x = Inches(7.6)
sx3, sy3, sw3, sh3 = phone_frame(s, p3x, p1y, p1w, p1h)
box(s, sx3, sy3 + sh3 - Inches(3.2), sw3, Inches(3.2), fill=WHITE, line=SLATE_300, line_w=Pt(0.75), radius=0.15)
txt(s, sx3 + Inches(0.15), sy3 + sh3 - Inches(3.05), sw3 - Inches(0.3), Inches(0.25), 'Menu Lainnya', size=8, bold=True, color=SLATE_900)
moreitems = ['Tugas Hari Ini', 'Reviews', '', 'Profil Saya', 'Users & Roles / Settings', 'Sign Out']
my_ = sy3 + sh3 - Inches(2.65)
for it in moreitems:
    if it:
        col = RED if it == 'Sign Out' else SLATE_700
        txt(s, sx3 + Inches(0.15), my_, sw3 - Inches(0.3), Inches(0.22), it, size=6.8, color=col, bold=(it=='Sign Out'))
    my_ += Inches(0.35)
navy3 = sy3 + sh3 - Inches(0.55)
box(s, sx3, navy3, sw3, Inches(0.55), fill=WHITE, line=SLATE_300, line_w=Pt(0.75))
nx = sx3
for lab in navlabels:
    col = MAROON if lab == 'More' else SLATE_500
    txt(s, nx, navy3 + Inches(0.18), sw3/5, Inches(0.3), lab, size=5.3, color=col, bold=(lab=='More'), align=PP_ALIGN.CENTER)
    nx += sw3/5
txt(s, p3x - Inches(0.3), p1y + p1h + Inches(0.12), p1w + Inches(0.6), Inches(0.6),
    'MOCKUP AKURAT\n"More" - akun, admin panel, sign out', size=10.5, bold=True, color=SLATE_700, align=PP_ALIGN.CENTER, line_spacing=1.1)

bullets(s, Inches(10.4), Inches(1.6), Inches(2.5), Inches(4.5), [
    'Sidebar desktop TIDAK PERNAH muncul di HP',
    'Navigasi utama = 4 tombol + More di bawah',
    'Logout selalu terjangkau lewat More',
    'Teknisi memang dirancang mobile-dulu',
], size=10, gap=12)
footer(s, 'Kiri: screenshot sungguhan. Tengah & kanan: rekonstruksi akurat dari kode yang sama (bukan tebakan).')

# =============================================================================
# SLIDE 12 - Keamanan & Audit
# =============================================================================
s = add_slide(); set_bg(s, WHITE)
header_bar(s, 'Keamanan', 'Setiap Akses Dijaga, Setiap Perubahan Tercatat')
sec_items = [
    ('\U0001F510', 'Akses per Peran (RLS)', 'Aturan siapa-boleh-apa dijaga LANGSUNG di database, bukan di tampilan.'),
    ('\U0001F4CD', 'GPS Bukan Sekadar Klaim', 'Check-in/out divalidasi jarak dari titik gedung terdaftar.'),
    ('\U0001F5C3\uFE0F', 'Foto Bukti Privat', 'Tersimpan di storage privat, dibuka lewat tautan sementara.'),
    ('\U0001F4DC', 'Jejak Audit Admin-Only', 'Siapa mengubah apa dan kapan - hanya Admin yang bisa melihat.'),
    ('\U0001F514', 'Notifikasi Otomatis', 'Kabar penting muncul sendiri - tidak menunggu dicek manual.'),
    ('\U0001F5D1\uFE0F', 'Pembersihan Data Terkontrol', 'Foto lama dihapus HANYA setelah disetujui admin.'),
]
cw = Inches(3.9); ch = Inches(2.15); cx0 = Inches(0.55); cy0 = Inches(1.55); gapx = Inches(0.18); gapy = Inches(0.18)
for i, (icon, title, desc) in enumerate(sec_items):
    col = i % 3; row = i // 3
    x = cx0 + col*(cw+gapx); y = cy0 + row*(ch+gapy)
    box(s, x, y, cw, ch, fill=SLATE_100, radius=0.08)
    txt(s, x + Inches(0.2), y + Inches(0.15), Inches(0.6), Inches(0.5), icon, size=22)
    txt(s, x + Inches(0.2), y + Inches(0.7), cw - Inches(0.4), Inches(0.4), title, size=13, bold=True, color=SLATE_900)
    txt(s, x + Inches(0.2), y + Inches(1.1), cw - Inches(0.4), ch - Inches(1.25), desc, size=10.8, color=SLATE_700, line_spacing=1.15)
footer(s)

# =============================================================================
# SLIDE 13 - Penutup
# =============================================================================
s = add_slide(); set_bg(s, MAROON)
box(s, 0, 0, SW, Inches(0.12), fill=GOLD, shape=MSO_SHAPE.RECTANGLE)
txt(s, Inches(0.9), Inches(1.6), Inches(11.5), Inches(1.0), 'Satu Platform,\nOperasional yang Bisa Dipercaya', size=36, bold=True, color=WHITE, line_spacing=1.05)
txt(s, Inches(0.9), Inches(3.1), Inches(10.5), Inches(0.9),
    'Dari rencana sampai bukti terverifikasi - semua pihak melihat kondisi yang sama, kapan saja.', size=16, color=RGBColor(0xF3, 0xD9, 0xC9))
recap = ['Bukti nyata, bukan klaim', 'Tiap peran, tampilan yang tepat', 'Aman & tercatat', 'Mudah dipakai siapa saja']
rx = Inches(0.9); ry = Inches(4.3)
for item in recap:
    w = Inches(0.16*len(item) + 0.6)
    sp = box(s, rx, ry, w, Inches(0.55), fill=RGBColor(0x6B, 0x0C, 0x24), radius=0.5)
    tf = sp.text_frame; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = item; r.font.size = Pt(12); r.font.bold = True; r.font.color.rgb = WHITE; r.font.name = FONT
    rx += w + Inches(0.15)
txt(s, Inches(0.9), Inches(6.3), Inches(8), Inches(0.5), 'Terima kasih - siap untuk pertanyaan & diskusi.', size=15, color=WHITE, italic=True)
txt(s, Inches(0.9), Inches(6.9), Inches(6), Inches(0.4), 'Field Service Platform \u00b7 IndoVisual Professional Tools', size=11, color=RGBColor(0xE8, 0xC7, 0xB2))

out_path = r'C:\Users\userp\Documents\WORK FILE DHANY PTS\PENDING\AI\fieldserviceplatform\Field-Service-Platform-Presentasi.pptx'
prs.save(out_path)
print('Saved:', out_path)
