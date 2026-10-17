# Publicación interna (Entorno B) — propuesta

> Nada de esto está desplegado. Requiere autorización antes de incurrir en costos o exponer cualquier servicio.

## Separación de entornos

| | Entorno A — Validación privada | Entorno B — Dashboard empresarial |
|---|---|---|
| Dónde | Esta computadora (o un servidor privado autorizado) | Servidor/servicio interno de la empresa |
| Datos | Precios digitales + **precios oficiales AMEXGAS** | Sólo precios digitales, crudo, notas de mercado |
| Configuración | `AUTH_MODE=local`, `PRIVATE_MODE=1` | `AUTH_MODE=proxy`, `PRIVATE_MODE=0` |
| Base privada | `private/official.db` | **No existe** en el servidor |

Con `PRIVATE_MODE=0` el servidor no abre la base privada ni carga el módulo privado; las rutas `/api/private/*` responden 403 y la interfaz oculta la sección.

## Si más adelante se autoriza mostrar la diferencia vs. AMEXGAS en el Entorno B

Decisión previa obligatoria: **quién** puede verla y **qué** se comparte (sólo el semáforo, la diferencia, o también el precio oficial). Diseño recomendado, de menor a mayor exposición:

1. **Sólo semáforo y estadísticos agregados** (MAE, P90): se calculan en el Entorno A y se publican como un archivo de resumen firmado, sin precios oficiales diarios.
2. **Diferencia diaria** para el rol `validador`: se habilita `PRIVATE_MODE=1` en el servidor, con la base privada fuera de la carpeta pública, cifrado en reposo del disco y respaldo controlado. El rol se asigna por usuario en `config/roles.json`.

En ambos casos, la diferencia combinada con el precio digital permite reconstruir el precio oficial; por eso se trata como información confidencial y se restringe al mismo grupo que puede ver el oficial.

## Arquitectura recomendada (Microsoft 365 / Entra ID)

La organización ya usa Microsoft 365 (Outlook, Teams, SharePoint), por lo que la autenticación natural es **Microsoft Entra ID** (inicio de sesión único con la cuenta corporativa, MFA y acceso condicional ya existentes).

```
Usuario (navegador, teléfono)
   │ HTTPS + inicio de sesión Microsoft
   ▼
Proxy de autenticación (Entra ID)       ← Opción 1: Azure App Service "Easy Auth"
   │ encabezado X-MS-CLIENT-PRINCIPAL-NAME   Opción 2: Azure Container Apps + auth integrada
   ▼                                       Opción 3: servidor interno + oauth2-proxy / IIS + ARR
Aplicación (AUTH_MODE=proxy, PRIVATE_MODE=0)
   │
   ├─ data/market.db (disco persistente)
   └─ Tarea programada diaria (npm run update)
```

- La aplicación **sólo confía** en el encabezado de identidad si la conexión proviene de `trustedProxies`. El puerto de la aplicación no se expone directamente.
- Roles por correo en `config/roles.json` (`{"*": "lector", "direccion@empresa.com": "validador"}`), o mediante grupos de Entra ID mapeados por el proxy.
- Secretos (p. ej. `EIA_API_KEY`) como variables de entorno o Azure Key Vault, nunca en el repositorio.
- Restringir el acceso a la red corporativa o VPN si se desea, además del inicio de sesión.

### Costos orientativos (verificar antes de contratar)

- Azure App Service plan B1 Linux o Container Apps con consumo bajo: del orden de decenas de USD/mes. SQLite basta para decenas de usuarios concurrentes de sólo lectura.
- Entra ID: incluido en las licencias Microsoft 365 existentes para inicio de sesión básico.
- Alternativa sin costo de nube: una máquina virtual o servidor interno existente con IIS/NGINX + autenticación integrada de Windows o oauth2-proxy.

## Lista de verificación antes de publicar

- [ ] Autorización explícita para el despliegue y su costo.
- [ ] Decisión sobre quién ve la diferencia vs. AMEXGAS (por defecto: nadie en Entorno B).
- [ ] `PRIVATE_MODE=0` y sin `private/` en el servidor.
- [ ] HTTPS obligatorio; la app escucha sólo en la red interna del proxy.
- [ ] `config/roles.json` con usuarios/grupos aprobados.
- [ ] Tarea programada de actualización y alerta por correo/Teams si `npm run update` termina con código ≠ 0.
- [ ] Respaldo diario de `data/market.db`.
- [ ] Revisar los términos de uso de cada fuente para uso interno empresarial (ver `docs/FUENTES.md`).
