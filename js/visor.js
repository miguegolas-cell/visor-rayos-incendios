// ===============================
// METVLC · VISOR RAYOS INCENDIOS
// Rayos SIGIF/GVA + combustible + pendiente + NDMI
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
// ORDEN DE CAPAS
// ===============================

map.createPane("pendientePane");
map.getPane("pendientePane").style.zIndex = 330;

map.createPane("ndmiPane");
map.getPane("ndmiPane").style.zIndex = 340;

map.createPane("combustiblePane");
map.getPane("combustiblePane").style.zIndex = 350;

map.createPane("rayosPane");
map.getPane("rayosPane").style.zIndex = 650;

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
// GRUPOS DE CAPAS
// ===============================

const pendienteLayer = L.layerGroup().addTo(map);
const ndmiLayer = L.layerGroup().addTo(map);
const combustibleLayer = L.layerGroup().addTo(map);
const rayosLayer = L.layerGroup().addTo(map);

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

const COMBUSTIBLE_IMAGE = "datos/combustible/modelo_combustible.png";
const COMBUSTIBLE_BOUNDS = "datos/combustible/modelo_combustible_bounds.json";

const PENDIENTE_IMAGE = "datos/pendiente/pendiente.png";
const PENDIENTE_BOUNDS = "datos/pendiente/pendiente_bounds.json";

const NDMI_IMAGE = "datos/ndmi/ultimo_ndmi.png";
const NDMI_BOUNDS = "datos/ndmi/ndmi_bounds.json";

// ===============================
// VARIABLES
// ===============================

let primeraCargaRayos = true;

let combustibleOverlay = null;
let pendienteOverlay = null;
let ndmiOverlay = null;

let combustibleOpacity = 0.55;
let pendienteOpacity = 0.45;
let ndmiOpacity = 0.65;

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

function convertirBounds(data) {
  // Formato preferido:
  // { "bounds": [[lat_min, lon_min], [lat_max, lon_max]] }
  if (data.bounds && Array.isArray(data.bounds)) {
    return L.latLngBounds(data.bounds);
  }

  // Formato alternativo:
  // { "bbox": { "lon_min": ..., "lat_min": ..., "lon_max": ..., "lat_max": ... } }
  if (data.bbox) {
    return L.latLngBounds(
      [data.bbox.lat_min, data.bbox.lon_min],
      [data.bbox.lat_max, data.bbox.lon_max]
    );
  }

  throw new Error("Archivo bounds sin formato válido");
}

async function cargarBounds(url) {
  const data = await cargarJSON(url);
  const bounds = convertirBounds(data);

  if (!bounds.isValid()) {
    throw new Error(`Bounds no válidos en ${url}`);
  }

  return bounds;
}

// ===============================
// FECHAS RAYOS
// ===============================

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
          pane: "rayosPane",
          radius: radioPorEdad(h),
          color: "#111111",
          weight: 1.8,
          fillColor: colorPorEdad(h),
          fillOpacity: 0.95,
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
// CAPAS RASTER
// ===============================

async function cargarCapaRaster(nombre, imageUrl, boundsUrl, layerGroup, pane, opacity) {
  try {
    const bounds = await cargarBounds(boundsUrl);

    const overlay = L.imageOverlay(urlNoCache(imageUrl), bounds, {
      pane: pane,
      opacity: opacity,
      interactive: false
    });

    overlay.addTo(layerGroup);

    console.log(`${nombre} cargado correctamente`);

    return overlay;

  } catch (error) {
    console.warn(`No se pudo cargar ${nombre}:`, error);
    return null;
  }
}

async function cargarCombustible() {
  combustibleOverlay = await cargarCapaRaster(
    "modelo de combustible",
    COMBUSTIBLE_IMAGE,
    COMBUSTIBLE_BOUNDS,
    combustibleLayer,
    "combustiblePane",
    combustibleOpacity
  );
}

async function cargarPendiente() {
  pendienteOverlay = await cargarCapaRaster(
    "pendiente",
    PENDIENTE_IMAGE,
    PENDIENTE_BOUNDS,
    pendienteLayer,
    "pendientePane",
    pendienteOpacity
  );
}

async function cargarNDMI() {
  ndmiOverlay = await cargarCapaRaster(
    "NDMI",
    NDMI_IMAGE,
    NDMI_BOUNDS,
    ndmiLayer,
    "ndmiPane",
    ndmiOpacity
  );
}

// ===============================
// CONTROL DE OPACIDADES
// ===============================

const opacityControl = L.control({
  position: "topright"
});

opacityControl.onAdd = function () {
  const div = L.DomUtil.create("div", "legend");

  div.innerHTML = `
    <div class="legend-title">Opacidad capas</div>

    <label style="display:block;margin-top:6px;">
      Combustible
      <input 
        id="combustibleOpacity" 
        type="range" 
        min="0" 
        max="1" 
        step="0.05" 
        value="${combustibleOpacity}"
        style="width:130px;"
      >
    </label>

    <label style="display:block;margin-top:6px;">
      Pendiente
      <input 
        id="pendienteOpacity" 
        type="range" 
        min="0" 
        max="1" 
        step="0.05" 
        value="${pendienteOpacity}"
        style="width:130px;"
      >
    </label>

    <label style="display:block;margin-top:6px;">
      NDMI
      <input 
        id="ndmiOpacity" 
        type="range" 
        min="0" 
        max="1" 
        step="0.05" 
        value="${ndmiOpacity}"
        style="width:130px;"
      >
    </label>
  `;

  L.DomEvent.disableClickPropagation(div);

  setTimeout(() => {
    const combustibleInput = document.getElementById("combustibleOpacity");
    const pendienteInput = document.getElementById("pendienteOpacity");
    const ndmiInput = document.getElementById("ndmiOpacity");

    if (combustibleInput) {
      combustibleInput.addEventListener("input", e => {
        combustibleOpacity = Number(e.target.value);

        if (combustibleOverlay) {
          combustibleOverlay.setOpacity(combustibleOpacity);
        }
      });
    }

    if (pendienteInput) {
      pendienteInput.addEventListener("input", e => {
        pendienteOpacity = Number(e.target.value);

        if (pendienteOverlay) {
          pendienteOverlay.setOpacity(pendienteOpacity);
        }
      });
    }

    if (ndmiInput) {
      ndmiInput.addEventListener("input", e => {
        ndmiOpacity = Number(e.target.value);

        if (ndmiOverlay) {
          ndmiOverlay.setOpacity(ndmiOpacity);
        }
      });
    }
  }, 300);

  return div;
};

opacityControl.addTo(map);

// ===============================
// LEYENDA
// ===============================

// ===============================
// LEYENDA
// ===============================

const COMBUSTIBLE_LEYENDA = "datos/combustible/modelo_combustible_leyenda.json";

function rgbaToCss(rgba) {
  if (!rgba || rgba.length < 3) {
    return "rgba(180,180,180,0.85)";
  }

  const r = rgba[0];
  const g = rgba[1];
  const b = rgba[2];
  const a = rgba.length >= 4 ? (rgba[3] / 255) : 1;

  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

async function cargarLeyendaCombustible() {
  try {
    const data = await cargarJSON(COMBUSTIBLE_LEYENDA);
    const valores = data.valores || [];

    if (!valores.length) {
      return `
        <div class="legend-item">
          <span class="legend-dot" style="background:#c17f35"></span>
          Modelo de combustible
        </div>
      `;
    }

    return valores.map(item => {
      const color = rgbaToCss(item.color_rgba);
      const valor = item.valor;

      return `
        <div class="legend-item">
          <span class="legend-dot" style="background:${color}"></span>
          Modelo ${valor}
        </div>
      `;
    }).join("");

  } catch (error) {
    console.warn("No se pudo cargar la leyenda de combustible:", error);

    return `
      <div class="legend-item">
        <span class="legend-dot" style="background:#c17f35"></span>
        Modelo de combustible
      </div>
    `;
  }
}

const legend = L.control({
  position: "bottomright"
});

legend.onAdd = function () {
  const div = L.DomUtil.create("div", "legend");

  div.style.maxWidth = "260px";
  div.style.maxHeight = "420px";
  div.style.overflowY = "auto";

  div.innerHTML = `
    <div class="legend-title">Leyenda del visor</div>

    <details open style="margin-top:6px;">
      <summary style="font-weight:700; cursor:pointer;">Rayos SIGIF/GVA</summary>
      <div style="margin-top:6px;">
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
      </div>
    </details>

    <hr style="border:none;border-top:1px solid #ddd;margin:8px 0">

    <details open>
      <summary style="font-weight:700; cursor:pointer;">Pendiente</summary>
      <div style="margin-top:6px;">
        <div class="legend-item">
          <span class="legend-dot" style="background:#fff7bc"></span>
          Pendiente baja
        </div>

        <div class="legend-item">
          <span class="legend-dot" style="background:#fec44f"></span>
          Pendiente media
        </div>

        <div class="legend-item">
          <span class="legend-dot" style="background:#fe9929"></span>
          Pendiente alta
        </div>

        <div class="legend-item">
          <span class="legend-dot" style="background:#d95f0e"></span>
          Pendiente muy alta
        </div>
      </div>
    </details>

    <hr style="border:none;border-top:1px solid #ddd;margin:8px 0">

    <details open>
      <summary style="font-weight:700; cursor:pointer;">NDMI</summary>
      <div style="margin-top:6px;">
        <div style="
          width:170px;
          height:12px;
          border-radius:6px;
          border:1px solid #999;
          background:linear-gradient(to right, #8c510a, #dfc27d, #c7eae5, #01665e);
          margin:4px 0 6px 0;
        "></div>

        <div style="
          display:flex;
          justify-content:space-between;
          font-size:11px;
          gap:8px;
        ">
          <span>Más seco</span>
          <span>Más húmedo</span>
        </div>
      </div>
    </details>

    <hr style="border:none;border-top:1px solid #ddd;margin:8px 0">

    <details open>
      <summary style="font-weight:700; cursor:pointer;">Modelo de combustible</summary>
      <div id="leyendaCombustible" style="
        margin-top:6px;
        max-height:170px;
        overflow-y:auto;
        padding-right:4px;
      ">
        Cargando leyenda...
      </div>
    </details>
  `;

  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);

  setTimeout(async () => {
    const contenedor = document.getElementById("leyendaCombustible");

    if (contenedor) {
      contenedor.innerHTML = await cargarLeyendaCombustible();
    }
  }, 250);

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
