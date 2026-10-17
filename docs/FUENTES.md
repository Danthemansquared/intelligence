# Fuentes de datos

Investigación verificada el 17-oct-2026 con consultas reales a cada URL. "No verificado" = no se pudo confirmar.

## Resumen y clasificación

| Fuente | Producto · referencia | Unidad | Frecuencia / rezago | Historial | Acceso | Costo / términos | Clasificación | Estado |
|---|---|---|---|---|---|---|---|---|
| **EIA** — Mont Belvieu Propane Spot FOB (`EER_EPLLPA_PF4_Y44MB_DPG`) | Propano spot FOB Mont Belvieu; origen LSEG/Refinitiv | USD/gal | Diaria, **publicada una vez por semana** (normalmente miércoles). Último dato hoy: 14-oct (publicado 15-oct; siguiente 21-oct) | Desde 1992-07-09 | Tabla HTML sin llave; XLS; API v2 (llave gratuita) | Gratuito, dominio público | **Principal (propano)** | Activa |
| **FRED** — `DPROPANEMBTX` | Espejo exacto de la serie EIA | USD/gal | Igual a EIA | Igual | CSV sin llave (`fredgraph.csv`) | Gratuito | Respaldo automático de EIA | Activa como respaldo |
| **Trading Economics** — Propane `PNL:COM` | Propano Mont Belvieu, cotización OTC/CFD (metodología no documentada) | USD/gal (2 decimales) | Diaria, sin rezago | Sólo dato del día en la página; historial vía API de pago | Página HTML pública | API ≈ USD 199/mes; cuenta *guest* descontinuada; **términos de extracción no verificados** | Secundaria (indicativa) | **Deshabilitada** hasta revisar términos |
| **EIA** — WTI Cushing (`RWTC`) y Brent Europa (`RBRTE`) spot | Crudo spot físico FOB | USD/bbl | Diaria, publicada semanalmente | WTI 1986, Brent 1987 | HTML/XLS/API; respaldo FRED `DCOILWTICO`, `DCOILBRENTEU` | Gratuito | **Principal (crudo)** | Activa |
| **Yahoo Finance** — `CL=F`, `BZ=F` | Futuros de primer mes: WTI NYMEX y Brent Last Day Financial (NYMEX) | USD/bbl | Diaria (cierre); sin rezago | 2 años por consulta | API JSON no oficial | Sin costo; términos de uso personal, sin SLA | Secundaria (dato del día) | Activa |
| **BLS vía FRED** — PPI Butane (`WPU05320105`) | Índice de precios al productor de butano en EE. UU. (no específico de Mont Belvieu; no estacionalizado) | Índice 1982=100 | **Mensual**; publicado a mediados del mes siguiente (sep-2026 → 15-oct-2026); últimos 4 meses preliminares | Desde 1977-06 | CSV sin llave | Gratuito | **Secundaria indirecta (butano)** — no permite diferencia en cUSD/gal | Activa |
| **EIA WPSR** — `WPRSTUS1`, `W_EPLLPZ_EEX_NUS-Z00_MBBLD` | Inventarios y exportaciones de propano/propileno de EE. UU. | miles bbl → MMbbl; mil b/d | Semanal (miércoles) | 2015 / 2010 | HTML sin llave | Gratuito | Contexto | Activa |
| CME Group — Mont Belvieu LDH Propane (OPIS), Normal Butane (OPIS) `D0` | Futuros financieros OPIS | USD/gal | Liquidación diaria | — | Páginas y endpoints bloqueados (403, Akamai) | Licencia de datos CME | Descartada (inaccesible) | — |
| Yahoo `B0=F` | "Mont Belvieu TET Propane (OPIS)" | USD/gal | Muy poca liquidez (1 punto/mes) | — | API no oficial | — | Descartada (no confiable) | — |
| Stooq, Investing.com, Barchart, Nasdaq Data Link | — | — | — | — | Bloqueados (reto JS, 403, respuesta vacía) | — | Descartadas | — |
| AIGLP (aiglp.org/feed) | Noticias GLP Latinoamérica | — | — | — | RSS | Gratuito | Contexto (noticias, sin precios) | Pendiente |
| EIA Today in Energy / Heating Oil & Propane Update (RSS) | Noticias y reportes | — | Diario / semanal | — | RSS | Gratuito | Contexto | Pendiente |

## Butano normal Mont Belvieu

**No existe una fuente digital gratuita y automatizable de precio diario.** La mejor referencia pública es el **PPI de butano del BLS** (sugerido por el usuario, integrado): mensual, en índice, no en cUSD/gal. El dashboard lo muestra como «referencia indirecta» con la diferencia vs. AMEXGAS marcada como «No comparable», y en el Entorno A evalúa:

- correlación y acierto de dirección de los cambios mensuales vs. AMEXGAS, comparando contra el **promedio mensual** oficial y contra el oficial del **día de referencia del BLS** (martes de la semana que contiene el día 13);
- una **estimación calibrada fuera de muestra** (índice × mediana de AMEXGAS/índice de los 12 meses previos) con su MAE, P90 y tolerancia en cUSD/gal, y su valor para los meses publicados del PPI que aún no tienen dato oficial.

**Estimación diaria (sólo Entorno A):** butano = propano EIA del día × mediana de la relación butano AMEXGAS / propano EIA de los últimos 20 días con ambos datos (sin usar nunca el dato del mismo día). Se valida como cualquier otra fuente (MAE, sesgo, P90, semáforo) y su margen se recalcula con el desfase real entre el último dato oficial y la fecha estimada. Es la cifra que muestra la tarjeta de butano del validador.

Para precio diario publicado: EIA, FRED y Trading Economics no lo publican; CME/ICE (contratos OPIS) y Argus requieren licencia; Yahoo `D0=F` no devuelve datos. Opciones:

1. Licencia OPIS o Argus, que permitiría automatizar butano y propano con la misma referencia que usa la industria.
2. Captura de un boletín recibido por correo, si el contrato lo permite.
3. Un estimador de butano a partir de propano y crudo, calibrado y evaluado **sólo en el Entorno A** (pendiente de autorización: el modelo se ajusta con datos oficiales).

## Fechas

- **Fecha de cotización**: día de operación. Única base de comparación.
- **Fecha de publicación**: EIA la publica en la página ("Release Date"); se guarda para los datos de la última entrega.
- **Fecha de consulta**: momento en que este sistema descargó el dato.

## Frecuencia de consulta

La tarea programada corre dos veces por día hábil (08:30 y 17:30). Cada fuente recibe una sola solicitud por ejecución (EIA: una página por serie), muy por debajo de cualquier límite razonable. Trading Economics, si se habilita, una vez al día.
