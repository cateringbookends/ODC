"""
ODC Executive One-Page Report — strict A4 PDF
Uses reportlab canvas for pixel-perfect layout.
"""
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import (
    HexColor, white, black
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os

W, H = A4   # 595.28 x 841.89 pts

# ── Palette ──────────────────────────────────────────────────────
C_SLATE_900  = HexColor('#0f172a')
C_SLATE_800  = HexColor('#1e293b')
C_SLATE_700  = HexColor('#334155')
C_SLATE_500  = HexColor('#64748b')
C_SLATE_300  = HexColor('#cbd5e1')
C_SLATE_100  = HexColor('#f1f5f9')
C_SLATE_50   = HexColor('#f8fafc')
C_WHITE      = white
C_EMERALD    = HexColor('#059669')
C_EMERALD_D  = HexColor('#047857')
C_EMERALD_L  = HexColor('#d1fae5')
C_EMERALD_S  = HexColor('#ecfdf5')
C_GREEN_BDR  = HexColor('#a7f3d0')
C_GOLD       = HexColor('#d97706')
C_GOLD_SOFT  = HexColor('#fef3c7')
C_GOLD_BDR   = HexColor('#fde68a')
C_BLUE       = HexColor('#0369a1')
C_BLUE_SOFT  = HexColor('#e0f2fe')
C_BLUE_BDR   = HexColor('#bae6fd')
C_PURPLE     = HexColor('#7c3aed')
C_PURPLE_S   = HexColor('#ede9fe')
C_PURPLE_BDR = HexColor('#ddd6fe')
C_RED_SOFT   = HexColor('#fef2f2')


def rounded_rect(c, x, y, w, h, r=6, fill=None, stroke=None, stroke_width=0.5):
    """Draw a rounded rectangle (fill and/or stroke)."""
    if fill:
        c.setFillColor(fill)
    if stroke:
        c.setStrokeColor(stroke)
        c.setLineWidth(stroke_width)
    else:
        c.setStrokeColor(HexColor('#00000000'))
        c.setLineWidth(0)

    path = c.beginPath()
    path.moveTo(x + r, y)
    path.lineTo(x + w - r, y)
    path.curveTo(x + w - r, y, x + w, y, x + w, y + r)
    path.lineTo(x + w, y + h - r)
    path.curveTo(x + w, y + h - r, x + w, y + h, x + w - r, y + h)
    path.lineTo(x + r, y + h)
    path.curveTo(x + r, y + h, x, y + h, x, y + h - r)
    path.lineTo(x, y + r)
    path.curveTo(x, y + r, x, y, x + r, y)
    path.close()

    if fill and stroke:
        c.drawPath(path, fill=1, stroke=1)
    elif fill:
        c.drawPath(path, fill=1, stroke=0)
    elif stroke:
        c.drawPath(path, fill=0, stroke=1)


def label(c, text, x, y, size=7, color=C_SLATE_500, bold=False, align='left'):
    c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
    c.setFillColor(color)
    if align == 'right':
        c.drawRightString(x, y, text)
    elif align == 'center':
        c.drawCentredString(x, y, text)
    else:
        c.drawString(x, y, text)


def bullet_row(c, text, x, y, dot_color=C_EMERALD, text_color=C_SLATE_700, size=6.5, max_width=230):
    """Draw a dot + wrapped text row, return final y after text."""
    c.setFillColor(dot_color)
    c.circle(x + 2.5, y + 2.5, 2.2, fill=1, stroke=0)
    c.setFont('Helvetica', size)
    c.setFillColor(text_color)
    # simple wrap
    words = text.split()
    lines = []
    line = ''
    for w in words:
        test = (line + ' ' + w).strip()
        if c.stringWidth(test, 'Helvetica', size) <= max_width:
            line = test
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    for i, ln in enumerate(lines):
        c.drawString(x + 8, y + (len(lines)-1-i)*8, ln)
    return y - (len(lines)-1)*8 - 10


def check_row(c, text, x, y, max_width=130):
    size = 6.5
    # green check box
    rounded_rect(c, x, y-1, 10, 10, r=2, fill=C_EMERALD_L)
    c.setFont('Helvetica-Bold', 6)
    c.setFillColor(C_EMERALD_D)
    c.drawCentredString(x+5, y+2, '✓')
    c.setFont('Helvetica', size)
    c.setFillColor(C_SLATE_700)
    words = text.split()
    lines = []
    line = ''
    for w in words:
        test = (line + ' ' + w).strip()
        if c.stringWidth(test, 'Helvetica', size) <= max_width:
            line = test
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    for i, ln in enumerate(lines):
        c.drawString(x+13, y + (len(lines)-1-i)*8, ln)
    return (len(lines)-1)*8


# ═══════════════════════════════════════════════════════════════════
OUT = '/sessions/loving-sweet-wright/mnt/ODC/ODC_Executive_One_Page_Report.pdf'
c = canvas.Canvas(OUT, pagesize=A4)
c.setTitle('ODC Event Dashboard — Executive Report')
c.setAuthor('ODC Internal')

MARGIN = 22
BODY_W = W - 2 * MARGIN   # 551 pts

# ── HEADER BAND ─────────────────────────────────────────────────
HDR_H = 85
c.setFillColor(C_SLATE_900)
c.rect(0, H - HDR_H, W, HDR_H, fill=1, stroke=0)

# Emerald accent strip (bottom of header)
c.setFillColor(C_EMERALD)
c.rect(0, H - HDR_H, W, 2, fill=1, stroke=0)

# Radial green glow (right side decoration)
c.setFillColor(HexColor('#05966918'))
c.ellipse(W-60, H-HDR_H, W+40, H+30, fill=1, stroke=0)

# Brand tag pill
pill_x, pill_y = MARGIN, H - 22
rounded_rect(c, pill_x, pill_y - 9, 130, 12, r=5,
             fill=HexColor('#05966930'), stroke=HexColor('#05966966'), stroke_width=0.4)
c.setFillColor(HexColor('#6ee7b7'))
c.setFont('Helvetica-Bold', 6)
c.drawString(pill_x + 6, pill_y - 5, '●  EXECUTIVE REPORT · CONFIDENTIAL')

# Title
c.setFont('Helvetica-Bold', 22)
c.setFillColor(C_WHITE)
c.drawString(MARGIN, H - 44, 'ODC')
tw = c.stringWidth('ODC', 'Helvetica-Bold', 22)
c.setFillColor(HexColor('#34d399'))
c.drawString(MARGIN + tw + 5, H - 44, 'Event Dashboard')

# Subtitle
c.setFont('Helvetica', 7.5)
c.setFillColor(HexColor('#94a3b8'))
c.drawString(MARGIN, H - 57, 'Centralised event operations & finance platform — sales to settlement, fully in-house.')

# Meta right
c.setFont('Helvetica', 6.5)
c.setFillColor(HexColor('#64748b'))
c.drawRightString(W - MARGIN, H - 24, 'Prepared: June 2026')
c.setFillColor(HexColor('#94a3b8'))
c.drawRightString(W - MARGIN, H - 34, 'aiops@kgirdharlal.com')

# "All Core Modules Live" pill
px2 = W - MARGIN - 110
py2 = H - 58
rounded_rect(c, px2, py2 - 7, 110, 13, r=5,
             fill=HexColor('#05966930'), stroke=HexColor('#05966966'), stroke_width=0.4)
c.setFont('Helvetica-Bold', 6)
c.setFillColor(HexColor('#6ee7b7'))
c.drawCentredString(px2 + 55, py2 - 2, '●  All Core Modules Live')

# ── KPI STRIP ──────────────────────────────────────────────────
KPI_Y = H - HDR_H - 42
KPI_H = 40
kpis = [
    ('🗂', 'MODULES LIVE', '10+',   'Sales → Admin',      C_EMERALD,  C_EMERALD_S),
    ('⏱', 'TIME SAVED/MO',  '60–100','staff hours (50 evts)', HexColor('#3b82f6'), C_BLUE_SOFT),
    ('₹', 'BUILD COST SAVED','₹5–8L', 'vs. external vendor',  C_GOLD,    C_GOLD_SOFT),
    ('🛡', 'AUDIT & ACCESS',  'Full',  'Logs, sessions, IP',   C_PURPLE,  C_PURPLE_S),
]
kpi_w = BODY_W / 4
for i, (icon, lbl_t, val, sub, accent, bg) in enumerate(kpis):
    kx = MARGIN + i * kpi_w
    # background tile
    rounded_rect(c, kx + 1, KPI_Y - KPI_H + 2, kpi_w - 2, KPI_H - 2, r=0, fill=bg)
    # accent bar top
    c.setFillColor(accent)
    c.rect(kx + 1, KPI_Y - 2, kpi_w - 2, 2, fill=1, stroke=0)
    # divider
    if i > 0:
        c.setStrokeColor(C_SLATE_100)
        c.setLineWidth(0.5)
        c.line(kx, KPI_Y, kx, KPI_Y - KPI_H)
    # value
    c.setFont('Helvetica-Bold', 14)
    c.setFillColor(C_SLATE_900)
    c.drawString(kx + 6, KPI_Y - 20, val)
    # label
    c.setFont('Helvetica-Bold', 5.5)
    c.setFillColor(C_SLATE_500)
    c.drawString(kx + 6, KPI_Y - 29, lbl_t)
    # sub
    c.setFont('Helvetica', 5.5)
    c.setFillColor(C_SLATE_500)
    c.drawString(kx + 6, KPI_Y - 38, sub)

# divider line below KPIs
c.setStrokeColor(C_SLATE_100)
c.setLineWidth(0.5)
c.line(MARGIN, KPI_Y - KPI_H, W - MARGIN, KPI_Y - KPI_H)

# ── BODY: two-column grid ──────────────────────────────────────
# Layout plan (y from top, in pts below KPI strip):
#  Row 1: Modules (left wide) + Time Savings (right)
#  Row 2: Business Impact (left) + Cost Avoidance (right)
#  Row 3: Control & Compliance (left) + Next Upgrades (right)
#  Status bar + Footer

BODY_TOP = KPI_Y - KPI_H - 6   # ~692 down from top, 150 remaining...
# Actually let's compute from bottom up for safety
# Footer: 18pt, Status: 24pt, padding: 4pt → bottom baseline = 18+24+4 = 46
FOOTER_Y  = 14
STATUS_Y  = FOOTER_Y + 18
BODY_BOT  = STATUS_Y + 24 + 4   # = 60

BODY_H    = BODY_TOP - BODY_BOT   # available body height

COL_GAP = 6
COL_L_W = BODY_W * 0.52   # left wider
COL_R_W = BODY_W - COL_L_W - COL_GAP

LX = MARGIN
RX = MARGIN + COL_L_W + COL_GAP

# --- helper: card frame ---
def card(cx, cy, cw, ch, title, icon_char, accent=C_EMERALD, bg=C_WHITE, bdr=C_SLATE_100):
    rounded_rect(c, cx, cy - ch, cw, ch, r=5, fill=bg, stroke=bdr, stroke_width=0.6)
    # header band
    rounded_rect(c, cx, cy - 16, cw, 16, r=5, fill=C_SLATE_50)
    c.setFillColor(C_SLATE_100)
    c.rect(cx, cy - 16, cw, 5, fill=1, stroke=0)  # flatten bottom corners
    # icon circle
    rounded_rect(c, cx+5, cy-13, 11, 11, r=3, fill=C_EMERALD_S)
    c.setFont('Helvetica-Bold', 7)
    c.setFillColor(accent)
    c.drawCentredString(cx+10.5, cy-9, icon_char)
    # title
    c.setFont('Helvetica-Bold', 6.5)
    c.setFillColor(C_SLATE_700)
    c.drawString(cx+20, cy-10, title)
    # divider
    c.setStrokeColor(C_SLATE_100)
    c.setLineWidth(0.4)
    c.line(cx, cy-16, cx+cw, cy-16)

# ════════════════════════════════════════════════════════════════
# Compute heights dynamically
# Row heights: we have BODY_H total to fill with 3 rows
ROW1_H = BODY_H * 0.34
ROW2_H = BODY_H * 0.34
ROW3_H = BODY_H * 0.32

R1_TOP = BODY_TOP
R2_TOP = R1_TOP - ROW1_H - 4
R3_TOP = R2_TOP - ROW2_H - 4

# ══ ROW 1: MODULES (left) + TIME SAVINGS (right) ══════════════

# -- MODULES card (left) --
card(LX, R1_TOP, COL_L_W, ROW1_H, 'WHAT THE SYSTEM CENTRALISES', '◈', C_EMERALD, C_WHITE, C_GREEN_BDR)

modules = [
    ('📋', 'Sales Intake',       'Booking, PAX, billing, advance, GST, food & allergy notes'),
    ('📊', 'Pre Cost Planning',  'Food, staff, vendor, decor, equip, misc — projected P&L'),
    ('💵', 'Petty Cash',         'Person-wise payouts, small expenses, remaining balance'),
    ('🧾', 'Bill Submission',    'Receipt upload, category, head/person map, event capture'),
    ('🔍', 'Financial Control',  'Payment received, client balance, actual cost, P&L'),
    ('📈', 'Analytics',          'Revenue, pipeline, food pref, zone & event contribution'),
    ('🔐', 'Admin Controls',     'Users, active sessions, IP/device, audit logs, system status'),
    ('☁️', 'Google Backend',     'Sheets/Drive/Apps Script; Vercel production frontend'),
]

COLS = 2
chip_w = (COL_L_W - 10 - (COLS-1)*4) / COLS
chip_h = (ROW1_H - 20) / (len(modules)//COLS) - 3

my = R1_TOP - 19
for idx, (ico, name, desc) in enumerate(modules):
    col = idx % COLS
    row = idx // COLS
    cx_ = LX + 5 + col * (chip_w + 4)
    cy_ = my - row * (chip_h + 3)
    rounded_rect(c, cx_, cy_ - chip_h, chip_w, chip_h, r=3, fill=C_SLATE_50, stroke=C_SLATE_100, stroke_width=0.4)
    c.setFont('Helvetica', 7)
    c.setFillColor(C_SLATE_700)
    c.drawString(cx_+3, cy_-9, ico + '  ' if len(ico) < 3 else ico)
    c.setFont('Helvetica-Bold', 6)
    c.setFillColor(C_SLATE_700)
    nm_x = cx_ + 3 + (13 if len(ico) > 1 else 11)
    c.drawString(nm_x, cy_-9, name)
    c.setFont('Helvetica', 5.5)
    c.setFillColor(C_SLATE_500)
    # wrap desc
    dwords = desc.split()
    dline = ''
    dlines = []
    for w in dwords:
        t = (dline+' '+w).strip()
        if c.stringWidth(t,'Helvetica',5.5) <= chip_w - 6:
            dline = t
        else:
            dlines.append(dline); dline = w
    if dline: dlines.append(dline)
    for li, dl in enumerate(dlines[:2]):
        c.drawString(cx_+3, cy_-17-li*7, dl)

# -- TIME SAVINGS card (right) --
card(RX, R1_TOP, COL_R_W, ROW1_H, 'ESTIMATED TIME SAVINGS', '⏱', HexColor('#3b82f6'), C_WHITE, C_BLUE_BDR)

savings = [
    ('Event creation & billing',  '10–15 min/evt'),
    ('Pre-cost planning',          '20–30 min/evt'),
    ('Petty cash tracking',        '20–40 min/evt'),
    ('Bill & expense reconcile',   '30–60 min/evt'),
    ('Monthly mgmt reporting',     '1–2 days/mo'),
    ('50 events/month total',      '60–100 hrs/mo'),
]
tw_col1 = COL_R_W * 0.58
sy = R1_TOP - 20
row_h = (ROW1_H - 22) / len(savings)
for i, (task, saved) in enumerate(savings):
    ry = sy - i * row_h
    if i % 2 == 0:
        c.setFillColor(C_SLATE_50)
        c.rect(RX+2, ry - row_h + 1, COL_R_W-4, row_h-1, fill=1, stroke=0)
    c.setFont('Helvetica', 6 if i < 5 else 6.5)
    c.setFillColor(C_SLATE_700 if i < 5 else C_SLATE_900)
    if i == 5:
        c.setFont('Helvetica-Bold', 6.5)
    c.drawString(RX + 5, ry - row_h + 3, task)
    # badge
    bw = c.stringWidth(saved, 'Helvetica-Bold', 5.5) + 8
    bg_col = C_BLUE_SOFT if i < 5 else HexColor('#dbeafe')
    txt_col = HexColor('#1d4ed8') if i == 5 else HexColor('#0369a1')
    rounded_rect(c, RX + COL_R_W - bw - 4, ry - row_h + 2, bw, row_h - 3, r=3,
                 fill=C_EMERALD_L if i < 5 else HexColor('#dbeafe'))
    c.setFont('Helvetica-Bold', 5.5)
    c.setFillColor(C_EMERALD_D if i < 5 else txt_col)
    c.drawCentredString(RX + COL_R_W - bw/2 - 4, ry - row_h + 4, saved)
    # divider
    c.setStrokeColor(C_SLATE_100)
    c.setLineWidth(0.3)
    c.line(RX+2, ry - row_h, RX+COL_R_W-2, ry - row_h)

# ══ ROW 2: BUSINESS IMPACT (left) + COST AVOIDANCE (right) ════

card(LX, R2_TOP, COL_L_W, ROW2_H, 'BUSINESS IMPACT', '🎯', C_BLUE, C_WHITE, C_BLUE_BDR)

impacts = [
    'Single source of truth — sales, advance, petty cash, bills, in-house charges & P&L, all linked per event.',
    'Full accountability: every change logged with user, login, device & IP — reduces disputes.',
    'Event profitability visible before, during & after execution — no waiting for manual reconciliation.',
    'Receipt & bill data is event-linked, eliminating missing bills and delayed settlement.',
    'Admin monitors active sessions and forces logout from the UI — no IT intervention needed.',
]
imp_y = R2_TOP - 19
for imp in impacts:
    imp_y = bullet_row(c, imp, LX+5, imp_y, dot_color=C_BLUE, max_width=COL_L_W-14)

card(RX, R2_TOP, COL_R_W, ROW2_H, 'COST AVOIDANCE', '₹', C_GOLD, C_WHITE, C_GOLD_BDR)

# Two cost boxes
box_h = 34
bx = RX + 4
by = R2_TOP - 20
bw2 = (COL_R_W - 10) / 2
rounded_rect(c, bx, by - box_h, bw2 - 2, box_h, r=4, fill=C_EMERALD_S, stroke=C_GREEN_BDR, stroke_width=0.5)
c.setFont('Helvetica-Bold', 5.5)
c.setFillColor(C_EMERALD_D)
c.drawString(bx+4, by-9, 'MVP BUILD (EXTERNAL)')
c.setFont('Helvetica-Bold', 12)
c.setFillColor(C_EMERALD_D)
c.drawString(bx+4, by-21, u'₹4–5L')
c.setFont('Helvetica', 5.5)
c.setFillColor(C_SLATE_500)
c.drawString(bx+4, by-30, 'Basic feature set')

bx2 = bx + bw2 + 2
rounded_rect(c, bx2, by - box_h, bw2 - 2, box_h, r=4, fill=C_GOLD_SOFT, stroke=C_GOLD_BDR, stroke_width=0.5)
c.setFont('Helvetica-Bold', 5.5)
c.setFillColor(HexColor('#92400e'))
c.drawString(bx2+4, by-9, 'POLISHED PRODUCTION')
c.setFont('Helvetica-Bold', 12)
c.setFillColor(C_GOLD)
c.drawString(bx2+4, by-21, u'₹5–8L')
c.setFont('Helvetica', 5.5)
c.setFillColor(C_SLATE_500)
c.drawString(bx2+4, by-30, 'Full feature + deployment')

# Note box
note_y = by - box_h - 4
note_h = R2_TOP - ROW2_H - note_y - 2
rounded_rect(c, bx, note_y - note_h + 2, COL_R_W - 8, note_h, r=3, fill=C_SLATE_50)
c.setFillColor(C_EMERALD)
c.rect(bx, note_y - note_h + 2, 2.5, note_h, fill=1, stroke=0)
c.setFont('Helvetica', 5.8)
c.setFillColor(C_SLATE_700)
note_lines = [
    'External maintenance: ~₹40K–1L/month for',
    'support, features & integrations. In-house dev',
    'eliminated vendor lock-in & cut iteration cost.',
]
for li, nl in enumerate(note_lines):
    c.drawString(bx+6, note_y - 7 - li*8, nl)

# ══ ROW 3: CONTROL & COMPLIANCE (left) + NEXT UPGRADES (right) ═

card(LX, R3_TOP, COL_L_W, ROW3_H, 'CONTROL & COMPLIANCE', '🛡', C_PURPLE, C_WHITE, C_PURPLE_BDR)

checks = [
    'Every action logged: user, timestamp, device/browser & IP',
    'Active sessions reviewable; force-logout from admin UI',
    'Centralised roles prevent uncontrolled financial record access',
    'KYC validated client + server side (PAN/Aadhaar/GST/mobile)',
    'Strict CSP on all pages — no XSS; no inline handlers',
    'Google Drive/Sheets backend in familiar business ecosystem',
]
comp_gap = 4
half = len(checks)//2
cx_l2 = LX + 5
cx_r2 = LX + COL_L_W//2 + 3
ch_y = R3_TOP - 19
row_step = (ROW3_H - 22) / half

for i, chk in enumerate(checks):
    col = i % 2
    row = i // 2
    cx_ = cx_l2 if col == 0 else cx_r2
    cy_ = ch_y - row * row_step
    extra = check_row(c, chk, cx_, cy_, max_width=(COL_L_W//2 - 18))

card(RX, R3_TOP, COL_R_W, ROW3_H, 'NEXT HIGH-VALUE UPGRADES', '🚀', C_PURPLE, C_WHITE, C_PURPLE_BDR)

upgrades = [
    'Improve mobile & wide-screen layouts for faster daily field use',
    'Stronger validations: negative amounts, duplicates, required fields',
    'Exportable event-wise P&L and settlement reports (PDF/CSV)',
    'Email receipt templates & one-click client payment confirmation',
    'Dashboard filters by date, status, salesperson, food type & dept',
]
up_y = R3_TOP - 20
up_step = (ROW3_H - 24) / len(upgrades)
for i, up in enumerate(upgrades):
    uy = up_y - i * up_step
    # number badge
    rounded_rect(c, RX+4, uy-10, 11, 11, r=3, fill=C_PURPLE_S)
    c.setFont('Helvetica-Bold', 6)
    c.setFillColor(C_PURPLE)
    c.drawCentredString(RX+9.5, uy-5, str(i+1))
    c.setFont('Helvetica', 6)
    c.setFillColor(C_SLATE_700)
    # wrap text
    uwords = up.split()
    uline = ''
    ulines = []
    for w in uwords:
        t = (uline+' '+w).strip()
        if c.stringWidth(t,'Helvetica',6) <= COL_R_W-24:
            uline = t
        else:
            ulines.append(uline); uline = w
    if uline: ulines.append(uline)
    for li, ul in enumerate(ulines[:2]):
        c.drawString(RX+18, uy - 4 - li*7, ul)

# ── STATUS BAR ──────────────────────────────────────────────────
c.setFillColor(C_SLATE_900)
c.rect(0, STATUS_Y, W, 22, fill=1, stroke=0)

statuses = [
    ('Sales Intake & Saved Events', True),
    ('Pre Cost & Petty Cash', True),
    ('Bill Submission', True),
    ('Financial Control', True),
    ('Analytics & Admin', True),
    ('Master Persons', True),
    ('Mobile UI', False),
]
sx = MARGIN
for name, live in statuses:
    dot_col = HexColor('#34d399') if live else HexColor('#fbbf24')
    c.setFillColor(dot_col)
    c.circle(sx + 3, STATUS_Y + 11, 2.5, fill=1, stroke=0)
    c.setFont('Helvetica', 5.5)
    c.setFillColor(HexColor('#94a3b8'))
    tw2 = c.stringWidth(name, 'Helvetica', 5.5)
    c.drawString(sx + 8, STATUS_Y + 8, name)
    sx += tw2 + 20
    if sx > W - 80:
        break

# ── FOOTER ──────────────────────────────────────────────────────
c.setFillColor(C_SLATE_50)
c.rect(0, 0, W, FOOTER_Y + 4, fill=1, stroke=0)
c.setStrokeColor(C_SLATE_100)
c.setLineWidth(0.4)
c.line(0, FOOTER_Y + 4, W, FOOTER_Y + 4)
c.setFont('Helvetica-Bold', 5.5)
c.setFillColor(C_SLATE_700)
c.drawString(MARGIN, FOOTER_Y - 1, 'ODC — Outdoor Catering Division')
c.setFont('Helvetica', 5.5)
c.setFillColor(C_SLATE_500)
c.drawString(MARGIN + 130, FOOTER_Y - 1, '·  Internal Use Only  ·  June 2026')
c.setFont('Helvetica-Bold', 5.5)
c.setFillColor(C_GOLD)
c.drawRightString(W - MARGIN, FOOTER_Y - 1, '⚠ CONFIDENTIAL')

# ── SAVE ────────────────────────────────────────────────────────
c.showPage()
c.save()
print(f"PDF saved: {OUT}")
print(f"Page count: 1")
                                                                                                                          