# Builds the GovFlow architecture diagram as SVG, matching the existing
# hand-designed theme: rounded cards, tinted icon tiles, two bordered panels.
W, H = 1700, 860

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
    add(f'<marker id="{name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" '
        f'markerHeight="6.5" orient="auto-start-reverse">'
        f'<path d="M 0 0 L 10 5 L 0 10 z" fill="{col}"/></marker>')
add('</defs>')

add(f'<rect width="{W}" height="{H}" fill="#ffffff"/>')
add(f'<rect x="10" y="10" width="{W-20}" height="{H-20}" rx="20" fill="#ffffff" '
    f'stroke="{NAVY}" stroke-width="3"/>')

# ---------- top row ---------------------------------------------------------
TOP_Y, TOP_H = 56, 80
actors = [
    (52,  200, '#0d9488', '#f0fdfa', 'MeriPehchaan',  'Identity provider',  'key'),
    (266, 200, '#16a34a', '#f0fdf4', 'Citizen',        'Apply \u00b7 track',   'person'),
    (480, 200, '#1d4ed8', '#eff6ff', 'Review Officer', 'Review \u00b7 decide', 'shield'),
    (694, 200, '#7c3aed', '#faf5ff', 'Administrator',  'Monitor \u00b7 configure', 'gearp'),
]
for x, w, col, bg, title, sub, ic in actors:
    card(x, TOP_Y, w, TOP_H, col, bg)
    tile(x + 14, TOP_Y + 18, 44, '#ffffff')
    cx, cy = x + 36, TOP_Y + 40
    if ic == 'person': icon_person(cx, cy, col)
    elif ic == 'shield': icon_shield(cx, cy, col)
    elif ic == 'key': icon_key(cx, cy, col)
    else: icon_gear(cx, cy, col, 7)
    text(x + 70, TOP_Y + 36, title, 15.5, col, '700')
    text(x + 70, TOP_Y + 57, sub, 11.5, MUTED)

# ---------- panels ----------------------------------------------------------
PAN_Y, PAN_H = 170, 650
add(f'<rect x="40" y="{PAN_Y}" width="860" height="{PAN_H}" rx="16" fill="#fbfdff" '
    f'stroke="#2b5ea8" stroke-width="2"/>')
add(f'<rect x="1160" y="{PAN_Y}" width="490" height="{PAN_H}" rx="16" fill="#f7fdfb" '
    f'stroke="#0f766e" stroke-width="2"/>')

def chip(x, y, w, label, fill):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="30" rx="8" fill="{fill}"/>')
    text(x + w / 2, y + 20, label, 12.5, '#ffffff', '700', 'middle', '.5')

chip(64, 156, 232, 'GOVFLOW PLATFORM', '#16305c')
chip(1184, 156, 316, 'DEPARTMENTAL SYSTEMS (SIMULATED)', '#0f766e')

# ---------- platform stack --------------------------------------------------
BX, BW = 260, 420
stack = [
    (202, '#2563eb', '#eff6ff', 'Next.js User Interface', 'Citizen \u00b7 Officer \u00b7 Admin consoles', 'browser'),
    (324, '#0d9488', '#f0fdfa', 'Express API Gateway',    'Auth \u00b7 RBAC \u00b7 consent \u00b7 pre-fill', 'gear'),
    (446, '#8b5cf6', '#f5f3ff', 'Redis Queue',            'BullMQ job queue', 'layers'),
    (568, '#f59e0b', '#fffbeb', 'BullMQ Worker',          'Workflow orchestration \u00b7 retries', 'gear'),
]
for y, col, bg, title, sub, ic in stack:
    card(BX, y, BW, 92, col, bg)
    tile(BX + 16, y + 22, 46, '#ffffff')
    cx, cy = BX + 39, y + 45
    if ic == 'browser': icon_browser(cx, cy, col)
    elif ic == 'layers': icon_layers(cx, cy, col)
    else: icon_gear(cx, cy, col, 8)
    text(BX + 78, y + 41, title, 16, NAVY, '700')
    text(BX + 78, y + 62, sub, 11.5, MUTED)

card(BX, 690, BW, 102, '#2563eb', '#eff6ff')
tile(BX + 16, 712, 46, '#ffffff')
icon_db(BX + 39, 735, '#2563eb')
text(BX + 78, 726, 'PostgreSQL', 16, NAVY, '700')
text(BX + 78, 746, 'Workflow \u00b7 audit \u00b7 common data model', 11.5, MUTED)
text(BX + 78, 764, 'Identifier crosswalk \u00b7 pre-fill snapshots \u00b7 receipts', 11.5, '#047857', '600')

# ---------- departmental systems -------------------------------------------
GX, GW = 1184, 442
depts = [
    (202, 'Identity Registry',         'REST \u00b7 API-key header',  'Citizen identity records', 'Read only',                 'idcard', '#0ea5e9'),
    (358, 'Income Department',         'REST \u00b7 Bearer token',    'Income assessments',       'Read + receives decisions', 'rupee',  '#0d9488'),
    (514, 'Education Department',      'REST \u00b7 HTTP Basic auth', 'Enrolment records',        'Read + receives decisions', 'cap',    '#2563eb'),
    (670, 'Legacy Beneficiary System', 'CSV export \u00b7 no API',    'Beneficiary register',     'Read only \u2014 no inbox', 'file',   '#64748b'),
]
for y, title, proto, what, mode, ic, col in depts:
    card(GX, y, GW, 138, '#b7dfd8', '#ffffff', 12, 1.6)
    tile(GX + 18, y + 22, 48, '#f1f8f7')
    cx, cy = GX + 42, y + 46
    if ic == 'idcard': icon_idcard(cx, cy, col)
    elif ic == 'rupee': icon_rupee(cx, cy, col)
    elif ic == 'cap': icon_cap(cx, cy, col)
    else: icon_file(cx, cy, col)
    text(GX + 82, y + 42, title, 15.5, NAVY, '700')
    text(GX + 82, y + 62, proto, 11.5, MUTED)
    text(GX + 18, y + 92, what, 12, MUTED)
    badge = WRITE if 'receives' in mode else MUTED
    bg = '#ecfdf5' if 'receives' in mode else '#f1f5f9'
    bw = 8.6 * len(mode) + 20
    add(f'<rect x="{GX+18}" y="{y+102}" width="{bw}" height="23" rx="11.5" fill="{bg}"/>')
    text(GX + 18 + bw / 2, y + 118, mode, 11, badge, '600', 'middle')

# ---------- arrows ----------------------------------------------------------
path('M 366 56 L 366 34 L 152 34 L 152 56', SSO, marker='arrowS')
text(259, 26, 'signs in \u2014 GovFlow never sees a password', 11.5, SSO, '600', 'middle')

path('M 152 136 L 152 146 L 26 146 L 26 370 L 256 370', SSO, marker='arrowS')
text(44, 250, 'identity assertion:', 11.5, SSO, '700')
text(44, 265, 'who they are, and', 11.5, SSO)
text(44, 280, 'their identifier at', 11.5, SSO)
text(44, 295, 'each department', 11.5, SSO)

path('M 366 136 L 366 200', NAVY)
path('M 580 136 L 580 200', NAVY)
path('M 794 136 L 794 158 L 640 158 L 640 200', NAVY)

path('M 470 294 L 470 322', NAVY); text(482, 313, 'REST / JSON', 11, MUTED)
path('M 470 416 L 470 444', NAVY); text(482, 435, 'enqueue', 11, MUTED)
path('M 470 538 L 470 566', NAVY); text(482, 557, 'dequeue', 11, MUTED)
path('M 470 660 L 470 688', NAVY)
path('M 260 741 L 206 741 L 206 394 L 256 394', NAVY, sw=1.8)

path('M 680 348 L 740 348 L 740 256 L 1156 256', MON, dash='7 6', marker='arrowM')
text(752, 244, 'health checks \u00b7 failure simulation', 11.5, MON, '600')

path('M 680 388 L 804 388 L 804 306 L 1156 306', READ, marker='arrow')
text(816, 280, 'PRE-FILL \u2014 synchronous read', 11.5, READ, '700')
text(816, 295, 'not queued: the citizen is waiting', 11, MUTED)

path('M 680 596 L 900 596 L 900 427 L 1180 427', WRITE, marker='arrowW')
path('M 900 583 L 1180 583', WRITE, marker='arrowW')
text(912, 402, 'DECISIONS WRITTEN BACK', 11.5, WRITE, '700')
text(912, 417, 'their reference is authoritative', 11, MUTED)

path('M 680 630 L 1156 630', READ, marker='arrow')
text(692, 652, 'four connectors \u2014 verification reads', 11.5, READ, '700')
text(692, 667, 'REST \u00d7 3 + CSV \u2192 one common data model', 11, MUTED)

add('</svg>')
import os
here = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(here, 'architecture-overview.svg'), 'w').write('\n'.join(out))
print('svg written')
