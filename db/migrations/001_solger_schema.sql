-- =============================================================================
-- SOLGER — Esquema principal en Supabase (schema: solger)
-- 100% dinámico: ninguna planta está quemada en SQL. Todas las plantas nuevas
-- o existentes en la cuenta de FusionSolar se descubren y sincronizan
-- automáticamente vía ON CONFLICT (fs_plant_code) DO UPDATE.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS solger;

-- Permisos para el API de Supabase (PostgREST)
-- IMPORTANTE: En Supabase Dashboard -> Settings -> API -> Exposed schemas,
-- asegúrate de incluir "solger".
GRANT USAGE ON SCHEMA solger TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA solger TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA solger TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA solger TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA solger
    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA solger
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
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

-- ─── 2. Plantas y Equipos (Auto-descubiertas desde FusionSolar) ───────────────

CREATE TABLE IF NOT EXISTS solger.planta (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                    UUID NOT NULL REFERENCES solger.organizacion(id) ON DELETE CASCADE,
    cliente_id                UUID REFERENCES solger.cliente(id) ON DELETE SET NULL,
    fs_plant_code             TEXT NOT NULL UNIQUE,
    fs_plant_id               TEXT,
    nombre                    TEXT NOT NULL,
    -- Capacidad nominal configurada en FusionSolar vs. estimada por histórico P90
    kwp_dc_nominal            NUMERIC(10, 2) NOT NULL DEFAULT 0,
    kwp_dc_estimado           NUMERIC(10, 2),
    kw_ac_nominal             NUMERIC(10, 2),
    metodo_estimacion_kwp     TEXT DEFAULT 'pendiente_historico', -- 'fusionsolar' | 'p90_daily_yield' | 'placa_manual'
    kwp_actualizado_en        TIMESTAMPTZ,
    pr_base_historico         NUMERIC(5, 4) NOT NULL DEFAULT 0.8000,
    latitud                   DOUBLE PRECISION,
    longitud                  DOUBLE PRECISION,
    direccion                 TEXT,
    municipio                 TEXT,
    departamento              TEXT DEFAULT 'Valle del Cauca',
    fecha_conexion            DATE,
    comercializador           TEXT DEFAULT 'Celsia',
    nivel_tension             INT DEFAULT 1,
    tiene_medidor_inteligente BOOLEAN NOT NULL DEFAULT true,
    tiene_sensor_irradiancia  BOOLEAN NOT NULL DEFAULT false,
    activa                    BOOLEAN NOT NULL DEFAULT true,
    ultima_sincronizacion_fs  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vista de capacidad efectiva: usa kwp_dc_nominal si > 0; de lo contrario, kwp_dc_estimado
CREATE OR REPLACE VIEW solger.v_planta_efectiva AS
SELECT
    p.*,
    COALESCE(NULLIF(p.kwp_dc_nominal, 0), p.kwp_dc_estimado, 0) AS kwp_efectivo,
    (NULLIF(p.kwp_dc_nominal, 0) IS NULL AND p.kwp_dc_estimado IS NOT NULL) AS kwp_es_estimado
FROM solger.planta p;

GRANT SELECT ON solger.v_planta_efectiva TO anon, authenticated, service_role;

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
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planta_id            UUID NOT NULL REFERENCES solger.planta(id) ON DELETE CASCADE,
    comercializador      TEXT NOT NULL DEFAULT 'Celsia',
    periodo              TEXT NOT NULL, -- 'YYYY-MM'
    fecha_inicio_ciclo   DATE,
    fecha_fin_ciclo      DATE,
    import_kwh_facturado NUMERIC(12, 2),
    export_kwh_facturado NUMERIC(12, 2),
    kwh_neto_facturado   NUMERIC(12, 2) NOT NULL,
    cu_cop_kwh           NUMERIC(10, 2) NOT NULL,
    componentes_cu       JSONB NOT NULL DEFAULT '{}'::jsonb, -- {G, T, D, C, PR, R}
    excedentes_t1_kwh    NUMERIC(12, 2),
    excedentes_t2_kwh    NUMERIC(12, 2),
    credito_energia_cop  NUMERIC(14, 2),
    total_cop            NUMERIC(14, 2) NOT NULL,
    pdf_storage_path     TEXT,          -- Ruta en Supabase Storage cuando se suba el PDF
    origen               TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'estimado_medidor', 'ocr')),
    notas                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
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

-- ─── 7. Perfiles de Usuario y Cursor de Sincronización ────────────────────────

CREATE TABLE IF NOT EXISTS solger.usuario_perfil (
    user_id     UUID PRIMARY KEY, -- Referencia a auth.users(id)
    org_id      UUID NOT NULL REFERENCES solger.organizacion(id) ON DELETE CASCADE,
    cliente_id  UUID REFERENCES solger.cliente(id) ON DELETE SET NULL,
    rol         TEXT NOT NULL DEFAULT 'analista' CHECK (rol IN ('admin_solger', 'analista', 'tecnico', 'cliente')),
    nombre      TEXT,
    activo      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solger.sync_cursor (
    clave           TEXT PRIMARY KEY,
    ultimo_valor    TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
