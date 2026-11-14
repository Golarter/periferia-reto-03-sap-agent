import fs from "node:fs/promises";
const agent=await fs.readFile("agent/prompt.md","utf8");
const knowledge=await fs.readFile("src/knowledge/ordenes-compra.md","utf8");
await fs.writeFile("modulo/agent.md",`---
description: Agente SAP de órdenes de compra con validaciones RC1-RC10
mode: primary
permission:
  edit: deny
  bash: deny
---
${agent}`);
await fs.writeFile("modulo/skill/ordenes-compra/SKILL.md",`---
name: ordenes-compra
description: Conocimiento de validación y creación controlada de órdenes de compra SAP
---
${knowledge}`);
console.log("Módulo sincronizado con prompt y conocimiento canónicos");
