// ===============================
// METVLC · VISOR RAYOS INCENDIOS
// Rayos AEMET como imagen raster PNG
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
  "Rayos AEMET": rayosLayer,
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

const RAYOS_IMAGES = {
  24: "datos/rayos/rayos_24h.png",
  48: "datos/rayos/rayos_48h.png",
  72: "datos/rayos/rayos_72h.png"
};

const RAYOS_BOUNDS = "datos/rayos/rayos_bounds.json";
const RAYOS_MANIFEST = "datos/rayos/manifest_rayos.json";

const COMBUSTIBLE_GEOJSON = "datos/combustible/modelo_combustible.geojson";
const PENDIENTE_GEOJSON = "datos/pendiente/pendiente.geojson";

const NDMI_IMAGE = "datos/ndmi/ultimo_ndmi.png";

// Bounds provisionales del NDMI.
// Cuando subas el NDMI definitivo, ajustamos estos límites.
const NDMI_BOUNDS = [
  [38.60, -1.70],
  [40.25, 0.05]
];

// ===============================
// VARIABLES
// ===============================

let rayosOverlay = null;
let rayosBounds = null;
let rayosOpacity = 0.85;
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

// ===============================
// CARGAR BOUNDS RAYOS
// ===============================

async function cargarBoundsRayos() {
  if (rayosBounds) {
    return rayosBounds;
  }

  const data = await cargarJSON(RAYOS_BOUNDS);

  console.log("rayos_bounds.json:", data);

  if (!data.bounds || !Array.isArray(data.bounds)) {
    throw new Error("rayos_bounds.json no contiene bounds válidos");
  }

  rayosBounds = L.latLngBounds(data.bounds);

  if (!rayosBounds.isValid()) {
    throw new Error("Bounds de rayos no válidos");
  }

  return rayosBounds;
}

// ===============================
// CARGAR RAYOS 24 / 48 / 72 H
// ===============================

async function cargarRayos(horas = 24) {
  try {
    setInfoRayos(`Cargando rayos AEMET · últimas ${horas} h...`);

    rayosLayer.clearLayers();

    const bounds = await cargarBoundsRayos();
    const imageUrl = urlNoCache(RAYOS_IMAGES[horas]);

    console.log("Cargando imagen de rayos:", imageUrl);
    console.log("Bounds:", bounds);

    rayosOverlay = L.imageOverlay(imageUrl, bounds, {
      opacity: rayosOpacity,
      interactive: false,
      attribution: "Rayos AEMET"
    });

    rayosOverlay.addTo(rayosLayer);

    if (primeraCargaRayos) {
      map.fitBounds(bounds.pad(0.08));
      primeraCargaRayos = false;
    }

    await cargarManifestRayos(horas);

  } catch (error) {
    console.error("ERROR cargando rayos:", error);
    setInfoRayos(`ERROR: ${error.message}`);
  }
}

// ===============================
// MANIFEST RAYOS
// ===============================

async function cargarManifestRayos(horasSeleccionadas) {
  try {
    const manifest = await cargarJSON(RAYOS_MANIFEST);

    console.log("manifest_rayos.json:", manifest);

    const salida = manifest.salidas?.[`${horasSeleccionadas}h`];

    const imagenesUsadas = salida?.imagenes_usadas ?? "sin dato";

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
      `Rayos AEMET · ${horasSeleccionadas} h · imágenes usadas: ${imagenesUsadas} · actualizado: ${actualizado}`
    );

  } catch (error) {
    console.warn("No se pudo cargar manifest_rayos.json", error);
    setInfoRayos(`Rayos AEMET · últimas ${horasSeleccionadas} h`);
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
// CONTROL DE OPACIDAD RAYOS
// ===============================

const opacityControl = L.control({
  position: "topright"
});

opacityControl.onAdd = function () {
  const div = L.DomUtil.create("div", "legend");

  div.innerHTML = `
    <div class="legend-title">Opacidad rayos</div>
    <input 
      id="rayosOpacity" 
      type="range" 
      min="0" 
      max="1" 
      step="0.05" 
      value="${rayosOpacity}"
      style="width:130px;"
    >
  `;

  L.DomEvent.disableClickPropagation(div);

  setTimeout(() => {
    const input = document.getElementById("rayosOpacity");

    if (input) {
      input.addEventListener("input", e => {
        rayosOpacity = Number(e.target.value);

        if (rayosOverlay) {
          rayosOverlay.setOpacity(rayosOpacity);
        }
      });
    }
  }, 300);

  return div;
};

opacityControl.addTo(map);

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
    <div class="legend-title">Capas</div>

    <div class="legend-item">
      <span class="legend-dot" style="background:#ff0000"></span>
      Rayos AEMET
    </div>

    <div class="legend-item">
      <span class="legend-dot" style="background:#c17f35"></span>
      Combustible
    </div>

    <div class="legend-item">
      <span class="legend-dot" style="background:#8d8d8d"></span>
      Pendiente
    </div>

    <div class="legend-item">
      <span class="legend-dot" style="background:#4f8f4f"></span>
      NDMI
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
// cargarNDMI(); // Lo dejamos desactivado hasta subir el NDMI real
