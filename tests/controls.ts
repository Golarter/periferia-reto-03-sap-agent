import assert from "node:assert/strict";
import {readPackage,validate} from "../src/tools/oc.js";
const ctx={directory:process.cwd(),sessionId:"unit"},source=await readPackage("sol-001",ctx);
const clone=()=>structuredClone(source);
async function expect(code:string,modify:(p:typeof source)=>void){
 const p=clone();modify(p);const r=await validate("sol-001",p,ctx);
 const codes=[...r.bloqueos,...r.confirmaciones].map(x=>x.codigo);
 assert.ok(codes.includes(code),`No se detectó ${code}: ${JSON.stringify(r)}`);
 console.log("PASS",code);
}
await expect("RC1",p=>{p.solicitud.proveedor_nit="999999999"});
await expect("RC2",p=>{p.aprobacion!.de="intruso@periferia-ficticia.com"});
await expect("RC3",p=>{p.solicitud.valor_total=60000000;p.solicitud.valor_unitario=500000});
await expect("RC4",p=>{p.solicitud.subarea="Subárea inexistente"});
await expect("RC5",p=>{p.cotizacion!.total=15000000});
await expect("RC6",p=>{delete p.solicitud.indicador_iva});
{
 const p=clone();delete p.solicitud.condiciones_pago;const r=await validate("sol-001",p,ctx);assert.equal(r.derivados.condiciones_pago,"Z030");console.log("PASS RC7");
}
await expect("RC8",p=>{p.factura={numero:"TEST",fecha:"2026-08-01",total:p.solicitud.valor_total}});
await expect("RC9",p=>{p.aprobacion!.fecha="2026-08-01T10:00:00-05:00"});
await expect("RC10",p=>{p.solicitud.cantidad=121});
console.log("10/10 controles probados con mutaciones");
