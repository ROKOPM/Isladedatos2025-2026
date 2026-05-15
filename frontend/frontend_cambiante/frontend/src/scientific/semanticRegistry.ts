/**
 * Semantic Registry — Single Source of Scientific Truth
 * 
 * ALL user-facing strings in the analytical layer MUST come from here.
 * NO hardcoded labels in React components.
 * Purpose: prevent semantic drift across the platform.
 */

export const SemanticRegistry = {

  // ── Metric Labels ──────────────────────────────────────────────
  metrics: {
    smoking_rate: {
      label: 'Incidencia de Tabaquismo',
      short: 'Inc. Tab.',
      unit: '%',
      definition: 'Proporción de observaciones que involucran consumo de tabaco respecto al total de eventos válidos en la ventana temporal.',
      tooltip: 'Ej: Un 2.8% indica que casi 3 de cada 100 observaciones confirmadas involucran tabaco.'
    },
    peak_hour: {
      label: 'Pico de Afluencia',
      short: 'Afluencia Máx.',
      unit: 'obs/hora',
      definition: 'Intervalo temporal que concentra el volumen absoluto máximo de observaciones.',
      tooltip: 'La hora específica con mayor concentración absoluta de personas detectadas.'
    },
    density: {
      label: 'Concentración Conductual',
      short: 'Concentración',
      unit: 'N',
      definition: 'Volumen de eventos registrados en la ventana temporal activa.',
      tooltip: 'Total de observaciones válidas en el periodo.'
    },
    behavioral_stability: {
      label: 'Estabilidad Conductual',
      short: 'Estabilidad',
      unit: 'índice',
      definition: 'Métrica derivada de la varianza, IQR y densidad de outliers que describe qué tan concentradas están las observaciones.',
      tooltip: 'Un valor alto indica observaciones más estables y repetitivas en agregado.'
    }
  },

  // ── Statistical Terms ──────────────────────────────────────────
  statistics: {
    iqr: {
      label: 'Rango Intercuartílico (IQR)',
      definition: 'Medida de dispersión estadística que captura el 50% central de las observaciones, excluyendo valores extremos.'
    },
    median: {
      label: 'Mediana',
      definition: 'Valor central que divide la distribución en dos mitades iguales. Más robusta que el promedio ante outliers.'
    },
    outlier: {
      label: 'Evento Extremo (Outlier)',
      definition: 'Observación que se desvía significativamente del IQR (>1.5x IQR). Indica comportamiento atípico.'
    },
    confidence_interval: {
      label: 'Intervalo de Confianza (95%)',
      definition: 'Rango dentro del cual estimamos que se encuentra el valor poblacional verdadero con 95% de certeza.'
    },
    p_value: {
      label: 'P-Value',
      definition: 'Probabilidad de observar datos tan extremos como los obtenidos si la hipótesis nula fuera cierta. p<0.05 indica significancia.'
    },
    cliffs_delta: {
      label: "Cliff's Delta",
      definition: 'Métrica no paramétrica de tamaño del efecto. Mide la probabilidad de que una observación del grupo B supere a una del grupo A.'
    }
  },

  // ── Governance Disclaimers ─────────────────────────────────────
  governance: {
    causality: 'Las asociaciones observadas son estrictamente correlacionales. Coincidencia temporal no implica relación causal.',
    ethics: 'Este sistema no realiza perfilamiento individual, scoring conductual ni predicciones. Todos los análisis son agregados y anonimizados.',
    methodology: 'Los resultados son sensibles al tamaño de la muestra, la cobertura temporal y la calidad de los sensores.',
    reproducibility: 'Este análisis es reproducible mediante su UUID de snapshot y la versión inmutable del dataset asociado.'
  },

  // ── Academic Context Labels ────────────────────────────────────
  academicContext: {
    normal: 'Periodo regular',
    midterms: 'Segundo parcial',
    finals: 'Exámenes finales / extraordinarios',
    projects: 'Entrega de proyectos',
    partial_exams: 'Primer parcial',
    holidays: 'Vacaciones / Semana Santa',
    vacation: 'Periodo vacacional',
    high_load: 'Carga académica alta',
    administrative: 'Periodo administrativo',
    unknown: 'Sin clasificar'
  },

  // ── UI Loading States ──────────────────────────────────────────
  ui: {
    loading: 'Evaluando matriz conductual...',
    empty: 'Muestra insuficiente para inferencia.',
    error: 'Error en el motor de agregación.'
  }
} as const

export type MetricKey = keyof typeof SemanticRegistry.metrics
export type StatKey = keyof typeof SemanticRegistry.statistics
export type AcademicContextKey = keyof typeof SemanticRegistry.academicContext
