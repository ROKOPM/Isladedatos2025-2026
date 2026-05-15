"""
Statistical Guard Rails
Blocks invalid or scientifically unsound analytical operations before they execute.
Prevents p-hacking, insufficient-sample inference, and absurd temporal comparisons.
"""
import json
import os

CONFIG_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'config', 'scientific_config.json')

def _load_config():
    try:
        with open(CONFIG_PATH, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {
            "inference": {"min_sample_size": 5, "warning_sample_size": 30},
            "governance": {"max_comparison_periods": 2, "max_allowed_range_days": 90}
        }


class StatisticalGuardRails:
    """
    Validates analytical requests BEFORE inference is computed.
    Returns structured allow/block decisions with human-readable reasons.
    """

    def __init__(self):
        self.config = _load_config()
        self.inf = self.config.get('inference', {})
        self.gov = self.config.get('governance', {})

    def validate_sample_size(self, n: int) -> dict:
        min_n = self.inf.get('min_sample_size', 5)
        warn_n = self.inf.get('warning_sample_size', 30)

        if n < min_n:
            return {
                "allowed": False,
                "reason": f"Muestra insuficiente (N={n}). Se requieren al menos {min_n} observaciones para inferencia válida.",
                "severity": "critical"
            }
        if n < warn_n:
            return {
                "allowed": True,
                "reason": f"Muestra limitada (N={n}). Resultados con alto margen de error.",
                "severity": "warning"
            }
        return {"allowed": True, "reason": None, "severity": "ok"}

    def validate_date_range(self, days: int) -> dict:
        max_days = self.gov.get('max_allowed_range_days', 90)
        if days > max_days:
            return {
                "allowed": False,
                "reason": f"Rango temporal excesivo ({days} días). Máximo permitido: {max_days} días.",
                "severity": "critical"
            }
        return {"allowed": True, "reason": None, "severity": "ok"}

    def validate_comparison_balance(self, n_a: int, n_b: int) -> dict:
        if n_a == 0 or n_b == 0:
            return {
                "allowed": False,
                "reason": "Uno de los periodos comparados no tiene observaciones.",
                "severity": "critical"
            }
        ratio = max(n_a, n_b) / min(n_a, n_b)
        if ratio > 10:
            return {
                "allowed": True,
                "reason": f"Comparación desbalanceada (ratio {ratio:.1f}:1). Resultados sesgados posibles.",
                "severity": "warning"
            }
        return {"allowed": True, "reason": None, "severity": "ok"}

    def validate_all(self, n: int, days: int = 15, n_comparison: int = 0) -> dict:
        """Run all guard rails and return aggregated result."""
        checks = [
            self.validate_sample_size(n),
            self.validate_date_range(days),
        ]
        if n_comparison > 0:
            checks.append(self.validate_comparison_balance(n, n_comparison))

        blocked = [c for c in checks if not c['allowed']]
        warnings = [c for c in checks if c['allowed'] and c.get('reason')]

        if blocked:
            return {
                "allowed": False,
                "reasons": [c['reason'] for c in blocked],
                "warnings": [c['reason'] for c in warnings]
            }
        return {
            "allowed": True,
            "reasons": [],
            "warnings": [c['reason'] for c in warnings]
        }
