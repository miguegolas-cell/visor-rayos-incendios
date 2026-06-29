import json
import os
import re
import html
import hashlib
import xml.etree.ElementTree as ET
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
    "fecha", "fecha_hora", "fechahora", "datetime", "date",
    "time", "hora", "timestamp", "ts", "fint", "fh"
]


# ==========================================================
# UTILIDADES
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
        r"\d{12,14}",
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

    # Campos de fecha/hora completos
    for key in TIME_KEYS:
        if key in props_lower:
            dt = parse_datetime(props_lower[key])
            if dt:
                return dt, key, True

    # Buscar dentro de nombre y descripción
    texto = " ".join(
        str(props.get(k, ""))
        for k in ["name", "description", "descripcion", "descripción"]
    )

    dt = extraer_fecha_de_texto(texto)
    if dt:
        return dt, "texto_kml", True

    # Si el KML no trae hora, usamos la hora de captura.
    # En duplicados se conserva la primera hora vista.
    return capture_time, "metvlc_captura_utc", False


# ==========================================================
# DESCARGAR KML
# ==========================================================

def descargar_kml():
    print("Descargando KML SIGIF/GVA...")
    print(SIGIF_KML_URL)

    req = Request(
        SIGIF_KML_URL,
        headers={
            "User-Agent": "Mozilla/5.0 MetVlc GitHub Action"
        }
    )

    with urlopen(req, timeout=120) as response:
        content = response.read()

    print(f"KML descargado: {len(content) / 1024:.1f} KB")

    return content


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
    root = ET.fromstring(kml_content)

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
        props["metvlc_fuente"] = "SIGIF/GVA Rayos 24h KML"

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
            # Conservamos la primera hora, actualizamos última vez visto
            old_props = merged[key].setdefault("properties", {})
            new_props = feat.get("properties") or {}

            old_props["metvlc_last_seen_utc"] = iso_utc(capture_time)

            # Si antes no tenía hora real y ahora sí, actualizamos
            if not old_props.get("metvlc_has_real_time") and new_props.get("metvlc_has_real_time"):
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

    kml_content = descargar_kml()
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

    # El histórico se queda solo con 72h
    write_geojson(HISTORICO, features_72h)
    write_geojson(FILE_24H, features_24h)
    write_geojson(FILE_48H, features_48h)
    write_geojson(FILE_72H, features_72h)

    manifest = {
        "producto": "Rayos SIGIF/GVA KML 24h convertido a GeoJSON",
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
        "nota": "Si el KML no trae hora individual de cada rayo, se usa la primera hora de captura en GitHub Actions."
    }

    write_json(MANIFEST, manifest)

    print("Actualización completada.")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
