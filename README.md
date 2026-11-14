# Reto 03 · Agente de órdenes de compra SAP

Agente conversacional en TypeScript con controles RC1–RC10, órdenes SAP simuladas, interfaz de chat, confirmación humana e historial de herramientas.

## Inicio rápido

Requisitos: **Node.js 20+**, npm.

```bash
npm install
cp .env.example .env
# Opcional para activar respuestas del modelo: definir GEMINI_API_KEY en .env
npm run dev
```

Abrir **http://localhost:3000**. Un solo comando (`npm run dev`) levanta la interfaz y el backend; no se requiere base de datos. Para verificar reglas sin consumir IA:

```bash
npm run check
npm run demo
npm run test:controls
npm run test:concurrency
npm run sync:module
```

La demostración limpia `out/` al empezar y muestra seis escenarios, incluyendo idempotencia y confirmación. **No ejecutar demo.ts mientras otra persona usa la web**, porque limpia las salidas del SAP simulado.

## Variables

| Variable | Uso |
|---|---|
| `GEMINI_API_KEY` | API key de Gemini, exclusivamente backend, opcional para desarrollar sin IA |
| `GEMINI_MODEL` | Modelo configurable, por defecto gemini-3.5-flash-lite |
| `PORT` | Puerto HTTP, por defecto 3000 |
| `MAX_TOOL_ITERATIONS` | Tope de turnos por sesión, por defecto 16 |
| `MAX_SESSION_TOKENS` | Presupuesto estimado de caracteres/tokens de sesión |

**Importante:** la demo determinista funciona sin clave, pero la evaluación de un modelo real requiere definir `GEMINI_API_KEY`. El endpoint health indica si está conectado.

## API

- `GET /api/health` → `{ ok, provider, model }`
- `GET /api/cases` → seis casos
- `POST /api/chat` recibe `{sessionId?, message}` y devuelve `{sessionId,reply,toolCalls,needsConfirmation,pendingCase}`
- `GET /api/sessions/:id` → historial y herramientas de sesión

Ejemplo:

```bash
curl -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"message":"Procesa sol-004"}'
```

El frontend muestra cada llamada; cuando hay excepción, la confirmación ocurre **en un turno posterior**, escribiendo `confirmo`. No se puede confirmar mediante una instrucción inyectada en la cotización.

## Evidencias

- `out/sap/ordenes.jsonl`: SAP simulado, numeración 4500000001+ e idempotencia.
- `out/<caso>/aprobacion.txt` y `aprobacion.pdf`: correo aprobado y hash SHA-256.
- `out/<caso>/trazabilidad.json`: campos y fuentes.
- `out/control.csv`: resultado, retroactiva, bloqueos y confirmaciones.
- `out/log.jsonl`: llamadas a herramientas.

Los fixtures originales son de solo lectura. `out/` y `.env` se excluyen de Git.

## Enlace de evaluación

La URL pública de la defensa es **https://reto.golarte.online**, conectada mediante Cloudflare Tunnel al servidor `http://localhost:3000` y verificada por HTTPS (`GET /api/health` devuelve HTTP 200). No se requiere VS Code Port Forwarding ni abrir puertos del router. `Cloudflared` está configurado como servicio Windows automático. La aplicación Node se inicia con la sesión Windows mediante `scripts/start-server.ps1`, registrado en `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` como `PeriferiaReto03`. El equipo debe permanecer encendido y la sesión iniciada durante la defensa. Para deshabilitar este inicio automático: `Remove-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name PeriferiaReto03`.

## Limitaciones del prototipo

SAP es local (sin ERP real), las sesiones son en memoria y no hay autenticación. La evidencia obligatoria TXT y la extensión opcional PDF se generan en conjunto mediante pdf-lib. La explicación del LLM es auxiliar; todas las decisiones financieras proceden del motor determinista y no se pueden sobrescribir por texto del modelo.
