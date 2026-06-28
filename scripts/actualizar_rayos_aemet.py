import json
import os
import tarfile
import hashlib
from pathlib import Path
from urllib.request import Request, urlopen
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo


AEMET_RAYOS_URL = os.environ.get(
    "AEMET_RAYOS_URL",
    "https://www.aemet.es/es/geojson/download/rayos/descargar_rayos_1782676866.tar.gz"
)

BASE_DIR = Path(__file__).resolve().parents[1]
OUT_DIR = BASE_DIR / "datos" / "rayos"
OUT_DIR.mkdir(parents=True, exist_ok=True)

FILE_24H = OUT_DIR / "rayos_24h.geojson"
FILE_48H = OUT_DIR / "rayos_48h.geojson"
FILE_72H = OUT_DIR / "rayos_72h.geojson"
MANIFEST = OUT_DIR / "manifest_rayos.json"

TMP_TAR = OUT_DIR / "_rayos_aemet.tar.gz"

# BBOX aproximado provincia de Valencia + margen.
# Luego lo mejoraremos con el polígono exacto de provincia.
FILTER_VALENCIA_BBOX = os.environ.get("FILTER_VALENCIA_BBOX", "1") == "1"
LON_MIN, LON_MAX = -1.70, 0.05
LAT_MIN, LAT_MAX = 38.60, 40.25

TIME_KEYS = [
    "fecha", "fecha_hora", "fechahora", "datetime", "date",
    "time", "hora", "timestamp", "ts", "fint", "fh"
]


def now_utc():
    return datetime.now(timezone.utc)


def to_iso_utc(dt):
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def parse_datetime(value):
    if value is None:
        return None

    if isinstance(value, (int, float)):
        try:
            # Epoch en milisegundos o segundos
            if value > 10_000_000_000:
                value = value / 1000
            return datetime.fromtimestamp(value, tz=timezone.utc)
        except Exception:
            return None

    if not isinstance(value, str):
        return None

    s = value.strip()
    if not s:
        return None

    s = s.replace("Z", "+00:00")
    s = s.replace(" UTC", "+00:00")
    s = s.replace("CEST", "").replace("CET", "").strip()

    # ISO
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("Europe/Madrid"))
        return dt.astimezone(timezone.utc)
    except Exception:
        pass

    # Formatos frecuentes
    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%Y%m%d%H%M%S",
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(s, fmt)
            dt = dt.replace(tzinfo=ZoneInfo("Europe/Madrid"))
            return dt.astimezone(timezone.utc)
        except Exception:
            continue

    return None


def detect_feature_time(feature, capture_time):
    props = feature.get("properties") or {}

    for key in TIME_KEYS:
        for real_key in props.keys():
            if real_key.lower() == key.lower():
                dt = parse_datetime(props.get(real_key))
                if dt:
                    return dt, real_key

    # Si AEMET no trae hora en propiedades, usamos la hora de captura.
    return capture_time, "metvlc_captura_utc"


def is_point_in_valencia_bbox(feature):
    geom = feature.get("geometry") or {}
    if geom.get("type") != "Point":
        return True

    coords = geom.get("coordinates") or []
    if len(coords) < 2:
        return False

    lon, lat = coords[0], coords[1]
    return LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX


def feature_key(feature):
    geom = feature.get("geometry") or {}
    props = feature.get("properties") or {}

    clean_props = {
        k: v for k, v in props.items()
        if not str(k).startswith("metvlc_")
    }

    raw = json.dumps(
        {
            "geometry": geom,
            "properties": clean_props,
        },
        ensure_ascii=False,
        sort_keys=True
    )

    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def read_feature_collection(path):
    if not path.exists():
        return []

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("type") == "FeatureCollection":
            return data.get("features", [])
    except Exception:
        pass

    return []


def write_feature_collection(path, features):
    fc = {
        "type": "FeatureCollection",
        "features": features
    }

    path.write_text(
        json.dumps(fc, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def download_aemet_package():
    print("Descargando paquete de rayos AEMET...")
    print(AEMET_RAYOS_URL)

    req = Request(
        AEMET_RAYOS_URL,
        headers={
            "User-Agent": "Mozilla/5.0 MetVlc GitHub Action"
        }
    )

    with urlopen(req, timeout=120) as response:
        TMP_TAR.write_bytes(response.read())

    print(f"Descargado: {TMP_TAR}")
    print(f"Tamaño: {TMP_TAR.stat().st_size / 1024:.1f} KB")


def extract_features_from_tar(capture_time):
    features = []

    with tarfile.open(TMP_TAR, "r:gz") as tar:
        members = tar.getmembers()

        useful = [
            m for m in members
            if m.isfile() and m.name.lower().endswith((".geojson", ".json"))
        ]

        print(f"Archivos JSON/GeoJSON encontrados: {len(useful)}")

        for member in useful:
            f = tar.extractfile(member)
            if not f:
                continue

            try:
                data = json.loads(f.read().decode("utf-8"))
            except Exception as e:
                print(f"No se pudo leer {member.name}: {e}")
                continue

            if data.get("type") == "FeatureCollection":
                incoming = data.get("features", [])
            elif data.get("type") == "Feature":
                incoming = [data]
            else:
                incoming = []

            for feat in incoming:
                if FILTER_VALENCIA_BBOX and not is_point_in_valencia_bbox(feat):
                    continue

                props = feat.setdefault("properties", {})
                dt, source_key = detect_feature_time(feat, capture_time)

                props["metvlc_time_utc"] = to_iso_utc(dt)
                props["metvlc_time_source"] = source_key
                props["metvlc_captura_utc"] = to_iso_utc(capture_time)
                props["metvlc_fuente"] = "AEMET rayos"

                features.append(feat)

    return features


def filter_last_hours(features, hours, ref_time):
    limit = ref_time - timedelta(hours=hours)
    output = []

    for feat in features:
        props = feat.get("properties") or {}
        dt = parse_datetime(props.get("metvlc_time_utc"))
        if dt and dt >= limit:
            output.append(feat)

    return output


def main():
    capture_time = now_utc()

    download_aemet_package()
    new_features = extract_features_from_tar(capture_time)

    old_features = read_feature_collection(FILE_72H)

    merged = {}

    # Primero históricos, para conservar la primera hora de captura si no hay hora original.
    for feat in old_features:
        merged[feature_key(feat)] = feat

    for feat in new_features:
        key = feature_key(feat)
        if key not in merged:
            merged[key] = feat

    all_features = list(merged.values())

    features_72h = filter_last_hours(all_features, 72, capture_time)
    features_48h = filter_last_hours(all_features, 48, capture_time)
    features_24h = filter_last_hours(all_features, 24, capture_time)

    write_feature_collection(FILE_72H, features_72h)
    write_feature_collection(FILE_48H, features_48h)
    write_feature_collection(FILE_24H, features_24h)

    manifest = {
        "fuente": AEMET_RAYOS_URL,
        "actualizado_utc": to_iso_utc(capture_time),
        "filtro_bbox_valencia": FILTER_VALENCIA_BBOX,
        "rayos_nuevos_descarga": len(new_features),
        "rayos_24h": len(features_24h),
        "rayos_48h": len(features_48h),
        "rayos_72h": len(features_72h),
        "archivos": [
            "rayos_24h.geojson",
            "rayos_48h.geojson",
            "rayos_72h.geojson"
        ]
    }

    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    TMP_TAR.unlink(missing_ok=True)

    print("Actualización completada.")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
