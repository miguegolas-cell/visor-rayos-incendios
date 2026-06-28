import json
import os
import re
import shutil
import tarfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image
import rasterio
from rasterio.windows import from_bounds


# ==========================================================
# CONFIGURACIÓN
# ==========================================================

AEMET_RAYOS_PAGE = "https://www.aemet.es/es/eltiempo/observacion/rayos"

AEMET_RAYOS_URL_FIJA = os.environ.get(
    "AEMET_RAYOS_URL",
    "https://www.aemet.es/es/geojson/download/rayos/descargar_rayos_1782676866.tar.gz"
)

# Producto que cubre Península/Baleares en resolución local.
# Es el que nos interesa para Valencia.
REGION_TOKEN = os.environ.get("AEMET_RAYOS_REGION", "PB_LOCL")

# BBOX Valencia con margen:
# lon_min, lat_min, lon_max, lat_max
BBOX_ENV = os.environ.get("VALENCIA_BBOX", "-1.70,38.60,0.05,40.25")
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = map(float, BBOX_ENV.split(","))

# Si vale 1, intenta localizar automáticamente la URL más reciente.
BUSCAR_URL_AUTOMATICA = os.environ.get("BUSCAR_URL_AUTOMATICA", "1") == "1"

BASE_DIR = Path(__file__).resolve().parents[1]
OUT_DIR = BASE_DIR / "datos" / "rayos"
HORAS_DIR = OUT_DIR / "horas"
TMP_DIR = OUT_DIR / "_tmp"

OUT_DIR.mkdir(parents=True, exist_ok=True)
HORAS_DIR.mkdir(parents=True, exist_ok=True)
TMP_DIR.mkdir(parents=True, exist_ok=True)

TMP_TAR = TMP_DIR / "rayos_aemet.tar.gz"
HORAS_META = HORAS_DIR / "horas_meta.json"

FILE_24H = OUT_DIR / "rayos_24h.png"
FILE_48H = OUT_DIR / "rayos_48h.png"
FILE_72H = OUT_DIR / "rayos_72h.png"

BOUNDS_FILE = OUT_DIR / "rayos_bounds.json"
MANIFEST_FILE = OUT_DIR / "manifest_rayos.json"


# ==========================================================
# FUNCIONES GENERALES
# ==========================================================

def now_utc():
    return datetime.now(timezone.utc)


def iso_utc(dt):
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def parse_iso_utc(value):
    if not value:
        return None

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def limpiar_tmp():
    if TMP_DIR.exists():
        shutil.rmtree(TMP_DIR, ignore_errors=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)


def cargar_json(path, default):
    if not path.exists():
        return default

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def guardar_json(path, data):
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


# ==========================================================
# BUSCAR URL MÁS RECIENTE DE AEMET
# ==========================================================

def buscar_url_rayos_actual():
    if not BUSCAR_URL_AUTOMATICA:
        print("Búsqueda automática desactivada. Uso URL fija.")
        return AEMET_RAYOS_URL_FIJA

    print("Buscando URL actual de rayos en AEMET...")

    try:
        req = Request(
            AEMET_RAYOS_PAGE,
            headers={"User-Agent": "Mozilla/5.0 MetVlc GitHub Action"}
        )

        with urlopen(req, timeout=120) as response:
            html = response.read().decode("utf-8", errors="ignore")

        patrones = re.findall(
            r'["\']([^"\']*descargar_rayos_\d+\.tar\.gz)["\']',
            html
        )

        if not patrones:
            print("No se ha encontrado enlace nuevo. Uso URL fija.")
            return AEMET_RAYOS_URL_FIJA

        # Quitamos duplicados manteniendo orden
        vistos = []
        for p in patrones:
            if p not in vistos:
                vistos.append(p)

        url = urljoin("https://www.aemet.es", vistos[-1])
        print(f"URL detectada: {url}")
        return url

    except Exception as e:
        print(f"No se pudo buscar URL automática: {e}")
        print("Uso URL fija.")
        return AEMET_RAYOS_URL_FIJA


# ==========================================================
# DESCARGA
# ==========================================================

def descargar_paquete_aemet():
    url = buscar_url_rayos_actual()

    print("Descargando paquete de rayos AEMET...")
    print(url)

    req = Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 MetVlc GitHub Action"}
    )

    with urlopen(req, timeout=180) as response:
        TMP_TAR.write_bytes(response.read())

    size_kb = TMP_TAR.stat().st_size / 1024
    print(f"Descargado: {TMP_TAR}")
    print(f"Tamaño: {size_kb:.1f} KB")

    return url


# ==========================================================
# FECHA DESDE NOMBRE DE ARCHIVO
# ==========================================================

def fecha_desde_nombre(nombre):
    """
    Ejemplo:
    down_rayos_PB_LOCL_2026062817+0200_1782676866.geotiff
    """

    m = re.search(r"(\d{10})([+-]\d{4})", nombre)

    if not m:
        return None

    fecha_hora = m.group(1)
    offset = m.group(2)

    try:
        dt = datetime.strptime(fecha_hora + offset, "%Y%m%d%H%z")
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


# ==========================================================
# RECORTE GEOTIFF → PNG TRANSPARENTE
# ==========================================================

def geotiff_cubre_valencia(src):
    b = src.bounds

    if b.right < LON_MIN:
        return False
    if b.left > LON_MAX:
        return False
    if b.top < LAT_MIN:
        return False
    if b.bottom > LAT_MAX:
        return False

    return True


def leer_recorte_rgba(tif_path):
    """
    Lee un GeoTIFF RGBA de AEMET, lo recorta a la zona de Valencia
    y devuelve una imagen PIL RGBA.
    """

    with rasterio.open(tif_path) as src:
        if not geotiff_cubre_valencia(src):
            return None, 0

        window = from_bounds(
            LON_MIN,
            LAT_MIN,
            LON_MAX,
            LAT_MAX,
            transform=src.transform
        )

        window = window.round_offsets().round_lengths()

        data = src.read(
            window=window,
            boundless=True,
            fill_value=0
        )

    if data.size == 0:
        return None, 0

    # data viene como bandas, alto, ancho
    bandas, alto, ancho = data.shape

    if bandas >= 4:
        rgba = np.moveaxis(data[:4], 0, -1)
    elif bandas == 3:
        rgb = np.moveaxis(data[:3], 0, -1)
        alpha = np.where(np.any(rgb != 0, axis=2), 255, 0).astype(np.uint8)
        rgba = np.dstack([rgb, alpha])
    elif bandas == 1:
        gray = data[0]
        alpha = np.where(gray != 0, 255, 0).astype(np.uint8)
        rgba = np.dstack([gray, gray, gray, alpha])
    else:
        return None, 0

    if rgba.dtype != np.uint8:
        rgba = np.clip(rgba, 0, 255).astype(np.uint8)

    rgb = rgba[:, :, :3]
    alpha_original = rgba[:, :, 3]

    # Fondo negro/transparente fuera.
    alpha_por_rgb = np.where(np.any(rgb != 0, axis=2), 255, 0).astype(np.uint8)
    alpha = np.maximum(alpha_original, alpha_por_rgb)

    # Si el pixel es completamente negro, lo hacemos transparente.
    negro = np.all(rgb == 0, axis=2)
    alpha[negro] = 0

    rgba[:, :, 3] = alpha

    visible_pixels = int(np.count_nonzero(alpha))

    img = Image.fromarray(rgba, mode="RGBA")
    return img, visible_pixels


# ==========================================================
# EXTRAER HORAS DEL TAR
# ==========================================================

def extraer_horas_desde_tar(capture_time):
    print("Leyendo contenido del paquete...")

    metadata = cargar_json(HORAS_META, default=[])

    meta_por_archivo = {
        item["file"]: item
        for item in metadata
        if "file" in item
    }

    procesados = 0
    visibles = 0
    image_size = None

    with tarfile.open(TMP_TAR, "r:gz") as tar:
        members = tar.getmembers()

        geotiffs = [
            m for m in members
            if m.isfile()
            and m.name.lower().endswith((".geotiff", ".tif", ".tiff"))
            and REGION_TOKEN in Path(m.name).name
        ]

        print(f"GeoTIFF encontrados para {REGION_TOKEN}: {len(geotiffs)}")

        for member in geotiffs:
            nombre = Path(member.name).name
            dt = fecha_desde_nombre(nombre)

            if dt is None:
                print(f"Sin fecha reconocible, salto: {nombre}")
                continue

            tmp_tif = TMP_DIR / nombre

            f = tar.extractfile(member)
            if f is None:
                continue

            tmp_tif.write_bytes(f.read())

            try:
                img, visible_pixels = leer_recorte_rgba(tmp_tif)
            except Exception as e:
                print(f"Error leyendo {nombre}: {e}")
                continue

            if img is None:
                print(f"No cubre Valencia o sin imagen válida: {nombre}")
                continue

            if image_size is None:
                image_size = img.size

            out_name = f"rayos_{dt.strftime('%Y%m%dT%H%MZ')}.png"
            out_path = HORAS_DIR / out_name

            img.save(out_path, optimize=True)

            meta_por_archivo[out_name] = {
                "file": out_name,
                "time_utc": iso_utc(dt),
                "source_file": nombre,
                "visible_pixels": visible_pixels,
                "updated_utc": iso_utc(capture_time)
            }

            procesados += 1

            if visible_pixels > 0:
                visibles += 1

            tmp_tif.unlink(missing_ok=True)

    metadata_nueva = list(meta_por_archivo.values())

    print(f"Horas procesadas: {procesados}")
    print(f"Horas con píxeles visibles sobre Valencia: {visibles}")

    return metadata_nueva, image_size, procesados, visibles


# ==========================================================
# LIMPIAR HISTÓRICO > 72 H
# ==========================================================

def limpiar_historico(metadata, ref_time):
    cutoff = ref_time - timedelta(hours=72, minutes=30)

    metadata_limpia = []

    for item in metadata:
        dt = parse_iso_utc(item.get("time_utc"))

        if dt is None:
            continue

        if dt >= cutoff:
            metadata_limpia.append(item)

    archivos_validos = {item["file"] for item in metadata_limpia}

    for png in HORAS_DIR.glob("rayos_*.png"):
        if png.name not in archivos_validos:
            png.unlink(missing_ok=True)

    guardar_json(HORAS_META, metadata_limpia)

    return metadata_limpia


# ==========================================================
# COMPOSICIONES 24 / 48 / 72 H
# ==========================================================

def obtener_image_size(metadata, image_size):
    if image_size is not None:
        return image_size

    for item in metadata:
        path = HORAS_DIR / item["file"]

        if path.exists():
            try:
                with Image.open(path) as img:
                    return img.size
            except Exception:
                pass

    # Fallback por si no hay nada.
    return (900, 900)


def componer_horas(metadata, horas, ref_time, image_size):
    cutoff = ref_time - timedelta(hours=horas)

    seleccion = []

    for item in metadata:
        dt = parse_iso_utc(item.get("time_utc"))

        if dt is None:
            continue

        if dt >= cutoff:
            seleccion.append((dt, item))

    seleccion.sort(key=lambda x: x[0])

    salida = Image.new("RGBA", image_size, (0, 0, 0, 0))

    total_visibles = 0

    for _, item in seleccion:
        path = HORAS_DIR / item["file"]

        if not path.exists():
            continue

        try:
            img = Image.open(path).convert("RGBA")

            if img.size != image_size:
                img = img.resize(image_size, Image.Resampling.BILINEAR)

            salida = Image.alpha_composite(salida, img)
            total_visibles += int(item.get("visible_pixels", 0))

        except Exception as e:
            print(f"No se pudo componer {path.name}: {e}")

    out_path = OUT_DIR / f"rayos_{horas}h.png"
    salida.save(out_path, optimize=True)

    return {
        "horas": horas,
        "archivo": out_path.name,
        "imagenes_usadas": len(seleccion),
        "pixeles_visibles_acumulados": total_visibles
    }


# ==========================================================
# ARCHIVOS AUXILIARES PARA LEAFLET
# ==========================================================

def escribir_bounds(image_size, capture_time):
    bounds = {
        "bounds": [
            [LAT_MIN, LON_MIN],
            [LAT_MAX, LON_MAX]
        ],
        "leaflet": "L.imageOverlay(url, bounds)",
        "bbox": {
            "lon_min": LON_MIN,
            "lat_min": LAT_MIN,
            "lon_max": LON_MAX,
            "lat_max": LAT_MAX
        },
        "image_size": {
            "width": image_size[0],
            "height": image_size[1]
        },
        "actualizado_utc": iso_utc(capture_time)
    }

    guardar_json(BOUNDS_FILE, bounds)


# ==========================================================
# MAIN
# ==========================================================

def main():
    capture_time = now_utc()

    limpiar_tmp()

    url_usada = descargar_paquete_aemet()

    metadata, image_size, procesados, visibles = extraer_horas_desde_tar(capture_time)

    metadata = limpiar_historico(metadata, capture_time)

    image_size = obtener_image_size(metadata, image_size)

    resumen_24 = componer_horas(metadata, 24, capture_time, image_size)
    resumen_48 = componer_horas(metadata, 48, capture_time, image_size)
    resumen_72 = componer_horas(metadata, 72, capture_time, image_size)

    escribir_bounds(image_size, capture_time)

    manifest = {
        "producto": "Rayos AEMET raster GeoTIFF",
        "fuente": url_usada,
        "region_token": REGION_TOKEN,
        "actualizado_utc": iso_utc(capture_time),
        "bbox_valencia": {
            "lon_min": LON_MIN,
            "lat_min": LAT_MIN,
            "lon_max": LON_MAX,
            "lat_max": LAT_MAX
        },
        "geotiff_procesados_en_esta_ejecucion": procesados,
        "geotiff_con_pixeles_visibles_valencia": visibles,
        "historico_horas_guardadas": len(metadata),
        "image_size": {
            "width": image_size[0],
            "height": image_size[1]
        },
        "salidas": {
            "24h": resumen_24,
            "48h": resumen_48,
            "72h": resumen_72
        },
        "archivos_para_leaflet": [
            "rayos_24h.png",
            "rayos_48h.png",
            "rayos_72h.png",
            "rayos_bounds.json"
        ],
        "nota": "AEMET proporciona los rayos como GeoTIFF raster. No hay puntos GeoJSON individuales."
    }

    guardar_json(MANIFEST_FILE, manifest)

    limpiar_tmp()

    print("Actualización completada.")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
