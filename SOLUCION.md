# SOLUCIÓN TÉCNICA · Reto 03 — Órdenes de compra SAP

## 1. Problema y usuario

La analista administrativa dedica tiempo a digitar datos de compra y comprobar manualmente proveedor, aprobador, centros de costo e impuestos. El riesgo es que errores operativos se transformen en registros SAP inválidos; adicionalmente, las OC retroactivas no son visibles para la dirección.

## 2. Arquitectura

```text
Navegador / Chat web (HTML CSS JS)
       | POST /api/chat
Backend Express + TypeScript
       |-- agente: agent/prompt.md
       |-- conocimiento: src/knowledge/ordenes-compra.md
       |-- capa de modelo: src/llm/adapter.ts + gemini.ts
       |-- motor determinista: src/tools/oc.ts (Zod)
       |-- src/sap/adapter.ts -> src/sap/mock.ts
       |-- fixtures/reto-03 (solo lectura)
       +-- out/ (evidencia, JSONL, CSV)
```

Comportamiento del asistente, conocimiento del proceso, herramientas y transporte HTTP están separados. La fuente de los montos es el paquete, jamás el modelo. El adaptador SAP y su contrato se desacoplan de la implementación basada en archivos.

## 3. Ciclo, herramientas y confirmaciones

Al recibir `sol-00N`, el orquestador invoca de forma auditable `oc_leer_paquete`, `oc_validar`, `oc_construir_payload`, `oc_generar_evidencia` y `oc_crear` según corresponda. Devuelve el resultado de cada fase al chat. Ante bloqueos no construye ni crea. Ante confirmaciones construye y detiene el turno; exige `confirmo` en un mensaje posterior desde la misma sesión antes de ejecutar creación. Mantiene presupuesto de turnos y tokens estimado por sesión y responde con errores legibles.

La narración opcional de Gemini se genera después de ejecutar los controles: el proveedor no controla los montos ni las decisiones de autorización. Este diseño es una decisión de seguridad y fiabilidad. La interfaz `LlmAdapter.enviar(mensajes, herramientas)` desacopla al proveedor del ciclo. El modelo puede ejecutar un **ciclo adicional de function calling nativo de Gemini** sobre las cinco funciones con esquemas derivados de Zod (máximo ocho iteraciones). Todas sus solicitudes de lectura se reconstruyen usando el caso autorizado, mientras que la creación permanece exclusivamente en manos del orquestador con controles y confirmación humana. Por tanto, el LLM participa realmente en la invocación de herramientas de consulta, pero no puede saltarse RC1–RC10 ni autorizar gastos por sí mismo. Este ciclo requiere una API key para verificarlo en vivo.

## 4. Modelo

Google Gemini mediante `@google/genai` y variable `GEMINI_API_KEY`, modelo `GEMINI_MODEL` (por defecto `gemini-3.5-flash-lite`). Se elige por su API TypeScript y la posibilidad de obtener cuota gratuita. El motor y `demo.ts` no requieren esta clave. Para una estimación de 10.000 tokens de entrada y 2.000 de salida, la tarifa estándar publicada de Gemini 3.5 Flash-Lite (USD 0,30/M input y USD 2,50/M output) equivale a **aprox. USD 0,008 por solicitud fuera de cuota gratuita**; puede variar por iteraciones y tokens de razonamiento. En el nivel gratuito los tokens estándar están listados como gratuitos, sujetos a límites. Fuente: https://ai.google.dev/gemini-api/docs/pricing. La respuesta del ciclo se limita a 900 tokens por iteración, ocho iteraciones y timeout total de 20 s. Para la URL pública se limita el consumo a 20 solicitudes por IP cada 10 minutos y 250 solicitudes globales por día; esto protege parcialmente la cuota gratuita, no sustituye autenticación.

## 5. Matriz de controles

| Regla | Fuente / comportamiento | Clasificación |
|---|---|---|
| RC1 | Match proveedor por NIT; si falta, nombre normalizado; requiere activo | Bloqueo |
| RC2 | Aprobación con “Aprobado” por aprobador del centro | Bloqueo |
| RC3 | Monto frente al tope del aprobador | Bloqueo |
| RC4 | Subárea incluida en centro de costo | Bloqueo |
| RC5 | Delta relativo >2 % entre cotización y solicitud, o cotización ausente | Confirmación |
| RC6 | IVA ausente: valor default proveedor | Confirmación y derivado |
| RC7 | Pago ausente: default proveedor | Derivado |
| RC8 | Factura emitida antes de fecha solicitud | Confirmación y marca retroactiva |
| RC9 | Aprobación anterior a fecha solicitud | Confirmación |
| RC10 | Cantidad × unitario y total con diferencia absoluta ≤1 | Bloqueo |

El control más delicado es RC5: cotejar montos que aparecen con puntos de miles en un texto informal. El parser convierte el total numérico sin redondeos inventados y exhibe el porcentaje de discrepancia. Las reglas de mayor riesgo son RC2 y RC3, porque el correo aparentemente válido podría no tener autoridad sobre ese centro o monto.

## 6. Adaptador SAP productivo propuesto

**Opción:** fachada interna hacia SAP S/4HANA mediante OData `API_PURCHASEORDER_PROCESS_SRV` si el landscape y la versión la exponen; alternativa RFC `BAPI_PO_CREATE1` mediante middleware y conectividad privada. No se asume viabilidad hasta confirmar producto SAP, versión, autorizaciones y endpoints.

**Mapeo:** `sociedad` → CompanyCode; `organizacion_compras` → PurchasingOrganization; proveedor → Supplier; `moneda` → DocumentCurrency; posición `numero` → PurchaseOrderItem; precio, cantidad, indicador IVA → NetPriceAmount / OrderQuantity / TaxCode según API real; centro de costo/subárea → asignación contable y campos personalizados validados con FI/CO. La aprobación y hash se incorporarían como adjunto o documento enlazado mediante API de attachments disponible.

**Seguridad:** servicio backend aislado; credenciales en un gestor de secretos con IAM y rotación, TLS con verificación de certificado, cuenta técnica de privilegio mínimo y auditoría. Nunca en prompt, front ni logs.

**Idempotencia:** usar identificador estable `solicitud_id` en un registro transaccional de correlación, comprobar referencia en SAP antes de reintentar; ante timeout de respuesta consultar estado antes de volver a enviar. Para errores parciales: compensación controlada según estados de SAP, cola de reintentos y derivación humana; nunca duplicar. Para auditoría, conservar solicitud, eventos, hash, referencias SAP y usuario de confirmación.

**Plan B:** generar payload revisable y CSV de carga, prellenar pantallas vía integración asistida, sin automatizar escritura a SAP si no existe canal seguro.

## 7. Lectura del proceso de OC retroactivas

La presencia de factura previa a solicitud es un síntoma de que el control de compras se está aplicando después del compromiso económico. La dirección debería medir volumen, valor, frecuencia y centro de costo de OC retroactivas, distinguiendo excepciones legítimas de patrones. Recomiendo un indicador mensual `OC retroactivas / OC totales`, seguimiento por responsable y causa, y una política que requiera aprobación adicional de compras/finanzas para retroactivas, además del visto bueno del líder. No se deben crear órdenes ficticiamente antedatadas para “arreglar” el indicador.

## 8. Decisiones y trade-offs

1. JSONL local frente a PostgreSQL: despliegue y evaluación rápidos; la escritura se serializa con una cola en memoria para evitar duplicados por concurrencia dentro de un proceso (probada con 12 operaciones simultáneas). Para despliegues multiproceso sigue siendo necesaria una base transaccional.
2. Controles TypeScript frente a decisiones del LLM: evita alucinaciones e inyección, pero reduce flexibilidad.
3. HTML plano frente a React: interfaz funcional y desplegable sin compilación; menos modularidad visual.
4. TXT con SHA-256 y PDF: ambos se generan del mismo contenido con pdf-lib para conservar paridad y cubrir P0/P1.
5. Confirmación en turno posterior frente a botón sin contexto: almacena la acción pendiente por sesión; en producción requeriría autenticación e identidad vinculada.

## 9. Supuestos

Los maestros son exhaustivos para la prueba; los seis paquetes de entrada son ejemplos ficticios; el mensaje “Aprobado” es válido como evidencia en el prototipo; una sola posición por solicitud cubre los casos; el SAP simulado es un adaptador local; los números de órdenes se asignan secuencialmente bajo ejecución simple.

## 10. Cobertura

| Historia | Estado | Pendiente para producción |
|---|---|---|
| HU1 Leer paquete | Hecho | Ingesta MIME, Excel y PDF |
| HU2 Controles | Hecho | Reglas vivas y dueños de políticas |
| HU3 Payload y trazabilidad | Hecho | Mapping real SAP |
| HU4 Evidencia TXT y PDF | Hecho | Firma digital / attachments SAP |
| HU5 Crear e idempotencia | Hecho | Transacciones distribuidas/multiproceso |
| HU6 Manejo de errores | Hecho para fixtures | Errores corporativos y retry granular |
| Front y sesión | Hecho | Identidad y persistencia multiusuario |
| Gemini real | Implementado; falta validación con clave | Integración verificada y observabilidad productiva |

## 11. Uso de IA para construir

Se utilizó **ChatGPT (GPT-6)** para examinar el PRD y fixtures, diseñar y generar código, crear herramientas, interfaz y documentación, y ejecutar pruebas automáticas mediante Remote Desktop Commander. Se verificaron las seis salidas del demo, sin dar por válidos resultados del modelo para tomar decisiones de compra. Se descartó el despliegue complejo con base externa porque el PRD exige archivos locales y disponibilidad durante la defensa, no un ERP ni infraestructura productiva.

## 12. Riesgos y mitigaciones

- Inyección desde cotización/correo → datos nunca instrucciones, ejecución fuera de texto LLM.
- Aprobaciones falsas → en producción validar identidad y firma de origen.
- Doble OC por concurrencia → índice único y transacción/lock distribuido.
- Exposición de API key → variable de entorno y límites/rate limiting por usuario.
- Pérdida de datos y caídas → reemplazar JSONL por persistencia transaccional.
- Códigos fiscales erróneos → validar contra maestro vigente y unidad tributaria.
- Política retroactiva incierta → decisión formal de la dirección antes de poner en producción.
