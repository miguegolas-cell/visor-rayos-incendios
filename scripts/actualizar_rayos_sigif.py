import json
import os
import re
import html
import gzip
import zipfile
import hashlib
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from urllib.request import Request, urlopen


# ==========================================================
# CONFIGURACIÓN
# ==========================================================

SIGIF_KML_URL = os.environ.get(
    "SIGIF_KML_URL",
    "https://prevencionincendiosgva.es/Meteorologia/GetRayos24hKML"
)

BASE_DIR = Path(__file__).resolve().parents[1]
OUT_DIR = BASE_DIR / "datos" / "rayos"
OUT_DIR.mkdir(parents=True, exist_ok=True)

FILE_24H = OUT_DIR / "rayos_24h.geojson"
FILE_48H = OUT_DIR / "rayos_48h.geojson"
FILE_72H = OUT_DIR / "rayos_72h.geojson"
HISTORICO = OUT_DIR / "rayos_historico.geojson"
MANIFEST = OUT_DIR / "manifest_rayos.json"

# Filtro aproximado provincia de Valencia + margen
# lon_min, lat_min, lon_max, lat_max
VALENCIA_BBOX = os.environ.get("VALENCIA_BBOX", "-1.70,38.60,0.05,40.25")
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = map(float, VALENCIA_BBOX.split(","))

TIME_KEYS = [
    "fecha",
    "fecha_hora",
    "fechahora",
    "datetime",
    "date",
    "time",
    "hora",
    "timestamp",
    "ts",
    "fint",
    "fh"
]


# ==========================================================
# UTILIDADES GENERALES
# ==========================================================

def now_utc():
    return datetime.now(timezone.utc)


def iso_utc(dt):
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def parse_iso(value):
    if not value:
        return None

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def strip_html(text):
    if not text:
        return ""

    text = html.unescape(str(text))
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    return text


def in_valencia_bbox(lon, lat):
    return LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX


def read_geojson(path):
    if not path.exists():
        return {
            "type": "FeatureCollection",
            "features": []
        }

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {
            "type": "FeatureCollection",
            "features": []
        }


def write_geojson(path, features):
    data = {
        "type": "FeatureCollection",
        "features": features
    }

    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def write_json(path, data):
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


# ==========================================================
# DESCARGA KMZ / KML
# ==========================================================

def descargar_kmz_o_kml():
    print("Descargando archivo SIGIF/GVA...")
    print(SIGIF_KML_URL)

    req = Request(
        SIGIF_KML_URL,
        headers={
            "User-Agent": "Mozilla/5.0 MetVlc GitHub Action",
            "Accept": (
                "application/vnd.google-earth.kmz,"
                "application/vnd.google-earth.kml+xml,"
                "application/xml,text/xml,*/*"
            )
        }
    )

    with urlopen(req, timeout=120) as response:
        content = response.read()
        content_type = response.headers.get("Content-Type", "")

    print(f"Contenido descargado: {len(content) / 1024:.1f} KB")
    print(f"Content-Type: {content_type}")
    print(f"Primeros bytes: {content[:20]!r}")

    return content


def normalizar_kml_content(content):
    """
    Convierte la respuesta descargada en KML limpio.

    Admite:
    - KMZ/ZIP con un .kml dentro
    - KML directo
    - GZIP
    - KML con caracteres antes de <kml>
    - HTML de error, avisando claramente
    """

    raw = content

    # GZIP
    if raw[:2] == b"\x1f\x8b":
        print("Detectado GZIP. Descomprimiendo...")
        raw = gzip.decompress(raw)

    # KMZ / ZIP
    if raw[:4] == b"PK\x03\x04":
        print("Detectado KMZ/ZIP. Buscando archivo .kml dentro...")

        with zipfile.ZipFile(BytesIO(raw)) as z:
            nombres = z.namelist()

            print("Archivos dentro del KMZ:")
            for nombre in nombres:
                print(f" - {nombre}")

            kmls = [
                nombre for nombre in nombres
                if nombre.lower().endswith(".kml")
            ]

            if not kmls:
                raise RuntimeError("El KMZ no contiene ningún archivo .kml")

            # Normalmente será doc.kml
            kml_name = kmls[0]
            raw = z.read(kml_name)

            print(f"KML extraído del KMZ: {kml_name}")

    # Decodificación
    texto = None

    for enc in ["utf-8-sig", "utf-16", "latin-1"]:
        try:
            prueba = raw.decode(enc)

            # Evita decodificaciones malas llenas de nulos
            if prueba.count("\x00") > 10:
                continue

            texto = prueba
            print(f"Decodificación usada: {enc}")
            break

        except Exception:
            continue

    if texto is None:
        raise RuntimeError("No se pudo decodificar el contenido como KML")

    texto_limpio = texto.strip()
    inicio_lower = texto_limpio[:600].lower()

    if "<html" in inicio_lower or "<!doctype html" in inicio_lower:
        print("La respuesta parece HTML, no KML/KMZ.")
        print("Vista previa:")
        print(texto_limpio[:1000])
        raise RuntimeError("SIGIF ha devuelto HTML en lugar de KML/KMZ")

    # Por si viniera como cadena JSON con el KML dentro
    if (
        (texto_limpio.startswith('"') and texto_limpio.endswith('"'))
        or (texto_limpio.startswith("'") and texto_limpio.endswith("'"))
    ):
        try:
            texto_limpio = json.loads(texto_limpio)
            print("Detectado KML dentro de cadena JSON.")
        except Exception:
            pass

    # Buscar inicio real del XML/KML
    posibles_inicios = []

    idx_xml = texto_limpio.find("<?xml")
    idx_kml = texto_limpio.find("<kml")

    if idx_xml >= 0:
        posibles_inicios.append(idx_xml)

    if idx_kml >= 0:
        posibles_inicios.append(idx_kml)

    if not posibles_inicios:
        print("No se ha encontrado etiqueta <?xml ni <kml.")
        print("Vista previa:")
        print(texto_limpio[:1000])
        raise RuntimeError("La respuesta descargada no contiene KML reconocible")

    inicio = min(posibles_inicios)

    if inicio > 0:
        print(f"Eliminando {inicio} caracteres antes del inicio del KML.")
        texto_limpio = texto_limpio[inicio:]

    # Cortar basura posterior tras </kml>
    cierre = texto_limpio.lower().rfind("</kml>")

    if cierre >= 0:
        texto_limpio = texto_limpio[:cierre + len("</kml>")]

    print("KML normalizado correctamente.")
    print(f"Tamaño KML limpio: {len(texto_limpio) / 1024:.1f} KB")

    return texto_limpio


# ==========================================================
# FECHAS
# ==========================================================

def parse_datetime(value):
    if value is None:
        return None

    if isinstance(value, (int, float)):
        try:
            if value > 10_000_000_000:
                value = value / 1000

            return datetime.fromtimestamp(value, tz=timezone.utc)
        except Exception:
            return None

    s = str(value).strip()

    if not s:
        return None

    s = s.replace("Z", "+00:00")
    s = s.replace(" UTC", "+00:00")
    s = s.replace("CEST", "").replace("CET", "").strip()

    # ISO directo
    try:
        dt = datetime.fromisoformat(s)

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("Europe/Madrid"))

        return dt.astimezone(timezone.utc)

    except Exception:
        pass

    formatos = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%Y%m%d%H%M%S",
        "%Y%m%d%H%M",
        "%Y%m%d%H",
    ]

    for fmt in formatos:
        try:
            dt = datetime.strptime(s, fmt)
            dt = dt.replace(tzinfo=ZoneInfo("Europe/Madrid"))
            return dt.astimezone(timezone.utc)

        except Exception:
            continue

    return None


def extraer_fecha_de_texto(texto):
    if not texto:
        return None

    patrones = [
        r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}",
        r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}",
        r"\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2}",
        r"\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}",
        r"\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2}",
        r"\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}",
        r"\d{14}",
        r"\d{12}",
        r"\d{10}",
    ]

    for patron in patrones:
        m = re.search(patron, texto)

        if m:
            dt = parse_datetime(m.group(0))

            if dt:
                return dt

    return None


def detectar_fecha_feature(props, capture_time):
    props_lower = {
        str(k).lower(): v
        for k, v in props.items()
    }

    # Fecha + hora separadas
    posibles_fechas = ["fecha", "date", "dia", "día"]
    posibles_horas = ["hora", "time"]

    for fk in posibles_fechas:
        for hk in posibles_horas:
            if fk in props_lower and hk in props_lower:
                dt = parse_datetime(f"{props_lower[fk]} {props_lower[hk]}")

                if dt:
                    return dt, f"{fk}+{hk}", True

    # Campo completo de fecha/hora
    for key in TIME_KEYS:
        if key in props_lower:
            dt = parse_datetime(props_lower[key])

            if dt:
                return dt, key, True

    # Buscar dentro de name / description
    texto = " ".join(
        str(props.get(k, ""))
        for k in ["name", "description", "descripcion", "descripción"]
    )

    dt = extraer_fecha_de_texto(texto)

    if dt:
        return dt, "texto_kml", True

    # Si no trae hora individual, usamos la hora de captura.
    return capture_time, "metvlc_captura_utc", False


# ==========================================================
# PARSEAR KML
# ==========================================================

def get_text(parent, tag_name):
    el = parent.find(f".//{{*}}{tag_name}")

    if el is None or el.text is None:
        return ""

    return el.text.strip()


def extraer_extended_data(placemark):
    props = {}

    # <Data name=""><value></value></Data>
    for data in placemark.findall(".//{*}ExtendedData/{*}Data"):
        key = data.attrib.get("name") or data.attrib.get("displayName")
        value_el = data.find(".//{*}value")

        if key and value_el is not None and value_el.text is not None:
            props[key] = value_el.text.strip()

    # <SimpleData name="">valor</SimpleData>
    for data in placemark.findall(".//{*}ExtendedData//{*}SimpleData"):
        key = data.attrib.get("name")

        if key and data.text is not None:
            props[key] = data.text.strip()

    return props


def parse_coordinates(coord_text):
    if not coord_text:
        return None

    coord_text = coord_text.strip()

    # En KML puede haber varias coordenadas; usamos la primera
    first = coord_text.split()[0]
    parts = first.split(",")

    if len(parts) < 2:
        return None

    try:
        lon = float(parts[0])
        lat = float(parts[1])
        alt = float(parts[2]) if len(parts) >= 3 else None

        return lon, lat, alt

    except Exception:
        return None


def parse_kml_to_features(kml_content, capture_time):
    kml_limpio = normalizar_kml_content(kml_content)
    root = ET.fromstring(kml_limpio)

    features = []

    placemarks = root.findall(".//{*}Placemark")

    print(f"Placemarks encontrados: {len(placemarks)}")

    for placemark in placemarks:
        name = get_text(placemark, "name")
        description_raw = get_text(placemark, "description")
        description = strip_html(description_raw)

        coord_text = get_text(placemark, "coordinates")
        coords = parse_coordinates(coord_text)

        if coords is None:
            continue

        lon, lat, alt = coords

        if not in_valencia_bbox(lon, lat):
            continue

        props = {}

        if name:
            props["name"] = name

        if description:
            props["description"] = description

        props.update(extraer_extended_data(placemark))

        dt, time_source, has_real_time = detectar_fecha_feature(props, capture_time)

        props["metvlc_time_utc"] = iso_utc(dt)
        props["metvlc_time_source"] = time_source
        props["metvlc_has_real_time"] = has_real_time
        props["metvlc_captura_utc"] = iso_utc(capture_time)
        props["metvlc_last_seen_utc"] = iso_utc(capture_time)
        props["metvlc_fuente"] = "SIGIF/GVA Rayos 24h KMZ"

        geometry_coords = [lon, lat]

        if alt is not None:
            geometry_coords.append(alt)

        feature = {
            "type": "Feature",
            "properties": props,
            "geometry": {
                "type": "Point",
                "coordinates": geometry_coords
            }
        }

        features.append(feature)

    print(f"Rayos dentro del BBOX Valencia: {len(features)}")

    return features


# ==========================================================
# DEDUPLICAR E HISTÓRICO
# ==========================================================

def feature_key(feature):
    props = feature.get("properties") or {}
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates") or []

    lon = round(float(coords[0]), 5) if len(coords) > 0 else None
    lat = round(float(coords[1]), 5) if len(coords) > 1 else None

    has_real_time = props.get("metvlc_has_real_time", False)

    if has_real_time:
        raw = {
            "lon": lon,
            "lat": lat,
            "time": props.get("metvlc_time_utc")
        }
    else:
        raw = {
            "lon": lon,
            "lat": lat,
            "name": props.get("name", ""),
            "description": props.get("description", "")
        }

    text = json.dumps(raw, ensure_ascii=False, sort_keys=True)

    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def merge_historico(old_features, new_features, capture_time):
    merged = {}

    for feat in old_features:
        merged[feature_key(feat)] = feat

    nuevos = 0
    repetidos = 0

    for feat in new_features:
        key = feature_key(feat)

        if key in merged:
            old_props = merged[key].setdefault("properties", {})
            new_props = feat.get("properties") or {}

            # Conservamos la primera hora y actualizamos la última vez visto
            old_props["metvlc_last_seen_utc"] = iso_utc(capture_time)

            # Si antes no tenía hora real y ahora sí, actualizamos
            if (
                not old_props.get("metvlc_has_real_time")
                and new_props.get("metvlc_has_real_time")
            ):
                old_props["metvlc_time_utc"] = new_props.get("metvlc_time_utc")
                old_props["metvlc_time_source"] = new_props.get("metvlc_time_source")
                old_props["metvlc_has_real_time"] = True

            repetidos += 1

        else:
            merged[key] = feat
            nuevos += 1

    return list(merged.values()), nuevos, repetidos


def filter_last_hours(features, hours, ref_time):
    cutoff = ref_time - timedelta(hours=hours)

    output = []

    for feat in features:
        props = feat.get("properties") or {}
        dt = parse_iso(props.get("metvlc_time_utc"))

        if dt and dt >= cutoff:
            output.append(feat)

    return output


# ==========================================================
# MAIN
# ==========================================================

def main():
    capture_time = now_utc()

    kml_content = descargar_kmz_o_kml()
    new_features = parse_kml_to_features(kml_content, capture_time)

    old_data = read_geojson(HISTORICO)
    old_features = old_data.get("features", [])

    all_features, nuevos, repetidos = merge_historico(
        old_features,
        new_features,
        capture_time
    )

    features_72h = filter_last_hours(all_features, 72, capture_time)
    features_48h = filter_last_hours(all_features, 48, capture_time)
    features_24h = filter_last_hours(all_features, 24, capture_time)

    # El histórico se mantiene solo a 72 h
    write_geojson(HISTORICO, features_72h)
    write_geojson(FILE_24H, features_24h)
    write_geojson(FILE_48H, features_48h)
    write_geojson(FILE_72H, features_72h)

    manifest = {
        "producto": "Rayos SIGIF/GVA KMZ 24h convertido a GeoJSON",
        "fuente": SIGIF_KML_URL,
        "actualizado_utc": iso_utc(capture_time),
        "bbox_valencia": {
            "lon_min": LON_MIN,
            "lat_min": LAT_MIN,
            "lon_max": LON_MAX,
            "lat_max": LAT_MAX
        },
        "rayos_descargados_en_bbox": len(new_features),
        "rayos_nuevos": nuevos,
        "rayos_repetidos": repetidos,
        "rayos_24h": len(features_24h),
        "rayos_48h": len(features_48h),
        "rayos_72h": len(features_72h),
        "archivos": [
            "rayos_24h.geojson",
            "rayos_48h.geojson",
            "rayos_72h.geojson",
            "rayos_historico.geojson"
        ],
        "nota": (
            "SIGIF/GVA proporciona un KMZ con rayos de las últimas 24 h. "
            "Este script acumula histórico propio hasta 72 h. "
            "Si el KML no trae hora individual de cada rayo, se usa la primera hora de captura."
        )
    }

    write_json(MANIFEST, manifest)

    print("Actualización completada.")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
