from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from django.http import HttpResponse
from .services.pdf_generator import ScientificReportPDF
from .utils.metadata import MetadataGenerator


@api_view(['POST'])
def generate_scientific_report(request):
    """
    Generates a deterministic scientific PDF report.
    Input: current filters, metrics, academic context.
    Output: PDF binary stream.
    """
    try:
        data = request.data
        filters = data.get('filters', {})
        metrics = data.get('metrics', {})
        academic_context = data.get('academic_context', 'normal')
        sample_size = data.get('sample_size', 0)

        metadata = MetadataGenerator.generate_metadata(
            filters=filters,
            sample_size=sample_size,
            academic_context=academic_context
        )

        warnings = metadata.get('warnings', [])

        pdf_gen = ScientificReportPDF(
            metadata=metadata,
            metrics=metrics,
            warnings=warnings,
            academic_context=academic_context
        )
        buffer = pdf_gen.generate()

        response = HttpResponse(buffer.read(), content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="isla_reporte_cientifico_{metadata["query_hash"][:8]}.pdf"'
        return response

    except ImportError:
        return Response(
            {"error": "reportlab no está instalado en el backend. Ejecute: pip install reportlab"},
            status=status.HTTP_501_NOT_IMPLEMENTED
        )
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
