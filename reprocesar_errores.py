"""
reprocesar_errores.py
─────────────────────
Resetea a 'pendiente' los registros de staging.tabla_central que quedaron
en estado 'error' o 'error_json' para que qwen_worker los vuelva a procesar.

También opcionalmente reprocesa capturas_crudas con estado 'error' o 'timeout'
en datalake para reenviarlas a LLaVA.

Uso:
    python reprocesar_errores.py [--qwen] [--llava] [--dry-run]

    --qwen     Resetea registros en staging.tabla_central (default: activado)
    --llava    Resetea capturas en datalake.capturas_crudas (default: no)
    --dry-run  Solo muestra cuántos registros se verían afectados, sin modificar nada

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
DO_QWEN  = "--llava" not in sys.argv or "--qwen" in sys.argv   # qwen por defecto
DO_LLAVA = "--llava" in sys.argv


async def main():
    print("🔌 Conectando a PostgreSQL...")
    pool = await asyncpg.create_pool(POSTGRES_DSN, min_size=1, max_size=3)

    async with pool.acquire() as conn:

        # ── 1. staging.tabla_central → qwen_worker ────────────────
        if DO_QWEN:
            conteo = await conn.fetchval("""
                SELECT COUNT(*) FROM staging.tabla_central
                WHERE estado_envio IN ('error', 'error_json')
            """)
            print(f"\n📊 staging.tabla_central — registros con error: {conteo}")

            if conteo == 0:
                print("   ✅ Nada que reprocesar en staging.")
            elif DRY_RUN:
                print(f"   [DRY-RUN] Se resetearían {conteo} registros a 'pendiente'.")
            else:
                resultado = await conn.execute("""
                    UPDATE staging.tabla_central
                    SET estado_envio = 'pendiente'
                    WHERE estado_envio IN ('error', 'error_json')
                """)
                n = int(resultado.split()[-1])
                print(f"   ✅ {n} registros reseteados → 'pendiente'. qwen_worker los procesará automáticamente.")

            # Mostrar también cuántos siguen procesando (stuck)
            stuck = await conn.fetchval("""
                SELECT COUNT(*) FROM staging.tabla_central
                WHERE estado_envio = 'procesando'
                  AND estampa_tiempo < NOW() - INTERVAL '10 minutes'
            """)
            if stuck > 0:
                print(f"\n   ⚠️  {stuck} registros en 'procesando' por más de 10 min (crash recovery).")
                if not DRY_RUN:
                    resultado2 = await conn.execute("""
                        UPDATE staging.tabla_central
                        SET estado_envio = 'pendiente'
                        WHERE estado_envio = 'procesando'
                          AND estampa_tiempo < NOW() - INTERVAL '10 minutes'
                    """)
                    n2 = int(resultado2.split()[-1])
                    print(f"   ✅ {n2} registros stuck reseteados también.")

        # ── 2. datalake.capturas_crudas → LLaVA ──────────────────
        if DO_LLAVA:
            for estado in ("error", "timeout"):
                conteo_llava = await conn.fetchval(
                    f"SELECT COUNT(*) FROM datalake.capturas_crudas WHERE estado_llava='{estado}'"
                )
                print(f"\n📊 datalake.capturas_crudas — estado '{estado}': {conteo_llava}")
                if conteo_llava == 0:
                    print(f"   ✅ Nada con estado '{estado}'.")
                elif DRY_RUN:
                    print(f"   [DRY-RUN] Se resetearían {conteo_llava} a 'pendiente'.")
                else:
                    resultado3 = await conn.execute(f"""
                        UPDATE datalake.capturas_crudas
                        SET estado_llava = 'pendiente'
                        WHERE estado_llava = '{estado}'
                    """)
                    n3 = int(resultado3.split()[-1])
                    print(f"   ✅ {n3} capturas reseteadas → 'pendiente'. Usa reprocesar_timeouts.py para reenviar a LLaVA.")

        # ── 3. Resumen del estado actual ──────────────────────────
        print("\n─── Estado actual del pipeline ───────────────────────")

        filas_central = await conn.fetch("""
            SELECT estado_envio, COUNT(*) AS n
            FROM staging.tabla_central
            GROUP BY estado_envio
            ORDER BY n DESC
        """)
        print("\nstaging.tabla_central:")
        for row in filas_central:
            print(f"   {row['estado_envio']:25s}  {row['n']:>6,}")

        filas_datalake = await conn.fetch("""
            SELECT estado_llava, COUNT(*) AS n
            FROM datalake.capturas_crudas
            GROUP BY estado_llava
            ORDER BY n DESC
        """)
        print("\ndatalake.capturas_crudas:")
        for row in filas_datalake:
            print(f"   {row['estado_llava']:25s}  {row['n']:>6,}")

        hechos = await conn.fetchval(
            "SELECT COUNT(*) FROM warehouse.hechos_actividades_escenaurbana"
        )
        vectores = await conn.fetchval(
            "SELECT COUNT(*) FROM warehouse.hechos_vectores_descripcion_habitos WHERE vector_habito IS NOT NULL"
        )
        con_umap = await conn.fetchval(
            "SELECT COUNT(*) FROM warehouse.hechos_vectores_descripcion_habitos WHERE umap_x IS NOT NULL"
        )
        print(f"\nwarehouse:")
        print(f"   hechos_actividades_escenaurbana  {hechos:>6,}")
        print(f"   vectores con embedding           {vectores:>6,}")
        print(f"   vectores con UMAP                {con_umap:>6,}")

    await pool.close()
    print("\n🏁 Listo.")


if __name__ == "__main__":
    asyncio.run(main())
