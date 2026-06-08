from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


OUT = Path("output/pdf")
OUT.mkdir(parents=True, exist_ok=True)
PDF = OUT / "ODC_Executive_One_Page_Report.pdf"


def p(text, style):
    return Paragraph(text, style)


styles = getSampleStyleSheet()
title = ParagraphStyle(
    "Title",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=18,
    leading=21,
    textColor=colors.HexColor("#0f172a"),
    alignment=TA_CENTER,
    spaceAfter=3,
)
subtitle = ParagraphStyle(
    "Subtitle",
    parent=styles["Normal"],
    fontName="Helvetica",
    fontSize=8.8,
    leading=11,
    textColor=colors.HexColor("#475569"),
    alignment=TA_CENTER,
)
section = ParagraphStyle(
    "Section",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=9.2,
    leading=11,
    textColor=colors.HexColor("#0f766e"),
    spaceBefore=4,
    spaceAfter=3,
)
body = ParagraphStyle(
    "Body",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=7.2,
    leading=9,
    textColor=colors.HexColor("#111827"),
)
small = ParagraphStyle(
    "Small",
    parent=body,
    fontSize=6.7,
    leading=8.2,
)
metric_label = ParagraphStyle(
    "MetricLabel",
    parent=body,
    fontName="Helvetica-Bold",
    fontSize=6.6,
    leading=7.6,
    textColor=colors.HexColor("#475569"),
)
metric_value = ParagraphStyle(
    "MetricValue",
    parent=body,
    fontName="Helvetica-Bold",
    fontSize=10.5,
    leading=12,
    textColor=colors.HexColor("#0f766e"),
)


doc = SimpleDocTemplate(
    str(PDF),
    pagesize=A4,
    rightMargin=10 * mm,
    leftMargin=10 * mm,
    topMargin=9 * mm,
    bottomMargin=8 * mm,
)

story = [
    p("ODC Event Dashboard - Executive Impact Report", title),
    p(
        "Centralized event finance, operations, receipts, petty cash, audit tracking and analytics in one live web system.",
        subtitle,
    ),
    Spacer(1, 4),
]

metrics = [
    [p("Monthly Time Saving", metric_label), p("60-100 hrs", metric_value)],
    [p("External Build Avoided", metric_label), p("Rs 10-18 lakh", metric_value)],
    [p("Support Cost Avoided", metric_label), p("Rs 40k-1L / month", metric_value)],
    [p("Core Workflow", metric_label), p("10 modules live", metric_value)],
]
metric_table = Table(metrics, colWidths=[33 * mm, 35 * mm] * 2)
metric_table.setStyle(TableStyle([
    ("SPAN", (0, 0), (0, 0)),
    ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d7e3ef")),
    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
]))
story.append(metric_table)
story.append(Spacer(1, 5))

left = [
    p("Business Purpose", section),
    p("Built an internal dashboard that replaces scattered Excel sheets, WhatsApp follow-ups, manual receipt tracking and person-dependent reconciliation with one controlled system.", body),
    p("What Is Centralized", section),
    p("- Sales Intake: event booking, PAX, billing, advance schedule, GST and client notes.<br/>- Pre Cost: food, staff, vendor, decor, equipment, additional charges and projected P&amp;L.<br/>- Petty Cash: person-wise allocation, small expenses, cash required and release summary.<br/>- Bill Submission: event-wise receipt upload, category, head/person mapping and description.<br/>- Financial Control: payment received, client balance, actual cost, planned vs actual P&amp;L and in-house charges.<br/>- Analytics/Admin: revenue views, active sessions, IP/device visibility, audit logs and user controls.", small),
    p("Control And Compliance", section),
    p("- Every critical action can be logged with user, time, device/browser, IP and changed entity.<br/>- Admin can see active sessions and force logout when required.<br/>- Central roles reduce uncontrolled access to operational and finance records.<br/>- Google Sheets/Drive remain the central backend while Vercel provides the production frontend.", small),
]

right = [
    p("Measured Business Impact", section),
    p("- One source of truth for event money movement from booking to final P&amp;L.<br/>- Faster profitability review before, during and after execution.<br/>- Fewer missing bills because receipts and expenses are tied to events.<br/>- Better accountability because changes can be traced by login, device and IP.<br/>- Management reporting no longer depends on manual consolidation.", small),
    p("Estimated Time Saving", section),
    p("- Event creation and billing: 10-15 minutes saved per event.<br/>- Pre-cost planning: 20-30 minutes saved per event.<br/>- Petty cash tracking: 20-40 minutes saved per event.<br/>- Bill reconciliation: 30-60 minutes saved per event.<br/>- Monthly reporting: 1-2 working days saved per month.<br/><b>At 50 events/month: approximately 60-100 staff hours saved monthly.</b>", small),
    p("Cost Avoidance", section),
    p("- External MVP build estimate: Rs 4-8 lakh.<br/>- Polished production build estimate: Rs 10-18 lakh.<br/>- Ongoing external maintenance estimate: Rs 40,000-Rs 1,00,000 per month.<br/>- In-house build avoids vendor lock-in and makes workflow changes faster.", small),
    p("Current Status And Next Upgrades", section),
    p("- Live modules: Sales Intake, Saved Events, Pre Cost, Petty Cash, Bill Submission, Financial Control, Analytics, Master Persons, Admin and FAQ.<br/>- Recent stability fixes removed full Admin panel refresh in live sections.<br/>- Next high-value upgrades: mobile and wide-screen layout polish; stronger validation for negative amounts, duplicates and required fields; exportable event-wise P&amp;L and settlement reports in PDF/CSV; email or WhatsApp alerts for payment due dates and client confirmations; dashboard filters by date, salesperson, food type and department head.", small),
]

content = Table([[left, right]], colWidths=[86 * mm, 86 * mm])
content.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ("LINEBEFORE", (1, 0), (1, 0), 0.35, colors.HexColor("#d7e3ef")),
]))
story.append(content)
story.append(Spacer(1, 5))

footer = Table(
    [[p("<b>Executive takeaway:</b> The dashboard converts event finance from manual after-the-fact reconciliation into live operational control with auditability, accountability and measurable monthly time savings.", body)]],
    colWidths=[172 * mm],
)
footer.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ecfdf5")),
    ("BOX", (0, 0), (-1, -1), 0.45, colors.HexColor("#99f6e4")),
    ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story.append(footer)

doc.build(story)
print(PDF)
