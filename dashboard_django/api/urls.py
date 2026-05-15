from django.urls import path
from . import views
from . import views_snapshots
from . import views_reports
from . import views_scientific

urlpatterns = [
    path("health/",          views.health,           name="health"),
    path("kpis/",            views.kpis,             name="kpis"),
    path("eventos-hora/",    views.eventos_por_hora, name="eventos_hora"),
    path("top-actividades/", views.top_actividades,  name="top_actividades"),
    path("heatmap/",         views.heatmap_dia_hora, name="heatmap"),
    path("clusters/",        views.clusters,         name="clusters"),
    path("clusters/status/", views.clusters_status,  name="clusters_status"),
    path("clusters/recompute/", views.clusters_recompute, name="clusters_recompute"),
    path("clusters/job/<uuid:job_id>/", views.clusters_job, name="clusters_job"),
    path("clusters/custom/", views.clusters_custom,  name="clusters_custom"),
    path("alertas/",         views.alertas,          name="alertas"),
    path("calidad-ia/",      views.calidad_ia,       name="calidad_ia"),
    path("filtros/",         views.opciones_filtros, name="filtros"),
    path("calendario/",      views.calendario,       name="calendario"),
    path("duracion-habitos/", views.duracion_habitos, name="duracion_habitos"),
    path("calidad-aire/",     views.calidad_aire,     name="calidad_aire"),
    path("sistema/",          views.sistema,          name="sistema"),
    path("firma-temporal/",   views.firma_temporal,   name="firma_temporal"),
    path("patrones-raw/",     views.patrones_raw,     name="patrones_raw"),
    path("alertas-panel/",    views.alertas_panel,    name="alertas_panel"),
    path("export-csv/",       views.export_csv,       name="export_csv"),
    path("export-pdf/",       views.export_pdf,       name="export_pdf"),
    path("contexto-social/",  views.contexto_social,  name="contexto_social"),
    path("tendencias/",      views.tendencias_fumado, name="tendencias"),
    path("events/",          views.events_paginated,  name="events_paginated"),

    # Scientific Snapshot Layer
    path("snapshots/",            views_snapshots.snapshots_api,       name="snapshots"),
    path("snapshots/<uuid:uuid>/", views_snapshots.snapshot_detail_api, name="snapshot_detail"),

    # Scientific Report Layer
    path("scientific-report/", views_reports.generate_scientific_report, name="scientific_report"),

    # Scientific Hardening Layer
    path("methodology/",  views_scientific.methodology_api,  name="methodology"),
    path("guardrails/",   views_scientific.guardrails_api,   name="guardrails"),
    path("validate-snapshot/<uuid:uuid>/", views_scientific.validate_snapshot_api, name="validate_snapshot"),
]
