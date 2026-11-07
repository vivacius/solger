# Plan Técnico: `001-solger-ops-platform`

## 1. Arquitectura y Componentes
- **Dominio (`backend/kpi.py`, `backend/anomalies.py`)**: Fuente única de fórmulas IEC 61724-1, factor UPME CO₂ (`0.220 tCO₂eq/MWh`), estimador P90 de capacidad histórica y motor estadístico de 4 capas.
- **Persistencia (`db/migrations/001_solger_schema.sql`, `backend/supabase_store.py`, `backend/sync_and_estimate.py`)**:
  - Esquema `solger` en Supabase sin plantas quemadas.
  - Auto-sync en caliente al consultar `/api/plants` y `/api/plants/summary`.
  - Script de backfill histórico y estimación P90 (`sync_and_estimate.py`).
- **Frontend (`webapp/src/`)**: Corrección de estados de salud, colores, filtros y delegación de verificación de facturas al backend.
- **Infraestructura (`vercel.json`, `api/index.py`, `.github/pull_request_template.md`)**: Configuración lista para GitHub + Vercel.

## 2. Estrategia de Verificación
- [x] Compilación limpia de TypeScript y bundle de producción (`npm run build`).
- [ ] Ejecución de `db/migrations/001_solger_schema.sql` en el SQL Editor de Supabase (schema `solger` expuesto en Settings -> API).
- [ ] Ejecución de `python backend/sync_and_estimate.py --months 4` para poblar `solger.planta` y `solger.kpi_diario` y calcular los `kWp` históricos.
