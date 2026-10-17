# Mont Belvieu — Dashboard ejecutivo de precios

Propano, butano y crudo (WTI, Brent) desde fuentes públicas, con validación **privada** contra los precios oficiales AMEXGAS.

- **Entorno A (privado, esta computadora):** precios oficiales, diferencia vs. AMEXGAS en cUSD/gal, estadísticas de error y tolerancias.
- **Entorno B (empresa, futuro):** sólo indicadores digitales. Ver [docs/PUBLICACION.md](docs/PUBLICACION.md).

Documentación: [Arquitectura](docs/ARQUITECTURA.md) · [Fuentes](docs/FUENTES.md) · [Publicación interna](docs/PUBLICACION.md)

## Requisitos

- macOS/Linux/Windows con **Node.js 22.5 o superior** (probado con 25.9). No requiere base de datos externa: usa SQLite integrado en Node.
- Acceso a internet sólo para descargar precios públicos.

## Instalación

```bash
cd <carpeta del proyecto>
npm install
```

## Uso diario

| Acción | Comando |
|---|---|
| Iniciar el dashboard | `npm start` → http://127.0.0.1:3100 |
| Actualizar precios digitales | `npm run update` (o `npm run update -- --source eia_propano`) |
| Cargar/actualizar precios oficiales | `npm run import-official -- --file "/ruta/archivo.xlsx"` |
| Sólo agregar fechas nuevas de una hoja | `npm run import-official -- --file "/ruta/archivo.xlsx" --sheet "Nombre de hoja" --only-new` |
| Cotejar un Excel contra la base oficial (sin importar) | `npm run crosscheck-official -- --file "/ruta/archivo.xlsx"` |
| Reporte privado de precisión y tolerancias | `npm run private-report` → `private/reporte-precision.md` |
| Agregar hechos de mercado verificados | `npm run add-notes -- --file notas.json` |
| Exportar datos públicos | Botones en «Calidad de datos», o `/api/export?format=xlsx` |
| Pruebas | `npm test` |
| Demo con datos oficiales **sintéticos** | `npm run demo-data` y `npm run start:demo` (puerto 3101) |

### Actualización automática

```bash
./scripts/install-schedule.sh
```

Instala un LaunchAgent de macOS que ejecuta `npm run update` de lunes a viernes a las 08:30 y 17:30 (bitácora en `data/update.log`). Cada ejecución:

- reintenta hasta 3 veces con espera creciente;
- valida fecha (no futura), unidad y rango plausible; rechaza y registra lo inválido;
- detecta duplicados y guarda las **revisiones** cuando una fuente corrige un valor;
- registra `ok`, `sin_cambios` (no simula éxito si no hubo datos nuevos) o `error`;
- detecta cambios en el formato de la respuesta;
- si EIA falla, usa automáticamente el espejo de FRED;
- termina con código ≠ 0 si alguna fuente falla (para alertas).

El dashboard muestra alertas de **antigüedad** (dato atrasado/detenido) separadas de las alertas de **diferencia**.

## Formato de los archivos oficiales

Se reconocen por encabezados (ver `PROFILES` en `src/private/import-official.js`):

- `Fecha | Propano | Butano | Propano 2026 | Butano 2026` (cUSD/gal).
- `fecha | … | propano USDc/Gal | butano USDc/Gal` (columnas A, E y F).

El importador sólo imprime conteos y fechas. Descarta fechas futuras, valores fuera de rango y fechas repetidas con valores distintos.

## Sitio público (GitHub Pages)

`.github/workflows/pages.yml` publica la **vista general** (sin datos oficiales) de lunes a viernes: descarga precios públicos, carga las notas de `notas/` y genera el sitio con `npm run build:static` (`PRIVATE_MODE=0`, `PUBLIC_SITE=1`). Excluye fuentes cuyos términos no permiten redistribución y pide a los buscadores no indexarlo. Para forzar una actualización: pestaña **Actions → Actualizar sitio público → Run workflow**.

## Seguridad y confidencialidad

- Los precios oficiales viven en `private/official.db` (carpeta 0700, archivo 0600), **separada** de `data/market.db`. Ambas están en `.gitignore`.
- La API pública (`/api/*`) no importa ni consulta la base privada (hay una prueba que lo verifica). Las rutas privadas exigen rol `validador` y `PRIVATE_MODE` activo, y responden con `Cache-Control: no-store`.
- En modo local el servidor sólo escucha en `127.0.0.1` y rechaza conexiones externas.
- Sin telemetría, analítica, CDNs ni servicios de IA. Los registros sólo contienen método, ruta y estado; los errores del módulo privado omiten el detalle.
- «¿Qué movió el mercado?» se construye con reglas deterministas a partir de datos públicos; no envía nada a terceros.

## Configuración

`config/settings.json` (opcional, excluido de git) o variables de entorno:

| Variable | Default | Uso |
|---|---|---|
| `PORT`, `HOST` | 3100, 127.0.0.1 | Servidor |
| `AUTH_MODE` | `local` | `local` o `proxy` (detrás de Entra ID / oauth2-proxy) |
| `PRIVATE_MODE` | `1` | `0` en el Entorno B |
| `LOCAL_ROLE` | `validador` | `lector` para ver la vista sin datos privados |
| `PRIVATE_DB`, `PUBLIC_DB` | `private/official.db`, `data/market.db` | Rutas de las bases |
| `tolerance` (settings.json) | `{greenP: 0.9, yellowP: 0.99, windowMonths: 24, minN: 120}` | Semáforo |

## Limitaciones conocidas

- **Butano:** no hay precio diario gratuito. Se usa el PPI mensual del BLS (`WPU05320105`) como referencia indirecta y, en privado, una estimación calibrada con error medido; la diferencia diaria vs. AMEXGAS requiere una fuente OPIS/Argus.
- **EIA publica semanalmente:** el precio digital "de hoy" puede tener hasta ~8 días hábiles. Trading Economics (diario) está deshabilitado hasta revisar sus términos de uso.
- **Referencia distinta:** EIA (LSEG) no especifica TET/non-TET y puede no coincidir con la referencia oficial. El sesgo medido refleja esa diferencia.
- **Sin referencia oficial:** para fechas posteriores al último dato oficial cargado, el dashboard muestra «Sin referencia oficial disponible» (nunca reutiliza el último oficial).
