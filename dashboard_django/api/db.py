import os
from functools import lru_cache
from sqlalchemy import create_engine
import pandas as pd


@lru_cache(maxsize=1)
def get_engine():
    host = os.environ.get("DB_HOST", "isla_postgres")
    port = os.environ.get("DB_PORT", "5432")
    name = os.environ.get("DB_NAME", "postgres")
    user = os.environ.get("DB_USER", "postgres")
    pwd  = os.environ.get("DB_PASS", "postgres")
    return create_engine(f"postgresql+psycopg2://{user}:{pwd}@{host}:{port}/{name}")


def query(sql: str, params=None) -> pd.DataFrame:
    """Equivalente directo al query() de app.py — devuelve DataFrame."""
    try:
        return pd.read_sql(sql, get_engine(), params=params)
    except Exception as e:
        print(f"[DB ERROR] {e}")
        return pd.DataFrame()
