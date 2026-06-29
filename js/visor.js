// ===============================
// METVLC · VISOR RAYOS INCENDIOS
// Rayos SIGIF/GVA como puntos GeoJSON
// ===============================

console.log("visor.js cargado correctamente");

// ===============================
// MAPA
// ===============================

const map = L.map("map", {
  center: [39.25, -0.65],
  zoom: 9,
  minZoom: 7,
  maxZoom: 16
});

// ===============================
// CAPAS BASE
// ===============================

const osm = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }
).addTo(map);

const cartoLight = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap &copy; CARTO"
  }
);

const baseLayers = {
  "OpenStreetMap": osm,
  "Carto claro": cartoLight
};

// ===============================
// CAPAS OPERATIVAS
// ===============================

const rayosLayer = L.layerGroup().addTo(map);
const combustibleLayer = L.layerGroup();
const pendienteLayer = L.layerGroup();
const ndmiLayer = L.layerGroup();

const overlayLayers = {
  "Rayos SIGIF/GVA": rayosLayer,
  "Modelo de combustible": combustibleLayer,
  "Pendiente": pendienteLayer,
  "Último NDMI": ndmiLayer
};

L.control.layers(baseLayers, overlayLayers, {
  collapsed: false
}).addTo(map);

// ===============================
// RUTAS
// ===============================

const RAYOS_FILES = {
  24: "datos/rayos/rayos_24h.geojson",
  48: "datos/rayos/rayos_48h.geojson",
  72: "datos/rayos/rayos_72h.geojson"
};

const RAYOS_MANIFEST = "datos/rayos/manifest_rayos.json";

const COMBUSTIBLE_GEOJSON = "datos/combustible/modelo_combustible.geojson";
const PENDIENTE_GEOJSON = "datos/pendiente/pendiente.geojson";
const NDMI_IMAGE = "datos/ndmi/ultimo_ndmi.png";

const NDMI_BOUNDS = [
  [38.60, -1.70],
  [40.25, 0.05]
];

// ===============================
// VARIABLES
// ===============================

let primeraCargaRayos = true;

// ===============================
// UTILIDADES
// ===============================

function urlNoCache(url) {
  return `${url}?v=${Date.now()}`;
}

function setInfoRayos(texto) {
  const info = document.getElementById("infoRayos");

  if (info) {
    info.textContent = texto;
  }

  console.log(texto);
}

async function cargarJSON(url) {
  const response = await fetch(urlNoCache(url), {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`No se pudo cargar ${url} · HTTP ${response.status}`);
  }

  return await response.json();
}

function parseFechaUTC(value) {
  if (!value) return null;

  const d = new Date(value);

  if (isNaN(d.getTime())) {
    return null;
  }

  return d;
}

function edadHoras(feature) {
  const props = feature.properties || {};
  const fecha = parseFechaUTC(props.metvlc_time_utc);

  if (!fecha) return null;

  return (new Date() - fecha) / 1000 / 3600;
}

function colorPorEdad(horas) {
  if (horas === null) return "#666666";
  if (horas <= 6) return "#ff0000";
  if (horas <= 24) return "#ff8c00";
  if (horas <= 48) return "#ffd400";
  if (horas <= 72) return "#7a7a7a";
  return "#b0b0b0";
}

function radioPorEdad(horas) {
  if (horas === null) return 8;
  if (horas <= 6) return 10;
  if (horas <= 24) return 9;
  if (horas <= 48) return 8;
  return 7;
}

function formatearFecha(value) {
  const d = parseFechaUTC(value);

  if (!d) return "Sin fecha";

  return d.toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function crearPopupRayo(feature) {
  const props = feature.properties || {};
  const coords = feature.geometry?.coordinates || [];

  const lon = coords[0];
  const lat = coords[1];

  const h = edadHoras(feature);
  const antiguedad = h !== null ? `${h.toFixed(1)} h` : "No disponible";

  const nombre = props.name || "Rayo SIGIF/GVA";
  const descripcion = props.description || "";

  return `
    <div style="min-width:230px">
      <strong>${nombre}</strong><br>
      <hr style="margin:6px 0">
      <strong>Fecha:</strong> ${formatearFecha(props.metvlc_time_utc)}<br>
      <strong>Antigüedad:</strong> ${antiguedad}<br>
      <strong>Fuente:</strong> ${props.metvlc_fuente || "SIGIF/GVA"}<br>
      <strong>Lat/Lon:</strong> ${lat?.toFixed(5)}, ${lon?.toFixed(5)}
      ${descripcion ? `<hr style="margin:6px 0"><div>${descripcion}</div>` : ""}
    </div>
  `;
}

// ===============================
// CARGAR RAYOS
// ===============================

async function cargarRayos(horas = 24) {
  try {
    setInfoRayos(`Cargando rayos SIGIF/GVA · últimas ${horas} h...`);

    rayosLayer.clearLayers();

    const data = await cargarJSON(RAYOS_FILES[horas]);
    const features = data.features || [];

    console.log(`Rayos cargados ${horas}h:`, features.length);

    const geojson = L.geoJSON(data, {
      pointToLayer: function (feature, latlng) {
        const h = edadHoras(feature);

        return L.circleMarker(latlng, {
          radius: radioPorEdad(h),
          color: "#111111",
          weight: 1.6,
          fillColor: colorPorEdad(h),
          fillOpacity: 0.90,
          opacity: 1
        });
      },

      onEachFeature: function (feature, layer) {
        layer.bindPopup(crearPopupRayo(feature));
      }
    });

    geojson.addTo(rayosLayer);

    if (features.length > 0 && primeraCargaRayos) {
      const bounds = geojson.getBounds();

      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.22));
      }

      primeraCargaRayos = false;
    }

    await cargarManifestRayos(horas, features.length);

  } catch (error) {
    console.error("ERROR cargando rayos:", error);
    setInfoRayos(`ERROR: ${error.message}`);
  }
}

// ===============================
// MANIFEST RAYOS
// ===============================

async function cargarManifestRayos(horasSeleccionadas, totalFeatures) {
  try {
    const manifest = await cargarJSON(RAYOS_MANIFEST);

    const actualizado = manifest.actualizado_utc
      ? new Date(manifest.actualizado_utc).toLocaleString("es-ES", {
          timeZone: "Europe/Madrid",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })
      : "sin fecha";

    setInfoRayos(
      `Rayos SIGIF/GVA · ${horasSeleccionadas} h · ${totalFeatures} impactos · actualizado: ${actualizado}`
    );

  } catch (error) {
    console.warn("No se pudo cargar manifest_rayos.json", error);
    setInfoRayos(`Rayos SIGIF/GVA · ${horasSeleccionadas} h · ${totalFeatures} impactos`);
  }
}

// ===============================
// BOTONES 24 / 48 / 72
// ===============================

document.querySelectorAll(".time-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".time-btn").forEach(b => {
      b.classList.remove("active");
    });

    btn.classList.add("active");

    const horas = Number(btn.dataset.hours);
    cargarRayos(horas);
  });
});

// ===============================
// MODELO DE COMBUSTIBLE
// ===============================

async function cargarCombustible() {
  try {
    const response = await fetch(urlNoCache(COMBUSTIBLE_GEOJSON), {
      cache: "no-store"
    });

    if (!response.ok) {
      console.warn("Modelo de combustible no disponible todavía.");
      return;
    }

    const data = await response.json();

    L.geoJSON(data, {
      style: function () {
        return {
          color: "#654321",
          weight: 0.8,
          fillColor: "#c17f35",
          fillOpacity: 0.35
        };
      },

      onEachFeature: function (feature, layer) {
        const props = feature.properties || {};

        layer.bindPopup(`
          <strong>Modelo de combustible</strong><br>
          <hr style="margin:6px 0">
          ${Object.entries(props)
            .map(([k, v]) => `<strong>${k}:</strong> ${v}`)
            .join("<br>")}
        `);
      }
    }).addTo(combustibleLayer);

  } catch (error) {
    console.warn("No se pudo cargar modelo de combustible.", error);
  }
}

// ===============================
// PENDIENTE
// ===============================

async function cargarPendiente() {
  try {
    const response = await fetch(urlNoCache(PENDIENTE_GEOJSON), {
      cache: "no-store"
    });

    if (!response.ok) {
      console.warn("Pendiente no disponible todavía.");
      return;
    }

    const data = await response.json();

    L.geoJSON(data, {
      style: function () {
        return {
          color: "#5a5a5a",
          weight: 0.8,
          fillColor: "#8d8d8d",
          fillOpacity: 0.30
        };
      },

      onEachFeature: function (feature, layer) {
        const props = feature.properties || {};

        layer.bindPopup(`
          <strong>Pendiente</strong><br>
          <hr style="margin:6px 0">
          ${Object.entries(props)
            .map(([k, v]) => `<strong>${k}:</strong> ${v}`)
            .join("<br>")}
        `);
      }
    }).addTo(pendienteLayer);

  } catch (error) {
    console.warn("No se pudo cargar pendiente.", error);
  }
}

// ===============================
// NDMI
// ===============================

function cargarNDMI() {
  try {
    const ndmi = L.imageOverlay(urlNoCache(NDMI_IMAGE), NDMI_BOUNDS, {
      opacity: 0.65,
      interactive: false
    });

    ndmi.addTo(ndmiLayer);

  } catch (error) {
    console.warn("NDMI no cargado todavía.", error);
  }
}

// ===============================
// LEYENDA
// ===============================

const legend = L.control({
  position: "bottomright"
});

legend.onAdd = function () {
  const div = L.DomUtil.create("div", "legend");

  div.innerHTML = `
    <div class="legend-title">Antigüedad rayos</div>

    <div class="legend-item">
      <span class="legend-dot" style="background:#ff0000"></span>
      0 - 6 h
    </div>

    <div class="legend-item">
      <span class="legend-dot" style="background:#ff8c00"></span>
      6 - 24 h
    </div>

    <div class="legend-item">
      <span class="legend-dot" style="background:#ffd400"></span>
      24 - 48 h
    </div>

    <div class="legend-item">
      <span class="legend-dot" style="background:#7a7a7a"></span>
      48 - 72 h
    </div>

    <hr style="border:none;border-top:1px solid #ddd;margin:8px 0">

    <div class="legend-item">
      <span class="legend-dot" style="background:#c17f35"></span>
      Combustible
    </div>

    <div class="legend-item">
      <span class="legend-dot" style="background:#8d8d8d"></span>
      Pendiente
    </div>
  `;

  return div;
};

legend.addTo(map);

// ===============================
// INICIO
// ===============================

cargarRayos(24);
cargarCombustible();
cargarPendiente();
// cargarNDMI(); // Lo activaremos cuando subas la imagen NDMI real
