"""
reprocesar_completo.py
──────────────────────
Reprocesamiento completo del pipeline con enriquecimiento Davis.

Pasos:
  1. Enriquece vector_bruto con datos Davis reales (join temporal +-30 min)
     para los registros que tienen clima_davis nulo en staging.tabla_central.
  2. Limpia warehouse.hechos_actividades_escenaurbana y vectores (CASCADE).
  3. Resetea staging.tabla_central a 'pendiente' (completado + error_json).
  Qwen Worker procesara todo con el nuevo codigo de validacion y coherencia.

Uso:
    python reprocesar_completo.py [--dry-run]

Variables de entorno:
    POSTGRES_DSN  (default: postgresql://postgres:postgres@localhost:5432/postgres)
"""

import os
import sys
import asyncio
import asyncpg

POSTGRES_DSN = os.environ.get(
    "POSTGRES_DSN",
    "postgresql://postgres:postgres@localhost:5432/postgres"
)
DRY_RUN = "--dry-run" in sys.argv


async def main():
    print("Conectando a PostgreSQL...")
    pool = await asyncpg.create_pool(POSTGRES_DSN, min_size=1, max_size=3)

    async with pool.acquire() as conn:

        # ── Diagnostico inicial ───────────────────────────────
        print("\n─── Estado inicial ───────────────────────────────────")

        filas_staging = await conn.fetch("""
            SELECT estado_envio, COUNT(*) AS n
            FROM staging.tabla_central
            GROUP BY estado_envio ORDER BY n DESC
        """)
        for row in filas_staging:
            print(f"  staging.tabla_central [{row['estado_envio']:15s}] {row['n']:>6,}")

        sin_clima = await conn.fetchval("""
            SELECT COUNT(*) FROM staging.tabla_central
            WHERE (vector_bruto->'clima_davis') IS NULL
               OR vector_bruto->'clima_davis' = 'null'::jsonb
        """)
        con_clima = await conn.fetchval("""
            SELECT COUNT(*) FROM staging.tabla_central
            WHERE (vector_bruto->'clima_davis') IS NOT NULL
              AND vector_bruto->'clima_davis' != 'null'::jsonb
        """)
        print(f"\n  vector_bruto con clima Davis : {con_clima:>6,}")
        print(f"  vector_bruto SIN clima Davis : {sin_clima:>6,}")

        hechos_wh = await conn.fetchval(
            "SELECT COUNT(*) FROM warehouse.hechos_actividades_escenaurbana"
        )
        vectores_wh = await conn.fetchval(
            "SELECT COUNT(*) FROM warehouse.hechos_vectores_descripcion_habitos"
        )
        print(f"\n  warehouse.hechos             : {hechos_wh:>6,}")
        print(f"  warehouse.vectores           : {vectores_wh:>6,}")

        # ── Davis disponible para el rango de los hechos ──────
        davis_info = await conn.fetchrow("""
            SELECT
                COUNT(*) AS n,
                MIN(estampa_tiempo)::date AS desde,
                MAX(estampa_tiempo)::date AS hasta,
                ROUND(AVG(pm10)::numeric,2) AS pm10_avg
            FROM staging.tabla_davis
        """)
        print(f"\n  Davis disponible : {davis_info['n']:,} lecturas "
              f"({davis_info['desde']} → {davis_info['hasta']}) "
              f"PM10_avg={davis_info['pm10_avg']} ug/m3")

        # Cuantos registros sin clima podran ser enriquecidos
        enriquecibles = await conn.fetchval("""
            SELECT COUNT(*) FROM staging.tabla_central tc
            WHERE (tc.vector_bruto->'clima_davis') IS NULL
               OR tc.vector_bruto->'clima_davis' = 'null'::jsonb
               AND EXISTS (
                   SELECT 1 FROM staging.tabla_davis d
                   WHERE ABS(EXTRACT(EPOCH FROM (d.estampa_tiempo - tc.estampa_tiempo))) < 1800
               )
        """)
        print(f"  Registros enriquecibles      : {enriquecibles:>6,} (Davis +-30 min)")

        if DRY_RUN:
            print("\n  [DRY-RUN] No se haran cambios.")
            await pool.close()
            return

        print("\n─── Paso 1: Enriquecer vector_bruto con Davis ────────")
        # LATERAL join: para cada registro sin clima, busca la lectura Davis
        # mas cercana en +-30 minutos
        # Usa subconsulta correlacionada: referencia directa a la fila actual
        # (LATERAL en UPDATE FROM no puede referenciar la tabla objetivo)
        resultado_enrich = await conn.execute("""
            UPDATE staging.tabla_central
            SET vector_bruto = jsonb_set(
                vector_bruto,
                '{clima_davis}',
                (
                    SELECT jsonb_build_object(
                        'pm10', ROUND(d.pm10::numeric, 2),
                        'temp', ROUND(d.temperatura::numeric, 2),
                        'hum',  ROUND(d.humedad::numeric, 2)
                    )
                    FROM staging.tabla_davis d
                    WHERE ABS(EXTRACT(EPOCH FROM
                          (d.estampa_tiempo - staging.tabla_central.estampa_tiempo))) < 1800
                    ORDER BY ABS(EXTRACT(EPOCH FROM
                          (d.estampa_tiempo - staging.tabla_central.estampa_tiempo)))
                    LIMIT 1
                )
            )
            WHERE ((vector_bruto->'clima_davis') IS NULL
                OR vector_bruto->'clima_davis' = 'null'::jsonb)
              AND EXISTS (
                    SELECT 1 FROM staging.tabla_davis d
                    WHERE ABS(EXTRACT(EPOCH FROM
                          (d.estampa_tiempo - staging.tabla_central.estampa_tiempo))) < 1800
              )
        """)
        n_enrich = int(resultado_enrich.split()[-1])
        print(f"  Registros enriquecidos con Davis: {n_enrich:,}")

        sin_clima_post = await conn.fetchval("""
            SELECT COUNT(*) FROM staging.tabla_central
            WHERE (vector_bruto->'clima_davis') IS NULL
               OR vector_bruto->'clima_davis' = 'null'::jsonb
        """)
        print(f"  Registros aun sin clima (sin match Davis): {sin_clima_post:,}")

        print("\n─── Paso 2: Limpiar warehouse ────────────────────────")
        # Primero vectores (no hay FK inversa desde hechos a vectores,
        # pero si de vectores a hechos — truncar vectores primero es seguro)
        await conn.execute(
            "TRUNCATE warehouse.hechos_vectores_descripcion_habitos"
        )
        print("  warehouse.hechos_vectores_descripcion_habitos: TRUNCADO")

        await conn.execute(
            "TRUNCATE warehouse.hechos_actividades_escenaurbana CASCADE"
        )
        print("  warehouse.hechos_actividades_escenaurbana:     TRUNCADO")

        # dim_tiempo y dim_geoespacial se conservan (ON CONFLICT los reutiliza)
        n_dim_t = await conn.fetchval("SELECT COUNT(*) FROM warehouse.dim_tiempo")
        n_dim_g = await conn.fetchval("SELECT COUNT(*) FROM warehouse.dim_geoespacial")
        print(f"  warehouse.dim_tiempo conservado:   {n_dim_t:,} filas")
        print(f"  warehouse.dim_geoespacial conservado: {n_dim_g:,} filas")

        print("\n─── Paso 3: Resetear staging a pendiente ─────────────")
        resultado_reset = await conn.execute("""
            UPDATE staging.tabla_central
            SET estado_envio = 'pendiente'
            WHERE estado_envio IN ('completado', 'error_json', 'error', 'procesando')
        """)
        n_reset = int(resultado_reset.split()[-1])
        print(f"  Registros reseteados a 'pendiente': {n_reset:,}")

        # ── Verificacion final ────────────────────────────────
        print("\n─── Estado final ─────────────────────────────────────")
        filas_final = await conn.fetch("""
            SELECT estado_envio, COUNT(*) AS n
            FROM staging.tabla_central
            GROUP BY estado_envio ORDER BY n DESC
        """)
        for row in filas_final:
            print(f"  staging.tabla_central [{row['estado_envio']:15s}] {row['n']:>6,}")

        con_clima_post = await conn.fetchval("""
            SELECT COUNT(*) FROM staging.tabla_central
            WHERE (vector_bruto->'clima_davis') IS NOT NULL
              AND vector_bruto->'clima_davis' != 'null'::jsonb
        """)
        print(f"\n  Con clima Davis listo para Qwen: {con_clima_post:,}")

    await pool.close()
    print("\nQwen Worker procesara automaticamente los registros pendientes.")
    print("Monitorea con: docker logs isla_qwen -f")
    print("Al terminar, ejecuta: docker cp forzar_vectorizacion.py isla_habitos:/app/")
    print("                       docker exec isla_habitos python /app/forzar_vectorizacion.py")
    print("\nListo.")


if __name__ == "__main__":
    asyncio.run(main())
