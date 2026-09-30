# Builds the GovFlow architecture diagram as SVG, matching the existing
# hand-designed theme: rounded cards, tinted icon tiles, two bordered panels.
W, H = 1700, 1180

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
add(f'<rect x="10" y="10" width="{W-20}" height="{H-20}" rx="22" fill="#ffffff" '
    f'stroke="{NAVY}" stroke-width="3"/>')

# ---------- top row ---------------------------------------------------------
TOP_Y, TOP_H = 68, 90
actors = [
    (52,  200, '#0d9488', '#f0fdfa', 'MeriPehchaan',    'Identity provider', 'key'),
    (266, 200, '#16a34a', '#f0fdf4', 'Citizen',          'Apply · track',  'person'),
    (480, 200, '#1d4ed8', '#eff6ff', 'Review Officer',   'Review · decide',               'shield'),
    (694, 200, '#7c3aed', '#faf5ff', 'Administrator',    'Monitor · configure',           'gearp'),
]
for x, w, col, bg, title, sub, ic in actors:
    card(x, TOP_Y, w, TOP_H, col, bg)
    tile(x + 16, TOP_Y + 22, 46, '#ffffff')
    cx, cy = x + 39, TOP_Y + 45
    if ic == 'person': icon_person(cx, cy, col)
    elif ic == 'shield': icon_shield(cx, cy, col)
    elif ic == 'key': icon_key(cx, cy, col)
    else: icon_gear(cx, cy, col, 7)
    text(x + 76, TOP_Y + 40, title, 16, col, '700')
    text(x + 76, TOP_Y + 62, sub, 11.5, MUTED)

# ---------- panels ----------------------------------------------------------
PL_X, PL_W = 40, 860           # platform   40 .. 900
GV_X, GV_W = 1160, 490         # government 1160 .. 1650
PAN_Y, PAN_H = 206, 770

add(f'<rect x="{PL_X}" y="{PAN_Y}" width="{PL_W}" height="{PAN_H}" rx="16" fill="#fbfdff" '
    f'stroke="#2b5ea8" stroke-width="2"/>')
add(f'<rect x="{GV_X}" y="{PAN_Y}" width="{GV_W}" height="{PAN_H}" rx="16" fill="#f7fdfb" '
    f'stroke="#0f766e" stroke-width="2"/>')

def chip(x, y, w, label, fill):
    add(f'<rect x="{x}" y="{y}" width="{w}" height="34" rx="8" fill="{fill}"/>')
    text(x + w / 2, y + 23, label, 13.5, '#ffffff', '700', 'middle', '.6')

chip(64, 192, 250, 'GOVFLOW PLATFORM', '#16305c')
chip(1184, 192, 330, 'DEPARTMENTAL SYSTEMS (SIMULATED)', '#0f766e')

# ---------- platform stack --------------------------------------------------
BX, BW = 260, 420
stack = [
    (246, '#2563eb', '#eff6ff', 'Next.js User Interface', 'Citizen · Officer · Admin consoles', 'browser'),
    (394, '#0d9488', '#f0fdfa', 'Express API Gateway',    'Auth · RBAC · consent · pre-fill', 'gear'),
    (542, '#8b5cf6', '#f5f3ff', 'Redis Queue',            'BullMQ job queue', 'layers'),
    (690, '#f59e0b', '#fffbeb', 'BullMQ Worker',          'Workflow orchestration · retries', 'gear'),
]
for y, col, bg, title, sub, ic in stack:
    card(BX, y, BW, 96, col, bg)
    tile(BX + 18, y + 24, 48, '#ffffff')
    cx, cy = BX + 42, y + 48
    if ic == 'browser': icon_browser(cx, cy, col)
    elif ic == 'layers': icon_layers(cx, cy, col)
    else: icon_gear(cx, cy, col, 8)
    text(BX + 82, y + 44, title, 16.5, NAVY, '700')
    text(BX + 82, y + 66, sub, 12, MUTED)

# Postgres carries an extra line: what the new phases persist.
card(BX, 838, BW, 106, '#2563eb', '#eff6ff')
tile(BX + 18, 862, 48, '#ffffff')
icon_db(BX + 42, 886, '#2563eb')
text(BX + 82, 876, 'PostgreSQL', 16.5, NAVY, '700')
text(BX + 82, 897, 'Workflow · audit · common data model', 12, MUTED)
text(BX + 82, 915, 'Identifier crosswalk · pre-fill snapshots · receipts', 12, '#047857', '600')

# ---------- departmental systems -------------------------------------------
GX, GW = 1184, 442
depts = [
    (246, 'Identity Registry',        'REST · API-key header',  'Citizen identity records',  'Read only',              'idcard',  '#0ea5e9'),
    (418, 'Income Department',        'REST · Bearer token',    'Income assessments',        'Read + receives decisions', 'rupee', '#0d9488'),
    (590, 'Education Department',     'REST · HTTP Basic auth', 'Enrolment records',         'Read + receives decisions', 'cap',   '#2563eb'),
    (762, 'Legacy Beneficiary System','CSV export · no API',    'Beneficiary register',      'Read only — no inbox', 'db',    '#64748b'),
]
for y, title, proto, what, mode, ic, col in depts:
    card(GX, y, GW, 150, '#b7dfd8', '#ffffff', 12, 1.6)
    tile(GX + 20, y + 26, 52, '#f1f8f7')
    cx, cy = GX + 46, y + 52
    if ic == 'idcard': icon_idcard(cx, cy, col)
    elif ic == 'rupee': icon_rupee(cx, cy, col)
    elif ic == 'cap': icon_cap(cx, cy, col)
    else: icon_file(cx, cy, col)
    text(GX + 88, y + 46, title, 16, NAVY, '700')
    text(GX + 88, y + 68, proto, 12, MUTED)
    text(GX + 20, y + 100, what, 12.5, MUTED)
    badge = WRITE if 'receives' in mode else MUTED
    bg = '#ecfdf5' if 'receives' in mode else '#f1f5f9'
    bw = 9 * len(mode) + 22
    add(f'<rect x="{GX+20}" y="{y+112}" width="{bw}" height="24" rx="12" fill="{bg}"/>')
    text(GX + 20 + bw / 2, y + 128, mode, 11.5, badge, '600', 'middle')

# ---------- arrows ----------------------------------------------------------
# identity: citizen authenticates at the provider, provider asserts to GovFlow
path('M 366 68 L 366 44 L 152 44 L 152 68', SSO, marker='arrowS')
text(259, 36, 'signs in — GovFlow never sees a password', 12, SSO, '600', 'middle')
path('M 152 158 L 152 180 L 26 180 L 26 442 L 256 442', SSO, marker='arrowS')
text(44, 300, 'identity assertion:', 11.5, SSO, '700')
text(44, 316, 'who they are, and', 11.5, SSO)
text(44, 332, 'their identifier at', 11.5, SSO)
text(44, 348, 'each department', 11.5, SSO)

# actors into the UI
path('M 366 158 L 366 244', NAVY)
path('M 580 158 L 580 244', NAVY)
path('M 794 158 L 794 186 L 640 186 L 640 244', NAVY)

# internal flow
path('M 470 342 L 470 392', NAVY); text(482, 372, 'REST / JSON', 11.5, MUTED)
path('M 470 490 L 470 540', NAVY); text(482, 520, 'enqueue', 11.5, MUTED)
path('M 470 638 L 470 688', NAVY); text(482, 668, 'dequeue', 11.5, MUTED)
path('M 470 786 L 470 836', NAVY)
# worker + API both persist
path('M 260 891 L 206 891 L 206 476 L 256 476', NAVY, sw=1.8)

# monitoring (dashed)
path('M 680 406 L 760 406 L 760 286 L 1156 286', MON, dash='7 6', marker='arrowM')
text(772, 268, 'health checks · failure simulation', 12, MON, '600')

# pre-fill: synchronous, straight from the API - NOT through the queue
path('M 680 446 L 848 446 L 848 348 L 1156 348', READ, marker='arrow')
text(860, 316, 'PRE-FILL — synchronous read', 12, READ, '700')
text(860, 332, 'not queued: the citizen is waiting', 11.5, MUTED)

# verification reads, via the worker
path('M 680 740 L 1156 740', READ, marker='arrow')
text(692, 710, 'four connectors — verification reads', 12, READ, '700')
text(692, 726, 'REST × 3 + CSV → one common data model', 11.5, MUTED)

# write-back, only to the two departments that own outcomes
path('M 680 700 L 964 700 L 964 493 L 1180 493', WRITE, marker='arrowW')
path('M 964 665 L 1180 665', WRITE, marker='arrowW')
text(976, 462, 'DECISIONS WRITTEN BACK', 12, WRITE, '700')
text(976, 478, 'their reference is authoritative', 11.5, MUTED)

# ---------- legend ----------------------------------------------------------
LY = 1000
add(f'<rect x="40" y="{LY}" width="1610" height="72" rx="12" fill="#f8fafc" stroke="{LINE}"/>')
items = [
    (66,  READ,  None,    'Read — GovFlow asks a department for data'),
    (560, WRITE, None,    'Write — the decision is handed back'),
    (1000, MON,  '7 6',   'Monitoring — health checks, failure simulation'),
    (1400, SSO,  None,    'Identity assertion'),
]
for x, col, dash, label in items:
    path(f'M {x} {LY+28} L {x+38} {LY+28}', col, dash=dash,
         marker={READ: 'arrow', WRITE: 'arrowW', MON: 'arrowM', SSO: 'arrowS'}[col], sw=2.4)
    text(x + 48, LY + 33, label, 12.5, NAVY)
text(66, LY + 58,
     'Every department above is SIMULATED and holds synthetic data only. No real government '
     'system is connected and no real citizen data appears anywhere.',
     12, '#b45309', '600')

# ---------- footer ----------------------------------------------------------
text(W / 2, 1122,
     'GovFlow — Government Interoperability & Workflow Orchestration Platform',
     15, NAVY, '700', 'middle')
text(W / 2, 1144,
     'Connects departments · pre-fills the form · coordinates the workflow · hands the '
     'decision back. It never becomes the record.',
     12, MUTED, '400', 'middle')

add('</svg>')
import os
here = os.path.dirname(os.path.abspath(__file__))
open(os.path.join(here, 'architecture-overview.svg'), 'w').write('\n'.join(out))
print('svg written')
