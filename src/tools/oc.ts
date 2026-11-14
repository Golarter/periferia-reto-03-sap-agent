import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {z} from "zod";
import {OrdenSchema, type OrdenCompra} from "../sap/adapter.js";
import {SapMock} from "../sap/mock.js";
import {createEvidencePdf} from "../evidence/pdf.js";
export type Context={directory:string;sessionId:string};
type Solicitud={solicitud_id:string;solicitante:string;proveedor_nombre:string;proveedor_nit?:string;descripcion:string;centro_costo:string;subarea:string;cantidad:number;valor_unitario:number;valor_total:number;moneda:"COP"|"USD";indicador_iva?:string;condiciones_pago?:string;fecha_solicitud:string};
type Paquete={correo:{id:string;de:string;asunto:string;fecha:string};solicitud:Solicitud;cotizacion:{proveedor:string;nit:string|null;total:number;moneda:string;validez_hasta:string|null;texto:string;referencia:string|null}|null;aprobacion:{de:string;fecha:string;aprobado:boolean;texto:string}|null;factura:{numero:string;fecha:string;total:number}|null;faltantes:string[]};
type Validation={apta:boolean;bloqueos:Array<{codigo:string;detalle:string;accion:string}>;confirmaciones:Array<{codigo:string;detalle:string}>;derivados:Record<string,string>;retroactiva:boolean};
const ok=(data:unknown)=>JSON.stringify({ok:true,data});
const error=(e:unknown)=>JSON.stringify({ok:false,error:e instanceof Error?e.message:String(e)});
const absCase=(caso:string,ctx:Context)=>path.join(ctx.directory,"fixtures","reto-03","solicitudes",caso);
const master=async<T>(name:string,ctx:Context):Promise<T>=>JSON.parse(await fs.readFile(path.join(ctx.directory,"fixtures","reto-03","maestros",name+".json"),"utf8")) as T;
const json=async<T>(file:string)=>JSON.parse(await fs.readFile(file,"utf8")) as T;
const digits=(v:string)=>v.replace(/[^0-9]/g,"");
const normalized=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const optional=async(file:string)=>{try{return await fs.readFile(file,"utf8")}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e}};
const run=async<T>(fn:()=>Promise<T>)=>{try{return ok(await fn())}catch(e){return error(e)}};
const caseSchema=z.string().regex(/^sol-00[1-6]$/).describe("Carpeta del caso sol-001 a sol-006");
const numeric=(s:string)=>Number(s.replace(/[^\d]/g,""));
export async function readPackage(caso:string,ctx:Context):Promise<Paquete>{
 const dir=absCase(caso,ctx), missing:string[]=[];
 const correo=await json<{id:string;de:string;asunto:string;fecha:string}>(path.join(dir,"correo.json"));
 const solicitud=await json<Solicitud>(path.join(dir,"solicitud.json"));
 const rawCot=await optional(path.join(dir,"cotizacion.txt")),rawApp=await optional(path.join(dir,"aprobacion.json")),rawInv=await optional(path.join(dir,"factura.txt"));
 if(!rawCot)missing.push("cotizacion.txt");if(!rawApp)missing.push("aprobacion.json");
 const m=rawCot?.match(/TOTAL\s*\(IVA incluido\)\s*:\s*(COP|USD)\s*([\d.,]+)/i);
 const quoteRef=rawCot?.match(/COTIZACI[ÓO]N\s+([^\r\n]+)/i)?.[1]?.trim()??null;
 const cotizacion=rawCot?{proveedor:rawCot.match(/Proveedor:\s*([^\r\n]+)/i)?.[1]?.trim()??"",nit:rawCot.match(/NIT:\s*([\d.\-]+)/i)?.[1]?digits(rawCot.match(/NIT:\s*([\d.\-]+)/i)![1]).slice(0,9):null,total:m?numeric(m[2]):Number.NaN,moneda:m?.[1]??"COP",validez_hasta:null,texto:rawCot,referencia:quoteRef}:null;
 const ap=rawApp?JSON.parse(rawApp) as {de:string;fecha:string;cuerpo:string}:null;
 const aprobacion=ap?{de:ap.de,fecha:ap.fecha,aprobado:/\baprobado\b/i.test(ap.cuerpo),texto:ap.cuerpo}:null;
 const invDate=rawInv?.match(/Fecha de emisi[oó]n:\s*(\d{4}-\d\d-\d\d)/i)?.[1];
 const factura=rawInv?{numero:rawInv.match(/No\.\s*([^\r\n]+)/i)?.[1]??"",fecha:invDate??"",total:numeric(rawInv.match(/TOTAL:\s*(?:COP|USD)\s*([\d.,]+)/i)?.[1]??"0")}:null;
 if(!Number.isFinite(solicitud.valor_total)||!Number.isFinite(solicitud.valor_unitario)||!Number.isFinite(solicitud.cantidad))throw new Error("Los montos o cantidades deben ser numéricos");
 return {correo:{id:correo.id,de:correo.de,asunto:correo.asunto,fecha:correo.fecha},solicitud,cotizacion,aprobacion,factura,faltantes:missing};
}
export async function validate(caso:string,paquete:Paquete,ctx:Context):Promise<Validation>{
 if(!/^sol-00[1-6]$/.test(caso))throw new Error("Caso inválido");
 const s=paquete.solicitud;const bloqueos:Validation["bloqueos"]=[],confirmaciones:Validation["confirmaciones"]=[],derivados:Record<string,string>={};
 const providers=await master<Array<{codigo_sap:string;nit:string;nombre:string;activo:boolean;indicador_iva_default:string;condiciones_pago_default:string}>>("proveedores",ctx);
 const centers=await master<Array<{centro_costo:string;subareas:string[];aprobadores:Array<{email:string;tope:number}>}>>("centros-costo",ctx);
 const taxes=await master<Array<{codigo:string}>>("indicadores-iva",ctx),payments=await master<Array<{codigo:string}>>("condiciones-pago",ctx);
 const p=providers.find(v=>s.proveedor_nit?digits(v.nit)===digits(s.proveedor_nit):normalized(v.nombre)===normalized(s.proveedor_nombre));
 const cc=centers.find(c=>c.centro_costo===s.centro_costo);
 const approver=cc?.aprobadores.find(a=>a.email.toLowerCase()===paquete.aprobacion?.de?.toLowerCase());
 const block=(codigo:string,detalle:string,accion:string)=>bloqueos.push({codigo,detalle,accion});
 const confirm=(codigo:string,detalle:string)=>confirmaciones.push({codigo,detalle});
 if(!p||!p.activo)block("RC1","El proveedor no existe en maestros o está inactivo","Solicitar alta o reactivación del proveedor");
 if(!paquete.aprobacion?.aprobado||!approver)block("RC2","Falta aprobación válida de un aprobador autorizado para este centro","Solicitar aprobación al líder autorizado");
 if(approver&&s.valor_total>approver.tope)block("RC3",`El monto ${s.valor_total} supera el tope ${approver.tope} del aprobador`,"Escalar a un aprobador con autoridad suficiente");
 if(!cc||!cc.subareas.includes(s.subarea))block("RC4","La subárea no pertenece al centro de costo","Corregir centro y subárea");
 if(!paquete.cotizacion)confirm("RC5","No existe cotización; validar excepción antes de continuar");
 else if(!Number.isFinite(paquete.cotizacion.total)||s.valor_total<=0)block("RC5","Cotización o solicitud con total inválido","Corregir documento");
 else if(Math.abs(paquete.cotizacion.total-s.valor_total)/s.valor_total>0.02)confirm("RC5",`Solicitud: ${s.valor_total} ${s.moneda}; cotización: ${paquete.cotizacion.total} ${paquete.cotizacion.moneda}; diferencia ${((paquete.cotizacion.total-s.valor_total)/s.valor_total*100).toFixed(2)}%`);
 if(!s.indicador_iva){if(p){derivados.indicador_iva=p.indicador_iva_default;confirm("RC6",`IVA ausente: se propone código ${p.indicador_iva_default} del maestro del proveedor`)}else block("RC6","Sin proveedor no es posible derivar IVA","Regularizar proveedor")}
 if(!s.condiciones_pago&&p)derivados.condiciones_pago=p.condiciones_pago_default;
 const retroactiva=Boolean(paquete.factura?.fecha&&paquete.factura.fecha<s.fecha_solicitud);
 if(retroactiva)confirm("RC8",`Factura ${paquete.factura?.numero} emitida ${paquete.factura?.fecha}, antes de solicitud ${s.fecha_solicitud}: OC retroactiva`);
 if(paquete.aprobacion&&paquete.aprobacion.fecha.slice(0,10)<s.fecha_solicitud)confirm("RC9",`La aprobación ${paquete.aprobacion.fecha} antecede a la solicitud ${s.fecha_solicitud}`);
 if(!Number.isFinite(s.cantidad*s.valor_unitario)||Math.abs(s.cantidad*s.valor_unitario-s.valor_total)>1)block("RC10",`Cantidad × unitario = ${s.cantidad*s.valor_unitario}, total declarado = ${s.valor_total}`,"Corregir la solicitud; el agente no altera montos");
 if((s.indicador_iva||derivados.indicador_iva)&&!taxes.some(x=>x.codigo===(s.indicador_iva||derivados.indicador_iva)))block("IVA","Código IVA inexistente","Revisar indicador");
 if((s.condiciones_pago||derivados.condiciones_pago)&&!payments.some(x=>x.codigo===(s.condiciones_pago||derivados.condiciones_pago)))block("PAGO","Código de pago inexistente","Revisar condiciones");
 return {apta:bloqueos.length===0,bloqueos,confirmaciones,derivados,retroactiva};
}
async function shaEvidence(caso:string,ctx:Context){
 const app=await json<{de:string;para:string;fecha:string;asunto:string;cuerpo:string}>(path.join(absCase(caso,ctx),"aprobacion.json"));
 const content=`De: ${app.de}\nPara: ${app.para}\nFecha: ${app.fecha}\nAsunto: ${app.asunto}\n\n${app.cuerpo}\n`;
 const hash=crypto.createHash("sha256").update(content).digest("hex");const file=path.join(ctx.directory,"out",caso,"aprobacion.txt");
 await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content+`\nSHA256: ${hash}\n`);await createEvidencePdf(content,hash,path.join(path.dirname(file),"aprobacion.pdf"));return {ruta:path.relative(ctx.directory,file).replaceAll("\\","/"),pdf:path.relative(ctx.directory,path.join(path.dirname(file),"aprobacion.pdf")).replaceAll("\\","/"),sha256:hash};
}
export async function buildPayload(caso:string,paquete:Paquete,derivados:Record<string,string>,ctx:Context):Promise<{payload:OrdenCompra;trazabilidad:string}>{
 const valid=await validate(caso,paquete,ctx);if(!valid.apta)throw new Error("No se construye payload con bloqueos: "+valid.bloqueos.map(x=>x.codigo).join(","));
 const s=paquete.solicitud;const providers=await master<Array<{codigo_sap:string;nit:string;nombre:string}>>("proveedores",ctx);
 const provider=providers.find(x=>s.proveedor_nit?digits(x.nit)===digits(s.proveedor_nit):normalized(x.nombre)===normalized(s.proveedor_nombre));if(!provider)throw new Error("Proveedor no existe");
 const ev=await shaEvidence(caso,ctx);
 const payload=OrdenSchema.parse({referencia:{solicitud_id:s.solicitud_id,correo_id:paquete.correo.id,cotizacion_ref:paquete.cotizacion?.referencia??null},sociedad:"1000",organizacion_compras:"1000",proveedor:{codigo_sap:provider.codigo_sap,nit:provider.nit,nombre:provider.nombre},moneda:s.moneda,condiciones_pago:s.condiciones_pago??derivados.condiciones_pago,aprobador:{email:paquete.aprobacion?.de,fecha_aprobacion:paquete.aprobacion?.fecha,evidencia_sha256:ev.sha256},posiciones:[{numero:10,descripcion:s.descripcion.slice(0,40),cantidad:s.cantidad,unidad:"UN",precio_unitario:s.valor_unitario,centro_costo:s.centro_costo,subarea:s.subarea,indicador_iva:s.indicador_iva??derivados.indicador_iva}],excepciones:valid.confirmaciones.map(x=>({codigo:x.codigo,detalle:x.detalle,confirmado_por:null}))});
 const source={referencia:"solicitud + correo + cotizacion",proveedor:"maestro.proveedores",condiciones_pago:s.condiciones_pago?"solicitud":"derivado.maestro.proveedores",aprobador:"aprobacion",posiciones:{descripcion:"solicitud",cantidad:"solicitud",precio_unitario:"solicitud",centro_costo:"solicitud",subarea:"solicitud",indicador_iva:s.indicador_iva?"solicitud":"derivado.maestro.proveedores"},excepciones:"validacion"};
 const file=path.join(ctx.directory,"out",caso,"trazabilidad.json");await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify({payload,fuentes:source},null,2));return {payload,trazabilidad:path.relative(ctx.directory,file).replaceAll("\\","/")};
}
async function logAttempt(ctx:Context,id:string,resultado:string,oc:string,validation:Validation){const dir=path.join(ctx.directory,"out");await fs.mkdir(dir,{recursive:true});const file=path.join(dir,"control.csv");const hdr="solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n";try{await fs.access(file)}catch{await fs.writeFile(file,hdr)}const csv=(v:string)=>'"'+v.replaceAll('"','""')+'"';await fs.appendFile(file,[id,resultado,oc,String(validation.retroactiva),csv(validation.bloqueos.map(x=>x.codigo).join("|")),csv(validation.confirmaciones.map(x=>x.codigo).join("|")),new Date().toISOString()].join(",")+"\n")}
export async function create(caso:string,payload:OrdenCompra,confirmado:boolean,ctx:Context,confirmedBy:string|null="humano"):Promise<{numero_oc:string;fecha:string;idempotente:boolean}>{
 const paquete=await readPackage(caso,ctx),v=await validate(caso,paquete,ctx);
 if(payload.referencia.solicitud_id!==paquete.solicitud.solicitud_id)throw new Error("Referencia no coincide con el caso");
 if(!v.apta){await logAttempt(ctx,paquete.solicitud.solicitud_id,"bloqueada","",v);throw new Error("Bloqueos: "+v.bloqueos.map(x=>x.codigo+" "+x.detalle).join("; "))}
 const canonical=(await buildPayload(caso,paquete,v.derivados,ctx)).payload;
 if(JSON.stringify({...canonical,excepciones:[]})!==JSON.stringify({...payload,excepciones:[]}))throw new Error("Payload alterado: debe coincidir con las fuentes de verdad");
 if(v.confirmaciones.length&&!confirmado){await logAttempt(ctx,paquete.solicitud.solicitud_id,"pendiente_confirmacion","",v);throw new Error("Se requiere confirmación humana explícita: "+v.confirmaciones.map(x=>x.detalle).join("; "))}
 const sap=new SapMock(ctx.directory),old=await sap.buscarOrdenPorReferencia(paquete.solicitud.solicitud_id);
 const orden={...canonical,excepciones:canonical.excepciones.map(x=>({...x,confirmado_por:confirmado?confirmedBy:null}))};
 const result=await sap.crearOrden(orden);await logAttempt(ctx,paquete.solicitud.solicitud_id,old?"idempotente":"creada",result.numero_oc,v);return {...result,idempotente:!!old};
}
export async function recordDecision(caso:string,validation:Validation,ctx:Context,status:"bloqueada"|"pendiente_confirmacion"){const pkg=await readPackage(caso,ctx);await logAttempt(ctx,pkg.solicitud.solicitud_id,status,"",validation)}
export const leer_paquete={description:"Lee y normaliza el correo, solicitud, cotización, aprobación y factura opcional de un caso.",args:{caso:caseSchema},execute:async(a:{caso:string},ctx:Context)=>run(()=>readPackage(a.caso,ctx))};
export const validar={description:"Aplica todos los controles RC1 a RC10 usando maestros de referencia.",args:{caso:caseSchema,paquete:z.unknown().describe("Paquete obtenido de oc_leer_paquete")},execute:async(a:{caso:string;paquete:unknown},ctx:Context)=>run(()=>validate(a.caso,a.paquete as Paquete,ctx))};
export const construir_payload={description:"Construye una orden validada contra esquema SAP y conserva trazabilidad de sus fuentes.",args:{caso:caseSchema,paquete:z.unknown().describe("Paquete normalizado"),derivados:z.record(z.string(),z.string()).describe("Derivados devueltos por oc_validar")},execute:async(a:{caso:string;paquete:unknown;derivados:Record<string,string>},ctx:Context)=>run(()=>buildPayload(a.caso,a.paquete as Paquete,a.derivados,ctx))};
export const generar_evidencia={description:"Guarda la aprobación como TXT con encabezados y hash SHA-256.",args:{caso:caseSchema},execute:async(a:{caso:string},ctx:Context)=>run(()=>shaEvidence(a.caso,ctx))};
export const crear={description:"Crea una OC en SAP simulado, con bloqueo y confirmación humana previa, auditoría e idempotencia.",args:{caso:caseSchema,payload:OrdenSchema.describe("Payload validado"),confirmado:z.boolean().optional().describe("Aprobación humana explícita del turno posterior")},execute:async(a:{caso:string;payload:OrdenCompra;confirmado?:boolean},ctx:Context)=>run(()=>create(a.caso,a.payload,a.confirmado===true,ctx))};
export const tools={oc_leer_paquete:leer_paquete,oc_validar:validar,oc_construir_payload:construir_payload,oc_generar_evidencia:generar_evidencia,oc_crear:crear};
