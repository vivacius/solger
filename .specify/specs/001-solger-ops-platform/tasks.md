# Tareas de Implementación: `001-solger-ops-platform`

- [x] **T01**: Corregir mapeo `real_health_state` (1=Offline, 2=Alarma, 3=Operativa) en backend, frontend y reportes.
- [x] **T02**: Crear módulo central `backend/kpi.py` (Yf, índice de diseño, factor CO₂ UPME 0.220, estimador P90 histórico de kWp).
- [x] **T03**: Corregir verificación de facturas en backend (`inverter_power` / `ongrid_power` / `buyPower`) y etiquetado honesto de fuente XM (`market.py`).
- [x] **T04**: Diseñar `db/migrations/001_solger_schema.sql` 100% dinámico (sin plantas quemadas) en schema `solger`.
- [x] **T05**: Implementar auto-discovery y sincronización automática de plantas nuevas en `backend/supabase_store.py`.
- [x] **T06**: Implementar motor estadístico de anomalías (`backend/anomalies.py`) y script de backfill (`backend/sync_and_estimate.py`).
- [x] **T07**: Configurar Spec Kit (`.specify/`), plantilla de PR (`.github/pull_request_template.md`) y configuración de Vercel (`vercel.json`, `api/index.py`).
- [ ] **T08**: Ejecutar SQL en Supabase, exponer el schema `solger` en la API de Supabase y correr `sync_and_estimate.py`.
