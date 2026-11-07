-- =============================================================================
-- SOLGER — Migración 002: Campos extendidos Celsia PDF + Row-Level Security (RLS)
-- Esquema objetivo: solger (Supabase / PostgreSQL)
-- Compatible 100% con 001_solger_schema.sql (usuario_perfil.user_id)
-- =============================================================================

SET search_path TO solger, public;

-- 1. Columnas adicionales en solger.recibo para almacenar metadatos del PDF Celsia
ALTER TABLE solger.recibo
    ADD COLUMN IF NOT EXISTS cuenta_contrato        TEXT,
    ADD COLUMN IF NOT EXISTS medidor_numero         TEXT,
    ADD COLUMN IF NOT EXISTS factura_numero         TEXT,
    ADD COLUMN IF NOT EXISTS dias_facturados        INTEGER,
    ADD COLUMN IF NOT EXISTS credito_agpe_kwh_cop   NUMERIC(10, 2);

-- 2. Funciones auxiliares de seguridad en esquema solger (usando user_id = auth.uid())
CREATE OR REPLACE FUNCTION solger.current_user_rol()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = solger, public
AS $$
    SELECT rol FROM solger.usuario_perfil WHERE user_id = auth.uid() AND activo = TRUE LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION solger.current_user_cliente_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = solger, public
AS $$
    SELECT cliente_id FROM solger.usuario_perfil WHERE user_id = auth.uid() AND activo = TRUE LIMIT 1;
$$;

-- 3. Habilitar RLS en tablas del esquema solger
ALTER TABLE solger.cliente          ENABLE ROW LEVEL SECURITY;
ALTER TABLE solger.planta           ENABLE ROW LEVEL SECURITY;
ALTER TABLE solger.kpi_diario       ENABLE ROW LEVEL SECURITY;
ALTER TABLE solger.anomalia         ENABLE ROW LEVEL SECURITY;
ALTER TABLE solger.orden_trabajo    ENABLE ROW LEVEL SECURITY;
ALTER TABLE solger.recibo           ENABLE ROW LEVEL SECURITY;
ALTER TABLE solger.conciliacion     ENABLE ROW LEVEL SECURITY;
ALTER TABLE solger.usuario_perfil   ENABLE ROW LEVEL SECURITY;

-- 4. Políticas para lectura/escritura
-- Nota: El backend FastAPI con service_role_key salta RLS automáticamente.

DROP POLICY IF EXISTS planta_read_policy ON solger.planta;
CREATE POLICY planta_read_policy ON solger.planta
    FOR SELECT
    USING (
        auth.role() = 'anon'
        OR solger.current_user_rol() IN ('admin_solger', 'analista', 'tecnico')
        OR (solger.current_user_rol() = 'cliente' AND cliente_id = solger.current_user_cliente_id())
    );

DROP POLICY IF EXISTS kpi_diario_read_policy ON solger.kpi_diario;
CREATE POLICY kpi_diario_read_policy ON solger.kpi_diario
    FOR SELECT
    USING (
        auth.role() = 'anon'
        OR solger.current_user_rol() IN ('admin_solger', 'analista', 'tecnico')
        OR EXISTS (
            SELECT 1 FROM solger.planta p
            WHERE p.id = kpi_diario.planta_id
              AND p.cliente_id = solger.current_user_cliente_id()
        )
    );

DROP POLICY IF EXISTS orden_trabajo_read_policy ON solger.orden_trabajo;
CREATE POLICY orden_trabajo_read_policy ON solger.orden_trabajo
    FOR SELECT
    USING (
        auth.role() = 'anon'
        OR solger.current_user_rol() IN ('admin_solger', 'analista', 'tecnico')
        OR EXISTS (
            SELECT 1 FROM solger.planta p
            WHERE p.id = orden_trabajo.planta_id
              AND p.cliente_id = solger.current_user_cliente_id()
        )
    );

DROP POLICY IF EXISTS recibo_read_policy ON solger.recibo;
CREATE POLICY recibo_read_policy ON solger.recibo
    FOR SELECT
    USING (
        auth.role() = 'anon'
        OR solger.current_user_rol() IN ('admin_solger', 'analista')
        OR EXISTS (
            SELECT 1 FROM solger.planta p
            WHERE p.id = recibo.planta_id
              AND p.cliente_id = solger.current_user_cliente_id()
        )
    );

DROP POLICY IF EXISTS conciliacion_read_policy ON solger.conciliacion;
CREATE POLICY conciliacion_read_policy ON solger.conciliacion
    FOR SELECT
    USING (
        auth.role() = 'anon'
        OR solger.current_user_rol() IN ('admin_solger', 'analista')
        OR EXISTS (
            SELECT 1 FROM solger.recibo r
            JOIN solger.planta p ON p.id = r.planta_id
            WHERE r.id = conciliacion.recibo_id
              AND p.cliente_id = solger.current_user_cliente_id()
        )
    );

DROP POLICY IF EXISTS usuario_perfil_self_policy ON solger.usuario_perfil;
CREATE POLICY usuario_perfil_self_policy ON solger.usuario_perfil
    FOR SELECT
    USING (
        user_id = auth.uid()
        OR solger.current_user_rol() = 'admin_solger'
    );
