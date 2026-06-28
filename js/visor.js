// ===============================
// METVLC · VISOR RAYOS INCENDIOS
// ===============================

// Centro aproximado provincia de Valencia
const map = L.map("map", {
  center: [39.25, -0.65],
  zoom: 9,
  minZoom: 7,
  maxZoom: 16
});

// Capas base
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

// Capas operativas
let rayosLayer = L.layerGroup().addTo(map);
let combustibleLayer = L.layerGroup();
let pendienteLayer = L.layerGroup();
let ndmiLayer = L.layerGroup();

const overlayLayers = {
  "Rayos AEMET": rayosLayer,
  "Modelo de combustible": combustibleLayer,
  "Pendiente": pendienteLayer,
  "Último NDMI": ndmiLayer
};

L.control.layers(baseLayers, overlayLayers, {
  collapsed: false
}).addTo(map);

// ===============================
// CONFIGURACIÓN
// ===============================

const RAYOS_FILES = {
  24: "datos/rayos/rayos_24h.geojson",
  48: "datos/rayos/rayos_48h.geojson",
  72: "datos/rayos/rayos_72h.geojson"
};

// Estas capas las activaremos cuando me pases los archivos
const COMBUSTIBLE_GEOJSON = "datos/combustible/modelo_combustible.geojson";
const PENDIENTE_GEOJSON = "datos/pendiente/pendiente.geojson";

// NDMI manual cada 2 semanas.
// Cuando tengamos la imagen georreferenciada, ajustaremos estos bounds.
const NDMI_IMAGE = "datos/ndmi/ultimo_ndmi.png";

// Bounds provisionales para toda la provincia de Valencia.
// Después los ajustaremos a la extensión exacta del NDMI.
const NDMI_BOUNDS = [
  [38.65, -1.55],
  [40.10, -0.05]
];

// ===============================
// UTILIDADES RAYOS
// ===============================

function parseFechaUTC(value) {
  if (!value) return null;

  const d = new Date(value);
  if (isNaN(d.getTime())) return null;

  return d;
}

function edadHoras(feature) {
  const props = feature.properties || {};
  const fecha = parseFechaUTC(props.metvlc_time_utc);

  if (!fecha) return null;

  const ahora = new Date();
  return (ahora - fecha) / 1000 / 3600;
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
  if (horas === null) return 5;
  if (horas <= 6) return 7;
  if (horas <= 24) return 6;
  return 5;
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

  const horas = edadHoras(feature);
  const antiguedad = horas !== null
    ? `${horas.toFixed(1)} h`
    : "No disponible";

  return `
    <div style="min-width:210px">
      <strong>Rayo AEMET</strong><br>
      <hr style="margin:6px 0">
      <strong>Fecha:</strong> ${formatearFecha(props.metvlc_time_utc)}<br>
      <strong>Antigüedad:</strong> ${antiguedad}<br>
      <strong>Fuente:</strong> ${props.metvlc_fuente || "AEMET"}<br>
      <strong>Lat/Lon:</strong> ${lat?.toFixed(5)}, ${lon?.toFixed(5)}
    </div>
  `;
}

// ===============================
// CARGA DE RAYOS
// ===============================

async function cargarRayos(horas = 24) {
  const url = RAYOS_FILES[horas];

  rayosLayer.clearLayers();

  const info = document.getElementById("infoRayos");
  info.textContent = `Cargando rayos de las últimas ${horas} h...`;

  try {
    const response = await fetch(url, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`No se pudo cargar ${url}`);
    }

    const data = await response.json();

    const features = data.features || [];

    const geojson = L.geoJSON(data, {
      pointToLayer: function (feature, latlng) {
        const h = edadHoras(feature);

        return L.circleMarker(latlng, {
          radius: radioPorEdad(h),
          color: "#222",
          weight: 1,
          fillColor: colorPorEdad(h),
          fillOpacity: 0.85
        });
      },

      onEachFeature: function (feature, layer) {
        layer.bindPopup(crearPopupRayo(feature));
      }
    });

    geojson.addTo(rayosLayer);

    if (features.length > 0) {
      const bounds = geojson.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.18));
      }
    }

    info.textContent = `Mostrando ${features.length} rayos · últimas ${horas} h`;

  } catch (error) {
    console.error(error);
    info.textContent = `Error cargando rayos de ${horas} h`;
  }
}

// ===============================
// BOTONES 24 / 48 / 72
// ===============================

document.querySelectorAll(".time-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".time-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const horas = Number(btn.dataset.hours);
    cargarRayos(horas);
  });
});

// ===============================
// CAPAS FUTURAS
// ===============================

async function cargarCombustible() {
  try {
    const response = await fetch(COMBUSTIBLE_GEOJSON);
    if (!response.ok) return;

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
          ${Object.entries(props).map(([k, v]) => `<strong>${k}:</strong> ${v}`).join("<br>")}
        `);
      }
    }).addTo(combustibleLayer);

  } catch (e) {
    console.warn("Modelo de combustible no cargado todavía.");
  }
}

async function cargarPendiente() {
  try {
    const response = await fetch(PENDIENTE_GEOJSON);
    if (!response.ok) return;

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
          ${Object.entries(props).map(([k, v]) => `<strong>${k}:</strong> ${v}`).join("<br>")}
        `);
      }
    }).addTo(pendienteLayer);

  } catch (e) {
    console.warn("Pendiente no cargada todavía.");
  }
}

function cargarNDMI() {
  try {
    const ndmi = L.imageOverlay(NDMI_IMAGE, NDMI_BOUNDS, {
      opacity: 0.65
    });

    ndmi.addTo(ndmiLayer);

  } catch (e) {
    console.warn("NDMI no cargado todavía.");
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
    <div class="legend-title">Antigüedad del rayo</div>

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
cargarNDMI();
