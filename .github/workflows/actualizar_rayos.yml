name: Actualizar rayos AEMET

on:
  schedule:
    # Cada hora, minuto 7 UTC
    - cron: "7 * * * *"

  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: actualizar-rayos-aemet
  cancel-in-progress: true

env:
  AEMET_RAYOS_URL: "https://www.aemet.es/es/geojson/download/rayos/descargar_rayos_1782676866.tar.gz"
  AEMET_RAYOS_REGION: "PB_LOCL"
  BUSCAR_URL_AUTOMATICA: "1"
  VALENCIA_BBOX: "-1.70,38.60,0.05,40.25"

jobs:
  actualizar-rayos:
    runs-on: ubuntu-latest

    steps:
      - name: Descargar repositorio
        uses: actions/checkout@v4

      - name: Configurar Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Instalar dependencias
        run: |
          python -m pip install --upgrade pip
          pip install numpy pillow rasterio

      - name: Descargar y actualizar raster de rayos
        run: python scripts/actualizar_rayos_aemet.py

      - name: Guardar cambios
        run: |
          git config user.name "github-actions"
          git config user.email "github-actions@github.com"
          git add datos/rayos
          git commit -m "Actualizar rayos AEMET raster 24-48-72h" || echo "Sin cambios"
          git push
