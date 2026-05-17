# monkey_patch DEBE ser la primera linea ejecutable, sin excepcion
import eventlet
import eventlet.tpool
eventlet.monkey_patch()

# --- Imports estandar ---
import cv2
import base64
import time
import os
import queue
import uuid
import requests
import platform
import warnings

from threading import Thread
from datetime import datetime
from flask import Flask, render_template
from flask_socketio import SocketIO, emit
from ultralytics import YOLO
from cryptography.fernet import Fernet

warnings.simplefilter(action='ignore', category=FutureWarning)

# =============================================================================
# SECCION 1: Configuracion de Seguridad y Cifrado
# =============================================================================

BASE_SAVE_PATH      = os.environ.get('SAVE_PATH',          '/mnt/memoria/photos')
KEY_FILE            = os.environ.get('ENC_KEY_FILE',        'storage_encryption.key')
HARD_CASES_PATH     = os.environ.get('HARD_CASES_PATH',     '/mnt/memoria/hard_cases')
HARD_CASES_CONF_MIN = float(os.environ.get('HARD_CASES_CONF_MIN', '0.25'))
HARD_CASES_COOLDOWN = 30  # segundos minimos entre guardados por camara

if not os.path.exists(KEY_FILE):
    with open(KEY_FILE, 'wb') as f:
        f.write(Fernet.generate_key())
    print(f"Llave de cifrado generada en: {KEY_FILE}")

with open(KEY_FILE, 'rb') as f:
    cipher_suite = Fernet(f.read())

# =============================================================================
# SECCION 2: Flask y SocketIO
# =============================================================================

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', os.urandom(24).hex())

ALLOWED_ORIGINS = os.environ.get('CORS_ORIGINS', '*')
socketio = SocketIO(app, cors_allowed_origins=ALLOWED_ORIGINS, async_mode='eventlet')

# =============================================================================
# SECCION 3: Modelo YOLO unificado — Personas + Cigarros (una sola inferencia)
#
# Un unico modelo detecta AMBAS clases en el mismo pase:
#   · Clase persona  → privacidad: blur sobre el bounding box
#   · Clase cigarro  → deteccion de fumadores: cross-validacion con LLaVA
#
# Ventaja clave: una sola inferencia a 1 Hz en lugar de dos modelos separados.
# El modelo ve a la persona Y al cigarro en el mismo contexto visual, lo que
# mejora la deteccion de cigarros en mano o cerca de la boca.
#
# Como obtener el modelo (fine-tune desde yolo11s.pt):
# ─────────────────────────────────────────────────────
# 1. Descargar dataset con clases persona + cigarro (Roboflow Universe):
#      pip install roboflow ultralytics>=8.3.0
#      # Buscar "cigarette person detection" en universe.roboflow.com
#      # Exportar en formato YOLOv11 → genera data.yaml con ambas clases
#
# 2. Fine-tune con freeze del backbone (preserva recall de personas):
#      yolo train \
#        model=yolo11s.pt \
#        data=data.yaml \
#        epochs=50 \
#        imgsz=640 \
#        freeze=10
#      # freeze=10: congela las 10 primeras capas (backbone COCO) y solo
#      # entrena la cabeza de deteccion en el nuevo dataset.
#      # Resultado: best.pt con persona + cigarro, sin perder recall COCO.
#
# 3. Copiar el modelo al volumen de la isla y configurar env var:
#      DETECTOR_MODEL_PATH=/mnt/memoria/models/detector_yolo11s.pt
#
# Modo sin modelo entrenado (transicion):
#   Si DETECTOR_MODEL_PATH no existe, se carga yolo11s.pt (COCO) como
#   fallback. Solo detectara personas (privacidad). El campo
#   yolo_available=False en el payload indica al servidor que use
#   solo LLaVA para la decision de fumado (smoking_source='sin_datos_yolo').
# =============================================================================

# Nombres de clase que representan personas → blur de privacidad + conteo
# Cubre tanto el modelo COCO base ('person') como el dataset fine-tuneado
# ('nonSmoker', 'smoker'). La comparación es con el nombre en minúsculas.
PERSON_CLASS_NAMES  = {'person', 'nonsmoker', 'smoker', 'persona'}

# Nombres de clase que indican cigarro o acto de fumar → cross-validación con LLaVA
# 'smoker' aparece también en PERSON_CLASS_NAMES: blur + conteo + evidencia de fumado.
SMOKING_CLASS_NAMES = {'cigarette', 'cigarro', 'smoke', 'humo', 'smoking', 'cigar', 'vaper', 'smoker'}

# Modelo principal: yolo11s.pt — detecta personas (privacidad) y, si fue
# fine-tuneado con clases de cigarro, también detecta fumadores.
# Para usar un modelo entrenado: DETECTOR_MODEL_PATH=/ruta/al/best.pt
# Sin ese env var usa yolo11s.pt base (solo personas, sin cigarro via YOLO).
_custom_path = os.environ.get('DETECTOR_MODEL_PATH', '')
if _custom_path and os.path.exists(_custom_path):
    yolo_detector = YOLO(_custom_path)
    print(f"[YOLO] Modelo personalizado: {_custom_path}")
else:
    yolo_detector = YOLO("yolo11s.pt")
    if _custom_path:
        print(f"[YOLO] DETECTOR_MODEL_PATH no encontrado ({_custom_path}) — usando yolo11s.pt")
    else:
        print("[YOLO] yolo11s.pt activo (personas). Para cigarro via YOLO: configura DETECTOR_MODEL_PATH.")

_detector_has_cig = any(
    any(s in n.lower() for s in SMOKING_CLASS_NAMES)
    for n in (yolo_detector.names or {}).values()
)
print(f"[YOLO] Clases cargadas: {len(yolo_detector.names or {})} | "
      f"cigarro: {'SI' if _detector_has_cig else 'no (solo personas)'}")


def run_yolo_detection(frame, conf_threshold=0.35):
    """
    Unica inferencia YOLO: detecta personas Y cigarros en el mismo pase.

    Retorna:
      person_count   — numero de personas detectadas
      avg_conf       — confianza promedio de personas
      censored_frame — frame con personas desenfocadas (privacidad)
      smoking_det    — dict listo para payload smoking_detection del servidor

    Logica de cross-validacion en servidor (qwen_worker.validar_fumado_cruzado):
      YOLO=True  + LLaVA=True  → confirmado_ambos       (pipeline normal)
      YOLO=True  + LLaVA=False → alucinacion_llava       (fumado descartado)
      YOLO=False + LLaVA=False → negativo_confirmado     (pipeline normal)
      YOLO=False + LLaVA=True  → solo_llava_sin_cigarro  (bajo confianza)
    """
    results = yolo_detector(frame, conf=conf_threshold, verbose=False)

    censored_frame = frame.copy()
    person_confs   = []
    cigarette_dets = []
    h_frame, w_frame = frame.shape[:2]

    for r in results:
        boxes_xyxy = r.boxes.xyxy.cpu().numpy()
        boxes_conf = r.boxes.conf.cpu().numpy()
        boxes_cls  = r.boxes.cls.cpu().numpy()

        for i, cls in enumerate(boxes_cls):
            cls_id   = int(cls)
            det_conf = float(boxes_conf[i])
            det_box  = boxes_xyxy[i].tolist()
            cls_name = (yolo_detector.names or {}).get(cls_id, '').lower()

            is_person  = cls_name in PERSON_CLASS_NAMES
            is_smoking = cls_name in SMOKING_CLASS_NAMES

            # Persona (nonSmoker / smoker / person) → censurar bounding box
            if is_person:
                person_confs.append(det_conf)
                x1, y1, x2, y2 = map(int, det_box)
                x1 = max(0, x1); y1 = max(0, y1)
                x2 = min(w_frame, x2); y2 = min(h_frame, y2)
                roi = censored_frame[y1:y2, x1:x2]
                if roi.size > 0:
                    censored_frame[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (99, 99), 30)

            # Cigarro / fumador → registrar para cross-validacion con LLaVA
            if is_smoking:
                cigarette_dets.append({'confidence': det_conf, 'bbox': det_box, 'cls_id': cls_id})

    person_count = len(person_confs)
    avg_conf     = sum(person_confs) / person_count if person_count > 0 else 0.0

    cig_detected = len(cigarette_dets) > 0
    cig_conf     = max((d['confidence'] for d in cigarette_dets), default=0.0)

    smoking_det = {
        'yolo_available':          _detector_has_cig,
        'yolo_cigarette_detected': cig_detected if _detector_has_cig else False,
        'yolo_cigarette_conf':     round(cig_conf, 3) if _detector_has_cig else 0.0,
        'yolo_cigarette_count':    len(cigarette_dets) if _detector_has_cig else 0,
        'yolo_cigarette_boxes':    [d['bbox']   for d in cigarette_dets] if _detector_has_cig else [],
        'yolo_cigarette_classes':  [d['cls_id'] for d in cigarette_dets] if _detector_has_cig else [],
        # Camara termica no utilizada — campos presentes para compatibilidad con servidor
        'thermal_available':       False,
        'thermal_hotspot':         False,
        'thermal_max_intensity':   None,
        'thermal_hotspot_pixels':  0,
        'thermal_hotspot_center':  None
    }

    return person_count, avg_conf, censored_frame, smoking_det

# =============================================================================
# SECCION 4: Gestion de Camaras
# =============================================================================

def find_usb_camera(max_index=5):
    """Detecta la primera camara USB disponible."""
    backend = cv2.CAP_DSHOW if platform.system() == 'Windows' else cv2.CAP_V4L2
    for i in range(max_index):
        cap = cv2.VideoCapture(i, backend)
        if cap.isOpened():
            cap.release()
            print(f"Camara USB detectada en indice {i}")
            return i
        cap.release()
    print("No se encontro camara USB")
    return None


# [FIX-BUG03] Credenciales RTSP desde variables de entorno
_RTSP_USER   = os.environ.get('RTSP_USER',   'admin')
_RTSP_PASS   = os.environ.get('RTSP_PASS',   'admin')
_RTSP_HOST   = os.environ.get('RTSP_HOST',   '10.3.56.5')
_RTSP_PARAMS = os.environ.get('RTSP_PARAMS', 'channel=2&subtype=0')
RTSP_URL = f"rtsp://{_RTSP_USER}:{_RTSP_PASS}@{_RTSP_HOST}/cam/realmonitor?{_RTSP_PARAMS}"

usb_cam_index = find_usb_camera()
_RTSP_ENABLED = os.environ.get('RTSP_ENABLED', 'false').lower() in ('1', 'true', 'yes')
CAM_SOURCES = {"usb_cam": usb_cam_index}
if _RTSP_ENABLED:
    CAM_SOURCES["rtsp_cam"] = RTSP_URL
else:
    print("[rtsp_cam] Desactivada (RTSP_ENABLED=false). Para activar: RTSP_ENABLED=true")

# Estado global por camara
video_captures        = {}
camera_locks          = {}
is_streaming          = {}
is_auto_capturing     = {}
auto_capture_interval = {}
auto_capture_prompt   = {}
responses_history     = {}
frames_descartados    = {}
connected_clients     = 0
MAX_HISTORY           = 20

for cam_id in CAM_SOURCES:
    camera_locks[cam_id]          = eventlet.semaphore.Semaphore(1)
    is_streaming[cam_id]          = False
    is_auto_capturing[cam_id]     = False
    auto_capture_interval[cam_id] = 45
    auto_capture_prompt[cam_id]   = (
        "Eres un sensor visual de comportamiento humano en campus universitario (ESCOM IPN). "
        "Tu output alimenta un sistema de analisis de habitos urbanos — cada campo importa. "
        "Analiza SOLO lo que ves con claridad en la imagen. "
        "Responde UNICAMENTE con un objeto JSON valido, sin markdown, sin texto adicional.\n\n"
        "ESQUEMA EXACTO (nombres de campo obligatorios):\n"
        '{"conteo_personas": 1,'
        '"postura_dominante": "sentado|parado|caminando|recostado|otro",'
        '"interaccion_social": "solo|en_pareja|grupo_pequeno|grupo_grande|sin_personas",'
        '"actividad": "verbo+contexto (ej: estudiar_en_banca_exterior, caminar_por_pasillo, usar_celular_sentado, comer_solo_al_aire, conversar_de_pie_en_grupo, esperar_parado_con_mochila, descansar_recostado, fumar_en_exterior)",'
        '"fumando": false,'
        '"confianza_fumando": 0.0,'
        '"objetos_detectados": ["mochila", "celular", "laptop", "vaso", "audífonos", "cigarro"],'
        '"zona": "exterior_jardin|exterior_acceso|corredor_cubierto|interior_aula|cafeteria|estacionamiento|escaleras|otro",'
        '"nivel_actividad": "estatico|bajo|moderado|alto",'
        '"resumen_semantico": "2-3 oraciones que describan: QUIEN hace QUE, como interactua socialmente, y que patron de habito representa la escena (estudio, descanso, transito, consumo, sociabilizacion). Incluye detalles del entorno visible como densidad de personas, zona del campus y cualquier comportamiento notable."}\n\n'
        "DETECCION DE FUMADO — busca evidencia visual directa en este orden:\n"
        "true / 0.95 = humo visible saliendo de boca o nariz, O cigarro encendido (punta incandescente naranja/roja) en mano o boca\n"
        "true / 0.80 = objeto cilindrico delgado (cigarro, vaper, puro) sostenido entre dedos o apoyado en labios\n"
        "true / 0.65 = gesto repetido de llevar objeto delgado a la boca + postura de fumador (brazo doblado)\n"
        "false / 0.30 = postura o gesto ambiguo, objeto no identificable como cigarro con certeza\n"
        "false / 0.00 = sin ningun indicio visual de cigarro, humo, vaper o gesto de fumado\n\n"
        "REGLAS CRITICAS:\n"
        "1. conteo_personas: usa el numero YOLO provisto como referencia, pero corrige si ves claramente mas o menos personas en el encuadre.\n"
        "2. Si conteo_personas=0 (escena vacia o sin personas visibles):\n"
        '   {"conteo_personas":0,"postura_dominante":"N/A","interaccion_social":"sin_personas",'
        '"actividad":"escena_vacia","fumando":false,"confianza_fumando":0.0,'
        '"objetos_detectados":[],"zona":"exterior_acceso","nivel_actividad":"estatico",'
        '"resumen_semantico":"Escena sin presencia humana visible. Espacio del campus desocupado en este momento."}\n'
        "3. resumen_semantico: escribe 2-3 oraciones ricas. NO repitas los valores de los otros campos. "
        "Interpreta el patron de comportamiento: por ejemplo si alguien espera con mochila frente a un edificio, "
        "probablemente esta entre clases. Ese tipo de inferencia contextual es valiosa para el sistema de habitos.\n"
        "4. actividad: usa guion_bajo para frases compuestas. Se especifico: "
        "'esperar_sentado_usando_celular' es mejor que 'sentado'. Captura la actividad principal Y el contexto.\n"
        "5. objetos_detectados: maximo 8 items, solo los visualmente confirmados. "
        "Incluye objetos relevantes para inferir habitos: alimentos, bebidas, libros, laptops, cigarros, mochilas.\n"
        "6. No inventes personas, objetos ni elementos fuera del area visible del encuadre."
    )
    responses_history[cam_id]  = []
    frames_descartados[cam_id] = 0


# Funcion auxiliar para tpool — cap.read() es I/O nativo bloqueante
def _camera_read(cap_obj):
    return cap_obj.read()


def initialize_camera(cam_id):
    """Abre la fuente de camara y calienta el sensor leyendo frames iniciales."""
    source = CAM_SOURCES.get(cam_id)
    if source is None:
        print(f"cam_id '{cam_id}' no existe en CAM_SOURCES.")
        return False

    backend = (cv2.CAP_FFMPEG if isinstance(source, str) and source.startswith('rtsp://')
               else cv2.CAP_DSHOW if platform.system() == 'Windows'
               else cv2.CAP_V4L2)

    with camera_locks[cam_id]:
        existing = video_captures.get(cam_id)
        if existing:
            try: existing.release()
            except Exception: pass

        cap = cv2.VideoCapture(source, backend)
        video_captures[cam_id] = cap

        if not cap.isOpened():
            video_captures[cam_id] = None
            print(f"No se pudo abrir la camara {cam_id} (source={source})")
            return False

        try:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        except Exception:
            pass

    # Calentar la camara fuera del lock para no mantenerlo durante el warm-up
    for _ in range(8):
        with camera_locks[cam_id]:
            c = video_captures.get(cam_id)
            if c is None: break
            # BUG-07 FIX: usar tpool tambien en el warm-up
            ret, frame = eventlet.tpool.execute(_camera_read, c)
        if ret and frame is not None:
            print(f"Camara {cam_id} lista.")
            return True
        time.sleep(0.15)

    print(f"[WARN] {cam_id} abrio pero no entrega frames (warm failed).")
    return True


def release_camera(cam_id):
    with camera_locks[cam_id]:
        cap = video_captures.get(cam_id)
        if cap:
            cap.release()
            video_captures[cam_id] = None
    print(f"Camara {cam_id} liberada.")


def append_response(cam_id, data):
    responses_history[cam_id].append(data)
    if len(responses_history[cam_id]) > MAX_HISTORY:
        responses_history[cam_id] = responses_history[cam_id][-MAX_HISTORY:]


import re as _re
_SOCIAL_MIN = {'solo': 1, 'en_pareja': 2, 'grupo_pequeno': 3,
               'grupo_pequeño': 3, 'grupo_grande': 5, 'sin_personas': 0}

def _parse_llava_json(text):
    """Parsea JSON de LLaVA quitando markdown code fences si los hay."""
    if not isinstance(text, str):
        return text if isinstance(text, dict) else {}
    clean = _re.sub(r'```(?:json)?\s*', '', text).strip().rstrip('`').strip()
    import json as _json
    return _json.loads(clean)

def _extract_person_count(parsed, yolo_count):
    """Extrae conteo real de personas del JSON de LLaVA."""
    count = parsed.get('conteo_personas')
    if isinstance(count, int) and count >= 0:
        return count
    if yolo_count == 0:
        social = str(parsed.get('interaccion_social', '')).lower()
        inferred = _SOCIAL_MIN.get(social)
        if inferred is not None:
            return inferred
    return yolo_count

def _fix_smoking(parsed, cam_id):
    """
    Corrige fumado=false cuando los objetos o el resumen delatan un cigarro.
    LLaVA a veces lista 'cigarro' en objetos_detectados pero deja fumando=false.
    """
    if parsed.get('fumando') is True:
        return parsed
    objetos = [str(o).lower() for o in parsed.get('objetos_detectados', [])]
    resumen = str(parsed.get('resumen_semantico', '') or parsed.get('descripcion_breve', '')).lower()
    smoking_words = {'cigarro', 'cigarr', 'fumando', 'fuma', 'humo', 'vaper', 'cigaret'}
    obj_hit     = any(any(sw in o for sw in smoking_words) for o in objetos)
    resumen_hit = any(sw in resumen for sw in smoking_words)
    if obj_hit or resumen_hit:
        conf = 0.80 if obj_hit else 0.65
        parsed['fumando']          = True
        parsed['confianza_fumando'] = conf
        print(f"[{cam_id}] Fumado corregido: objetos={obj_hit} resumen={resumen_hit} conf={conf}")
    return parsed

# =============================================================================
# SECCION 5: Cola Anti-Saturacion LLM
#
# maxsize=10: frames nuevos se descartan si el Datacenter esta ocupado.
# Tuple: (cam_id, raw_b64, prompt, enc_filepath, person_count, avg_conf,
#          smoking_detection)
# =============================================================================

LLM_QUEUE_MAX = 15
llm_queue = queue.Queue(maxsize=LLM_QUEUE_MAX)


def llm_worker():
    """Worker unico y secuencial que consume la cola."""
    print("LLM Worker iniciado.")
    while True:
        task = llm_queue.get()
        if task is None:
            llm_queue.task_done()
            break

        cam_id, raw_b64, prompt, enc_filepath, person_count, avg_conf, smoking_det = task
        try:
            print(f"[{cam_id}] Enviando a Datacenter | "
                  f"Personas: {person_count} | "
                  f"YOLO-cigarro: {smoking_det.get('yolo_cigarette_detected', 'N/A')} | "
                  f"Termico: {smoking_det.get('thermal_hotspot', 'N/A')} | "
                  f"Cola: {llm_queue.qsize()} restantes")

            analysis_text = send_to_llm(
                raw_b64           = raw_b64,
                prompt            = prompt,
                filename          = enc_filepath,
                person_count      = person_count,
                avg_conf          = avg_conf,
                cam_id            = cam_id,
                smoking_detection = smoking_det
            )

            final_person_count = person_count
            try:
                _parsed = _parse_llava_json(analysis_text)
                _parsed  = _fix_smoking(_parsed, cam_id)
                final_person_count = _extract_person_count(_parsed, person_count)
                if final_person_count != person_count:
                    print(f"[{cam_id}] Conteo ajustado: YOLO={person_count} → LLaVA={final_person_count}")
                import json as _json
                analysis_text = _json.dumps(_parsed, ensure_ascii=False)
            except Exception as _e:
                print(f"[{cam_id}] Parse LLaVA JSON falló: {_e}")

            response_data = {
                'id':                str(uuid.uuid4())[:8],
                'timestamp':         datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                'prompt':            prompt,
                'response':          analysis_text,
                'person_count':      final_person_count,
                'file':              enc_filepath,
                'auto_capture':      True,
                'yolo_cigarro':      smoking_det.get('yolo_cigarette_detected', False),
                'yolo_cigarro_conf': smoking_det.get('yolo_cigarette_conf', 0.0),
                'thermal_hotspot':   smoking_det.get('thermal_hotspot', False)
            }
            append_response(cam_id, response_data)
            socketio.emit(f'new_response_{cam_id}', response_data)
            print(f"[{cam_id}] Respuesta recibida del Datacenter.")

        except Exception as e:
            print(f"[{cam_id}] Error en LLM Worker: {e}")
        finally:
            llm_queue.task_done()


Thread(target=llm_worker, daemon=True).start()

# =============================================================================
# SECCION 6: Almacenamiento Seguro — Cifrado en Disco
# =============================================================================

def encrypt_and_save(censored_frame, cam_id, ts_str):
    """Guarda version CENSURADA y CIFRADA. La imagen RAW nunca toca el disco."""
    folder_path = os.path.join(BASE_SAVE_PATH, cam_id)
    os.makedirs(folder_path, exist_ok=True)
    filepath = os.path.join(folder_path, f"evidencia_{ts_str}.enc")

    _, buf = cv2.imencode('.jpg', censored_frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    encrypted = cipher_suite.encrypt(buf.tobytes())

    with open(filepath, 'wb') as f:
        f.write(encrypted)

    size_kb = len(encrypted) / 1024
    print(f"[{cam_id}] Imagen guardada: {filepath} ({size_kb:.1f} KB cifrados)")
    return filepath

# =============================================================================
# SECCION 6b: Guardado de Casos Dificiles para Re-entrenamiento
#
# Cuando YOLO detecta cigarro/fumador con confianza >= HARD_CASES_CONF_MIN,
# guarda la imagen RAW (sin cifrar) con los bboxes dibujados + archivo .txt
# en formato YOLO. Estos archivos se copian periodicamente al servidor para
# la siguiente ronda de entrenamiento.
#
# Estructura de salida:
#   /mnt/memoria/hard_cases/<cam_id>/hard_<timestamp>.jpg  — imagen con bbox
#   /mnt/memoria/hard_cases/<cam_id>/hard_<timestamp>.txt  — label YOLO
#
# Configuracion via env vars:
#   HARD_CASES_PATH     — directorio base (default: /mnt/memoria/hard_cases)
#   HARD_CASES_CONF_MIN — confianza minima para guardar (default: 0.25)
# =============================================================================

hard_cases_last_save = {}  # {cam_id: timestamp} — cooldown por camara

_NOMBRES_CLASE_HC = {0: 'cigarette', 1: 'nonSmoker', 2: 'smoker'}


def save_hard_case(frame, smoking_det, cam_id, ts_str):
    """
    Guarda imagen RAW con bboxes y label YOLO para re-entrenamiento futuro.
    Ejecutar via tpool — escribe a disco sin bloquear el event loop.
    """
    if not HARD_CASES_PATH:
        return

    folder = os.path.join(HARD_CASES_PATH, cam_id)
    os.makedirs(folder, exist_ok=True)

    h_img, w_img = frame.shape[:2]
    img_out  = frame.copy()
    boxes    = smoking_det.get('yolo_cigarette_boxes',   [])
    classes  = smoking_det.get('yolo_cigarette_classes', [])
    conf_max = smoking_det.get('yolo_cigarette_conf',    0.0)

    label_lines = []
    for bbox, cls_id in zip(boxes, classes):
        x1, y1, x2, y2 = map(int, bbox)
        x1 = max(0, x1); y1 = max(0, y1)
        x2 = min(w_img, x2); y2 = min(h_img, y2)

        nombre = _NOMBRES_CLASE_HC.get(cls_id, str(cls_id))
        cv2.rectangle(img_out, (x1, y1), (x2, y2), (0, 60, 255), 2)
        cv2.putText(img_out, f"{nombre} {conf_max:.2f}",
                    (x1, max(y1 - 5, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 60, 255), 1, cv2.LINE_AA)

        cx = round(((x1 + x2) / 2) / w_img, 6)
        cy = round(((y1 + y2) / 2) / h_img, 6)
        bw = round((x2 - x1) / w_img, 6)
        bh = round((y2 - y1) / h_img, 6)
        label_lines.append(f"{cls_id} {cx} {cy} {bw} {bh}")

    img_path   = os.path.join(folder, f"hard_{ts_str}.jpg")
    label_path = os.path.join(folder, f"hard_{ts_str}.txt")

    cv2.imwrite(img_path, img_out, [cv2.IMWRITE_JPEG_QUALITY, 90])
    with open(label_path, 'w') as f:
        f.write('\n'.join(label_lines))

    print(f"[{cam_id}] Hard case guardado: hard_{ts_str}.jpg (conf={conf_max:.2f})")


# =============================================================================
# SECCION 7: Comunicacion con el Datacenter
# =============================================================================

FASTAPI_URL    = os.environ.get('FASTAPI_URL', 'http://100.91.181.124:8001/llava/')
LLM_MAX_RETRIES = 3


def send_to_llm(raw_b64, prompt, filename, person_count, avg_conf, cam_id,
                smoking_detection=None):
    """
    Envia imagen RAW al Datacenter con reintentos exponenciales.

    smoking_detection: dict con resultado YOLO cigarro + camara termica.
    El servidor usara estos datos para cross-validar la decision de fumado
    de LLaVA y aplicar la logica:
      YOLO=True + LLaVA=True  → confirmado
      YOLO=True + LLaVA=False → alucinacion LLaVA, fumado descartado
      YOLO=False + LLaVA=False → negativo confirmado
      YOLO=False + LLaVA=True  → bajo confianza, marcado como solo_llava
    """
    payload = {
        "file":            filename,
        "prompt":          prompt,
        "images":          [raw_b64],
        "person_count":    person_count,
        "nv_confz_global": avg_conf,
        "location_data": {
            "camara": cam_id,
            "campus": "Isla de Datos Urbanos",
            "coords": "19.504398, -99.147711"
        }
    }
    if smoking_detection:
        payload["smoking_detection"] = smoking_detection

    last_exc = None
    for attempt in range(LLM_MAX_RETRIES):
        try:
            response = requests.post(
                FASTAPI_URL,
                json    = payload,
                timeout = 60,
                headers = {"Content-Type": "application/json"}
            )
            response.raise_for_status()
            return response.json().get("response", "Sin respuesta del Datacenter")

        except (requests.exceptions.ConnectionError,
                requests.exceptions.Timeout) as e:
            last_exc = e
            wait = 2 ** attempt  # backoff: 1s, 2s, 4s
            print(f"[{cam_id}] Red Tailscale — intento {attempt + 1}/{LLM_MAX_RETRIES}, "
                  f"reintentando en {wait}s | {type(e).__name__}")
            time.sleep(wait)

        except requests.exceptions.HTTPError:
            raise

    raise last_exc

# =============================================================================
# SECCION 8: Loop Principal de Captura y Stream
#
# [BUG-07 FIX] cap.read() y run_yolo_privacy() son operaciones bloqueantes
# (I/O nativo y CPU-bound). Ejecutadas directamente en un greenthread eventlet
# congelan el event loop entero, impidiendo que SocketIO procese conexiones
# concurrentes.
#
# Solucion: eventlet.tpool.execute() delega la operacion a un thread nativo
# del pool y cede el greenthread al scheduler. El event loop permanece
# reactivo durante cap.read() (~33-100ms) e inferencia YOLO (~20-80ms en CPU).
#
# El camera_lock (eventlet.Semaphore) sigue protegiendo el acceso a cap:
#   1. Greenthread A adquiere semaforo y llama tpool.execute(_camera_read, cap)
#   2. Greenthread A cede al scheduler (tpool pendiente)
#   3. Thread nativo del tpool ejecuta cap.read() — SIN tocar el GIL del event loop
#   4. Greenthread B intenta adquirir el semaforo → espera cooperativamente
#   5. Thread nativo termina → reactiva Greenthread A → semaforo liberado
#   6. Greenthread B adquiere semaforo y procede
# =============================================================================

YOLO_THROTTLE_SECONDS = 1.0  # YOLO de privacidad: maximo 1 inferencia/segundo


def _blank_censored_frame(frame):
    """Frame negro como fallback seguro antes del primer ciclo de YOLO."""
    blank = frame.copy()
    blank[:] = 0
    return blank


def capture_and_stream(cam_id):
    """
    Hilo de fondo por camara. Maneja streaming, auto-captura con
    deteccion de fumadores y reconexion automatica.
    """
    print(f"[{cam_id}] Stream iniciado.")
    failed_reads        = 0
    last_yolo_time      = 0.0
    last_capture_time   = 0.0
    last_person_count   = 0
    peak_person_count   = 0  # máximo YOLO desde la última captura
    last_avg_conf       = 0.0
    last_censored_frame = None  # [FIX-BUG01] se inicializa en el primer frame
    # smoking_det vacio hasta que el primer ciclo YOLO corra
    last_smoking_det    = {
        'yolo_available': _detector_has_cig, 'yolo_cigarette_detected': False,
        'yolo_cigarette_conf': 0.0, 'yolo_cigarette_count': 0,
        'yolo_cigarette_boxes': [], 'thermal_available': False,
        'thermal_hotspot': False, 'thermal_max_intensity': None,
        'thermal_hotspot_pixels': 0, 'thermal_hotspot_center': None
    }

    while is_streaming.get(cam_id, False):
        # ── Lectura de frame ──────────────────────────────────────
        frame = None
        ret   = False
        with camera_locks[cam_id]:
            cap = video_captures.get(cam_id)
            if cap and cap.isOpened():
                # [BUG-07 FIX] tpool: cap.read() no bloquea el event loop
                ret, frame = eventlet.tpool.execute(_camera_read, cap)
                if ret and frame is not None:
                    failed_reads = 0
                else:
                    failed_reads += 1
            else:
                failed_reads += 1

        # ── Reconexion automatica ──────────────────────────────────
        if failed_reads >= 5:
            print(f"[{cam_id}] Camara perdida, reconectando...")
            release_camera(cam_id)
            if isinstance(CAM_SOURCES.get(cam_id), int):
                new_idx = find_usb_camera()
                if new_idx is not None:
                    CAM_SOURCES[cam_id] = new_idx
            initialize_camera(cam_id)
            failed_reads = 0
            eventlet.sleep(1)
            continue

        if frame is None:
            eventlet.sleep(0.1)
            continue

        # [FIX-BUG01] Primer frame: generar blank seguro antes del primer YOLO
        if last_censored_frame is None:
            last_censored_frame = _blank_censored_frame(frame)

        current_time = time.time()

        # ── YOLO unificado throttled (max 1 Hz) ──────────────────
        # Una sola inferencia detecta personas (privacidad) y cigarros (fumado).
        if (current_time - last_yolo_time) >= YOLO_THROTTLE_SECONDS:
            last_yolo_time = current_time
            # [BUG-07 FIX] CPU-bound (~20-80ms) — ceder al event loop via tpool
            p_count, avg_conf, censored_frame, last_smoking_det = eventlet.tpool.execute(
                run_yolo_detection, frame
            )

            if p_count != last_person_count:
                last_person_count = p_count
                print(f"[{cam_id}] {p_count} persona(s) | conf: {avg_conf:.2f} | "
                      f"cigarro: {last_smoking_det.get('yolo_cigarette_detected', False)}")

            if p_count > peak_person_count:
                peak_person_count = p_count

            last_avg_conf       = avg_conf
            last_censored_frame = censored_frame

            # ── Guardar caso dificil para re-entrenamiento ────────
            cig_conf = last_smoking_det.get('yolo_cigarette_conf', 0.0)
            ultimo_guardado = hard_cases_last_save.get(cam_id, 0.0)
            if (cig_conf >= HARD_CASES_CONF_MIN
                    and (current_time - ultimo_guardado) >= HARD_CASES_COOLDOWN):
                hard_cases_last_save[cam_id] = current_time
                ts_hc = datetime.now().strftime('%Y%m%d_%H%M%S')
                eventlet.tpool.execute(
                    save_hard_case, frame, last_smoking_det, cam_id, ts_hc
                )

        # ── Auto-Captura ──────────────────────────────────────────
        interval = auto_capture_interval.get(cam_id, 45)
        if (is_auto_capturing.get(cam_id, False)
                and (current_time - last_capture_time) >= interval):
            last_capture_time = current_time
            ts_str = datetime.now().strftime('%Y%m%d_%H%M%S')

            # [FIX-BUG02] Reutilizar last_censored_frame (YOLO ya corrio a 1 Hz)
            enc_path = encrypt_and_save(last_censored_frame, cam_id, ts_str)

            # RAW para LLaVA — 512x512 (vision encoder fijo en 336px)
            llm_frame = cv2.resize(frame, (512, 512))
            _, buf_raw = cv2.imencode('.jpg', llm_frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            raw_b64 = base64.b64encode(buf_raw).decode('utf-8')

            # smoking_det viene del ultimo ciclo YOLO (max 1s de antiguedad)
            smoking_det = last_smoking_det

            if smoking_det.get('yolo_cigarette_detected'):
                print(f"[{cam_id}] ALERTA FUMADO — "
                      f"YOLO: cigarro detectado "
                      f"(conf={smoking_det.get('yolo_cigarette_conf', 0):.2f})")

            # Prompt con contexto de escena anterior (solo descripcion, no JSON crudo)
            base_prompt = auto_capture_prompt.get(cam_id, "Analiza la imagen.")
            ultimo_ctx  = ""
            if responses_history[cam_id]:
                ultimo_resp = responses_history[cam_id][-1].get('response', '')
                if isinstance(ultimo_resp, str) and ultimo_resp:
                    # Extraer solo el campo de descripcion — evitar enviar JSON crudo
                    # al prompt, que satura el contexto de LLaVA y provoca eco del prompt.
                    try:
                        import json as _json
                        parsed = _json.loads(ultimo_resp)
                        desc = (parsed.get('resumen_semantico') or
                                parsed.get('descripcion_breve') or
                                parsed.get('descripcion') or '')
                        if desc:
                            ultimo_ctx = f"Escena anterior: {str(desc)[:100]}. "
                    except Exception:
                        pass  # si no parsea, no incluir contexto
            capture_person_count = peak_person_count  # máximo visto en el intervalo
            full_prompt = (f"Personas detectadas: {capture_person_count}. "
                           f"{ultimo_ctx}{base_prompt}")
            peak_person_count = 0  # resetear para el siguiente intervalo

            # Encolar — descartar si la cola esta llena
            if not llm_queue.full():
                llm_queue.put((cam_id, raw_b64, full_prompt, enc_path,
                               capture_person_count, last_avg_conf, smoking_det))

                print(f"[{cam_id}] Tarea encolada | Cola: {llm_queue.qsize()}/{LLM_QUEUE_MAX}")
            else:
                frames_descartados[cam_id] += 1
                print(f"[{cam_id}] Cola llena. Frame descartado "
                      f"#{frames_descartados[cam_id]} — Datacenter ocupado.")

        # ── Emitir frame CENSURADO al cliente web ─────────────────
        try:
            _, buf_web = cv2.imencode('.jpg', last_censored_frame,
                                      [cv2.IMWRITE_JPEG_QUALITY, 72])
            socketio.emit(f'video_frame_{cam_id}', {
                'image':              base64.b64encode(buf_web).decode('utf-8'),
                'person_count':       last_person_count,
                'queue_size':         llm_queue.qsize(),
                'queue_max':          LLM_QUEUE_MAX,
                'frames_descartados': frames_descartados[cam_id]
            })
        except Exception as e:
            print(f"[{cam_id}] Error emitiendo frame: {e}")

        eventlet.sleep(0.05)  # ~20 FPS

    print(f"[{cam_id}] Stream detenido.")

# =============================================================================
# SECCION 9: Captura Manual (disparada por el usuario desde la UI)
# =============================================================================

def analyze_image_manual(cam_id, prompt_text):
    """Captura un frame y lo envia inmediatamente al Datacenter (fuera de la cola)."""
    frame = None
    with camera_locks[cam_id]:
        cap = video_captures.get(cam_id)
        if cap is None or not cap.isOpened():
            socketio.emit('analysis_error', {'error': f'Camara {cam_id} no disponible'})
            return
        ret, frame = eventlet.tpool.execute(_camera_read, cap)  # BUG-07 FIX

    if not ret or frame is None:
        socketio.emit('analysis_error', {'error': 'Error al capturar imagen'})
        return

    ts     = datetime.now()
    ts_str = ts.strftime('%Y%m%d_%H%M%S')

    # Deteccion unificada: personas (privacidad) + cigarros (fumado)
    p_count, avg_conf, censored_frame, smoking_det = eventlet.tpool.execute(
        run_yolo_detection, frame  # [BUG-07 FIX] tpool: no bloquea el event loop
    )
    enc_path = encrypt_and_save(censored_frame, cam_id, f"manual_{ts_str}")

    # RAW para LLaVA — 512x512 (vision encoder fijo en 336px)
    llm_frame = cv2.resize(frame, (512, 512))
    _, buf_raw = cv2.imencode('.jpg', llm_frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    raw_b64    = base64.b64encode(buf_raw).decode('utf-8')

    prompt_clean = str(prompt_text).replace('"', "'").strip() or "Analiza la imagen."
    full_prompt  = f"Personas detectadas: {p_count}. {prompt_clean}"

    try:
        analysis_text = send_to_llm(
            raw_b64           = raw_b64,
            prompt            = full_prompt,
            filename          = enc_path,
            person_count      = p_count,
            avg_conf          = avg_conf,
            cam_id            = cam_id,
            smoking_detection = smoking_det
        )
    except Exception as e:
        analysis_text = f"Error contactando Datacenter: {e}"

    final_p_count = p_count
    try:
        _parsed = _parse_llava_json(analysis_text)
        _parsed = _fix_smoking(_parsed, cam_id)
        final_p_count = _extract_person_count(_parsed, p_count)
        import json as _json
        analysis_text = _json.dumps(_parsed, ensure_ascii=False)
    except Exception:
        pass

    response_data = {
        'id':                str(uuid.uuid4())[:8],
        'timestamp':         ts.strftime("%Y-%m-%d %H:%M:%S"),
        'prompt':            full_prompt,
        'response':          analysis_text,
        'person_count':      final_p_count,
        'file':              enc_path,
        'auto_capture':      False,
        'yolo_cigarro':      smoking_det.get('yolo_cigarette_detected', False),
        'yolo_cigarro_conf': smoking_det.get('yolo_cigarette_conf', 0.0),
        'thermal_hotspot':   smoking_det.get('thermal_hotspot', False)
    }
    append_response(cam_id, response_data)
    socketio.emit(f'new_response_{cam_id}', response_data)

# =============================================================================
# SECCION 10: Rutas Flask
# =============================================================================

@app.route('/')
def index():
    return render_template('index.html', cam_ids=list(CAM_SOURCES.keys()))

# =============================================================================
# SECCION 11: Eventos SocketIO
# =============================================================================

@socketio.on('connect')
def handle_connect():
    global connected_clients
    connected_clients += 1
    emit('client_count', {'count': connected_clients}, broadcast=True)
    for cam_id in CAM_SOURCES:
        emit(f'responses_history_{cam_id}', {'history': responses_history[cam_id]})
    print(f"Cliente conectado. Total: {connected_clients}")


@socketio.on('disconnect')
def handle_disconnect():
    global connected_clients
    connected_clients = max(0, connected_clients - 1)
    emit('client_count', {'count': connected_clients}, broadcast=True)
    print(f"Cliente desconectado. Total: {connected_clients}")


@socketio.on('start_stream')
def handle_start_stream(data):
    cam_id = data.get('cam_id')
    if not cam_id or cam_id not in CAM_SOURCES:
        emit('analysis_error', {'error': f'cam_id invalido: {cam_id}'})
        return
    if not is_streaming[cam_id]:
        if initialize_camera(cam_id):
            is_streaming[cam_id] = True
            socketio.start_background_task(capture_and_stream, cam_id)
            emit('stream_status', {'cam_id': cam_id, 'status': 'running'}, broadcast=True)
        else:
            emit('analysis_error', {'error': f'No se pudo abrir camara {cam_id}'})


@socketio.on('stop_stream')
def handle_stop_stream(data):
    cam_id = data.get('cam_id')
    if not cam_id or cam_id not in CAM_SOURCES:
        return
    is_streaming[cam_id]      = False
    is_auto_capturing[cam_id] = False
    release_camera(cam_id)
    emit('stream_status',        {'cam_id': cam_id, 'status': 'stopped'}, broadcast=True)
    emit('auto_capture_stopped', {'cam_id': cam_id}, broadcast=True)


@socketio.on('start_auto_capture')
def handle_start_auto_capture(data):
    cam_id = data.get('cam_id')
    if not cam_id or cam_id not in CAM_SOURCES:
        emit('analysis_error', {'error': f'cam_id invalido: {cam_id}'})
        return

    try:
        interval = int(data.get('interval', 45))
    except (TypeError, ValueError):
        interval = 45

    prompt = data.get('prompt', auto_capture_prompt.get(cam_id, ''))

    if not is_streaming[cam_id]:
        if initialize_camera(cam_id):
            is_streaming[cam_id] = True
            socketio.start_background_task(capture_and_stream, cam_id)
            emit('stream_status', {'cam_id': cam_id, 'status': 'running'}, broadcast=True)
        else:
            emit('analysis_error', {'error': f'Camara {cam_id} no disponible'})
            return

    auto_capture_interval[cam_id] = max(3, interval)
    auto_capture_prompt[cam_id]   = prompt
    is_auto_capturing[cam_id]     = True

    emit('auto_capture_started', {
        'cam_id':   cam_id,
        'interval': auto_capture_interval[cam_id]
    }, broadcast=True)
    print(f"[{cam_id}] Auto-captura iniciada cada {auto_capture_interval[cam_id]}s")


@socketio.on('stop_auto_capture')
def handle_stop_auto_capture(data):
    cam_id = data.get('cam_id')
    if not cam_id or cam_id not in CAM_SOURCES:
        return
    is_auto_capturing[cam_id] = False
    emit('auto_capture_stopped', {'cam_id': cam_id}, broadcast=True)
    print(f"[{cam_id}] Auto-captura detenida.")


@socketio.on('update_interval')
def handle_update_interval(data):
    """Cambia el intervalo de auto-captura en caliente, sin detener ni reiniciar nada."""
    cam_id = data.get('cam_id')
    if not cam_id or cam_id not in CAM_SOURCES:
        return
    try:
        interval = int(data.get('interval', 10))
    except (TypeError, ValueError):
        interval = 10
    interval = max(3, interval)
    auto_capture_interval[cam_id] = interval
    emit('interval_updated', {'cam_id': cam_id, 'interval': interval}, broadcast=True)
    print(f"[{cam_id}] Intervalo actualizado a {interval}s en caliente.")


@socketio.on('capture_and_analyze')
def handle_capture_and_analyze(data):
    cam_id      = data.get('cam_id')
    prompt_text = data.get('prompt', 'Analiza la imagen.')
    if not cam_id or cam_id not in CAM_SOURCES:
        return
    socketio.start_background_task(analyze_image_manual, cam_id, prompt_text)


@socketio.on('clear_history')
def handle_clear_history(data):
    cam_id = data.get('cam_id')
    if not cam_id or cam_id not in CAM_SOURCES:
        return
    responses_history[cam_id] = []
    emit(f'history_cleared_{cam_id}', {}, broadcast=True)
    print(f"Historial limpiado para {cam_id}")

# =============================================================================
# SECCION 12: Arranque automático
#
# DEFAULT_AUTO_INTERVAL: intervalo de captura en segundos. Se configura via
# env var AUTO_CAPTURE_INTERVAL (default 5s). Definido aqui a nivel de modulo
# para que sea accesible en autostart_cameras y en cualquier otro contexto.
# =============================================================================

DEFAULT_AUTO_INTERVAL = int(os.environ.get('AUTO_CAPTURE_INTERVAL', 5))


def _retry_camera_forever(cam_id):
    """
    Reintenta inicializar una camara que no conecto al arranque.
    Corre como greenthread en background hasta que la camara este activa.
    Util para camaras RTSP que tardan en estar disponibles despues del boot.
    """
    intento = 0
    while not is_streaming.get(cam_id, False):
        intento += 1
        espera = min(30 * intento, 300)  # crece hasta 5 min entre intentos
        print(f"[{cam_id}] Reintento diferido #{intento} en {espera}s...")
        eventlet.sleep(espera)
        if CAM_SOURCES.get(cam_id) is None:
            return
        if initialize_camera(cam_id):
            is_streaming[cam_id]          = True
            is_auto_capturing[cam_id]     = True
            auto_capture_interval[cam_id] = DEFAULT_AUTO_INTERVAL
            socketio.start_background_task(capture_and_stream, cam_id)
            print(f"[{cam_id}] Conectada en reintento #{intento}. "
                  f"Auto-captura cada {DEFAULT_AUTO_INTERVAL}s activa.")
            return
    print(f"[{cam_id}] _retry_camera_forever: camara ya activa, saliendo.")


def autostart_cameras():
    """
    Inicializa todas las camaras al arranque y activa auto-captura inmediata.
    Si una camara no conecta, lanza _retry_camera_forever en background.
    """
    eventlet.sleep(20)  # espera 20s para que el event loop, la red y los dispositivos esten listos
    for cam_id in list(CAM_SOURCES.keys()):
        if CAM_SOURCES[cam_id] is None:
            print(f"[{cam_id}] Sin fuente de camara configurada, omitiendo.")
            continue

        print(f"[{cam_id}] Iniciando — captura cada {DEFAULT_AUTO_INTERVAL}s")
        iniciada = False
        for attempt in range(1, 4):  # 3 intentos rapidos al arranque
            if initialize_camera(cam_id):
                is_streaming[cam_id]          = True
                is_auto_capturing[cam_id]     = True
                auto_capture_interval[cam_id] = DEFAULT_AUTO_INTERVAL
                socketio.start_background_task(capture_and_stream, cam_id)
                print(f"[{cam_id}] Auto-captura activa (intento {attempt}/3).")
                iniciada = True
                break
            print(f"[{cam_id}] Intento {attempt}/3 fallido, reintentando en 5s...")
            eventlet.sleep(5)

        if not iniciada:
            print(f"[{cam_id}] No conecta al arranque — reintento diferido activado.")
            socketio.start_background_task(_retry_camera_forever, cam_id)


if __name__ == '__main__':
    _model_label  = _custom_path or 'yolo11s.pt (base COCO)'
    _cig_label    = '✅ ACTIVO — cigarro detectado por YOLO' if _detector_has_cig else '⚠️  NO ACTIVO — solo personas (modelo base sin cigarro)'
    _path_ok      = os.path.isdir(BASE_SAVE_PATH)
    _path_label   = f"{BASE_SAVE_PATH} {'✅ accesible' if _path_ok else '❌ NO EXISTE — las imagenes NO se guardaran'}"
    print("=" * 60)
    print(" EDGE NODE — Isla de Datos Urbanos")
    print(f"   Save path       : {_path_label}")
    print(f"   Key file        : {KEY_FILE}")
    print(f"   Datacenter      : {FASTAPI_URL}")
    print(f"   Camaras         : {list(CAM_SOURCES.keys())}")
    print(f"   Modelo YOLO     : {_model_label}")
    print(f"   Cigarro YOLO    : {_cig_label}")
    print(f"   Captura cada    : {DEFAULT_AUTO_INTERVAL}s")
    print(f"   Autostart delay : 20s")
    print("=" * 60)
    if not _path_ok:
        print("[ERROR CRITICO] El directorio de guardado no existe.")
        print(f"                Verifica que el volumen este montado en: {BASE_SAVE_PATH}")

    socketio.start_background_task(autostart_cameras)
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)
