import qrcode
from qrcode.image.pil import PilImage
from PIL import Image, ImageDraw, ImageFilter
import math

URL = "https://dashboard-habitos.tailb47dbb.ts.net/"
OUTPUT = "/home/admin54/Escritorio/deploy_vm/qr_habitos.png"

# QR con alta corrección de errores para poder poner logo encima
qr = qrcode.QRCode(
    version=None,
    error_correction=qrcode.constants.ERROR_CORRECT_H,
    box_size=14,
    border=4,
)
qr.add_data(URL)
qr.make(fit=True)

# Colores verde oscuro sobre blanco
img = qr.make_image(fill_color="#1a6b3c", back_color="white").convert("RGBA")

size = img.size[0]
logo_size = int(size * 0.24)
center = size // 2

# --- Crear icono de hoja en el centro ---
logo = Image.new("RGBA", (logo_size, logo_size), (0, 0, 0, 0))
draw = ImageDraw.Draw(logo)

pad = 6
# Círculo de fondo blanco con borde verde
draw.ellipse(
    [pad, pad, logo_size - pad, logo_size - pad],
    fill=(255, 255, 255, 255),
    outline=(26, 107, 60, 255),
    width=5,
)

cx, cy = logo_size // 2, logo_size // 2
r = logo_size // 2 - 14


def rotated_ellipse_points(ox, oy, rx, ry, angle_deg, steps=50):
    """Polígono aproximando una elipse rotada."""
    angle = math.radians(angle_deg)
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        x = rx * math.cos(t)
        y = ry * math.sin(t)
        rx2 = x * math.cos(angle) - y * math.sin(angle) + ox
        ry2 = x * math.sin(angle) + y * math.cos(angle) + oy
        pts.append((rx2, ry2))
    return pts


# Hoja izquierda (verde oscuro)
pts_left = rotated_ellipse_points(cx - r * 0.2, cy - r * 0.1, r * 0.4, r * 0.7, -40)
draw.polygon(pts_left, fill=(34, 139, 80, 240))

# Hoja derecha (verde más claro)
pts_right = rotated_ellipse_points(cx + r * 0.2, cy - r * 0.1, r * 0.4, r * 0.7, 40)
draw.polygon(pts_right, fill=(56, 180, 100, 240))

# Tallo
stem_top = (cx, cy + r * 0.15)
stem_bot = (cx, cy + r * 0.8)
draw.line([stem_top, stem_bot], fill=(26, 107, 60, 240), width=4)

# Pequeño brillo en las hojas
for pts, color in [
    (rotated_ellipse_points(cx - r * 0.2, cy - r * 0.1, r * 0.15, r * 0.28, -45), (100, 210, 140, 80)),
    (rotated_ellipse_points(cx + r * 0.2, cy - r * 0.1, r * 0.15, r * 0.28, 45), (120, 230, 155, 80)),
]:
    draw.polygon(pts, fill=color)

# Pegar logo centrado
pos = (center - logo_size // 2, center - logo_size // 2)
img.paste(logo, pos, mask=logo)

# Fondo redondeado opcional (guardamos como PNG con transparencia)
img.save(OUTPUT, "PNG")
print(f"QR guardado en: {OUTPUT}")
print(f"Tamaño imagen: {img.size[0]}x{img.size[1]} px")
