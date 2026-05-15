"""
Davis AirLink Poller — Fase 2 (Componente Sensor)
Consulta WeatherLink API cada POLL_INTERVAL segundos
e inserta en staging.tabla_davis

TIMESTAMP : UTC homologado con webservice/main.py y edge/server.py
TEMPERATURA: La API WeatherLink devuelve °F → convertida a °C al insertar
SENSOR     : Filtra sensor_type=323 (AirLink), toma el registro más reciente por ts
AQI        : Llave corregida → aqi_val
"""
import os
import time
import hashlib
import hmac
import logging
import asyncio
import asyncpg
import httpx
from datetime import datetime, timezone

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [DAVIS] %(levelname)s %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("davis_poller")

# ── Config ────────────────────────────────────────────────────
API_KEY       = os.getenv("DAVIS_API_KEY",    "")
API_SECRET    = os.getenv("DAVIS_API_SECRET", "")
STATION_ID    = os.getenv("DAVIS_STATION_ID", "")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "300"))
DB_DSN        = os.getenv("DATABASE_URL",
    "postgresql://postgres:postgres@isla_postgres:5432/postgres")

if not API_KEY or not API_SECRET or not STATION_ID:
    raise RuntimeError(
        "❌ Variables de entorno requeridas no configuradas: "
        "DAVIS_API_KEY, DAVIS_API_SECRET, DAVIS_STATION_ID. "
        "Configúralas en el archivo .env del servidor."
    )


def utcnow() -> datetime:
    """UTC sin tzinfo — homologado con main.py y server.py"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def f_a_c(valor_f) -> float | None:
    """Convierte Fahrenheit → Celsius. Devuelve None si el valor es None."""
    if valor_f is None:
        return None
    return round((valor_f - 32) * 5 / 9, 2)


def construir_firma(station_id: str, api_key: str, api_secret: str) -> tuple[str, str]:
    ts = str(int(time.time()))
    mensaje = f"api-key{api_key}station-id{station_id}t{ts}"
    firma = hmac.new(
        api_secret.encode("utf-8"),
        mensaje.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return ts, firma


def extraer_datos_sensores(datos: dict) -> dict | None:
    if "sensors" not in datos:
        log.warning("Respuesta sin 'sensors': %s", list(datos.keys()))
        return None

    # ── 1. Filtrar solo sensor_type=323 (AirLink PM + clima) ──
    sensores_clima = []
    for sensor in datos["sensors"]:
        if sensor.get("sensor_type") == 323:
            for registro in sensor.get("data", []):
                sensores_clima.append(registro)

    if not sensores_clima:
        log.warning("No se encontraron sensores de clima/partículas (sensor_type=323)")
        return None

    # ── 2. Tomar el registro más reciente por timestamp ────────
    sensores_clima.sort(key=lambda x: x.get("ts", 0), reverse=True)
    r = sensores_clima[0]

    # ── 3. Extraer campos con llaves correctas de la API ───────
    resultado = {
        "pm10":         r.get("pm_10"),
        "pm1":          r.get("pm_1"),
        "pm2_5":        r.get("pm_2p5"),
        "aqi":          r.get("aqi_val"),          # ← corregido (antes aqi_pm10)
        "temperatura":  f_a_c(r.get("temp")),      # °F → °C
        "humedad":      r.get("hum"),
        "punto_rocio":  f_a_c(r.get("dew_point")), # °F → °C
        "indice_calor": f_a_c(r.get("heat_index")),# °F → °C
        # Hora real del sensor (solo para logging)
        "_hora_sensor": datetime.fromtimestamp(
            r.get("ts", 0), timezone.utc
        ).strftime("%H:%M:%S")
    }

    if resultado["pm10"] is None and resultado["temperatura"] is None:
        log.warning("Registro más reciente sin PM10 ni temperatura — saltando")
        return None

    return resultado


async def insertar_davis(pool: asyncpg.Pool, datos: dict):
    ts = utcnow()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO staging.tabla_davis
                (aqi, pm1, pm2_5, pm10, temperatura, humedad,
                 punto_rocio, indice_calor, estampa_tiempo)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        """,
            datos["aqi"],         datos["pm1"],    datos["pm2_5"],  datos["pm10"],
            datos["temperatura"], datos["humedad"],
            datos["punto_rocio"], datos["indice_calor"],
            ts
        )
    log.info(
        "✅ Davis | Sensor=%s UTC | Descarga=%s UTC | "
        "PM10=%.2f µg/m³ | Temp=%.1f°C | Hum=%.1f%% | AQI=%s",
        datos["_hora_sensor"],
        ts.strftime("%H:%M:%S"),
        datos["pm10"]         or 0,
        datos["temperatura"]  or 0,
        datos["humedad"]      or 0,
        datos["aqi"]          or "—",
    )


async def poll_loop(pool: asyncpg.Pool):
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            try:
                ts, firma = construir_firma(STATION_ID, API_KEY, API_SECRET)
                url = (
                    f"https://api.weatherlink.com/v2/current/{STATION_ID}"
                    f"?api-key={API_KEY}&t={ts}&api-signature={firma}"
                )
                resp = await client.get(url)
                resp.raise_for_status()
                datos_raw = resp.json()

                datos = extraer_datos_sensores(datos_raw)
                if datos:
                    await insertar_davis(pool, datos)
                else:
                    log.warning("⚠️  Datos vacíos o no reconocidos de la API")

            except httpx.HTTPStatusError as e:
                log.error("❌ HTTP %d — %s", e.response.status_code, e.response.text[:200])
            except Exception as e:
                log.error("❌ Error en poll: %s", e)

            log.info("💤 Esperando %ds para siguiente poll...", POLL_INTERVAL)
            await asyncio.sleep(POLL_INTERVAL)


async def main():
    log.info(
        "🚀 Davis Poller iniciando | station=%s | intervalo=%ds | tz=UTC | temp=°C",
        STATION_ID, POLL_INTERVAL
    )
    for intento in range(20):
        try:
            pool = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=3)
            log.info("✅ Conexión a PostgreSQL establecida")
            break
        except Exception as e:
            log.warning("⏳ Esperando postgres... (%d/20): %s", intento + 1, e)
            await asyncio.sleep(5)
    else:
        raise RuntimeError("No se pudo conectar a PostgreSQL después de 20 intentos")

    await poll_loop(pool)


if __name__ == "__main__":
    asyncio.run(main())
