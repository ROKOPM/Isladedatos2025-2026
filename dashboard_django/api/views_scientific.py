"""
Scientific Hardening Views
Endpoints for methodology generation, guard rail validation, and snapshot reconstruction.
"""
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .services.methodology_builder import MethodologyBuilder
from .scientific.guardrails import StatisticalGuardRails
from .scientific.reconstruction import ReconstructionValidator
from .models import AnalysisSnapshot


@api_view(['POST'])
def methodology_api(request):
    data = request.data
    builder = MethodologyBuilder(
        filters=data.get('filters', {}),
        sample_size=data.get('sample_size', 0),
        academic_context=data.get('academic_context', 'normal'),
    )
    result = builder.build()
    return Response({"status": "success", "data": result})


@api_view(['POST'])
def guardrails_api(request):
    data = request.data
    rails = StatisticalGuardRails()
    result = rails.validate_all(
        n=data.get('sample_size', 0),
        days=data.get('days', 15),
        n_comparison=data.get('comparison_size', 0),
    )
    return Response({"status": "success", "data": result})


@api_view(['GET'])
def validate_snapshot_api(request, uuid):
    try:
        snap = AnalysisSnapshot.get(uuid)
        record = {
            'filters':     snap.filters_json,
            'metrics':     snap.computed_metrics_json,
            'metadata':    snap.metadata_json,
            'query_hash':  snap.query_hash,
        }
        result = ReconstructionValidator.validate(record)
        return Response({"status": "success", "data": result})
    except FileNotFoundError:
        return Response({"status": "error", "message": "Snapshot no encontrado."}, status=status.HTTP_404_NOT_FOUND)
