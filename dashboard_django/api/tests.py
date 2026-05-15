"""
Scientific Reproducibility Tests
Validates metadata generation, governance warnings, snapshot immutability, and lineage integrity.
"""
from django.test import TestCase, SimpleTestCase, override_settings
from api.utils.metadata import MetadataGenerator
from api.models import DatasetVersion, AnalysisSnapshot
import json
import os
import tempfile

try:
    from api.models import AuditLog
except ImportError:
    AuditLog = None


class MetadataGeneratorTests(TestCase):
    """Tests for deterministic metadata generation and governance warnings."""

    def test_query_hash_is_deterministic(self):
        filters = {"campus": "Zacatenco", "camera": "Norte"}
        h1 = MetadataGenerator.generate_query_hash(filters, "v1.0.0")
        h2 = MetadataGenerator.generate_query_hash(filters, "v1.0.0")
        self.assertEqual(h1, h2, "Hash must be deterministic for same inputs")

    def test_query_hash_changes_with_version(self):
        filters = {"campus": "Zacatenco"}
        h1 = MetadataGenerator.generate_query_hash(filters, "v1.0.0")
        h2 = MetadataGenerator.generate_query_hash(filters, "v1.1.0")
        self.assertNotEqual(h1, h2, "Different dataset versions must produce different hashes")

    def test_low_sample_warning_block(self):
        warnings = MetadataGenerator.generate_governance_warnings(3, 0.5, 'normal')
        self.assertTrue(any("insuficiente" in w.lower() for w in warnings))

    def test_low_sample_warning_limited(self):
        warnings = MetadataGenerator.generate_governance_warnings(15, 0.5, 'normal')
        self.assertTrue(any("limitada" in w.lower() for w in warnings))

    def test_no_low_sample_warning_for_large_n(self):
        warnings = MetadataGenerator.generate_governance_warnings(500, 0.5, 'normal')
        self.assertFalse(any("insuficiente" in w.lower() or "limitada" in w.lower() for w in warnings))

    def test_high_variance_warning(self):
        warnings = MetadataGenerator.generate_governance_warnings(100, 2.0, 'normal')
        self.assertTrue(any("dispersa" in w.lower() for w in warnings))

    def test_academic_context_warning(self):
        warnings = MetadataGenerator.generate_governance_warnings(100, 0.5, 'midterms')
        self.assertTrue(any("presión" in w.lower() for w in warnings))

    def test_causality_disclaimer_always_present(self):
        warnings = MetadataGenerator.generate_governance_warnings(1000, 0.1, 'normal')
        self.assertTrue(any("correlacional" in w.lower() for w in warnings),
                        "Causality disclaimer must always be included")

    def test_metadata_structure(self):
        meta = MetadataGenerator.generate_metadata({"campus": "Z"}, 500)
        self.assertIn('generated_at', meta)
        self.assertIn('dataset_version', meta)
        self.assertIn('query_hash', meta)
        self.assertIn('governance', meta)
        self.assertEqual(meta['sample_size'], 500)

    def test_governance_flags(self):
        meta = MetadataGenerator.generate_metadata({"campus": "Z"}, 10, variance=2.0)
        gov = meta['governance']
        self.assertTrue(gov['low_sample_warning'])
        self.assertTrue(gov['high_variance_warning'])
        self.assertTrue(gov['causality_warning'])


class ClusterJobStateTests(SimpleTestCase):
    def test_cluster_query_hash_is_deterministic_and_filter_sensitive(self):
        from api.views import _cluster_query_hash
        filters_a = {"campus": ["A"], "intervalo": "15 days"}
        filters_b = {"intervalo": "15 days", "campus": ["A"]}
        filters_c = {"campus": ["B"], "intervalo": "15 days"}

        self.assertEqual(_cluster_query_hash(filters_a), _cluster_query_hash(filters_b))
        self.assertNotEqual(_cluster_query_hash(filters_a), _cluster_query_hash(filters_c))

    def test_read_cluster_status_marks_matching_ready_hash_as_hit(self):
        from api.views import _read_cluster_status
        with tempfile.TemporaryDirectory() as tmp:
            status_path = os.path.join(tmp, "cluster_job_status.json")
            payload = {
                "job_id": "job-1",
                "stage": "ready",
                "query_hash": "abc",
                "updated_at": "2026-05-12T00:00:00Z",
                "progress": 100,
                "elapsed_seconds": 5,
                "records_total": 10,
                "records_processed": 10,
                "message": "ok",
            }
            with open(status_path, "w", encoding="utf-8") as fh:
                json.dump(payload, fh)
            with override_settings(CLUSTER_STATUS_FILE=status_path):
                status = _read_cluster_status("abc")
        self.assertEqual(status["cache_status"], "hit")

    def test_read_cluster_status_marks_mismatched_ready_hash_as_stale(self):
        from api.views import _read_cluster_status
        with tempfile.TemporaryDirectory() as tmp:
            status_path = os.path.join(tmp, "cluster_job_status.json")
            with open(status_path, "w", encoding="utf-8") as fh:
                json.dump({"stage": "ready", "query_hash": "old", "updated_at": "2026-05-12T00:00:00Z"}, fh)
            with override_settings(CLUSTER_STATUS_FILE=status_path):
                status = _read_cluster_status("new")
        self.assertEqual(status["cache_status"], "stale")


class SnapshotModelTests(TestCase):
    """Tests for snapshot creation, retrieval, and immutability."""

    def setUp(self):
        if not hasattr(AnalysisSnapshot, "objects"):
            self.skipTest("AnalysisSnapshot is file-backed in this deployment")

    def test_snapshot_creation(self):
        snap = AnalysisSnapshot.objects.create(
            filters_json={"dateRange": ["2026-04-01", "2026-04-15"]},
            computed_metrics_json={"median": 12.5},
            metadata_json={"dataset_version": "v1.0.0"},
            visualization_state={"mode": "distribution"},
            query_hash="abc123"
        )
        self.assertIsNotNone(snap.uuid)
        self.assertIsNotNone(snap.created_at)

    def test_snapshot_retrieval_by_uuid(self):
        snap = AnalysisSnapshot.objects.create(
            filters_json={}, computed_metrics_json={},
            metadata_json={}, visualization_state={},
            query_hash="test_hash"
        )
        retrieved = AnalysisSnapshot.objects.get(uuid=snap.uuid)
        self.assertEqual(retrieved.query_hash, "test_hash")

    def test_snapshot_preserves_filters(self):
        filters = {"dateRange": ["2026-05-01", "2026-05-15"], "campus": "Zacatenco"}
        snap = AnalysisSnapshot.objects.create(
            filters_json=filters, computed_metrics_json={},
            metadata_json={}, visualization_state={},
            query_hash="filter_hash"
        )
        retrieved = AnalysisSnapshot.objects.get(uuid=snap.uuid)
        self.assertEqual(retrieved.filters_json, filters)


class DatasetVersionTests(TestCase):
    """Tests for dataset versioning immutability."""

    def setUp(self):
        if not hasattr(DatasetVersion, "objects"):
            self.skipTest("DatasetVersion is file-backed in this deployment")

    def test_version_creation(self):
        dv = DatasetVersion.objects.create(
            version="v1.0.0",
            warehouse_checksum="sha256abc",
            llava_version="LLaVA 13B",
            qwen_version="Qwen 2.5 14b"
        )
        self.assertEqual(dv.version, "v1.0.0")

    def test_version_uniqueness(self):
        DatasetVersion.objects.create(version="v1.0.0")
        with self.assertRaises(Exception):
            DatasetVersion.objects.create(version="v1.0.0")


class AuditLogTests(TestCase):
    """Tests for audit trail logging."""

    def setUp(self):
        if AuditLog is None:
            self.skipTest("AuditLog model is not present in this deployment")

    def test_audit_log_creation(self):
        log = AuditLog.objects.create(
            endpoint="/api/kpis/",
            filters_json={"campus": "Zacatenco"},
            dataset_version="v1.0.0",
            query_hash="hash123",
            duration_ms=45,
            sample_size=1200,
            warnings_emitted=["Correlacional"]
        )
        self.assertEqual(log.endpoint, "/api/kpis/")
        self.assertEqual(log.sample_size, 1200)

    def test_audit_log_ordering(self):
        AuditLog.objects.create(endpoint="/api/a/", query_hash="h1")
        AuditLog.objects.create(endpoint="/api/b/", query_hash="h2")
        logs = AuditLog.objects.all()
        self.assertEqual(logs[0].endpoint, "/api/b/")  # Most recent first


class GuardRailsTests(TestCase):
    """Tests for statistical guard rails blocking invalid operations."""

    def setUp(self):
        from api.scientific.guardrails import StatisticalGuardRails
        self.rails = StatisticalGuardRails()

    def test_blocks_tiny_sample(self):
        result = self.rails.validate_sample_size(3)
        self.assertFalse(result['allowed'])
        self.assertEqual(result['severity'], 'critical')

    def test_warns_small_sample(self):
        result = self.rails.validate_sample_size(15)
        self.assertTrue(result['allowed'])
        self.assertEqual(result['severity'], 'warning')

    def test_allows_large_sample(self):
        result = self.rails.validate_sample_size(500)
        self.assertTrue(result['allowed'])
        self.assertEqual(result['severity'], 'ok')

    def test_blocks_excessive_date_range(self):
        result = self.rails.validate_date_range(120)
        self.assertFalse(result['allowed'])

    def test_allows_normal_date_range(self):
        result = self.rails.validate_date_range(30)
        self.assertTrue(result['allowed'])

    def test_warns_unbalanced_comparison(self):
        result = self.rails.validate_comparison_balance(10, 200)
        self.assertTrue(result['allowed'])
        self.assertEqual(result['severity'], 'warning')

    def test_blocks_empty_comparison(self):
        result = self.rails.validate_comparison_balance(100, 0)
        self.assertFalse(result['allowed'])

    def test_validate_all_aggregates(self):
        result = self.rails.validate_all(n=3, days=120)
        self.assertFalse(result['allowed'])
        self.assertTrue(len(result['reasons']) >= 2)


class ReconstructionValidatorTests(TestCase):
    """Tests for snapshot reconstruction and reproducibility verification."""

    def test_valid_reconstruction(self):
        from api.scientific.reconstruction import ReconstructionValidator
        filters = {"campus": "Zacatenco"}
        dataset_version = "v1.0.0"
        query_hash = MetadataGenerator.generate_query_hash(filters, dataset_version)

        result = ReconstructionValidator.validate({
            'filters': filters,
            'metrics': {"median": 12},
            'metadata': {"dataset_version": dataset_version, "query_hash": query_hash, "sample_size": 100},
            'query_hash': query_hash
        })
        self.assertTrue(result['is_valid'])

    def test_invalid_reconstruction(self):
        from api.scientific.reconstruction import ReconstructionValidator
        result = ReconstructionValidator.validate({
            'filters': {"campus": "Zacatenco"},
            'metrics': {},
            'metadata': {"dataset_version": "v1.0.0"},
            'query_hash': "totally_wrong_hash"
        })
        self.assertFalse(result['is_valid'])

    def test_checksum_determinism(self):
        from api.scientific.reconstruction import ReconstructionValidator
        c1 = ReconstructionValidator.compute_state_checksum({"a": 1}, {"b": 2}, {"c": 3})
        c2 = ReconstructionValidator.compute_state_checksum({"a": 1}, {"b": 2}, {"c": 3})
        self.assertEqual(c1, c2)


class MethodologyBuilderTests(TestCase):
    """Tests for deterministic methodology text generation."""

    def test_methodology_contains_sample_size(self):
        from api.services.methodology_builder import MethodologyBuilder
        builder = MethodologyBuilder({"campus": "Z"}, 5000, "midterms")
        result = builder.build()
        self.assertIn("5,000", result['methodology_text'])

    def test_methodology_contains_limitations(self):
        from api.services.methodology_builder import MethodologyBuilder
        builder = MethodologyBuilder({}, 100)
        result = builder.build()
        self.assertTrue(len(result['limitations']) >= 3)

    def test_methodology_contains_causality_disclaimer(self):
        from api.services.methodology_builder import MethodologyBuilder
        builder = MethodologyBuilder({}, 100)
        result = builder.build()
        has_causality = any("correlacional" in lim.lower() for lim in result['limitations'])
        self.assertTrue(has_causality)

    def test_config_checksum_exists(self):
        from api.services.methodology_builder import MethodologyBuilder
        builder = MethodologyBuilder({}, 100)
        result = builder.build()
        self.assertIn('config_checksum', result)
        self.assertTrue(len(result['config_checksum']) > 0)
