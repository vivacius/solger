## 📋 Resumen del Cambio (Spec Kit)

- **Spec / Feature ID**: `001-solger-ops-platform` (ver `.specify/specs/`)
- **Fase del Plan**: `[ ] Fase 0 (Métricas/Core)  [ ] Fase 1 (Supabase/Ingesta/Anomalías)  [ ] Fase 2 (Recibos/AGPE)  [ ] Fase 3 (Auth/RLS/Vercel)`
- **Rama origen → destino**: `feat/...` → `main`

### ¿Qué problema resuelve o qué funcionalidad agrega?
<!-- Describe brevemente el propósito técnico y de negocio del PR -->

---

## 🔬 Verificación de Reglas de Negocio y Dominio Solar (`constitution.md`)

- [ ] **Mapeo Huawei FusionSolar**: Respeta estrictamente `1 = Offline`, `2 = Alarma/Falla`, `3 = Operativa (Healthy)`.
- [ ] **Cero datos quemados de plantas**: Cualquier planta nueva agregada al usuario de FusionSolar se descubre y sincroniza dinámicamente (`ON CONFLICT (fs_plant_code)`).
- [ ] **Exactitud física (IEC 61724-1)**:
  - [ ] No duplica el factor de pérdidas `0.80` en el cálculo de rendimiento específico (`Yf = E / kWp`).
  - [ ] Usa `inverter_power` / `PVYield` / `ongrid_power` / `buyPower` y nunca confunde irradiación (`radiation_power`) con energía (`kWh`).
  - [ ] Capacidades faltantes estimadas por percentil 90 histórico (`p90_daily_yield`), nunca con la generación de un solo día en curso.
- [ ] **Factor CO₂ UPME**: Usa el factor configurable (`0.220 tCO₂eq/MWh` Res. UPME 000085 inventario) con fuente explícita.
- [ ] **Mercado XM**: Nunca etiqueta datos `mock` como `XM SINERGOX`.
- [ ] **Aislamiento en Base de Datos**: Todas las tablas y vistas apuntan al schema `solger`.

---

## 🧪 Pruebas Realizadas

- [ ] `cd webapp && npm run build` compila sin errores de TypeScript (`tsc -b && vite build`).
- [ ] Endpoints de FastAPI probados localmente (`/api/health`, `/api/plants/summary`, `/api/alerts`).
- [ ] Migración SQL idempotente verificada en `db/migrations/`.

---

## 📸 Evidencia / Capturas / Logs (Opcional)
<!-- Adjunta salida de consola, capturas del dashboard o resultados de sincronización -->

