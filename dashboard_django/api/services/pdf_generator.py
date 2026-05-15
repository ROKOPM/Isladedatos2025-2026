"""
Scientific Report PDF Generator
Generates publication-grade reproducible research summaries.

NO corporate language.
NO KPIs, ROI, engagement, optimization.
YES: inference, sample, dispersion, variability, significance, context, observation, behavior.
"""
import io
from datetime import datetime, timezone

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.lib.colors import HexColor
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    HAS_REPORTLAB = True
except ImportError:
    HAS_REPORTLAB = False


class ScientificReportPDF:
    """
    Generates deterministic, reproducible scientific PDF reports.
    """

    TITLE_COLOR = HexColor('#1e293b') if HAS_REPORTLAB else None
    ACCENT_COLOR = HexColor('#3b82f6') if HAS_REPORTLAB else None
    MUTED_COLOR = HexColor('#64748b') if HAS_REPORTLAB else None

    def __init__(self, metadata: dict, metrics: dict, warnings: list, academic_context: str = 'normal'):
        self.metadata = metadata
        self.metrics = metrics
        self.warnings = warnings
        self.academic_context = academic_context
        self.generated_at = datetime.now(timezone.utc).isoformat()

    def generate(self) -> io.BytesIO:
        if not HAS_REPORTLAB:
            raise ImportError("reportlab is required for PDF generation. Install it via: pip install reportlab")

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter,
                                topMargin=0.75 * inch, bottomMargin=0.75 * inch,
                                leftMargin=0.75 * inch, rightMargin=0.75 * inch)
        styles = getSampleStyleSheet()

        title_style = ParagraphStyle('ScTitle', parent=styles['Title'],
                                     textColor=self.TITLE_COLOR, fontSize=18, spaceAfter=6)
        subtitle_style = ParagraphStyle('ScSubtitle', parent=styles['Normal'],
                                        textColor=self.MUTED_COLOR, fontSize=10, spaceAfter=20)
        heading_style = ParagraphStyle('ScHeading', parent=styles['Heading2'],
                                       textColor=self.ACCENT_COLOR, fontSize=13, spaceAfter=8, spaceBefore=16)
        body_style = ParagraphStyle('ScBody', parent=styles['Normal'],
                                     fontSize=10, leading=14, spaceAfter=8)
        warning_style = ParagraphStyle('ScWarning', parent=styles['Normal'],
                                        fontSize=9, leading=12, textColor=HexColor('#b45309'),
                                        spaceAfter=4, leftIndent=12)
        footer_style = ParagraphStyle('ScFooter', parent=styles['Normal'],
                                       fontSize=8, textColor=self.MUTED_COLOR, spaceAfter=4)

        elements = []

        # ── 1. Cover ──
        elements.append(Paragraph("Isla de Datos Urbanos — ESCOM · IPN", title_style))
        elements.append(Paragraph("Reporte de Inferencia Conductual Reproducible", subtitle_style))
        elements.append(Paragraph(f"Generado: {self.generated_at}", footer_style))
        elements.append(Spacer(1, 20))

        # ── 2. Methodology ──
        elements.append(Paragraph("Metodología", heading_style))
        elements.append(Paragraph(
            "Este reporte fue generado de forma determinística por el Motor de Inferencia Conductual "
            "de la plataforma Isla de Datos Urbanos. Toda evidencia reportada es de carácter observacional "
            "y correlacional. No se realizan afirmaciones causales ni predictivas.", body_style))
        elements.append(Paragraph(
            f"Motor estadístico: Cliff's Delta + Welch heurístico (v{self.metadata.get('inference_version', '1.0')}). "
            f"Nivel de confianza: 95%.", body_style))

        # ── 3. Dataset ──
        elements.append(Paragraph("Dataset y Muestra", heading_style))
        ds_data = [
            ["Versión del dataset", self.metadata.get('dataset_version', '—')],
            ["Hash de consulta", self.metadata.get('query_hash', '—')[:24] + '…'],
            ["Tamaño de muestra", f"N = {self.metadata.get('sample_size', 0):,}"],
            ["Contexto académico", self.academic_context],
        ]
        ds_table = Table(ds_data, colWidths=[2.5 * inch, 4 * inch])
        ds_table.setStyle(TableStyle([
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('TEXTCOLOR', (0, 0), (0, -1), self.MUTED_COLOR),
        ]))
        elements.append(ds_table)
        elements.append(Spacer(1, 12))

        # ── 4. Warnings ──
        elements.append(Paragraph("Advertencias Metodológicas", heading_style))
        if self.warnings:
            for w in self.warnings:
                elements.append(Paragraph(f"⚠ {w}", warning_style))
        else:
            elements.append(Paragraph("Sin advertencias activas.", body_style))

        # ── 5. Limitations ──
        elements.append(Paragraph("Limitaciones y Gobernanza Ética", heading_style))
        elements.append(Paragraph(
            "1. Las asociaciones reportadas son estrictamente correlacionales. "
            "Coincidencia temporal no implica relación causal.", body_style))
        elements.append(Paragraph(
            "2. El sistema no realiza perfilamiento individual ni scoring conductual. "
            "Todas las métricas son agregadas y anonimizadas.", body_style))
        elements.append(Paragraph(
            "3. Los resultados son sensibles al tamaño de la muestra, la cobertura temporal "
            "y la calidad de los sensores (cámaras + modelos de visión).", body_style))
        elements.append(Paragraph(
            "4. La reproducibilidad depende de la versión inmutable del dataset asociada a este reporte.", body_style))

        # ── Footer ──
        elements.append(Spacer(1, 30))
        elements.append(Paragraph(
            "— Documento generado automáticamente por el Motor de Reproducibilidad Científica de Isla de Datos Urbanos. "
            "Este reporte NO constituye evidencia causal ni debe usarse para decisiones punitivas. —",
            footer_style))

        doc.build(elements)
        buffer.seek(0)
        return buffer
