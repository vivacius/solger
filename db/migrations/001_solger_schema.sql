-- =============================================================================
-- SOLGER — Esquema principal en Supabase (schema: solger)
-- Incluye: activos, capacidad nominal vs. estimada por histórico, series de
-- tiempo, anomalías estadísticas, órdenes de trabajo, recibos/conciliación y RLS.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS solger;

-- Exponer el schema a los roles de Supabase API
GRANT USAGE ON SCHEMA solger TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA solger
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA solger
    GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

-- ─── 1. Organización y Clientes ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS solger.organizacion (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      TEXT NOT NULL UNIQUE,
    nit         TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO solger.organizacion (nombre)
VALUES ('SOLGER')
ON CONFLICT (nombre) DO NOTHING;

CREATE TABLE IF NOT EXISTS solger.cliente (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES solger.organizacion(id) ON DELETE CASCADE,
    nombre          TEXT NOT NULL,
    nit             TEXT,
    contacto_nombre TEXT,
    contacto_email  TEXT,
    contacto_tel    TEXT,
    notas           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, nombre)
);

-- ─── 2. Plantas y Equipos ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS solger.planta (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                  UUID NOT NULL REFERENCES solger.organizacion(id) ON DELETE CASCADE,
    cliente_id              UUID REFERENCES solger.cliente(id) ON DELETE SET NULL,
    fs_plant_code           TEXT NOT NULL UNIQUE,
    fs_plant_id             TEXT,
    nombre                  TEXT NOT NULL,
    -- Capacidad nominal configurada vs. capacidad estimada por histórico (P90)
    kwp_dc_nominal          NUMERIC(10, 2) NOT NULL DEFAULT 0,
    kwp_dc_estimado         NUMERIC(10, 2),
    kw_ac_nominal           NUMERIC(10, 2),
    metodo_estimacion_kwp   TEXT,          -- 'fusionsolar' | 'p90_historico' | 'placa_manual'
    kwp_actualizado_en      TIMESTAMPTZ,
    pr_base_historico       NUMERIC(5, 4) NOT NULL DEFAULT 0.8000,
    latitud                 DOUBLE PRECISION,
    longitud                DOUBLE PRECISION,
    direccion               TEXT,
    municipio               TEXT,
    departamento            TEXT DEFAULT 'Valle del Cauca',
    fecha_conexion          DATE,
    comercializador         TEXT DEFAULT 'Celsia',
    nivel_tension           INT DEFAULT 1,
    tiene_medidor_inteligente BOOLEAN NOT NULL DEFAULT true,
    tiene_sensor_irradiancia  BOOLEAN NOT NULL DEFAULT false,
    activa                  BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vista o columna calculada de capacidad efectiva (nominal si > 0, sino estimada)
CREATE OR REPLACE VIEW solger.v_planta_efectiva AS
SELECT
    p.*,
    COALESCE(NULLIF(p.kwp_dc_nominal, 0), p.kwp_dc_estimado, 0) AS kwp_efectivo,
    (NULLIF(p.kwp_dc_nominal, 0) IS NULL AND p.kwp_dc_estimado IS NOT NULL) AS kwp_es_estimado
FROM solger.planta p;

CREATE TABLE IF NOT EXISTS solger.equipo (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planta_id       UUID NOT NULL REFERENCES solger.planta(id) ON DELETE CASCADE,
    fs_dev_id       TEXT NOT NULL,
    nombre          TEXT NOT NULL,
    dev_type_id     INT,
    modelo          TEXT,
    version_sw      TEXT,
    serial          TEXT,
    garantia_hasta  DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (planta_id, fs_dev_id)
);

-- ─── 3. Contratos (Energía y O&M Post-Venta) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS solger.contrato_energia (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planta_id       UUID NOT NULL REFERENCES solger.planta(id) ON DELETE CASCADE,
    -- 'agpe_menor_100kw' | 'agpe_100kw_1mw' | 'autoconsumo_sin_excedentes' | 'ppa_bilateral'
    esquema         TEXT NOT NULL DEFAULT 'agpe_menor_100kw',
    tarifa_cop_kwh  NUMERIC(10, 2),
    indexacion      TEXT DEFAULT 'IPC',
    parametros      JSONB NOT NULL DEFAULT '{}'::jsonb,
    vigente_desde   DATE,
    vigente_hasta   DATE,
    activo          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solger.contrato_om (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planta_id           UUID NOT NULL REFERENCES solger.planta(id) ON DELETE CASCADE,
    nivel               TEXT NOT NULL DEFAULT 'estandar', -- 'basico' | 'estandar' | 'premium'
    pr_garantizado      NUMERIC(5, 2) DEFAULT 78.00,
    disponibilidad_min  NUMERIC(5, 2) DEFAULT 98.00,
    sla_horas_critico   INT DEFAULT 24,
    limpiezas_anuales   INT DEFAULT 2,
    valor_mensual_cop   NUMERIC(14, 2),
    vigente_desde       DATE,
    vigente_hasta       DATE,
    activo              BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 4. Series de Tiempo (Telemetría, Clima, Mercado) ─────────────────────────

CREATE TABLE IF NOT EXISTS solger.lectura_horaria (
    planta_id       UUID NOT NULL REFERENCES solger.planta(id) ON DELETE CASCADE,
    ts              TIMESTAMPTZ NOT NULL,
    gen_kwh         NUMERIC(12, 3) NOT NULL DEFAULT 0,
    export_kwh      NUMERIC(12, 3) NOT NULL DEFAULT 0,
    import_kwh      NUMERIC(12, 3) NOT NULL DEFAULT 0,
    autoconsumo_kwh NUMERIC(12, 3) NOT NULL DEFAULT 0,
    ghi_w_m2        NUMERIC(8, 2),
    temp_c          NUMERIC(5, 2),
    PRIMARY KEY (planta_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_lectura_horaria_ts ON solger.lectura_horaria (ts DESC);

CREATE TABLE IF NOT EXISTS solger.kpi_diario (
    planta_id           UUID NOT NULL REFERENCES solger.planta(id) ON DELETE CASCADE,
    fecha               DATE NOT NULL,
    gen_kwh             NUMERIC(12, 3) NOT NULL DEFAULT 0,
    export_kwh          NUMERIC(12, 3) NOT NULL DEFAULT 0,
    import_kwh          NUMERIC(12, 3) NOT NULL DEFAULT 0,
    autoconsumo_kwh     NUMERIC(12, 3) NOT NULL DEFAULT 0,
    ghi_sat_kwh_m2      NUMERIC(6, 3),  -- Irradiación diaria satelital (Open-Meteo)
    yf_kwh_kwp          NUMERIC(6, 3),  -- Rendimiento específico E / kWp_efectivo
    pr_sat_pct          NUMERIC(6, 2),  -- PR usando irradiación satelital
    indice_diseno_pct   NUMERIC(6, 2),  -- Yf / (4.5 * 0.80)
    ratio_pares         NUMERIC(6, 3),  -- Yf_planta / mediana(Yf_portafolio)
    z_score_robusto     NUMERIC(6, 2),
    ewma_residuo        NUMERIC(6, 3),
    estado_salud        SMALLINT,       -- 1=Offline, 2=Alarma, 3=Operativa
    PRIMARY KEY (planta_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_kpi_diario_fecha ON solger.kpi_diario (fecha DESC);

CREATE TABLE IF NOT EXISTS solger.precio_bolsa_horario (
    ts          TIMESTAMPTZ PRIMARY KEY,
    fecha       DATE NOT NULL,
    hora        SMALLINT NOT NULL CHECK (hora BETWEEN 0 AND 23),
    cop_kwh     NUMERIC(10, 2) NOT NULL,
    fuente      TEXT NOT NULL DEFAULT 'XM SINERGOX'
);

CREATE INDEX IF NOT EXISTS idx_precio_bolsa_fecha ON solger.precio_bolsa_horario (fecha DESC);

-- ─── 5. Motor de Anomalías y Órdenes de Trabajo ──────────────────────────────

CREATE TABLE IF NOT EXISTS solger.anomalia (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planta_id       UUID NOT NULL REFERENCES solger.planta(id) ON DELETE CASCADE,
    fecha_deteccion DATE NOT NULL,
    -- 'offline' | 'caida_subita' | 'suciedad_soiling' | 'sombreado' | 'clipping' | 'bajo_rendimiento_pares'
    tipo            TEXT NOT NULL,
    severidad       TEXT NOT NULL CHECK (severidad IN ('info', 'atencion', 'critica')),
    z_score         NUMERIC(6, 2),
    ratio_pares     NUMERIC(6, 3),
    kwh_perdidos    NUMERIC(12, 2) DEFAULT 0,
    cop_perdidos    NUMERIC(14, 2) DEFAULT 0,
    descripcion     TEXT NOT NULL,
    recomendacion   TEXT,
    detalle         JSONB NOT NULL DEFAULT '{}'::jsonb,
    estado          TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'en_revision', 'ot_creada', 'resuelta', 'descartada')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ,
    UNIQUE (planta_id, fecha_deteccion, tipo)
);

CREATE TABLE IF NOT EXISTS solger.orden_trabajo (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planta_id       UUID NOT NULL REFERENCES solger.planta(id) ON DELETE CASCADE,
    anomalia_id     UUID REFERENCES solger.anomalia(id) ON DELETE SET NULL,
    -- 'limpieza' | 'electrica' | 'termografia' | 'correctivo' | 'otro'
    tipo            TEXT NOT NULL,
    prioridad       TEXT NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta', 'urgente')),
    estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'programada', 'en_sitio', 'completada', 'cancelada')),
    titulo          TEXT NOT NULL,
    descripcion     TEXT,
    tecnico_nombre  TEXT,
    fecha_programada DATE,
    fecha_ejecucion DATE,
    sla_limite      TIMESTAMPTZ,
    costo_cop       NUMERIC(14, 2),
    kwh_recuperados NUMERIC(12, 2),
    evidencia_urls  TEXT[] DEFAULT '{}',
    notas_cierre    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 6. Recibos del Comercializador y Conciliación (listo para carga y OCR) ──

CREATE TABLE IF NOT EXISTS solger.recibo (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planta_id           UUID NOT NULL REFERENCES solger.planta(id) ON DELETE CASCADE,
    comercializador     TEXT NOT NULL DEFAULT 'Celsia',
    periodo             TEXT NOT NULL, -- 'YYYY-MM'
    fecha_inicio_ciclo  DATE,
    fecha_fin_ciclo     DATE,
    import_kwh_facturado NUMERIC(12, 2),
    export_kwh_facturado NUMERIC(12, 2),
    kwh_neto_facturado  NUMERIC(12, 2) NOT NULL,
    cu_cop_kwh          NUMERIC(10, 2) NOT NULL,
    componentes_cu      JSONB NOT NULL DEFAULT '{}'::jsonb, -- {G, T, D, C, PR, R}
    excedentes_t1_kwh   NUMERIC(12, 2),
    excedentes_t2_kwh   NUMERIC(12, 2),
    credito_energia_cop NUMERIC(14, 2),
    total_cop           NUMERIC(14, 2) NOT NULL,
    pdf_storage_path    TEXT,          -- Ruta en Supabase Storage cuando se suba el PDF
    origen              TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'estimado_medidor', 'ocr')),
    notas               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (planta_id, periodo, origen)
);

CREATE TABLE IF NOT EXISTS solger.conciliacion (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recibo_id           UUID NOT NULL UNIQUE REFERENCES solger.recibo(id) ON DELETE CASCADE,
    gen_fs_kwh          NUMERIC(12, 2),
    export_fs_kwh       NUMERIC(12, 2),
    import_fs_kwh       NUMERIC(12, 2),
    dif_kwh             NUMERIC(12, 2),
    dif_pct             NUMERIC(6, 2),
    dif_cop             NUMERIC(14, 2),
    estado              TEXT NOT NULL CHECK (estado IN ('pending', 'ok', 'discrepancy', 'critical')),
    explicacion         TEXT,
    verified_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 7. Perfiles de Usuario y Control de Acceso (RLS) ─────────────────────────

CREATE TABLE IF NOT EXISTS solger.usuario_perfil (
    user_id     UUID PRIMARY KEY, -- Referencia a auth.users(id)
    org_id      UUID NOT NULL REFERENCES solger.organizacion(id) ON DELETE CASCADE,
    cliente_id  UUID REFERENCES solger.cliente(id) ON DELETE SET NULL,
    rol         TEXT NOT NULL DEFAULT 'analista' CHECK (rol IN ('admin_solger', 'analista', 'tecnico', 'cliente')),
    nombre      TEXT,
    activo      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Control de progreso del backfill histórico reanudable
CREATE TABLE IF NOT EXISTS solger.sync_cursor (
    clave           TEXT PRIMARY KEY,
    ultimo_valor    TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 8. Semilla inicial de las 16 plantas de SOLGER ───────────────────────────

WITH org AS (
    SELECT id AS org_id FROM solger.organizacion WHERE nombre = 'SOLGER' LIMIT 1
)
INSERT INTO solger.planta (
    org_id, fs_plant_code, fs_plant_id, nombre, kwp_dc_nominal,
    metodo_estimacion_kwp, latitud, longitud, direccion, municipio, fecha_conexion
)
SELECT
    org.org_id, v.fs_plant_code, v.fs_plant_id, v.nombre, v.kwp_dc_nominal,
    CASE WHEN v.kwp_dc_nominal > 0 THEN 'fusionsolar' ELSE 'pendiente_historico' END,
    v.latitud, v.longitud, v.direccion, v.municipio, v.fecha_conexion::date
FROM org
CROSS JOIN (VALUES
    ('NE=35502362', '35502362', 'ANTOJO',                 0.00,   3.574051, -76.398471, 'ColombiaPalmira', 'Palmira', '2025-02-13'),
    ('NE=33983774', '33983774', 'BURRERA',                0.00,   3.586866, -76.391021, 'Palmira, Valle del Cauca, Colombia', 'Palmira', '2024-08-09'),
    ('NE=33752521', '33752521', 'HACIENDA LA ESTANCIA', 145.20,   3.536932, -76.318938, 'Calle 42 km1 Variante, Palmira, Valle del Cauca', 'Palmira', '2023-08-10'),
    ('NE=33777835', '33777835', 'HDA LA CRUZ POZO 1',    83.52,   3.692602, -76.298614, 'El Cerrito, Valle del Cauca', 'El Cerrito', '2023-10-23'),
    ('NE=33790681', '33790681', 'HDA LA CRUZ POZO 2',    83.52,   3.687233, -76.285932, 'El Cerrito, Valle del Cauca', 'El Cerrito', '2023-11-24'),
    ('NE=33795881', '33795881', 'HDA LA CRUZ POZO 3',    83.52,   3.693611, -76.336389, 'El Cerrito, Valle del Cauca', 'El Cerrito', '2023-12-06'),
    ('NE=33945451', '33945451', 'HDA MONICA',             0.00,   3.601715, -76.363988, 'Palmira, Valle del Cauca', 'Palmira', '2024-06-27'),
    ('NE=33731244', '33731244', 'HDA PASO ANCHO',       122.00,   3.609018, -76.403360, 'Palmira, Valle del Cauca', 'Palmira', '2023-03-25'),
    ('NE=34081254', '34081254', 'HERRAGRICOLA',           0.00,   3.520951, -76.322249, 'Palmira, Valle del Cauca', 'Palmira', '2024-09-27'),
    ('NE=35899144', '35899144', 'LA ESPERANZA 2',         0.00,   3.543947, -76.227425, 'Palmira, Valle del Cauca', 'Palmira', '2025-04-16'),
    ('NE=52329050', '52329050', 'La unión',               0.00,   3.767778, -76.337778, 'Carrera 13 8-14, Guacarí, Valle del Cauca', 'Guacarí', '2026-02-12'),
    ('NE=33879854', '33879854', 'MOLINO SAN GERARDO',     0.00,   3.761923, -76.327795, 'Cl. 4 #261, Guacarí, Valle del Cauca', 'Guacarí', '2024-04-13'),
    ('NE=35975392', '35975392', 'PICHINDE',               0.00,   3.502474, -76.202842, 'Palmira, Valle del Cauca', 'Palmira', '2025-04-29'),
    ('NE=34035592', '34035592', 'RIO GUACHAL',            0.00,   3.570135, -76.417819, 'Palmira, Valle del Cauca', 'Palmira', '2024-09-11'),
    ('NE=33744070', '33744070', 'SAN FELIPE - QUANTUM', 145.20,   3.543076, -76.330311, 'Palmira, Valle del Cauca', 'Palmira', '2023-06-13'),
    ('NE=37308996', '37308996', 'SUPER GRANOS',           0.00,   3.710442, -76.291416, 'El Cerrito, Valle del Cauca', 'El Cerrito', '2025-07-03')
) AS v(fs_plant_code, fs_plant_id, nombre, kwp_dc_nominal, latitud, longitud, direccion, municipio, fecha_conexion)
ON CONFLICT (fs_plant_code) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    kwp_dc_nominal = CASE WHEN EXCLUDED.kwp_dc_nominal > 0 THEN EXCLUDED.kwp_dc_nominal ELSE solger.planta.kwp_dc_nominal END,
    latitud = EXCLUDED.latitud,
    longitud = EXCLUDED.longitud,
    municipio = EXCLUDED.municipio,
    fecha_conexion = EXCLUDED.fecha_conexion;
