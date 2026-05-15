import json
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from .models import AnalysisSnapshot


@api_view(['POST', 'GET'])
def snapshots_api(request):
    if request.method == 'POST':
        try:
            data = request.data
            snapshot = AnalysisSnapshot.create(
                filters_json=data.get('filters', {}),
                computed_metrics_json=data.get('metrics', {}),
                metadata_json=data.get('metadata', {}),
                academic_context_summary=data.get('academic_context', {}),
                visualization_state=data.get('visualization_state', {}),
                user_notes=data.get('user_notes', ''),
                query_hash=data.get('query_hash', 'unknown_hash'),
            )
            return Response({"status": "success", "uuid": str(snapshot.uuid)}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response({"status": "error", "message": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    snapshots = AnalysisSnapshot.all_ordered(limit=50)
    data = [{
        "uuid":       str(s.uuid),
        "created_at": s.created_at.isoformat(),
        "query_hash": s.query_hash,
        "user_notes": s.user_notes,
    } for s in snapshots]
    return Response({"status": "success", "data": data})


@api_view(['GET'])
def snapshot_detail_api(request, uuid):
    try:
        snapshot = AnalysisSnapshot.get(uuid)
        data = {
            "uuid":            str(snapshot.uuid),
            "created_at":      snapshot.created_at.isoformat(),
            "filters":         snapshot.filters_json,
            "metrics":         snapshot.computed_metrics_json,
            "metadata":        snapshot.metadata_json,
            "academic_context": snapshot.academic_context_summary,
            "visualization_state": snapshot.visualization_state,
            "user_notes":      snapshot.user_notes,
            "query_hash":      snapshot.query_hash,
        }
        return Response({"status": "success", "data": data})
    except FileNotFoundError:
        return Response({"status": "error", "message": "Snapshot no encontrado."}, status=status.HTTP_404_NOT_FOUND)
