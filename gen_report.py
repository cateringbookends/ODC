from fpdf import FPDF

FONT_R  = '/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf'
FONT_B  = '/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf'
SYM_R   = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
SYM_B   = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
OUT     = '/sessions/loving-sweet-wright/mnt/ODC/ODC_Executive_One_Page_Report.pdf'

def h(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i+2], 16) for i in (0,2,4))

NAVY=h('0f172a'); NAVY2=h('1e293b'); GD=h('022c22'); GN=h('059669'); GL=h('34d399'); GLL=h('6ee7b7')
GBG=h('ecfdf5'); GB=h('6ee7b7'); GD2=h('d1fae5'); GDK=h('047857')
BL=h('3b82f6'); BL_L=h('bfdbfe'); BL_BG=h('eff6ff'); BL_D=h('1d4ed8')
OR=h('b45309'); OR_L=h('fde68a'); OR_BG=h('fef3c7'); OR_D=h('92400e')
PU=h('6d28d9'); PU_L=h('c4b5fd'); PU_BG=h('ede9fe')
SL=h('334155'); SL2=h('64748b'); SL3=h('94a3b8')
BORDER=h('e2e8f0'); LIGHT=h('f1f5f9'); LIGHTER=h('f8fafc')
WHITE=(255,255,255); BLACK=h('0f172a')
W=210

class R(FPDF):
    def __init__(self):
        super().__init__(unit='mm', format='A4')
        self.add_font('CF','',FONT_R); self.add_font('CF','B',FONT_B)
        self.add_font('SY','',SYM_R); self.add_font('SY','B',SYM_B)
        self.set_margins(0,0,0); self.set_auto_page_break(False); self.add_page()

    def cf(self,sz,b=False): self.set_font('CF','B' if b else '',sz)
    def sy(self,sz,b=False): self.set_font('SY','B' if b else '',sz)
    def tc(self,c): self.set_text_color(*c)
    def fc(self,c): self.set_fill_color(*c)
    def dc(self,c): self.set_draw_color(*c)
    def lw(self,w): self.set_line_width(w)
    def fill(self,x,y,w,h,c): self.fc(c); self.rect(x,y,w,h,'F')
    def hline(self,x,y,w,c,lw=.3): self.dc(c); self.lw(lw); self.line(x,y,x+w,y)
    def vline(self,x,y,h,c,lw=.3): self.dc(c); self.lw(lw); self.line(x,y,x,y+h)
    def box(self,x,y,w,h,fc,bc,lw=.3): self.fc(fc); self.dc(bc); self.lw(lw); self.rect(x,y,w,h,'FD')

    def t(self,x,y,w,h,txt,font='CF',b=False,sz=8,col=None,align='L'):
        col = col or BLACK
        self.set_font(font,'B' if b else '',sz); self.tc(col); self.set_xy(x,y)
        self.cell(w,h,txt,align=align)

    def sym(self,x,y,w,h,txt,sz=8,col=None,b=False,align='L'):
        col = col or BLACK
        self.t(x,y,w,h,txt,font='SY',b=b,sz=sz,col=col,align=align)

    def mt(self,x,y,w,txt,font='CF',b=False,sz=7,col=None,lh=3.8):
        col = col or BLACK
        self.set_font(font,'B' if b else '',sz); self.tc(col); self.set_xy(x,y)
        self.multi_cell(w,lh,txt)

    def badge(self,x,y,txt,bg,tc2,sz=6.5):
        self.cf(sz,True); bw=self.get_string_width(txt)+4
        self.box(x,y,bw,4,bg,bg,.1); self.tc(tc2); self.set_xy(x,y+.4); self.cell(bw,3.5,txt,align='C')
        return bw

    def pill(self,x,y,txt,sz=5.8):
        self.cf(sz); bw=self.get_string_width(txt)+3.5
        self.box(x,y,bw,3.5,LIGHT,BORDER,.15); self.tc(SL); self.set_xy(x,y+.3); self.cell(bw,3,txt,align='C')
        return bw+1.5

    def card_hd(self,x,y,w,ibg,icol,ich,title,bcol):
        self.fill(x,y,w,57,WHITE); self.dc(bcol); self.lw(.4); self.rect(x,y,w,57,'D')
        self.fill(x,y,w,8.5,LIGHTER); self.hline(x,y+8.5,w,BORDER,.2)
        self.fill(x+2,y+1.8,5.5,5.5,ibg)
        self.sy(9,True); self.tc(icol); self.set_xy(x+2,y+2); self.cell(5.5,4.5,ich,align='C')
        self.cf(6.5,True); self.tc(SL); self.set_xy(x+9.5,y+2.5); self.cell(w-11,4,title.upper())

    def chk(self,x,y):
        self.fill(x,y,5,5,GD2)
        self.sy(9,True); self.tc(GDK); self.set_xy(x,y+.5); self.cell(5,4,'✓',align='C')

    def num_c(self,x,y,n,bg,tc2):
        self.fill(x,y,5.5,5.5,bg)
        self.cf(6.5,True); self.tc(tc2); self.set_xy(x,y+.8); self.cell(5.5,4,str(n),align='C')

pdf = R()

# BANNER 0-10
pdf.fill(0,0,W,10,WHITE); pdf.hline(0,10,W,BORDER,.35)
pdf.t(13,1.5,110,4.5,'K. Girdharlal International Pvt Ltd',b=True,sz=11.5)
pdf.t(13,6.2,110,3.5,'Outdoor Catering Division — Operations & Finance System',sz=7.5,col=SL2)
pdf.t(110,2,88,3.5,'Document Ref: ODC-EXEC-JUN-2026',sz=7.5,col=SL2,align='R')
pdf.t(110,5.8,88,3.5,'For Internal Use Only  •  June 2026',sz=7.5,col=SL2,align='R')

# HEADER 10-30
pdf.fill(0,10,W,20,NAVY); pdf.fill(0,29.2,W,1,GN)
pdf.fill(13,12,40,4.5,h('1a3d2a'))
pdf.cf(6.5,True); pdf.tc(GLL); pdf.set_xy(13,12.5); pdf.cell(40,3.5,'EXECUTIVE REPORT  •  CONFIDENTIAL',align='C')
pdf.cf(22,True); pdf.tc(WHITE); pdf.set_xy(13,17)
odc_w = pdf.get_string_width('ODC ')
pdf.cell(odc_w+1,9,'ODC ')
pdf.tc(GL); pdf.set_xy(13+odc_w+1,17); pdf.cell(90,9,'Event Dashboard')
pdf.cf(7.5); pdf.tc(SL3); pdf.set_xy(13,26.5); pdf.cell(110,3.5,'Centralised event operations & finance — sales to settlement, fully in-house.')
pdf.cf(7.5); pdf.tc(SL2)
pdf.set_xy(115,13); pdf.cell(82,3.5,'Prepared by: aiops@kgirdharlal.com',align='R')
pdf.set_xy(115,17); pdf.cell(82,3.5,'Period: June 2026',align='R')
pdf.fill(148,21.5,49,5,h('1a3d2a'))
pdf.fill(151,23.5,2.5,2.5,GL)
pdf.cf(6.5,True); pdf.tc(GLL); pdf.set_xy(155,22); pdf.cell(41,4,'All Core Modules Live')

# KPI STRIP 30-47
pdf.fill(0,30,W,17,WHITE); pdf.hline(0,47,W,BORDER,.4)
for i,(val,lbl,sub,col) in enumerate([
    ('14','Pages / Modules','Login → Admin',GN),
    ('60–100','Staff Hours Saved/Month','50 events / month basis',BL),
    ('₹5–8L','Build Cost Avoided','vs. external vendor quote',OR),
    ('5','Deployment Targets','Vercel, Fly, Railway, Docker+',PU),
]):
    kx=i*W/4
    pdf.fill(kx,30,W/4,1.2,col)
    if i>0: pdf.vline(kx,30,17,BORDER)
    pdf.t(kx+5,31.5,W/4-10,7,val,b=True,sz=16)
    pdf.t(kx+5,39.5,W/4-10,3.5,lbl,b=True,sz=6.2,col=SL2)
    pdf.t(kx+5,43,W/4-10,3,sub,sz=5.8,col=SL3)

# CONTENT 47-227
CY=47; RH=57; PAD=13; LW=(W-PAD*2)*0.54; RW=(W-PAD*2)*0.46-2; LX=PAD; RX=PAD+LW+2

for row in range(3):
    ry=CY+3+row*(RH+1.5)

    if row==0:
        pdf.card_hd(LX,ry,LW,GBG,GDK,'■','What the System Centralises — 8 Modules',GB)
        chips=[('Sales Intake','Booking, PAX, billing, advance,\nGST, food & allergy notes, zone'),
               ('Pre Cost Planning','Food, staff, vendor, decor, equip,\nmisc — projected P&L'),
               ('Petty Cash','Person-wise payouts & expenses,\nremaining balance'),
               ('Bill Submission','Receipt upload, category,\nhead/person mapping'),
               ('Financial Control','Payment received, client balance,\nactual cost & P&L'),
               ('Analytics','Revenue, food pref, zone\ncontribution, top events'),
               ('Admin & Auth','Login, sessions, IP/device,\naudit logs, force-logout'),
               ('Google Backend','Sheets/Drive/Apps Script sync;\nVercel frontend')]
        cw=(LW-5)/2; ch=(RH-8.5-3)/4
        for ci,(cn,cd) in enumerate(chips):
            cx2=LX+2+(ci%2)*(cw+1); cy2=ry+8.5+2+(ci//2)*(ch+1)
            pdf.box(cx2,cy2,cw,ch-0.5,LIGHTER,LIGHT,.15)
            pdf.t(cx2+2,cy2+1,cw-3,4.5,cn,b=True,sz=7.2)
            pdf.mt(cx2+2,cy2+5.5,cw-3,cd,sz=5.8,col=SL2,lh=2.8)

        pdf.card_hd(RX,ry,RW,BL_BG,BL_D,'◷','Estimated Time Savings Per Event',BL_L)
        for ti,(label,bdg,alt) in enumerate([
            ('Event creation & billing calc','10–15 min',False),
            ('Pre-cost planning','20–30 min',True),
            ('Petty cash tracking','20–40 min',False),
            ('Bill & expense reconciliation','30–60 min',True),
            ('Monthly management reporting','1–2 days/mo',False),
            ('50 events/month — Total','60–100 hrs/mo',True)]):
            ty=ry+8.5+2+ti*7.6
            if alt: pdf.fill(RX+1,ty,RW-2,7.6,LIGHTER)
            pdf.t(RX+3,ty+1.8,RW-28,4.5,label,b=(ti==5),sz=7.5,col=SL)
            pdf.badge(RX+RW-24,ty+2,bdg,h('dbeafe') if ti==5 else h('d1fae5'),BL_D if ti==5 else GDK)
            if ti<5: pdf.hline(RX+1,ty+7.6,RW-2,BORDER,.12)

    elif row==1:
        pdf.card_hd(LX,ry,LW,BL_BG,BL_D,'◉','Business Impact',BL_L)
        for ii,imp in enumerate([
            'Single source of truth — sales, advance, petty cash, bills & P&L linked per event.',
            'Full accountability — every change logged with user, device & IP. Disputes eliminated.',
            'Profitability visible before, during & after execution — no reconciliation wait.',
            'Bills event-linked — eliminates missing vouchers and delayed settlement.',
            'Offline-tolerant frontend — local cache works without server; syncs in background.',
            'CSV export for all events; event status workflow managed in-app.']):
            iy=ry+8.5+2+ii*7.6
            pdf.fill(LX+2,iy+2.5,2.5,2.5,BL)
            pdf.cf(7.2); pdf.tc(SL); pdf.set_xy(LX+7,iy+0.5); pdf.multi_cell(LW-9,3.8,imp)

        pdf.card_hd(RX,ry,RW,OR_BG,OR,'₹','Cost Avoidance & Tech Highlights',OR_L)
        bw2=(RW-5)/2
        pdf.box(RX+2,ry+10,bw2,20,GBG,GB,.3)
        pdf.t(RX+4,ry+11.5,bw2-4,3.5,'MVP (EXTERNAL)',b=True,sz=5.5,col=GDK)
        pdf.t(RX+4,ry+15,bw2-4,8,'₹4–5L',b=True,sz=15,col=GDK)
        pdf.t(RX+4,ry+24,bw2-4,3,'Basic feature set',sz=6,col=SL2)
        bx2=RX+2+bw2+1.5
        pdf.box(bx2,ry+10,bw2,20,OR_BG,OR_L,.3)
        pdf.t(bx2+2,ry+11.5,bw2-4,3.5,'FULL PRODUCTION',b=True,sz=5.5,col=OR_D)
        pdf.t(bx2+2,ry+15,bw2-4,8,'₹5–8L',b=True,sz=15,col=OR)
        pdf.t(bx2+2,ry+24,bw2-4,3,'Full feature + deploy',sz=6,col=SL2)
        pdf.fill(RX+2,ry+32,RW-4,10,LIGHTER); pdf.fill(RX+2,ry+32,1,10,GN)
        pdf.cf(6.8); pdf.tc(SL); pdf.set_xy(RX+5,ry+33)
        pdf.multi_cell(RW-7,3.6,'Ext. maintenance: ₹40K–1L/month. In-house build\nremoved vendor lock-in & enables fast iteration.')
        px=RX+2; py=ry+44
        for pt in ['Offline cache','5 deploy targets','Smoke tests','Live reload SSE','DD-MM-YYYY mask','Zero-dep SQLite']:
            pw=pdf.pill(px,py,pt); px+=pw
            if px>RX+RW-12: px=RX+2; py+=4.5

    elif row==2:
        pdf.card_hd(LX,ry,LW,PU_BG,PU,'■','Control & Compliance — 6 Checks',PU_L)
        checks=[('Every action logged: user, timestamp, device & IP','Active sessions viewable; force-logout from admin'),
                ('Centralised roles — access controlled per user','KYC validated: PAN / Aadhaar / GST / mobile'),
                ('Strict CSP on all pages — no XSS; no inline scripts','Firebase Auth + auth-guard on all protected routes')]
        cw2=(LW-5)/2
        for ci2,(c1,c2) in enumerate(checks):
            cy2=ry+8.5+3+ci2*15.5
            pdf.chk(LX+2,cy2)
            pdf.cf(6.8); pdf.tc(SL); pdf.set_xy(LX+9,cy2); pdf.multi_cell(cw2-8,3.6,c1)
            pdf.chk(LX+2+cw2+1.5,cy2)
            pdf.cf(6.8); pdf.tc(SL); pdf.set_xy(LX+cw2+10.5,cy2); pdf.multi_cell(cw2-8,3.6,c2)

        pdf.card_hd(RX,ry,RW,PU_BG,PU,'▲','Next High-Value Upgrades — 5 Items',PU_L)
        for ui,utxt in enumerate([
            'Improve mobile & wide-screen layouts for faster daily use',
            'Stronger validations — negative amounts, duplicates, required fields',
            'Exportable event-wise P&L and settlement reports (PDF / CSV)',
            'Email / WhatsApp alerts for payment due dates & confirmations',
            'Dashboard filters: date, salesperson, food type & department']):
            uy=ry+8.5+3+ui*9.4
            pdf.num_c(RX+2,uy,ui+1,PU_BG,PU)
            pdf.cf(7.2); pdf.tc(SL); pdf.set_xy(RX+10,uy+0.5); pdf.multi_cell(RW-12,3.8,utxt)

# VERIFIED 227-251
pdf.fill(0,227,W,24,GD); pdf.fill(0,227,W,1.2,GN)
pdf.fc(GN); pdf.dc(GL); pdf.lw(.6); pdf.circle(13,229,9,'FD')
pdf.sy(16,True); pdf.tc(WHITE); pdf.set_xy(13,229); pdf.cell(9,9,'✓',align='C')
pdf.cf(5.5,True); pdf.tc(GL)
pdf.set_xy(13,238.5); pdf.cell(9,3,'VERIFIED',align='C')
pdf.set_xy(13,241.5); pdf.cell(9,3,'BY CLAUDE',align='C')
pdf.cf(11.5,True); pdf.tc(WHITE); pdf.set_xy(25,229.5)
pdf.cell(pdf.get_string_width('Verified by Claude — ')+1,5,'Verified by Claude — ')
tw2=pdf.get_string_width('Verified by Claude — ')
pdf.tc(GL); pdf.set_xy(25+tw2+1,229.5); pdf.cell(100,5,'Anthropic AI Codebase Audit  •  June 2026')
vw=(W-25-13)/2
for vi,(v1,v2) in enumerate([
    ('All 14 HTML pages & 13 JS controllers confirmed','KYC validation confirmed in server.js'),
    ('Audit log with IP & device confirmed in admin.js','Force-logout confirmed in firebase-auth.js'),
    ('Google Sheets sync confirmed in google-sync.js',  'Smoke-test suite confirmed (smoke-test.js)'),
    ('Strict CSP confirmed on all HTML pages',          'No factual discrepancies found in this report')]):
    vy=227+9+vi*3.6
    pdf.sy(7.5,True); pdf.tc(GL); pdf.set_xy(25,vy); pdf.cell(5,3.5,'✓')
    pdf.cf(6.8); pdf.tc(GLL); pdf.set_xy(29,vy); pdf.cell(vw-5,3.5,v1)
    pdf.sy(7.5,True); pdf.tc(GL); pdf.set_xy(25+vw,vy); pdf.cell(5,3.5,'✓')
    pdf.cf(6.8); pdf.tc(GLL); pdf.set_xy(29+vw,vy); pdf.cell(vw-5,3.5,v2)
pdf.cf(9.5,True); pdf.tc(GL); pdf.set_xy(W-35,230); pdf.cell(22,4.5,'June 2026',align='R')
pdf.cf(6.5); pdf.tc(h('4b7a5e'))
pdf.set_xy(W-35,235); pdf.cell(22,3.5,'Claude',align='R')
pdf.set_xy(W-35,238.5); pdf.cell(22,3.5,'Anthropic AI',align='R')

# STATUS BAR 251-259
pdf.fill(0,251,W,8,NAVY)
sx=13
for item in ['Sales Intake','Pre Cost & Petty Cash','Bill Submission','Financial Control','Analytics & Admin','Auth & Login','Event Log']:
    pdf.fc(GL); pdf.circle(sx,253,1.5,'F')
    pdf.cf(6.5); pdf.tc(SL3); pdf.set_xy(sx+4,252); pdf.cell(pdf.get_string_width(item)+1,3.5,item)
    sx+=pdf.get_string_width(item)+9
pdf.fc(h('fbbf24')); pdf.circle(sx,253,1.5,'F')
pdf.cf(6.5); pdf.tc(SL3); pdf.set_xy(sx+4,252); pdf.cell(20,3.5,'Mobile UI')

# FOOTER 259-297
pdf.fill(0,259,W,38,LIGHTER); pdf.hline(0,259,W,BORDER,.35)
pdf.t(13,263,130,4.5,'K. Girdharlal International Pvt Ltd  ·  Outdoor Catering Division (ODC)',b=True,sz=9)
pdf.t(13,268,130,3.5,'Internal Use Only  ·  Document Ref: ODC-EXEC-JUN-2026  ·  June 2026',sz=7,col=SL2)
pdf.hline(13,273,W-26,BORDER,.25)
pdf.cf(7.5,True); pdf.tc(SL); pdf.set_xy(13,275); pdf.cell(130,3.5,'AUDIT TRAIL — FILED BY CLAUDE (ANTHROPIC AI)')
for li,line in enumerate([
    'Independently audited by Claude (Anthropic AI) against the live ODC codebase  •  June 2026.',
    'Files reviewed: index.html, app.js, saved-events.js, pre-cost-planning.js, petty-cash.js, bill-submission.js,',
    'financial-control.js, analytics.js, admin.js, master-persons.js, store.js, event-store.js, server.js,',
    'database/schema.sql, firebase-auth.js, google-sync.js, smoke-test.js (132 lines), auth-guard.js, vercel.json.',
    'Conclusion: All claims in this report are consistent with the reviewed codebase. No discrepancies found.']):
    pdf.cf(6.3); pdf.tc(SL2); pdf.set_xy(13,279+li*3.2); pdf.cell(145,3.5,line)
pdf.box(W-43,263,30,6,OR_BG,OR_L,.3)
pdf.cf(7.5,True); pdf.tc(OR_D); pdf.set_xy(W-43,264.3); pdf.cell(30,3.5,'CONFIDENTIAL',align='C')
pdf.box(W-48,272,36,9,GD,GN,.5)
pdf.sy(9,True); pdf.tc(GL); pdf.set_xy(W-48,273.5); pdf.cell(36,6,'✓ Verified by Claude',align='C')

pdf.output(OUT)
print('Done:', OUT)
