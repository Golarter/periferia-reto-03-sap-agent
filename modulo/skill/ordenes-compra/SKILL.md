---
name: ordenes-compra
description: Conocimiento de validación y creación controlada de órdenes de compra SAP
---
# Proceso de órdenes de compra
El flujo normal es solicitud y cotización, validación de proveedor, aprobador y centro de costo, generación de evidencia y creación de OC simulada.
Los controles RC1-RC4 y RC10 son bloqueantes. RC5, RC6, RC8 y RC9 exigen confirmación humana explícita. RC7 genera únicamente un dato derivado informado al usuario.
Las órdenes retroactivas son aquellas cuya factura tiene fecha anterior a la solicitud: deben registrarse, medirse y no tratarse como compras normales.
Las fuentes de verdad son los fixtures de entrada y maestros; SAP simulado asigna numeración secuencial y evita duplicados por solicitud_id.
