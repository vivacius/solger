# Constitución del Proyecto SOLGER (`.specify/memory/constitution.md`)

Este documento define las reglas arquitectónicas, de dominio energético y de flujo de trabajo que todo código, especificación y Pull Request en **SOLGER** debe cumplir sin excepción.

---

## 1. Principios de Dominio Solar y Mercado Eléctrico Colombiano

1. **Mapeo Oficial Huawei FusionSolar Northbound API**:
   - `real_health_state = 1`: **Offline / Desconectada**
   - `real_health_state = 2`: **En Alarma / Falla**
   - `real_health_state = 3`: **Operativa / Sana (Healthy)**
   - Ningún componente del backend, frontend o generador de reportes puede invertir estos códigos.

2. **Auto-Descubrimiento Dinámico de Plantas (Cero Plantas Quemadas)**:
   - El catálogo de plantas no se quema en código ni en migraciones SQL.
   - Toda planta agregada a la cuenta de FusionSolar debe descubrirse automáticamente vía `/thirdData/stations` y sincronizarse en `solger.planta` mediante `ON CONFLICT (fs_plant_code) DO UPDATE`.

3. **Estimación No Circular de Capacidad Instalada (`kWp`)**:
   - Cuando una planta tiene `capacity = 0` en FusionSolar y aún no se ha digitado su placa nominal, su capacidad se estima a partir del **percentil 90 de su serie histórica de generación diaria (`p90_daily_yield`)**, nunca a partir de la generación del día en curso.
   - Se almacenan por separado `kwp_dc_nominal` y `kwp_dc_estimado`, exponiendo la capacidad efectiva mediante `solger.v_planta_efectiva`.

4. **Fórmulas IEC 61724-1 y Factores Oficiales**:
   - **Rendimiento específico (`Yf`)**: $Y_f = E_{generada} / P_{efectiva}$ en $\text{kWh/kWp}$.
   - **Facturación y Conciliación AGPE (CREG 174 de 2021)**: Se distingue entre generación del inversor (`inverter_power` / `PVYield`), exportación a la red (`ongrid_power`) e importación de la red (`buyPower`). Prohibido usar `radiation_power` como si fuera energía.
   - **Factor de Emisión CO₂**: Configurable por entorno, por defecto `0.220 tCO₂eq/MWh` (Resolución UPME 000085 — Inventarios GEI Alcance 2).
   - **Zona Horaria**: Toda marca temporal de consulta o cierre diario se ancla explícitamente a `America/Bogota`.

---

## 2. Arquitectura y Base de Datos

1. **Schema Dedicado en Supabase**:
   - Todos los objetos de base de datos viven exclusivamente en el schema `solger`.
2. **Fuente Única de Fórmulas**:
   - Los cálculos de dominio viven en `backend/kpi.py` y `backend/anomalies.py`.
3. **Despliegue Serverless + Worker**:
   - El repositorio mantiene compatibilidad directa con **Vercel** (`vercel.json` + `api/index.py` + `webapp/dist`).

---

## 3. Flujo de Trabajo en Git y Spec Kit

1. **Desarrollo Guiado por Especificaciones (Spec Kit)**:
   - Toda funcionalidad mayor se documenta en `.specify/specs/<id-feature>/` con `spec.md`, `plan.md` y `tasks.md`.
2. **Estrategia de Ramas**:
   - `main`: rama estable desplegable en Vercel.
   - `feat/<nombre-corto>` o `fix/<nombre-corto>`: ramas de trabajo por bloque funcional, integradas mediante merge estructurado y plantilla `.github/pull_request_template.md`.
3. **Seguridad de Secretos**:
   - `.env` nunca se versiona en Git. Solo `.env.example` forma parte del repositorio.

