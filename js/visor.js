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
//
// Importante: antes se cargaba el primer archivo existente.
// Como rayos_24h.geojson existe siempre, nunca se veía el histórico 48/72 h.
// Ahora el visor carga explícitamente el periodo elegido.
const RAYOS_FILES = {
  "24h": "datos/rayos/rayos_24h.geojson",
  "48h": "datos/rayos/rayos_48h.geojson",
  "72h": "datos/rayos/rayos_72h.geojson",
  "historico": "datos/rayos/rayos_historico.geojson"
};

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

let combustibleLegendData = null;
let pendienteLegendData = null;
let ndmiLegendData = null;

let activeRayosPeriod = "24h";
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
// SELECTOR DE PERIODO DE RAYOS
// ===============================

const periodosRayosControl = L.control({
  position: "topleft"
});

periodosRayosControl.onAdd = function () {
  const div = L.DomUtil.create("div", "legend rayos-period-control");

  div.innerHTML = `
    <div class="legend-title">Periodo rayos</div>
    <div class="rayos-period-grid">
      <button class="rayos-period-btn active" data-period="24h">24 h</button>
      <button class="rayos-period-btn" data-period="48h">48 h</button>
      <button class="rayos-period-btn" data-period="72h">72 h</button>
    </div>
    <div class="measure-small">
      El histórico se genera acumulando las descargas de SIGIF/GVA hasta 72 h.
    </div>
  `;

  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  return div;
};

periodosRayosControl.addTo(map);

function activarControlPeriodosRayos() {
  document.querySelectorAll(".rayos-period-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      cargarRayos(btn.dataset.period);
    });
  });
}

function actualizarBotonesPeriodoRayos(periodo) {
  document.querySelectorAll(".rayos-period-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.period === periodo);
  });
}

function etiquetaPeriodoRayos(periodo) {
  if (periodo === "24h") return "24 h";
  if (periodo === "48h") return "48 h";
  if (periodo === "72h") return "72 h";
  if (periodo === "historico") return "histórico";
  return periodo;
}


// ===============================
// RAYOS
// ===============================

async function cargarRayos(periodo = activeRayosPeriod) {
  activeRayosPeriod = periodo;
  actualizarBotonesPeriodoRayos(periodo);

  const url = RAYOS_FILES[periodo] || RAYOS_FILES["24h"];
  const etiqueta = etiquetaPeriodoRayos(periodo);

  setEstado(`Cargando rayos ${etiqueta}...`);

  try {
    const geojson = await fetchJson(url);

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
    setEstado(`${total} rayos cargados · ${etiqueta}`);

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
    setEstado(`Error cargando rayos ${etiqueta}`);
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
// LEYENDAS DINÁMICAS DE CAPAS RÁSTER
// Combustible · Pendiente · NDMI
// ===============================

const leyendaCapasControl = L.control({
  position: "bottomleft"
});

leyendaCapasControl.onAdd = function () {
  const div = L.DomUtil.create("div", "legend raster-legend");
  div.id = "leyendaCapasRaster";

  div.innerHTML = `
    <div class="legend-title">Leyenda capas</div>
    <div class="measure-small">Activa combustible, pendiente o NDMI para ver su leyenda.</div>
  `;

  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  return div;
};

leyendaCapasControl.addTo(map);

async function cargarLeyendasRasteres() {
  try {
    combustibleLegendData = await fetchJson(COMBUSTIBLE_LEYENDA);
  } catch (error) {
    console.warn("No se pudo cargar leyenda de combustible", error);
  }

  try {
    pendienteLegendData = await fetchJson(PENDIENTE_LEYENDA);
  } catch (error) {
    console.warn("No se pudo cargar leyenda de pendiente", error);
  }

  try {
    ndmiLegendData = await fetchJson(NDMI_LEYENDA);
  } catch (error) {
    console.warn("No se pudo cargar leyenda NDMI", error);
  }

  actualizarLeyendasCapasRaster();
}

function primerColorGrupo(grupo) {
  if (!grupo) return "#999999";

  if (grupo.color || grupo.colour || grupo.fill || grupo.hex || grupo.rgb) {
    return grupo.color || grupo.colour || grupo.fill || grupo.hex || grupo.rgb;
  }

  if (Array.isArray(grupo.items) && grupo.items.length) {
    const item = grupo.items.find(x => x.color || x.colour || x.fill || x.hex || x.rgb);
    if (item) {
      return item.color || item.colour || item.fill || item.hex || item.rgb;
    }
  }

  return "#999999";
}

function textoItemLeyenda(item) {
  return (
    item?.label ||
    item?.nombre ||
    item?.name ||
    item?.clase ||
    item?.valor ||
    item?.descripcion ||
    item?.texto ||
    ""
  );
}

function colorItemLeyenda(item) {
  return (
    item?.color ||
    item?.colour ||
    item?.fill ||
    item?.hex ||
    item?.rgb ||
    "#999999"
  );
}

function htmlItemLeyenda(label, color) {
  const borde = color === "transparent" ? "border:1px dashed #666;" : "";

  return `
    <div class="legend-item">
      <span class="legend-color" style="background:${color};${borde}"></span>
      <span>${label}</span>
    </div>
  `;
}

function htmlLeyendaCombustible(data) {
  let html = `<div class="raster-legend-section">`;
  html += `<div class="legend-title">${data?.titulo || "Modelo de combustible"}</div>`;

  if (data && Array.isArray(data.grupos) && data.grupos.length) {
    data.grupos.forEach(grupo => {
      const nombreGrupo = grupo.nombre || grupo.label || grupo.name || "Grupo";
      const colorGrupo = primerColorGrupo(grupo);

      // Leyenda simplificada: un color por agrupación operativa.
      html += htmlItemLeyenda(nombreGrupo, colorGrupo);
    });
  } else if (data && Array.isArray(data.items)) {
    data.items.forEach(item => {
      html += htmlItemLeyenda(textoItemLeyenda(item), colorItemLeyenda(item));
    });
  } else {
    html += `<div class="measure-small">Leyenda de combustible no disponible.</div>`;
  }

  if (data && Array.isArray(data.clases_no_representadas) && data.clases_no_representadas.length) {
    html += `
      <details class="legend-details">
        <summary>Clases no representadas</summary>
        <div class="measure-small">${data.clases_no_representadas.join("<br>")}</div>
      </details>
    `;
  }

  if (data && data.ambito) {
    html += `<div class="measure-small">${data.ambito}</div>`;
  }

  html += `</div>`;
  return html;
}

function htmlLeyendaPendiente(data) {
  let html = `<div class="raster-legend-section">`;
  html += `<div class="legend-title">${data?.titulo || "Pendiente"}</div>`;

  const items = data?.clases || data?.items || data?.leyenda || [];

  if (Array.isArray(items) && items.length) {
    items.forEach(item => {
      html += htmlItemLeyenda(textoItemLeyenda(item), colorItemLeyenda(item));
    });
  } else {
    html += `<div class="measure-small">Leyenda de pendiente no disponible.</div>`;
  }

  if (data && data.ambito) {
    html += `<div class="measure-small">${data.ambito}</div>`;
  }

  html += `</div>`;
  return html;
}

function htmlLeyendaNdmi(data) {
  let html = `<div class="raster-legend-section">`;
  html += `<div class="legend-title">${data?.titulo || "NDMI"}</div>`;

  // NDMI no viene como clases de color, sino como interpretación.
  // Por eso se representa con barra gradual: cálido/seco -> frío/húmedo.
  html += `
    <div class="ndmi-gradient"></div>
    <div class="ndmi-labels">
      <span>Menor humedad<br><strong>más seco</strong></span>
      <span>Mayor humedad<br><strong>más húmedo</strong></span>
    </div>
  `;

  if (data && Array.isArray(data.interpretacion)) {
    data.interpretacion.forEach(item => {
      const texto = item.texto || "";
      const significado = item.significado || "";
      html += `
        <div class="legend-item ndmi-text-item">
          <span class="legend-dot"></span>
          <span><strong>${texto}</strong>: ${significado}</span>
        </div>
      `;
    });
  }

  if (data && data.tratamiento) {
    html += `<div class="measure-small">${data.tratamiento}</div>`;
  }

  html += `</div>`;
  return html;
}

function htmlLeyendaGenerica(titulo, data) {
  let html = `<div class="raster-legend-section">`;
  html += `<div class="legend-title">${titulo}</div>`;

  const items =
    (Array.isArray(data?.items) && data.items) ||
    (Array.isArray(data?.clases) && data.clases) ||
    (Array.isArray(data?.leyenda) && data.leyenda) ||
    [];

  if (items.length) {
    items.forEach(item => {
      html += htmlItemLeyenda(textoItemLeyenda(item), colorItemLeyenda(item));
    });
  } else {
    html += `<div class="measure-small">Leyenda no disponible.</div>`;
  }

  html += `</div>`;
  return html;
}

function actualizarLeyendasCapasRaster() {
  const div = document.getElementById("leyendaCapasRaster");

  if (!div) return;

  let html = "";

  if (combustibleLayer && map.hasLayer(combustibleLayer)) {
    html += htmlLeyendaCombustible(combustibleLegendData);
  }

  if (pendienteLayer && map.hasLayer(pendienteLayer)) {
    html += htmlLeyendaPendiente(pendienteLegendData);
  }

  if (ndmiLayer && map.hasLayer(ndmiLayer)) {
    html += htmlLeyendaNdmi(ndmiLegendData);
  }

  if (!html) {
    html = `
      <div class="legend-title">Leyenda capas</div>
      <div class="measure-small">Activa combustible, pendiente o NDMI para ver su leyenda.</div>
    `;
  }

  div.innerHTML = html;
}

map.on("overlayadd", function () {
  actualizarLeyendasCapasRaster();
});

map.on("overlayremove", function () {
  actualizarLeyendasCapasRaster();
});


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
  await cargarLeyendasRasteres();

  activarControlesOpacidad();
  activarControlPeriodosRayos();

  await cargarRayos(activeRayosPeriod);
}

init();
