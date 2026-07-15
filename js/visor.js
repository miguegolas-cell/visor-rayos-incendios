// ============================================================
// METVLC · VISOR ÚLTIMOS RAYOS
// Capas base: OpenStreetMap, Carto, Satélite Esri, Relieve Esri,
// Satélite + relieve
// Capas operativas: Rayos, pendiente, NDMI, combustible
// ============================================================


// ===============================
// RUTAS
// ===============================

// Rayos.
// El script Python genera estos archivos:
// datos/rayos/rayos_24h.geojson
// datos/rayos/rayos_48h.geojson
// datos/rayos/rayos_72h.geojson
// datos/rayos/rayos_historico.geojson
const RAYOS_CANDIDATOS = [
  "datos/rayos/rayos_24h.geojson",
  "datos/rayos/rayos_48h.geojson",
  "datos/rayos/rayos_72h.geojson",
  "datos/rayos/rayos_historico.geojson"
];

const LIMITE_CV = "datos/limites/comunitat_valenciana.geojson";

const COMBUSTIBLE_IMAGE = "datos/combustible/modelo_combustible.png";
const COMBUSTIBLE_BOUNDS = "datos/combustible/modelo_combustible_bounds.json";
const COMBUSTIBLE_LEYENDA = "datos/combustible/modelo_combustible_leyenda.json";

const PENDIENTE_IMAGE = "datos/pendiente/pendiente.png";
const PENDIENTE_BOUNDS = "datos/pendiente/pendiente_bounds.json";
const PENDIENTE_LEYENDA = "datos/pendiente/pendiente_leyenda.json";

const NDMI_IMAGE = "datos/ndmi/ultimo_ndmi.png";
const NDMI_BOUNDS = "datos/ndmi/ndmi_bounds.json";
const NDMI_LEYENDA = "datos/ndmi/ndmi_leyenda.json";


// ===============================
// MAPA
// ===============================

const map = L.map("map", {
  center: [39.35, -0.45],
  zoom: 8,
  minZoom: 7,
  maxZoom: 18,
  zoomControl: true
});

map.createPane("panePendiente");
map.getPane("panePendiente").style.zIndex = 330;

map.createPane("paneNdmi");
map.getPane("paneNdmi").style.zIndex = 340;

map.createPane("paneCombustible");
map.getPane("paneCombustible").style.zIndex = 350;

map.createPane("paneLimite");
map.getPane("paneLimite").style.zIndex = 500;

map.createPane("paneRayos");
map.getPane("paneRayos").style.zIndex = 650;


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
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap &copy; CARTO"
  }
);

function crearEsriWorldImagery() {
  return L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri"
    }
  );
}

function crearEsriRelieveSombreado() {
  return L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 13,
      maxZoom: 19,
      attribution: "Relief &copy; Esri"
    }
  );
}

function crearEsriHillshade(opacity = 0.32) {
  return L.tileLayer(
    "https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 13,
      maxZoom: 19,
      opacity: opacity,
      attribution: "Hillshade &copy; Esri"
    }
  );
}

function crearEsriEtiquetas() {
  return L.tileLayer(
    "https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Labels &copy; Esri"
    }
  );
}

const esriSatelite = crearEsriWorldImagery();
const esriRelieve = crearEsriRelieveSombreado();

const esriSateliteRelieve = L.layerGroup([
  crearEsriWorldImagery(),
  crearEsriHillshade(0.30),
  crearEsriEtiquetas()
]);

const baseLayers = {
  "OpenStreetMap": osm,
  "Carto claro": cartoLight,
  "Satélite Esri": esriSatelite,
  "Relieve Esri": esriRelieve,
  "Satélite + relieve": esriSateliteRelieve
};

const overlayLayers = {};

const layerControl = L.control.layers(baseLayers, overlayLayers, {
  collapsed: false
}).addTo(map);


// ===============================
// VARIABLES DE CAPAS
// ===============================

let rayosLayer = L.layerGroup([], {
  pane: "paneRayos"
}).addTo(map);

let limiteLayer = null;
let combustibleLayer = null;
let pendienteLayer = null;
let ndmiLayer = null;

let rayosOverlayRegistrado = false;


// ===============================
// UTILIDADES
// ===============================

function urlNoCache(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${Date.now()}`;
}

function setEstado(texto) {
  const el = document.getElementById("estadoDatos");
  if (el) {
    el.textContent = texto;
  }
}

async function fetchJson(url) {
  const response = await fetch(urlNoCache(url));

  if (!response.ok) {
    throw new Error(`No se pudo cargar ${url}: ${response.status}`);
  }

  return response.json();
}

async function fetchJsonCandidatos(urls) {
  let ultimoError = null;

  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      return {
        data,
        url
      };
    } catch (error) {
      ultimoError = error;
      console.warn(`No cargó ${url}`, error);
    }
  }

  throw ultimoError || new Error("No se pudo cargar ningún archivo de rayos");
}

function getProp(props, keys, fallback = "") {
  for (const key of keys) {
    if (props[key] !== undefined && props[key] !== null && props[key] !== "") {
      return props[key];
    }
  }

  return fallback;
}

function normalizarFecha(valor) {
  if (!valor) {
    return null;
  }

  const d = new Date(valor);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return d;
}

function formatoFecha(valor) {
  const fecha = normalizarFecha(valor);

  if (!fecha) {
    return "Sin fecha";
  }

  return fecha.toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function obtenerFechaRayo(props) {
  return getProp(props, [
    "metvlc_time_utc",
    "fecha",
    "datetime",
    "time",
    "timestamp",
    "fecha_hora",
    "fechahora",
    "date",
    "hora",
    "FECHA",
    "HORA"
  ], null);
}

function colorRayoPorAntiguedad(props) {
  const fecha = obtenerFechaRayo(props);
  const d = normalizarFecha(fecha);

  if (!d) {
    return "#7b2cbf";
  }

  const horas = (Date.now() - d.getTime()) / 3600000;

  if (horas <= 1) return "#ff0000";
  if (horas <= 3) return "#ff7b00";
  if (horas <= 6) return "#ffd000";
  if (horas <= 12) return "#3a86ff";
  if (horas <= 24) return "#8338ec";

  return "#595959";
}

function popupRayo(feature) {
  const p = feature.properties || {};

  const fecha = obtenerFechaRayo(p);

  const intensidad = getProp(p, [
    "intensidad",
    "amplitude",
    "AMPLITUD",
    "peak_current",
    "corriente",
    "kA"
  ], "—");

  const polaridad = getProp(p, [
    "polaridad",
    "POLARIDAD",
    "polarity"
  ], "—");

  const fuente = getProp(p, [
    "metvlc_fuente",
    "fuente",
    "source",
    "origen",
    "ORIGEN"
  ], "—");

  const timeSource = getProp(p, [
    "metvlc_time_source"
  ], "");

  const captura = getProp(p, [
    "metvlc_captura_utc"
  ], "");

  let html = `
    <div class="popup-title">Rayo detectado</div>
    <table class="popup-table">
      <tr><td>Fecha</td><td>${formatoFecha(fecha)}</td></tr>
      <tr><td>Intensidad</td><td>${intensidad}</td></tr>
      <tr><td>Polaridad</td><td>${polaridad}</td></tr>
      <tr><td>Fuente</td><td>${fuente}</td></tr>
  `;

  if (timeSource) {
    html += `<tr><td>Origen hora</td><td>${timeSource}</td></tr>`;
  }

  if (captura) {
    html += `<tr><td>Captura</td><td>${formatoFecha(captura)}</td></tr>`;
  }

  html += `
    </table>
  `;

  return html;
}


// ===============================
// RAYOS
// ===============================

async function cargarRayos() {
  setEstado("Cargando rayos...");

  try {
    const result = await fetchJsonCandidatos(RAYOS_CANDIDATOS);
    const geojson = result.data;

    rayosLayer.clearLayers();

    const layer = L.geoJSON(geojson, {
      pane: "paneRayos",

      pointToLayer: function (feature, latlng) {
        const props = feature.properties || {};

        return L.circleMarker(latlng, {
          radius: 6,
          color: "#1b1b1b",
          weight: 1,
          fillColor: colorRayoPorAntiguedad(props),
          fillOpacity: 0.90,
          opacity: 1,
          pane: "paneRayos"
        });
      },

      onEachFeature: function (feature, layer) {
        layer.bindPopup(popupRayo(feature));
      }
    });

    layer.addTo(rayosLayer);

    const total = geojson.features ? geojson.features.length : 0;

    let periodo = "rayos";
    if (result.url.includes("24h")) periodo = "rayos 24 h";
    if (result.url.includes("48h")) periodo = "rayos 48 h";
    if (result.url.includes("72h")) periodo = "rayos 72 h";

    setEstado(`${total} ${periodo} cargados`);

    if (!rayosOverlayRegistrado) {
      layerControl.addOverlay(rayosLayer, "Últimos rayos");
      rayosOverlayRegistrado = true;
    }

    try {
      const bounds = layer.getBounds();

      if (bounds.isValid()) {
        map.fitBounds(bounds.pad(0.10));
      }
    } catch (e) {
      console.warn("No se pudo ajustar el mapa a los rayos", e);
    }

  } catch (error) {
    console.error(error);
    setEstado("Error cargando rayos");
  }
}


// ===============================
// LÍMITE CV
// ===============================

async function cargarLimiteCV() {
  try {
    const geojson = await fetchJson(LIMITE_CV);

    limiteLayer = L.geoJSON(geojson, {
      pane: "paneLimite",
      style: {
        color: "#102a3a",
        weight: 2,
        opacity: 0.85,
        fillOpacity: 0
      }
    }).addTo(map);

    layerControl.addOverlay(limiteLayer, "Límite Comunitat Valenciana");

    try {
      map.fitBounds(limiteLayer.getBounds(), {
        padding: [20, 20]
      });
    } catch (e) {
      console.warn("No se pudo ajustar al límite CV", e);
    }

  } catch (error) {
    console.warn("No se pudo cargar límite CV", error);
  }
}


// ===============================
// RÁSTERES COMO IMAGEOVERLAY
// ===============================

function normalizarBounds(boundsJson) {
  if (Array.isArray(boundsJson)) {
    return boundsJson;
  }

  if (boundsJson.bounds) {
    return boundsJson.bounds;
  }

  if (
    boundsJson.south !== undefined &&
    boundsJson.west !== undefined &&
    boundsJson.north !== undefined &&
    boundsJson.east !== undefined
  ) {
    return [
      [boundsJson.south, boundsJson.west],
      [boundsJson.north, boundsJson.east]
    ];
  }

  throw new Error("Formato de bounds no reconocido");
}

async function cargarImageOverlay(nombre, imageUrl, boundsUrl, pane, opacity) {
  try {
    const boundsJson = await fetchJson(boundsUrl);
    const bounds = normalizarBounds(boundsJson);

    const layer = L.imageOverlay(urlNoCache(imageUrl), bounds, {
      pane: pane,
      opacity: opacity,
      interactive: false
    });

    layerControl.addOverlay(layer, nombre);

    return layer;

  } catch (error) {
    console.warn(`No se pudo cargar ${nombre}`, error);
    return null;
  }
}

async function cargarRasteres() {
  pendienteLayer = await cargarImageOverlay(
    "Pendiente",
    PENDIENTE_IMAGE,
    PENDIENTE_BOUNDS,
    "panePendiente",
    0.70
  );

  ndmiLayer = await cargarImageOverlay(
    "NDMI",
    NDMI_IMAGE,
    NDMI_BOUNDS,
    "paneNdmi",
    0.72
  );

  combustibleLayer = await cargarImageOverlay(
    "Modelo de combustible",
    COMBUSTIBLE_IMAGE,
    COMBUSTIBLE_BOUNDS,
    "paneCombustible",
    0.72
  );
}


// ===============================
// LEYENDAS
// ===============================

const legendRayos = L.control({
  position: "bottomleft"
});

legendRayos.onAdd = function () {
  const div = L.DomUtil.create("div", "legend");

  div.innerHTML = `
    <div class="legend-title">Últimos rayos</div>
    <div class="legend-item"><span class="legend-color" style="background:#ff0000"></span>0–1 h</div>
    <div class="legend-item"><span class="legend-color" style="background:#ff7b00"></span>1–3 h</div>
    <div class="legend-item"><span class="legend-color" style="background:#ffd000"></span>3–6 h</div>
    <div class="legend-item"><span class="legend-color" style="background:#3a86ff"></span>6–12 h</div>
    <div class="legend-item"><span class="legend-color" style="background:#8338ec"></span>12–24 h</div>
    <div class="legend-item"><span class="legend-color" style="background:#595959"></span>&gt;24 h / sin fecha</div>
  `;

  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  return div;
};

legendRayos.addTo(map);


// ===============================
// CONTROL DE OPACIDAD
// ===============================

const opacityControl = L.control({
  position: "topright"
});

opacityControl.onAdd = function () {
  const div = L.DomUtil.create("div", "opacity-control");

  div.innerHTML = `
    <label>Opacidad capas</label>

    <div class="opacity-row">
      <span>Pendiente</span>
      <input id="opPendiente" type="range" min="0" max="1" step="0.05" value="0.70">
    </div>

    <div class="opacity-row">
      <span>NDMI</span>
      <input id="opNdmi" type="range" min="0" max="1" step="0.05" value="0.72">
    </div>

    <div class="opacity-row">
      <span>Combustible</span>
      <input id="opCombustible" type="range" min="0" max="1" step="0.05" value="0.72">
    </div>
  `;

  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  return div;
};

opacityControl.addTo(map);

function activarControlesOpacidad() {
  const opPendiente = document.getElementById("opPendiente");
  const opNdmi = document.getElementById("opNdmi");
  const opCombustible = document.getElementById("opCombustible");

  if (opPendiente) {
    opPendiente.addEventListener("input", e => {
      if (pendienteLayer) {
        pendienteLayer.setOpacity(Number(e.target.value));
      }
    });
  }

  if (opNdmi) {
    opNdmi.addEventListener("input", e => {
      if (ndmiLayer) {
        ndmiLayer.setOpacity(Number(e.target.value));
      }
    });
  }

  if (opCombustible) {
    opCombustible.addEventListener("input", e => {
      if (combustibleLayer) {
        combustibleLayer.setOpacity(Number(e.target.value));
      }
    });
  }
}


// ===============================
// ARRANQUE
// ===============================

async function init() {
  setEstado("Inicializando visor...");

  await cargarLimiteCV();
  await cargarRasteres();

  activarControlesOpacidad();

  await cargarRayos();
}

init();
