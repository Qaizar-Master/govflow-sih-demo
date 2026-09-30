# Builds the GovFlow architecture diagram as SVG, matching the existing
# hand-designed theme: rounded cards, tinted icon tiles, two bordered panels.
W, H = 1200, 850

NAVY   = '#1e3a5f'   # structure, titles
READ   = '#1e40af'   # GovFlow reads from a department
WRITE  = '#047857'   # decisions handed back  (new in Phase D)
SSO    = '#7c3aed'   # identity / assertion   (new in Phase B)
MON    = '#64748b'   # monitoring, dashed
MUTED  = '#5b6b7f'
LINE   = '#d8dfe8'

out = []
def add(s): out.append(s)

def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def text(x, y, s, size=13, fill=NAVY, weight='400', anchor='start', ls='0'):
    add(f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" font-weight="{weight}" '
        f'text-anchor="{anchor}" letter-spacing="{ls}">{esc(s)}</text>')

def card(x, y, w, h, stroke, fill='#ffffff', rx=12, sw=1.6):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" '
        f'stroke="{stroke}" stroke-width="{sw}"/>')

def tile(x, y, size, fill):
    add(f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="9" fill="{fill}"/>')

def path(d, stroke, dash=None, marker='arrow', sw=2.2):
    dd = f' stroke-dasharray="{dash}"' if dash else ''
    mk = f' marker-end="url(#{marker})"' if marker else ''
    add(f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{sw}" '
        f'stroke-linecap="round" stroke-linejoin="round"{dd}{mk}/>')

# --- icons (simple geometry, in the spirit of the original) ----------------
def icon_person(cx, cy, c):
    add(f'<circle cx="{cx}" cy="{cy-5}" r="5.5" fill="{c}"/>')
    add(f'<path d="M {cx-9} {cy+9} a 9 9 0 0 1 18 0 z" fill="{c}"/>')

def icon_shield(cx, cy, c):
    add(f'<path d="M {cx} {cy-11} l 10 4 v 7 c 0 6 -4 10 -10 12 c -6 -2 -10 -6 -10 -12 '
        f'v -7 z" fill="{c}"/>')
    add(f'<path d="M {cx-4} {cy} l 3 3 l 6 -6" fill="none" stroke="#fff" stroke-width="2" '
        f'stroke-linecap="round" stroke-linejoin="round"/>')

def icon_gear(cx, cy, c, r=8):
    add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{c}" stroke-width="3.4"/>')
    for i in range(8):
        import math
        a = i * math.pi / 4
        x1, y1 = cx + math.cos(a) * (r + 1.5), cy + math.sin(a) * (r + 1.5)
        x2, y2 = cx + math.cos(a) * (r + 5), cy + math.sin(a) * (r + 5)
        add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{c}" '
            f'stroke-width="3" stroke-linecap="round"/>')

def icon_browser(cx, cy, c):
    add(f'<rect x="{cx-11}" y="{cy-9}" width="22" height="18" rx="3" fill="none" '
        f'stroke="{c}" stroke-width="2.4"/>')
    add(f'<line x1="{cx-11}" y1="{cy-3}" x2="{cx+11}" y2="{cy-3}" stroke="{c}" stroke-width="2.4"/>')
    for dx in (-7, -3.5, 0):
        add(f'<circle cx="{cx+dx}" cy="{cy-6}" r="1.2" fill="{c}"/>')

def icon_layers(cx, cy, c):
    for dy, op in ((6, 1), (0, .72), (-6, .45)):
        add(f'<path d="M {cx} {cy+dy-5} l 11 5 l -11 5 l -11 -5 z" fill="{c}" opacity="{op}"/>')

def icon_file(cx, cy, c):
    add(f'<path d="M {cx-9} {cy-12} h 12 l 7 7 v 17 a 2 2 0 0 1 -2 2 h -17 a 2 2 0 0 1 -2 -2 '
        f'v -22 a 2 2 0 0 1 2 -2 z" fill="none" stroke="{c}" stroke-width="2.2"/>')
    add(f'<path d="M {cx+3} {cy-12} v 7 h 7" fill="none" stroke="{c}" stroke-width="2.2"/>')
    for i in range(3):
        add(f'<line x1="{cx-5}" y1="{cy+1+i*5}" x2="{cx+6}" y2="{cy+1+i*5}" stroke="{c}" '
            f'stroke-width="1.8" stroke-linecap="round"/>')

def icon_db(cx, cy, c):
    add(f'<ellipse cx="{cx}" cy="{cy-7}" rx="11" ry="4" fill="{c}"/>')
    add(f'<path d="M {cx-11} {cy-7} v 13 a 11 4 0 0 0 22 0 v -13" fill="{c}"/>')
    add(f'<ellipse cx="{cx}" cy="{cy+6}" rx="11" ry="4" fill="{c}" opacity=".55"/>')

def icon_idcard(cx, cy, c):
    add(f'<rect x="{cx-12}" y="{cy-9}" width="24" height="18" rx="3" fill="none" '
        f'stroke="{c}" stroke-width="2.2"/>')
    add(f'<circle cx="{cx-5}" cy="{cy-2}" r="3.2" fill="{c}"/>')
    add(f'<path d="M {cx-10} {cy+6} a 5 5 0 0 1 10 0" fill="{c}"/>')
    for i, wd in enumerate((9, 7, 5)):
        add(f'<line x1="{cx+2}" y1="{cy-4+i*4}" x2="{cx+2+wd}" y2="{cy-4+i*4}" stroke="{c}" '
            f'stroke-width="1.8" stroke-linecap="round"/>')

def icon_rupee(cx, cy, c):
    add(f'<text x="{cx}" y="{cy+8}" font-size="24" fill="{c}" font-weight="600" '
        f'text-anchor="middle">₹</text>')

def icon_cap(cx, cy, c):
    add(f'<path d="M {cx} {cy-8} l 14 6 l -14 6 l -14 -6 z" fill="{c}"/>')
    add(f'<path d="M {cx-8} {cy+1} v 6 a 8 5 0 0 0 16 0 v -6" fill="none" stroke="{c}" '
        f'stroke-width="2.2"/>')

def icon_key(cx, cy, c):
    add(f'<circle cx="{cx-5}" cy="{cy}" r="6" fill="none" stroke="{c}" stroke-width="2.6"/>')
    add(f'<line x1="{cx+1}" y1="{cy}" x2="{cx+12}" y2="{cy}" stroke="{c}" stroke-width="2.6" '
        f'stroke-linecap="round"/>')
    add(f'<line x1="{cx+9}" y1="{cy}" x2="{cx+9}" y2="{cy+5}" stroke="{c}" stroke-width="2.6" '
        f'stroke-linecap="round"/>')

# --- document ---------------------------------------------------------------
add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
    f'font-family="Inter, -apple-system, Segoe UI, Roboto, system-ui, sans-serif">')
add('<defs>')
for name, col in (('arrow', READ), ('arrowW', WRITE), ('arrowM', MON), ('arrowS', SSO)):
    add(f'<marker id="{name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
        f'markerHeight="6" orient="auto-start-reverse">'
        f'<path d="M 0 0 L 10 5 L 0 10 z" fill="{col}"/></marker>')
add('</defs>')

add(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')
add(f'<rect x="8" y="8" width="{W-16}" height="{H-16}" rx="18" fill="#ffffff" '
    f'stroke="{NAVY}" stroke-width="2.5"/>')

# ---------- actors ----------------------------------------------------------
actors = [
    (30,  '#0d9488', '#f0fdfa', 'MeriPehchaan',   'Identity provider', 'key'),
    (185, '#16a34a', '#f0fdf4', 'Citizen',         'Apply · track',   'person'),
    (340, '#1d4ed8', '#eff6ff', 'Review Officer',  'Review · decide', 'shield'),
    (495, '#7c3aed', '#faf5ff', 'Administrator',   'Monitor · configure', 'gearp'),
]
for x, col, bg, title, sub, ic in actors:
    card(x, 48, 145, 58, col, bg, 10, 1.5)
    tile(x + 10, 62, 30, '#ffffff')
    cx, cy = x + 25, 77
    if ic == 'person': icon_person(cx, cy, col)
    elif ic == 'shield': icon_shield(cx, cy, col)
    elif ic == 'key': icon_key(cx, cy, col)
    else: icon_gear(cx, cy, col, 5.5)
    text(x + 47, 73, title, 11.5, col, '700')
    text(x + 47, 88, sub, 9, MUTED)

# ---------- panels ----------------------------------------------------------
add('<rect x="30" y="128" width="610" height="662" rx="14" fill="#fbfdff" '
    'stroke="#2b5ea8" stroke-width="1.8"/>')
add('<rect x="740" y="128" width="430" height="662" rx="14" fill="#f7fdfb" '
    'stroke="#0f766e" stroke-width="1.8"/>')

def chip(x, y, w, label, fill):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="26" rx="7" fill="{fill}"/>')
    text(x + w / 2, y + 18, label, 9.5, '#ffffff', '700', 'middle', '.3')

chip(44, 138, 172, 'GOVFLOW PLATFORM', '#16305c')
chip(756, 138, 274, 'DEPARTMENTAL SYSTEMS (SIMULATED)', '#0f766e')

# ---------- platform stack --------------------------------------------------
BX, BW = 150, 420
stack = [
    (180, '#2563eb', '#eff6ff', 'Next.js User Interface', 'Citizen · Officer · Admin consoles', 'browser'),
    (296, '#0d9488', '#f0fdfa', 'Express API Gateway',    'Auth · RBAC · consent · pre-fill', 'gear'),
    (412, '#8b5cf6', '#f5f3ff', 'Redis Queue',            'BullMQ job queue', 'layers'),
    (528, '#f59e0b', '#fffbeb', 'BullMQ Worker',          'Workflow orchestration · retries', 'gear'),
]
for y, col, bg, title, sub, ic in stack:
    card(BX, y, BW, 88, col, bg, 11)
    tile(BX + 14, y + 22, 44, '#ffffff')
    cx, cy = BX + 36, y + 44
    if ic == 'browser': icon_browser(cx, cy, col)
    elif ic == 'layers': icon_layers(cx, cy, col)
    else: icon_gear(cx, cy, col, 7.5)
    text(BX + 72, y + 40, title, 14, NAVY, '700')
    text(BX + 72, y + 59, sub, 10.5, MUTED)

card(BX, 644, BW, 100, '#2563eb', '#eff6ff', 11)
tile(BX + 14, 666, 44, '#ffffff')
icon_db(BX + 36, 688, '#2563eb')
text(BX + 72, 680, 'PostgreSQL', 14, NAVY, '700')
text(BX + 72, 699, 'Workflow · audit · common data model', 10.5, MUTED)
text(BX + 72, 716, 'Crosswalk · pre-fill snapshots · receipts', 10.5, '#047857', '600')

# ---------- departmental systems -------------------------------------------
GX, GW = 756, 398
depts = [
    (180, 'Identity Registry',         'REST · API-key header',  'Citizen identity records', 'Read only',                  'idcard', '#0ea5e9'),
    (334, 'Income Department',         'REST · Bearer token',    'Income assessments',       'Read + receives decisions',  'rupee',  '#0d9488'),
    (488, 'Education Department',      'REST · HTTP Basic auth', 'Enrolment records',        'Read + receives decisions',  'cap',    '#2563eb'),
    (642, 'Legacy Beneficiary System', 'CSV export · no API',    'Beneficiary register',     'Read only — no inbox',  'file',   '#64748b'),
]
for y, title, proto, what, mode, ic, col in depts:
    card(GX, y, GW, 134, '#b7dfd8', '#ffffff', 11, 1.5)
    tile(GX + 16, y + 20, 42, '#f1f8f7')
    cx, cy = GX + 37, y + 41
    if ic == 'idcard': icon_idcard(cx, cy, col)
    elif ic == 'rupee': icon_rupee(cx, cy, col)
    elif ic == 'cap': icon_cap(cx, cy, col)
    else: icon_file(cx, cy, col)
    text(GX + 70, y + 38, title, 13.5, NAVY, '700')
    text(GX + 70, y + 56, proto, 10.5, MUTED)
    text(GX + 16, y + 88, what, 10.5, MUTED)
    badge = WRITE if 'receives' in mode else MUTED
    bg = '#ecfdf5' if 'receives' in mode else '#f1f5f9'
    bw = 7.4 * len(mode) + 18
    add(f'<rect x="{GX+16}" y="{y+98}" width="{bw}" height="21" rx="10.5" fill="{bg}"/>')
    text(GX + 16 + bw / 2, y + 112, mode, 10, badge, '600', 'middle')

# ---------- arrows ----------------------------------------------------------
path('M 257 48 L 257 30 L 102 30 L 102 48', SSO, marker='arrowS', sw=1.9)
text(180, 22, 'signs in — no password reaches GovFlow', 9.5, SSO, '600', 'middle')

path('M 102 106 L 102 116 L 18 116 L 18 340 L 146 340', SSO, marker='arrowS', sw=1.9)
text(34, 250, 'identity assertion:', 10, SSO, '700')
text(34, 263, 'who they are +', 10, SSO)
text(34, 276, 'department ids', 10, SSO)

path('M 257 106 L 257 178', NAVY, sw=1.9)
path('M 412 106 L 412 178', NAVY, sw=1.9)
path('M 567 106 L 567 178', NAVY, sw=1.9)

path('M 360 268 L 360 294', NAVY, sw=1.9); text(370, 286, 'REST / JSON', 9.5, MUTED)
path('M 360 384 L 360 410', NAVY, sw=1.9); text(370, 402, 'enqueue', 9.5, MUTED)
path('M 360 500 L 360 526', NAVY, sw=1.9); text(370, 518, 'dequeue', 9.5, MUTED)
path('M 360 616 L 360 642', NAVY, sw=1.9)
path('M 150 694 L 112 694 L 112 364 L 146 364', NAVY, sw=1.6)

path('M 570 318 L 600 318 L 600 228 L 736 228', MON, dash='6 5', marker='arrowM', sw=1.9)
text(612, 218, 'health · failure sim', 9.5, MON, '600')

path('M 570 354 L 636 354 L 636 266 L 736 266', READ, marker='arrow', sw=1.9)
text(648, 246, 'PRE-FILL', 10, READ, '700')
text(648, 258, 'not queued', 9.5, MUTED)

path('M 570 540 L 676 540 L 676 401 L 754 401', WRITE, marker='arrowW', sw=1.9)
path('M 676 510 L 754 510', WRITE, marker='arrowW', sw=1.9)
text(578, 382, 'DECISIONS BACK', 10, WRITE, '700')
text(578, 394, 'their reference rules', 9.5, MUTED)

path('M 570 590 L 736 590', READ, marker='arrow', sw=1.9)
text(580, 610, '4 connectors — reads', 10, READ, '700')
text(580, 623, 'REST × 3 + CSV → one model', 9.5, MUTED)

add('</svg>')
import os
here = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(here, 'architecture-overview.svg'), 'w').write('\n'.join(out))
print('svg written')
