# Especificación: `001-solger-ops-platform` — Centro de Operaciones O&M, Auto-Discovery y Detección de Anomalías

- **Estado**: Approved & In Progress
- **Fecha**: 2026-11-07

## 1. Contexto y Problema
SOLGER instala y opera plantas solares fotovoltaicas para clientes agroindustriales y comerciales en el Valle del Cauca. Se requiere transformar el prototipo inicial en una plataforma real respaldada por Supabase (`schema: solger`) y desplegable en Vercel que:
1. Corrija los errores críticos de interpretación de telemetría de Huawei FusionSolar y de conciliación energética.
2. Descubra automáticamente cualquier planta nueva agregada al usuario de FusionSolar sin quemar plantas en SQL.
3. Estime la capacidad instalada (`kWp`) de las plantas sin dato nominal a partir de su histórico real (percentil 90 diario).
4. Detecte anomalías de producción sin depender de piranómetros en sitio, combinando irradiancia satelital, comparación contra plantas vecinas del portafolio y control estadístico (z-score robusto MAD + EWMA).
5. Deje lista la estructura de base de datos para recibos del comercializador (Celsia) y conciliación AGPE (CREG 174/2021).

## 2. Requisitos Funcionales
- **RF-01 (Mapeo Oficial Huawei)**: `1 = Offline`, `2 = Alarma`, `3 = Operativa` en toda la plataforma y reportes.
- **RF-02 (Auto-Discovery de Plantas)**: Sincronización automática de `/thirdData/stations` hacia `solger.planta` vía `ON CONFLICT (fs_plant_code) DO UPDATE`.
- **RF-03 (Estimación Histórica de kWp)**: Para plantas con `capacity = 0`, calcular `kwp_dc_estimado` mediante el percentil 90 de generación diaria histórica (`p90_daily_yield`).
- **RF-04 (Detección Estadística de Anomalías)**: Evaluar cada planta por reglas duras, residuo respecto al esperado físico, ratio frente a la mediana del portafolio y z-score robusto / EWMA.
- **RF-05 (Conciliación de Recibos)**: Extraer `inverter_power`/`PVYield`, `ongrid_power` y `buyPower` desde el backend para verificar facturas.
- **RF-06 (Despliegue Vercel)**: Proveer `vercel.json` y `api/index.py` para servir el frontend estático y las rutas `/api/*`.
