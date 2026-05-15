"""
Qwen Worker — Fase 3 (Orquestador) + Fase 4 (ETL → Star Schema)
Lee tabla_central pendiente → llama Qwen via Ollama → carga DW estrella

Validacion de coherencia IA integrada:
  - Cruce PM10 vs nivel_riesgo_salud
  - Coherencia fumando + postura + social
  - Deteccion de campos LLaVA vacios
"""
import os
import re
import json
import time
import logging
import asyncio
import asyncpg
import httpx
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [QWEN] %(levelname)s %(message)s",
    datefmt="%H:%M:%S"
)
log = logging.getLogger("qwen_worker")

# ── Config ────────────────────────────────────────────────────
OLLAMA_URL    = os.getenv("OLLAMA_URL",    "http://isla_ollama_qwen:11434")
QWEN_MODEL    = os.getenv("QWEN_MODEL",    "qwen2.5:14b")
DB_DSN        = os.getenv("DATABASE_URL",
    "postgresql://postgres:postgres@isla_postgres:5432/postgres")
POLL_SLEEP               = int(os.getenv("POLL_SLEEP", "2"))
CAMPUS                   = os.getenv("CAMPUS",  "Campus Principal")
ZONA                     = os.getenv("ZONA",    "Acceso Norte")
CAMARA                   = os.getenv("CAMARA",  "rtsp_cam_01")
# Umbral de confianza de LLaVA para confirmar fumado.
# Ajustable via env var sin reconstruir imagen.
CONFIANZA_FUMADO_UMBRAL  = float(os.getenv("CONFIANZA_FUMADO_UMBRAL", "0.60"))

# ── Vocabulario canónico de actividades ──────────────────────
ACTIVIDAD_VOCAB = {
    "estudiar":     ["estudi", "leer", "leyendo", "cuaderno", "libro", "apuntes",
                     "laptop", "computadora", "escribiendo", "escribir", "trabajando"],
    "usar_celular": ["celular", "telefono", "movil", "smartphone", "whatsapp"],
    "comer":        ["comer", "comiendo", "bebiendo", "beber", "almorzando",
                     "almuerzo", "comida", "snack"],
    "caminar":      ["caminando", "caminar", "paseo", "paseando", "caminata",
                     "desplaz", "transitar", "transite"],
    "reunion":      ["reunion", "conversando", "conversar", "platicando", "platicar",
                     "grupo", "hablar", "dialogando"],
    "descansar":    ["descansar", "descansando", "estatico", "sentado", "parado",
                     "sin actividad", "dormir", "durmiendo", "dormido", "tumbado",
                     "acostado", "reposo", "idle"],
    "escena_vacia": ["escena vacia", "escena_vacia", "nadie", "vacio", "sin personas",
                     "sin presencia", "no hay"],
    "otro":         [],
}

def normalizar_actividad(raw: str | None, analisis: dict | None = None) -> str:
    """Mapea la respuesta libre de Qwen al vocabulario canónico.
    Si no hay personas presentes, fuerza escena_vacia sin importar el texto."""
    if analisis is not None:
        sin_personas = not analisis.get("presencia_humana", True)
        cero_personas = int(analisis.get("conteo_personas") or 0) == 0
        if sin_personas and cero_personas:
            return "escena_vacia"
    if not raw:
        return "otro"
    texto = raw.lower().strip()
    for etiqueta, keywords in ACTIVIDAD_VOCAB.items():
        if etiqueta == "otro":
            continue
        if any(kw in texto for kw in keywords):
            return etiqueta
    return "otro"


# ── Deteccion de plantilla LLaVA ─────────────────────────────
_RE_PLANTILLA_RESUMEN = re.compile(
    r"oraciones? describiendo|patron de comportamiento\.$|quien hace qu[eé]",
    re.IGNORECASE
)

def es_plantilla_llava(vision: dict) -> bool:
    """
    True si LLaVA devolvio el template del prompt en lugar de analizar la imagen.
    Indicadores: actividad contiene '|' o es 'verbo_contexto', o el resumen
    es literalmente el texto de instruccion del prompt.
    """
    actividad = str(vision.get("actividad") or "")
    resumen   = str(vision.get("resumen_semantico") or "")
    if "|" in actividad:
        return True
    if actividad.strip().lower() in ("verbo_contexto", "verbo+contexto"):
        return True
    if _RE_PLANTILLA_RESUMEN.search(resumen):
        return True
    return False


# ── Patron de palabras vagas en resumenes ─────────────────────
_RE_VAGO = re.compile(
    r"\b(sin dato|desconocido|n/?a|indeterminado|no se puede|"
    r"no aplica|no visible|no detectado|no determinado|unclear)\b",
    re.IGNORECASE
)

# ── Calidad del aire segun EPA/OMS ───────────────────────────
def _calidad_aire(pm10) -> tuple[str, str]:
    if pm10 is None:    return "sin_dato", "bajo"
    elif pm10 < 54:     return "buena",    "bajo"
    elif pm10 < 154:    return "moderada", "moderado"
    elif pm10 < 254:    return "insalubre_sensibles", "alto"
    else:               return "insalubre", "critico"


# ── Validacion de coherencia interna del JSON de Qwen ─────────
def validar_coherencia(analisis: dict, clima: dict | None, id_ref: int = 0
                       ) -> tuple[bool, str | None]:
    """
    Retorna (baja_calidad: bool, alertas: str | None).
    baja_calidad = True cuando hay 2+ alertas activas.
    alertas = cadena separada por '|', ej: 'resumen_corto|pm10_bajo+riesgo_alto'
    """
    alertas = []

    resumen  = analisis.get("resumen_semantico") or ""
    palabras = len(resumen.split())
    fumando  = analisis.get("esta_fumando", False)
    actividad = (analisis.get("actividad") or "").lower()
    social    = (analisis.get("interaccion_social") or "").lower()
    personas  = int(analisis.get("conteo_personas") or 0)
    presencia = analisis.get("presencia_humana", False)
    riesgo    = (analisis.get("nivel_riesgo_salud") or "bajo").lower()

    # 1. Resumen demasiado corto
    if palabras < 5:
        alertas.append("resumen_corto")

    # 2. Resumen con palabras evasivas
    if _RE_VAGO.search(resumen):
        alertas.append("resumen_vago")

    # 3. Fumando + postura incompatible
    if fumando and actividad in ("durmiendo", "dormido", "tumbado", "acostado", "sleeping"):
        alertas.append("fumando_postura_imposible")

    # 4. Personas vs interaccion social contradictorias
    if personas == 0 and "grupo" in social:
        alertas.append("cero_personas_en_grupo")
    if personas >= 3 and social == "solo":
        alertas.append("3_personas_marcado_solo")

    # 5. presencia_humana vs conteo_personas contradictorios
    if not presencia and personas > 0:
        alertas.append("presencia_false_personas_positivo")
    if presencia and personas == 0:
        alertas.append("presencia_true_cero_personas")

    # 6. PM10 bajo con riesgo alto o critico (cruce ambiental)
    if clima:
        pm10 = clima.get("pm10")
        if pm10 is not None and float(pm10) < 40 and riesgo in ("alto", "critico"):
            alertas.append(f"pm10_bajo_{float(pm10):.0f}_riesgo_{riesgo}")

    # 7. Campos criticos de LLaVA vacios
    campos_clave = ["actividad", "postura_dominante", "resumen_semantico"]
    n_vacios = sum(1 for c in campos_clave if not analisis.get(c))
    if n_vacios >= 2:
        alertas.append(f"campos_vacios_{n_vacios}_de_3")

    baja_calidad  = len(alertas) >= 2
    alertas_str   = "|".join(alertas) if alertas else None

    if alertas:
        nivel = logging.WARNING if baja_calidad else logging.DEBUG
        log.log(nivel, "🔎 Coherencia id=%d alertas=%s", id_ref, alertas_str)

    return baja_calidad, alertas_str


def detectar_baja_calidad_llava(vision: dict) -> bool:
    """
    True si LLaVA entrego 2+ de 3 campos clave vacios o invalidos.
    Indica que la captura fue de baja calidad o LLaVA no pudo procesar la imagen.
    """
    INVALIDOS = {
        "", "desconocido", "n/a", "no_detectado", "no se puede determinar",
        "indeterminado", "none", "null", "sin dato", "unclear", "unknown"
    }
    campos = ["actividad", "postura_dominante", "resumen_semantico"]
    n_malos = sum(
        1 for c in campos
        if str(vision.get(c, "") or "").strip().lower() in INVALIDOS
    )
    return n_malos >= 2


# ── Franjas horarias académicas ───────────────────────────────
_DIAS_ES = {
    "Monday": "Lunes", "Tuesday": "Martes", "Wednesday": "Miércoles",
    "Thursday": "Jueves", "Friday": "Viernes", "Saturday": "Sábado", "Sunday": "Domingo",
}

def _franja_horaria(hora: int) -> str:
    if hora < 7:   return "madrugada (fuera de horario académico)"
    if hora < 10:  return "mañana temprana (inicio de clases)"
    if hora < 13:  return "mañana media (clases en curso)"
    if hora < 15:  return "mediodía / receso de comida"
    if hora < 18:  return "tarde (clases vespertinas)"
    if hora < 21:  return "noche (clases nocturnas o estudio tardío)"
    return "noche avanzada (fuera de horario)"


# ── Prompt Qwen ───────────────────────────────────────────────
def construir_prompt_qwen(vector_bruto: dict, ts: datetime) -> str:
    vision = vector_bruto.get("vision_llava", {})
    clima  = vector_bruto.get("clima_davis",  {})

    if isinstance(vision, str):
        try:
            vision = json.loads(vision)
        except (json.JSONDecodeError, TypeError):
            vision = {"descripcion_breve": str(vision)[:500]}
    if not isinstance(vision, dict):
        vision = {}

    pm10 = clima.get("pm10") if clima else None
    temp = clima.get("temp") if clima else None
    hum  = clima.get("hum")  if clima else None

    calidad_str, riesgo_base = _calidad_aire(pm10)

    fumando_llava     = vision.get("fumando", False)
    confianza_fumando = float(vision.get("confianza_fumando", 0.0))
    umbral            = CONFIANZA_FUMADO_UMBRAL

    # ── Contexto temporal ─────────────────────────────────────
    hora    = ts.hour
    dia_es  = _DIAS_ES.get(ts.strftime("%A"), ts.strftime("%A"))
    franja  = _franja_horaria(hora)

    # ── Validación semántica del fumado ───────────────────────
    # En lugar de solo comparar número vs umbral, Qwen debe cruzar
    # la confianza numérica con la coherencia del texto de LLaVA.
    if fumando_llava and confianza_fumando >= umbral:
        regla_fumado = (
            f"LLaVA reportó fumando=true con confianza={confianza_fumando:.2f} (>= umbral {umbral:.2f}). "
            f"LEE el resumen_semantico y los objetos_detectados de LLaVA y valida que sean coherentes "
            f"con fumar (humo visible, cigarro, vaper, gesto repetido). "
            f"Si la descripción menciona objetos incompatibles (lápiz, pluma, comida, libro) o posturas "
            f"imposibles (dormido, acostado), descarta fumado aunque la confianza supere el umbral. "
            f"Solo confirma esta_fumando=true si la descripción es semánticamente coherente con fumar."
        )
    elif fumando_llava and confianza_fumando < umbral:
        regla_fumado = (
            f"LLaVA reportó fumando=true pero confianza={confianza_fumando:.2f} < umbral {umbral:.2f}. "
            f"DESCARTA fumado salvo que el resumen_semantico o los objetos_detectados de LLaVA "
            f"describan explícitamente humo, cigarro o vaper. En ese caso confirma esta_fumando=true."
        )
    else:
        regla_fumado = (
            f"LLaVA reportó fumando=false (confianza={confianza_fumando:.2f}). "
            f"Confirma esta_fumando=false. Solo sobreescribe a true si el resumen_semantico "
            f"de LLaVA describe explícitamente humo visible o cigarro encendido (contradicción interna)."
        )

    if pm10 is None:
        guia_riesgo = f"Sin datos ambientales: basarse solo en actividad. Riesgo base: {riesgo_base}."
    else:
        guia_riesgo = (
            f"PM10={pm10:.1f} ug/m3 ({calidad_str}) → riesgo_base={riesgo_base}. "
            "Escalar a 'alto' si nivel_actividad moderado/alto con PM10>54. "
            "Escalar a 'critico' si esta_fumando=true con PM10>54 en exterior."
        )

    clima_str = (
        f"PM10: {pm10:.1f} ug/m3 ({calidad_str}) | Temp: {temp:.1f}C | Hum: {hum:.0f}%"
        if pm10 is not None else
        "Sin datos del sensor Davis disponibles."
    )

    return f"""Eres un sistema experto de análisis de comportamiento urbano para campus universitario (ESCOM IPN).
Valida y sintetiza los datos de visión (LLaVA) con el contexto ambiental (Davis AirLink) y el contexto temporal.

CONTEXTO TEMPORAL: {hora:02d}:xx hrs — {dia_es} — {franja}

DATOS DE VISIÓN — LLaVA 13b:
{json.dumps(vision, ensure_ascii=False, indent=2)}

DATOS AMBIENTALES — Davis AirLink:
{clima_str}

INSTRUCCIONES:
ETAPA 1 — VALIDACIÓN SEMÁNTICA DE FUMADO: {regla_fumado}
ETAPA 2 — NIVEL DE RIESGO: {guia_riesgo}
ETAPA 3 — DECIDIR CAMPOS ESTRUCTURADOS (elige EXACTAMENTE del vocabulario cerrado):
  actividad: estudiar (leer, laptop, cuaderno, apuntes) | usar_celular (celular como actividad principal) |
    comer (comer o beber) | caminar (desplazarse, pasear) | reunion (conversación activa en grupo) |
    descansar (sin actividad específica, estático, dormir) | escena_vacia (sin personas) | otro
  postura_dominante: sentado | parado | caminando | otro
  interaccion_social: solo | en_pareja | en_grupo_pequeno | en_grupo_grande
  conteo_personas: número entero ≥ 0
  presencia_humana: true si conteo_personas > 0, false si es 0
  objetos_detectados: lista de objetos visibles

ETAPA 4 — SÍNTESIS ENRIQUECIDA (exactamente 3 oraciones para resumen_semantico, sin etiquetas ni prefijos):
  Primera oración: describe qué se observa visualmente. DEBE reflejar los campos estructurados de ETAPA 3:
    - actvidad elegida
    - interaccion_social: si es "solo" → "Una persona/un estudiante [actividad]..."
      si es "en_pareja" → "Dos estudiantes/una pareja [actividad]..."
      si es "en_grupo_pequeno" → "Un grupo pequeño [actividad]..."
      si es "en_grupo_grande" → "Un grupo grande [actividad]..."
    - postura dominante y objetos detectados
  Segunda oración: describe qué implica el contexto ambiental (PM10, temperatura, riesgo).
  Tercera oración: describe qué patrón académico o conductual sugiere la combinación dado el horario.

REGLAS DE CONSISTENCIA:
  - interaccion_social elegido DEBE coincidir con la descripción de la primera oración
  - NO uses "posible", "quizás", "probablemente" para fumar
  - Si esta_fumando=false: NO menciones fumar, cigarro, tabaco ni tabaquismo en ninguna oración
  - Si esta_fumando=true: menciónalo explícitamente (ej: "una persona fumando")
  - conteo_personas y presencia_humana deben ser consistentes entre sí

RESPUESTA — JSON EXACTO (sin markdown, sin texto extra):
{{
  "esta_fumando": false,
  "actividad": "estudiar|usar_celular|comer|caminar|reunion|descansar|escena_vacia|otro",
  "postura_dominante": "sentado|parado|caminando|otro",
  "interaccion_social": "solo|en_pareja|en_grupo_pequeno|en_grupo_grande",
  "objetos_detectados": ["lista", "de", "objetos"],
  "resumen_semantico": "Oración 1 visual. Oración 2 ambiental. Oración 3 patrón conductual.",
  "nivel_riesgo_salud": "bajo|moderado|alto|critico",
  "conteo_personas": 0,
  "presencia_humana": false
}}"""


# ── Limpieza de respuesta Qwen ────────────────────────────────
def limpiar_respuesta_qwen(texto: str) -> dict:
    limpio = re.sub(r"```(?:json)?\s*", "", texto, flags=re.IGNORECASE)
    limpio = limpio.replace("```", "").strip()
    try:
        return json.loads(limpio)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', limpio, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise


# ── Crash recovery ─────────────────────────────────────────────
async def resetear_procesando(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        resultado = await conn.execute("""
            UPDATE staging.tabla_central
            SET estado_envio = 'pendiente'
            WHERE estado_envio = 'procesando'
              AND estampa_tiempo < NOW() - INTERVAL '10 minutes'
        """)
    n = int(resultado.split()[-1])
    if n > 0:
        log.warning("Crash recovery: %d registros reseteados procesando→pendiente", n)


# ── Llamada a Qwen con reintentos ────────────────────────────
async def llamar_qwen(client: httpx.AsyncClient, prompt: str, max_intentos: int = 3) -> dict:
    ultimo_error = None
    for intento in range(max_intentos):
        temperatura = max(0.05, 0.1 - intento * 0.03)
        payload = {
            "model":  QWEN_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": temperatura, "num_predict": 512}
        }
        resp = await client.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=120)
        resp.raise_for_status()
        texto = resp.json().get("response", "")
        try:
            return limpiar_respuesta_qwen(texto)
        except (json.JSONDecodeError, ValueError) as e:
            ultimo_error = e
            log.warning("Qwen JSON invalido (intento %d/%d, temp=%.2f): %s",
                        intento + 1, max_intentos, temperatura, e)
            if intento < max_intentos - 1:
                await asyncio.sleep(2)
    raise ultimo_error


# ── Cross-validacion YOLO smoking vs LLaVA ───────────────────
def validar_fumado_cruzado(
    analisis: dict,
    smoking_det: dict | None
) -> tuple[str, float | None]:
    """
    Cruza la deteccion YOLO de cigarro con el analisis LLaVA+Qwen.
    Muta 'analisis' si la decision de fumado debe cambiar.

    Retorna (smoking_source: str, yolo_conf: float | None).

    Reglas de decision:
      YOLO=True  + LLaVA=True  → 'confirmado_ambos'
            esta_fumando queda True — ambas fuentes confirman.

      YOLO=True  + LLaVA=False → 'alucinacion_llava'
            esta_fumando = False — YOLO ve cigarro pero LLaVA no confirma.
            Si confianza YOLO >= CONFIANZA_FUMADO_UMBRAL: esta_fumando = True
            (YOLO tiene precedencia cuando su confianza es alta).

      YOLO=False + LLaVA=True  → 'solo_llava_sin_cigarro'
            esta_fumando = False — LLaVA dice que fuma pero YOLO no ve cigarro.
            Se descarta el fumado por falta de evidencia visual directa.

      YOLO=False + LLaVA=False → 'negativo_confirmado'
            esta_fumando queda False — ambas fuentes descartan fumado.

      Sin datos YOLO           → 'sin_datos_yolo'
            Sin cambios — flujo normal pre-smoking-detection.

    La camara termica contribuye como bonus de confianza:
      Si thermal_hotspot=True y YOLO tambien detecto:
        yolo_conf += 0.10 (capped a 1.0) antes de aplicar umbral.
    """
    if not smoking_det or not smoking_det.get('yolo_available', False):
        return 'sin_datos_yolo', None

    yolo_detected = bool(smoking_det.get('yolo_cigarette_detected', False))
    yolo_conf     = float(smoking_det.get('yolo_cigarette_conf', 0.0))
    thermal_hot   = bool(smoking_det.get('thermal_hotspot', False))
    esta_fumando  = bool(analisis.get('esta_fumando', False))

    # Bonus termico: aumenta confianza cuando termica y YOLO coinciden
    conf_efectiva = yolo_conf
    if yolo_detected and thermal_hot:
        conf_efectiva = min(1.0, yolo_conf + 0.10)

    if yolo_detected and esta_fumando:
        # Ambas fuentes confirman
        analisis['esta_fumando'] = True
        log.info("SMOKING CROSS-VAL: confirmado_ambos (yolo=%.2f thermal=%s)",
                 conf_efectiva, thermal_hot)
        return 'confirmado_ambos', round(conf_efectiva, 3)

    if yolo_detected and not esta_fumando:
        # YOLO ve cigarro pero LLaVA no confirma
        if conf_efectiva >= CONFIANZA_FUMADO_UMBRAL:
            # Confianza YOLO alta: sobreescribir LLaVA (posible alucinacion negativa)
            analisis['esta_fumando'] = True
            log.warning("SMOKING CROSS-VAL: alucinacion_llava SOBREESCRITA "
                        "(yolo=%.2f >= umbral=%.2f)", conf_efectiva, CONFIANZA_FUMADO_UMBRAL)
        else:
            # Confianza YOLO baja: descartar fumado
            analisis['esta_fumando'] = False
            log.info("SMOKING CROSS-VAL: alucinacion_llava DESCARTADA (yolo=%.2f < umbral=%.2f)",
                     conf_efectiva, CONFIANZA_FUMADO_UMBRAL)
        return 'alucinacion_llava', round(conf_efectiva, 3)

    if not yolo_detected and esta_fumando:
        # LLaVA dice que fuma pero YOLO no ve cigarro — descartar
        analisis['esta_fumando'] = False
        log.info("SMOKING CROSS-VAL: solo_llava_sin_cigarro — fumado descartado por YOLO")
        return 'solo_llava_sin_cigarro', 0.0

    # Ambos negativos
    return 'negativo_confirmado', 0.0


# ── ETL Fase 4: carga modelo estrella (schema v3) ─────────────
async def etl_cargar_dw(
    conn: asyncpg.Connection,
    ts: datetime,
    analisis: dict,
    clima: dict | None,
    id_central: int,
    vision_original: dict,
    smoking_det: dict | None = None
):
    # ── Validacion de coherencia interna ──────────────────────────
    baja_calidad_llava  = detectar_baja_calidad_llava(vision_original)
    baja_calidad_qwen, alertas_str = validar_coherencia(analisis, clima, id_central)
    baja_calidad_final  = baja_calidad_llava or baja_calidad_qwen

    if baja_calidad_final:
        log.warning("Registro baja calidad id_central=%d | llava=%s | alertas=%s",
                    id_central, baja_calidad_llava, alertas_str)

    # ── Cross-validacion YOLO smoking vs LLaVA ─────────────────
    # DEBE ejecutarse despues de validar_coherencia y ANTES del INSERT,
    # ya que puede mutar analisis['esta_fumando'].
    smoking_source, yolo_conf = validar_fumado_cruzado(analisis, smoking_det)

    # Escribe confianza_fumador y fumador_valido definitivos en tabla_central.
    # El trigger puso el valor preliminar (confianza_yolo); aquí lo reemplazamos
    # con el resultado real de la cross-validación YOLO+LLaVA.
    await conn.execute("""
        UPDATE staging.tabla_central
        SET confianza_fumador = $1,
            fumador_valido    = $2
        WHERE id_central = $3
    """, yolo_conf, bool(analisis.get("esta_fumando", False)), id_central)

    # 1. dim_tiempo
    id_tiempo = await conn.fetchval("""
        INSERT INTO warehouse.dim_tiempo
            (estampa_tiempo, fecha_completa, anio, mes, dia, dia_semana, hora, minuto, id_calendario)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
            (SELECT id_calendario FROM warehouse.subcat_calendario
             WHERE fecha_oficial = $2 LIMIT 1))
        ON CONFLICT (fecha_completa, hora, minuto) DO UPDATE
            SET anio           = EXCLUDED.anio,
                id_calendario  = COALESCE(warehouse.dim_tiempo.id_calendario, EXCLUDED.id_calendario),
                estampa_tiempo = COALESCE(warehouse.dim_tiempo.estampa_tiempo, EXCLUDED.estampa_tiempo)
        RETURNING id_tiempo
    """,
        ts, ts.date(), ts.year, ts.month, ts.day,
        ts.strftime("%A"), ts.hour, ts.minute
    )

    # 2. dim_geoespacial
    id_geo = await conn.fetchval("""
        SELECT id_geoespacial FROM warehouse.dim_geoespacial
        WHERE camara = $1 LIMIT 1
    """, CAMARA)
    if not id_geo:
        id_geo = await conn.fetchval("""
            INSERT INTO warehouse.dim_geoespacial (campus, zona, camara)
            VALUES ($1,$2,$3) RETURNING id_geoespacial
        """, CAMPUS, ZONA, CAMARA)

    # 3. Calidad de aire
    pm10  = clima.get("pm10") if clima else None
    temp  = clima.get("temp") if clima else None
    hum   = clima.get("hum")  if clima else None

    if pm10 is None:    calidad = "sin_dato"
    elif pm10 < 54:     calidad = "buena"
    elif pm10 < 154:    calidad = "moderada"
    elif pm10 < 254:    calidad = "insalubre_sensibles"
    else:               calidad = "insalubre"

    # 4. hechos_actividades_escenaurbana
    actividad_norm = normalizar_actividad(analisis.get("actividad"), analisis)
    # Si la escena esta vacia no tiene sentido guardar postura ni interaccion social
    postura_norm     = None if actividad_norm == "escena_vacia" else analisis.get("postura_dominante")
    interaccion_norm = None if actividad_norm == "escena_vacia" else analisis.get("interaccion_social")

    id_hecho = await conn.fetchval("""
        INSERT INTO warehouse.hechos_actividades_escenaurbana
            (id_tiempo, id_geoespacial,
             esta_fumando, actividad, postura_dominante, interaccion_social,
             objetos_detectados, resumen_semantico,
             presencia_humana, conteo_personas, nivel_riesgo_salud,
             nivel_pm10, temperatura, humedad, calidad_aire_label,
             id_central_origen,
             smoking_source, yolo_cigarette_conf)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING id_hecho
    """,
        id_tiempo, id_geo,
        analisis.get("esta_fumando", False),
        actividad_norm,
        postura_norm,
        interaccion_norm,
        json.dumps(analisis.get("objetos_detectados", [])),
        analisis.get("resumen_semantico"),
        analisis.get("presencia_humana", False),
        analisis.get("conteo_personas", 0),
        analisis.get("nivel_riesgo_salud", "bajo"),
        pm10, temp, hum, calidad,
        id_central,
        smoking_source,
        yolo_conf
    )

    log.info("DW id_hecho=%d | id_central=%d | personas=%d | riesgo=%s | "
             "calidad_aire=%s | fumado=%s | smoking_src=%s | alertas=%s",
             id_hecho, id_central,
             analisis.get("conteo_personas", 0),
             analisis.get("nivel_riesgo_salud", "?"),
             calidad,
             analisis.get("esta_fumando", False),
             smoking_source,
             alertas_str or "ok")


# ── Ciclo principal ───────────────────────────────────────────
async def ciclo_orquestador(pool: asyncpg.Pool, client: httpx.AsyncClient):
    log.info("Ciclo orquestador iniciado")

    while True:
        async with pool.acquire() as conn:
            registro = await conn.fetchrow("""
                SELECT id_central, estampa_tiempo, vector_bruto
                FROM   staging.tabla_central
                WHERE  estado_envio = 'pendiente'
                  AND (
                      (vector_bruto -> 'clima_davis') IS NOT NULL
                      OR estampa_tiempo < NOW() - INTERVAL '6 minutes'
                  )
                ORDER  BY estampa_tiempo ASC
                LIMIT  1
                FOR UPDATE SKIP LOCKED
            """)

            if not registro:
                await asyncio.sleep(POLL_SLEEP)
                continue

            id_central   = registro["id_central"]
            ts           = registro["estampa_tiempo"]
            vector_bruto = registro["vector_bruto"]

            if isinstance(vector_bruto, str):
                vector_bruto = json.loads(vector_bruto)

            log.info("Procesando id_central=%d  ts=%s", id_central, ts)

            try:
                await conn.execute("""
                    UPDATE staging.tabla_central
                    SET estado_envio = 'procesando'
                    WHERE id_central = $1
                """, id_central)

                vision_check = vector_bruto.get("vision_llava", {})
                if isinstance(vision_check, str):
                    try:
                        vision_check = json.loads(vision_check)
                    except Exception:
                        vision_check = {}
                if es_plantilla_llava(vision_check):
                    log.warning("Plantilla LLaVA detectada — omitiendo Qwen id_central=%d", id_central)
                    await conn.execute("""
                        UPDATE staging.tabla_central
                        SET estado_envio = 'baja_calidad_llava'
                        WHERE id_central = $1
                    """, id_central)
                    continue

                prompt   = construir_prompt_qwen(vector_bruto, ts)
                analisis = await llamar_qwen(client, prompt)
                log.info("Qwen: fumando=%s | actividad=%s",
                         analisis.get("esta_fumando"),
                         str(analisis.get("actividad", "?"))[:50])

                clima           = vector_bruto.get("clima_davis")
                vision_original = vector_bruto.get("vision_llava", {})
                # smoking_detection viene de la isla via la tabla_llava.smoking_json
                # y fue propagado al vector_bruto por el trigger fn_auto_llenado_central
                smoking_det     = vector_bruto.get("smoking_detection")

                if isinstance(vision_original, str):
                    try:
                        vision_original = json.loads(vision_original)
                    except Exception:
                        vision_original = {}

                async with conn.transaction():
                    await etl_cargar_dw(
                        conn, ts, analisis, clima, id_central,
                        vision_original, smoking_det
                    )
                    await conn.execute("""
                        UPDATE staging.tabla_central
                        SET estado_envio = 'completado'
                        WHERE id_central = $1
                    """, id_central)

            except json.JSONDecodeError as e:
                log.error("Qwen no devolvio JSON valido: %s", e)
                await conn.execute("""
                    UPDATE staging.tabla_central SET estado_envio='error_json'
                    WHERE id_central=$1
                """, id_central)

            except Exception as e:
                log.error("Error procesando id_central=%d: %s", id_central, e)
                await conn.execute("""
                    UPDATE staging.tabla_central SET estado_envio='error'
                    WHERE id_central=$1
                """, id_central)

        await asyncio.sleep(0.5)


async def main():
    log.info("Qwen Worker iniciando | modelo=%s", QWEN_MODEL)

    for i in range(20):
        try:
            pool = await asyncpg.create_pool(DB_DSN, min_size=1, max_size=5)
            log.info("PostgreSQL conectado")
            break
        except Exception as e:
            log.warning("Esperando postgres (%d/20): %s", i+1, e)
            await asyncio.sleep(5)
    else:
        raise RuntimeError("No se pudo conectar a PostgreSQL")

    async with httpx.AsyncClient() as client:
        for i in range(30):
            try:
                r = await client.get(f"{OLLAMA_URL}/api/tags", timeout=5)
                modelos = [m["name"] for m in r.json().get("models", [])]
                if any(QWEN_MODEL in m for m in modelos):
                    log.info("Modelo %s disponible en Ollama", QWEN_MODEL)
                    break
                else:
                    log.warning("Modelo %s no disponible aun (%d/30)", QWEN_MODEL, i+1)
            except Exception as e:
                log.warning("Esperando Ollama (%d/30): %s", i+1, e)
            await asyncio.sleep(10)

    await resetear_procesando(pool)

    async with httpx.AsyncClient() as client:
        await ciclo_orquestador(pool, client)


if __name__ == "__main__":
    asyncio.run(main())
