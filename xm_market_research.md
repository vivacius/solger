# 🔬 Investigación: SOLGER + Mercado Eléctrico Mayorista XM Colombia

## 1. ¿Qué es SOLGER?

**SOLGER** es una plataforma de **gestión de activos solares** en Colombia. El sistema:
- Se conecta a **Huawei FusionSolar** (via API Northbound) para monitorear plantas solares en tiempo real
- Expone un **backend FastAPI** que actúa como proxy hacia FusionSolar
- Tiene una **webapp en React/TypeScript** para visualizar KPIs, alarmas y rendimiento
- Genera **reportes ejecutivos** con métricas como Performance Ratio (PR), HSP, energía generada, CO₂ evitado
- Sirve a un **portafolio de plantas solares** (probablemente Valle del Cauca, dado que usa `HSP_REF = 4.5`)

**El negocio**: Gestión técnica y comercial de plantas solares fotovoltaicas en Colombia.

---

## 2. ¿Qué es XM y por qué importa?

**XM S.A. E.S.P.** es el **Administrador del Mercado de Energía Mayorista (MEM)** y operador del **Sistema Interconectado Nacional (SIN)** de Colombia. Sus roles relevantes para SOLGER:

| Rol | Relevancia para Solar |
|-----|----------------------|
| **ASIC** (Administrador del Sistema de Intercambios Comerciales) | Liquida hora a hora la energía vendida/comprada entre agentes |
| **LAC** (Liquidador y Administrador de Cuentas) | Calcula cuánto le debe pagar cada comprador a cada generador |
| **Publicación de precios** | Publica el **Precio de Bolsa Nacional** — la referencia de mercado |

**Portal**: [SINERGOX](https://sinergox.xm.com.co/) — datos del MEM
**API pública**: `https://servapibi.xm.com.co` — sin usuario ni clave requeridos

---

## 3. ¿Cómo funciona el mercado y los contratos?

### 3.1 El Mercado Spot (Bolsa de Energía)

El precio spot en Colombia se llama **Precio de Bolsa Nacional** y se calcula **hora a hora** por XM mediante un modelo de despacho ideal. Depende de:
- Disponibilidad hídrica (embalses)
- Ofertas de los generadores térmicos
- Demanda del sistema
- Generación FNCER disponible

> **Agosto 2026**: El precio promedio de bolsa ronda **$562 COP/kWh**, presionado por mayor térmica.

### 3.2 Contratos Bilaterales (el mecanismo de tu caso)

Los generadores solares en Colombia **NO venden directamente en bolsa**; normalmente tienen uno de estos esquemas:

```
┌─────────────────────────────────────────────────────────────────┐
│ ESQUEMA 1 — Contrato Bilateral / PPA (Power Purchase Agreement) │
│                                                                 │
│  Generador Solar ──── precio fijo o indexado ──── Comercial-  │
│  (SOLGER / cliente)   (ej. $350/kWh por 15 años)  izador/Emp  │
│                                                   resa compradora│
│                                                                 │
│  XM/ASIC liquida la DIFERENCIA entre lo contratado y lo real  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ ESQUEMA 2 — Contrato de Largo Plazo por Subasta (FNCER)        │
│                                                                 │
│  Generador Solar ──── precio adjudicado en subasta ──── Redes  │
│  (ganador de subasta)  (precio fijo indexado IPC)    de distrib│
│                                                                 │
│  XM supervisa el cumplimiento de la obligación de energía       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 🎯 LA MÉTRICA CLAVE: ¿Cómo saber si el contrato es justo?

### 4.1 Variable principal: `PrecBolsNaci` (Precio de Bolsa Nacional)

Esta es la métrica de referencia del mercado. Se consulta en la API de XM:

```python
from pydataxm import PYDATAXM
from datetime import date

xm = PYDATAXM()

# Precio de Bolsa Nacional ($/kWh)
df = xm.request_data(
    metric="PrecBolsNaci",
    entity="Sistema",
    start_date=date(2026, 1, 1),
    end_date=date(2026, 8, 21)
)
print(df.head())
```

**¿Qué te dice?**: Si tu precio contractual es **mayor** al precio de bolsa promedio → tu cliente está pagando bien. Si es **menor** → podrías estar vendiendo barato.

### 4.2 Variables adicionales relevantes para SOLGER

| Variable API (`metric`) | Descripción | ¿Por qué importa? |
|------------------------|-------------|-------------------|
| `PrecBolsNaci` | Precio de Bolsa Nacional ($/kWh, horario) | **La referencia spot del mercado** |
| `PrecioPromedioContratosRegulado` | Precio promedio de contratos mercado regulado | Benchmark para PPAs con distribuidoras |
| `PrecioPromedioContratosNoRegulado` | Precio promedio contratos mercado no regulado | Benchmark para PPAs con empresas industriales |
| `GeneracionReal` | Generación real por recurso/agente | Validar lo que XM reconoce como tu generación |
| `GeneracionIdeal` | Generación ideal del despacho | Para calcular restricciones o vertimientos |
| `VentasContratosEnergia` | Energía vendida en contratos (MWh) | Verificar los MWh liquidados en tu contrato |
| `PrecioOfertaDespacho` | Precio de oferta de los generadores | Contexto del costo de oportunidad |

### 4.3 La lógica de liquidación que hace XM (ASIC)

```
Lo que te pagan = Energía_Generada_Real × Precio_Contrato
                 ± Ajuste en bolsa por diferencias

Si generaste MÁS de lo contratado:
  → El exceso se valora al precio de bolsa (puede ser ventaja o no)

Si generaste MENOS de lo contratado:
  → Debes comprar la diferencia en bolsa al precio spot
  → Riesgo alto en días de alta irradiación fallida
```

---

## 5. ¿Contrato fijo o subasta?

### Contrato Bilateral / PPA Directo
- El precio se **negocia libre y privadamente** entre las partes
- No hay publicación oficial del precio individual
- La referencia para saber si es justo: comparar con `PrecBolsNaci` y `PrecioPromedioContratosNoRegulado`
- **Indexación típica**: IPC anual o dólar (para proyectos con equipos importados)

### Subasta FNCER (mecanismo oficial)
- XM/UPME organizan subastas en las que se adjudica energía a precio fijo (COP/kWh) con 20-25 años de contrato
- El precio adjudicado se publica oficialmente
- Ejemplo: subasta de 2019 adjudicó a ~$147 COP/kWh (pesos 2019)
- Regulación: CREG 130 de 2019 y posteriores

---

## 6. Cómo integrar esto en SOLGER

### Módulo propuesto: `analytics/market_analytics.py`

```python
from pydataxm import PYDATAXM
from datetime import date, timedelta

class MarketAnalytics:
    """Comparador entre ingresos contractuales y precio spot XM."""
    
    def __init__(self):
        self.xm = PYDATAXM()
    
    def get_spot_price(self, start: date, end: date) -> pd.DataFrame:
        """Precio de Bolsa Nacional (referencia de mercado)."""
        return self.xm.request_data(
            metric="PrecBolsNaci",
            entity="Sistema",
            start_date=start,
            end_date=end
        )
    
    def get_avg_contract_price(self, start: date, end: date) -> dict:
        """Precio promedio de contratos regulados y no regulados."""
        regulado = self.xm.request_data("PrecioPromedioContratosRegulado", "Sistema", start, end)
        no_regulado = self.xm.request_data("PrecioPromedioContratosNoRegulado", "Sistema", start, end)
        return {"regulado": regulado, "no_regulado": no_regulado}
    
    def evaluate_contract(
        self, 
        contract_price_cop_kwh: float,
        energy_kwh: float,
        start: date, 
        end: date
    ) -> dict:
        """
        Evalúa si el precio contractual es competitivo vs. el mercado.
        
        Args:
            contract_price_cop_kwh: Precio pactado en el contrato (COP/kWh)
            energy_kwh: Energía generada en el período (kWh)
            start/end: Período de análisis
        """
        df_bolsa = self.get_spot_price(start, end)
        avg_bolsa = df_bolsa["Values_Hour00":"Values_Hour23"].mean().mean()
        
        revenue_contract = contract_price_cop_kwh * energy_kwh
        revenue_bolsa = avg_bolsa * energy_kwh
        delta = revenue_contract - revenue_bolsa
        
        return {
            "precio_contrato_cop_kwh": contract_price_cop_kwh,
            "precio_bolsa_promedio_cop_kwh": round(avg_bolsa, 2),
            "ingreso_contrato_cop": round(revenue_contract, 0),
            "ingreso_equivalente_bolsa_cop": round(revenue_bolsa, 0),
            "diferencia_cop": round(delta, 0),
            "evaluacion": "✅ Contrato favorable" if delta > 0 else "⚠️ Bolsa habría pagado más"
        }
```

---

## 7. Respuesta directa a tu pregunta

> **"¿Cuál es la métrica para identificar en qué plan me debería pagar la empresa con la que tengo el contrato, o si lo subastaría?"**

**Respuesta**: La métrica de referencia universal es el **`PrecBolsNaci` (Precio de Bolsa Nacional)** publicado hora a hora por XM.

- Si tu **precio contractual** > **Precio de Bolsa promedio** del período → tu contrato bilateral te conviene más que haber vendido en bolsa.
- Si tu **precio contractual** < **Precio de Bolsa promedio** → habrías ganado más vendiendo en mercado spot (aunque esto es más riesgoso).
- La **segunda referencia** es `PrecioPromedioContratosNoRegulado` si tu cliente es una empresa industrial, o `PrecioPromedioContratosRegulado` si es una distribuidora.

Para **subastas FNCER**: la métrica es el **precio adjudicado en subasta** (público, disponible en UPME/XM), comparado contra el precio de bolsa proyectado para los próximos 20 años.

---

## 8. Próximos pasos recomendados para SOLGER

- [ ] Integrar `pydataxm` en el proyecto (`pip install pydataxm`)
- [ ] Crear módulo `analytics/market_analytics.py` para consultar precios XM
- [ ] Agregar al reporte ejecutivo: comparativa ingreso contractual vs. precio bolsa
- [ ] En la webapp: panel de **Análisis de Mercado** con `PrecBolsNaci` histórico vs. precio del contrato
- [ ] Almacenar en DB el precio de contrato por planta para automatizar el cálculo
