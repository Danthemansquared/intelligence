# Arquitectura

## Principios

1. **Una sola implementación de cada fórmula.** Diferencias, variaciones, percentiles, tolerancias y antigüedad viven en `src/core/metrics.js`. Servidor, scripts y pruebas la reutilizan. La interfaz sólo redondea.
2. **Datos oficiales separados físicamente.** Los precios AMEXGAS viven en `private/official.db` (permisos 0700/0600, excluida de git). La base pública `data/market.db` nunca contiene valores oficiales ni diferencias.
3. **Capas claras:** origen (adaptadores) → validación/normalización → almacenamiento → cálculos → API → interfaz.
4. **Sin dependencias innecesarias.** Node.js ≥ 22.5 con SQLite integrado (`node:sqlite`), servidor `node:http` y pruebas `node:test`. Única dependencia: `exceljs` (leer el Excel oficial y exportar).
5. **Nada se envía a terceros.** No hay telemetría, analítica, CDNs ni servicios de IA. Las únicas conexiones salientes son las descargas de precios públicos.

## Módulos

```
src/
  config.js               Configuración (env > config/settings.json > defaults)
  core/
    units.js              Conversión de unidades (USD/gal, USD/bbl, USD/t, USD/kg → cUSD/gal)
    dates.js              Días hábiles, fechas ISO, calendario de Houston
    metrics.js            Δ, |Δ|, Δ%, estadísticas de error, tolerancias, variaciones, antigüedad
    narrative.js          "¿Qué movió el mercado?" (determinista, sin IA)
  sources/
    index.js              Registro de fuentes (metadatos + adaptador). Agregar una fuente = un objeto aquí.
    http.js, fred.js, eia.js, ...   Adaptadores
  ingest/run.js           Orquestador: reintentos, validación, deduplicación, bitácora, detección de cambios de formato
  db/public.js            Entorno B: observaciones digitales, ejecuciones, revisiones, notas
  db/private.js           Entorno A: precios oficiales (sólo si privateMode)
  private/
    import-official.js    Importa el Excel oficial (sólo imprime conteos y fechas)
    validation.js         Emparejamiento, estadísticas, tolerancias, recomendación
  server/
    server.js             HTTP, cabeceras de seguridad, ruteo, estáticos
    auth.js               Identidad y roles (local | proxy)
    public-api.js         /api/*  (no importa nada privado)
    private-api.js        /api/private/* (se carga sólo con privateMode)
web/                      Interfaz (HTML/CSS/JS sin dependencias, gráficas SVG propias)
test/                     Pruebas de cálculo, unidades, fechas, faltantes y permisos
```

## Modelo de datos

**Pública (`data/market.db`)**

| Tabla | Contenido |
|---|---|
| `observations` | Una fila por (fuente, producto, fecha de cotización): valor y unidad originales, valor normalizado, conversión aplicada, fecha de publicación (si existe) y fecha de consulta. |
| `observation_revisions` | Historial cuando una fuente corrige un valor ya publicado. |
| `fetch_runs` | Cada ejecución: estado (`ok`, `sin_cambios`, `error`, `omitida`), intentos, filas nuevas/revisadas/rechazadas, huella de estructura y mensaje. |
| `market_notes` | Hechos verificables con fecha, fuente y URL para "¿Qué movió el mercado?". |

**Privada (`private/official.db`)**

| Tabla | Contenido |
|---|---|
| `official_prices` | Precio AMEXGAS por producto y fecha, en cUSD/gal. |
| `import_log` | Metadatos de cada importación (conteos y fechas; nunca valores). |

## Tres fechas distintas

- **Fecha de cotización** (`quote_date`): día de operación al que corresponde el precio. Es la única que se usa para comparar.
- **Fecha de publicación** (`published_at`): cuándo la fuente lo hizo público (EIA publica con rezago semanal).
- **Fecha de consulta** (`fetched_at`): cuándo lo descargó este sistema.

## Metodología de comparación

- Se empareja **por fecha de cotización exacta**. Nunca se interpola ni se reutiliza el último oficial: si falta, se muestra «Sin referencia oficial disponible».
- Si producto, unidad, fecha o referencia de mercado no coinciden, se muestra «No comparable» con el motivo.
- Se calcula además el error con desfase de ±1 día hábil para detectar fuentes que fechan distinto (el resultado se muestra como advertencia, no se aplica automáticamente).
- **Precisión de nivel** (MAE, sesgo, percentiles, % dentro de márgenes) y **precisión de dirección** (acierto de signo y correlación de cambios diarios) se reportan por separado.
- Régimen de mercado: días "volátiles" = cambio diario oficial mayor al percentil 75 histórico.

## Tolerancia (semáforo)

Por fuente y producto, sobre una ventana móvil (24 meses por defecto, configurable):

- **Verde** ≤ P90 del error absoluto (lo normal en 9 de cada 10 días).
- **Amarillo** entre P90 y P99 (inusual, revisar).
- **Rojo** > P99, o comparación no válida.
- Con menos de 120 días comparables la tolerancia se marca **preliminar**; con menos de 10, **insuficiente** y no se propone.

Los percentiles y la ventana se cambian en `config/settings.json` (`tolerance`). Una vez aprobada, la tolerancia puede fijarse en esa configuración.

Las **fallas de datos** (fuente detenida, atrasada, error de descarga, cambio de formato) generan alertas de antigüedad o de falla, independientes del semáforo de diferencia.

## Agregar una fuente

1. Crear el adaptador (función `fetch()` que devuelve `{ rows: [{ product, quoteDate, value, unit, publishedAt? }], signature }`).
2. Registrar sus metadatos en `src/sources/index.js` (referencia, unidad, frecuencia, rezago normal, términos, limitaciones, `comparable`).
3. `npm run update -- --source <id>`.

No requiere cambios en base de datos, cálculos ni interfaz.

## Diseño de la interfaz

Basado en las Human Interface Guidelines de Apple y en la auditoría del *redesign-skill* (taste-skill):

- **Superficies agrupadas**: tarjetas blancas sobre `#F2F2F7` (negro/`#1C1C1E` en oscuro), separadas por tono, sin bordes ni sombras. Radios concéntricos (tarjeta 22 px, bloque interno 14 px, control 9 px).
- **Tipografía del sistema** (SF Pro en Apple, Segoe UI en Windows) con los estilos de texto de Apple: título 40/32, *title3* 21, cuerpo 17, *subheadline* 15, nota 13, *caption* 12. Cifras tabulares en datos.
- **Color con significado**: un solo acento (azul de sistema); series validadas para daltonismo (azul `#007AFF`, naranja `#E46A00`); verde/naranja/rojo de sistema sólo para el semáforo, siempre con texto. Las variaciones de precio son neutras (flecha + signo): para un comprador de GLP una subida no es "buena".
- **Componentes**: tarjetas tipo widget de Bolsa con mini tendencia; control segmentado con pulgar deslizante y navegación por teclado; lista agrupada estilo Ajustes para las fuentes; gráficas con eje a la derecha, área tenue y punto final.
- **Movimiento**: curva de resorte `cubic-bezier(0.32, 0.72, 0, 1)`; esqueletos de carga; respeta `prefers-reduced-motion`.
- **Accesibilidad**: enlace "Saltar al contenido", foco visible, objetivos táctiles de 36–44 px en pantallas táctiles, `aria-current` en la sección activa.
- Descartado a propósito de la skill: fuentes externas, texturas de grano e imágenes de stock (contradicen a Apple y la política sin recursos externos).
