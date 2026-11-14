import "dotenv/config";
import express from "express";import cors from "cors";import fs from "node:fs/promises";import path from "node:path";
import {randomUUID} from "node:crypto";
import {readPackage,validate,buildPayload,create,recordDecision} from "./tools/oc.js";
import type {OrdenCompra} from "./sap/adapter.js";
import {GeminiAdapter} from "./llm/gemini.js";
import {runToolLoop} from "./llm/tool-loop.js";
const root=process.cwd(),app=express();app.use(cors());app.use(express.json({limit:"30kb"}));app.use(express.static(path.join(root,"web")));
const sessions=new Map<string,{history:Array<{role:"user"|"assistant";content:string}>;calls:Array<{name:string;args:unknown;result:unknown;ts:string}>;pending:{caso:string;payload:OrdenCompra}|null;turns:number;tokenBudget:number}>();
const model=process.env.GEMINI_API_KEY?new GeminiAdapter(process.env.GEMINI_API_KEY):null;
const maxTurns=Number(process.env.MAX_TOOL_ITERATIONS||16),maxSessionTokens=Number(process.env.MAX_SESSION_TOKENS||30000);
const basePrompt=await fs.readFile(path.join(root,"agent","prompt.md"),"utf8");
const knowledge=await fs.readFile(path.join(root,"src","knowledge","ordenes-compra.md"),"utf8");
const context={directory:root,sessionId:""};
// Límite de solicitudes para proteger la cuota gratuita de la API en el enlace público.
const quota=new Map<string,{start:number,count:number}>();
let globalQuota={start:Date.now(),count:0};
app.use("/api/chat",(req,res,next)=>{
 const now=Date.now(),ip=String(req.headers["cf-connecting-ip"]||req.ip||"unknown");
 const q=quota.get(ip)??{start:now,count:0};
 if(now-q.start>600000){q.start=now;q.count=0}
 if(now-globalQuota.start>86400000)globalQuota={start:now,count:0};
 if(q.count>=20||globalQuota.count>=250)return res.status(429).json({error:"Límite de solicitudes alcanzado. Reintenta más tarde."});
 q.count++;globalQuota.count++;quota.set(ip,q);
 if(quota.size>2000)for(const [key,v] of quota)if(now-v.start>600000)quota.delete(key);
 next();
});
type Call={name:string;args:unknown;result:unknown;ts:string};
app.get("/api/health",(_req,res)=>res.json({ok:true,provider:model?.provider||"sin-configurar",model:model?.model||null}));
app.get("/api/sessions/:id",(req,res)=>{const s=sessions.get(req.params.id);res.status(s?200:404).json(s??{error:"Sesión no encontrada"})});
app.get("/api/cases",(_req,res)=>res.json(["sol-001","sol-002","sol-003","sol-004","sol-005","sol-006"]));
app.post("/api/chat",async(req,res)=>{
 const id=typeof req.body.sessionId==="string"&&req.body.sessionId.length<100?req.body.sessionId:randomUUID();
 const message=String(req.body.message??"").slice(0,1500).trim();if(!message)return res.status(400).json({error:"Mensaje vacío"});
 const s=sessions.get(id)??{history:[],calls:[],pending:null,turns:0,tokenBudget:0};sessions.set(id,s);s.history.push({role:"user",content:message});
 if(s.turns>=maxTurns)return res.json({sessionId:id,reply:"Límite de turnos alcanzado. Abre una sesión nueva.",toolCalls:[],needsConfirmation:false});
 s.turns++;s.tokenBudget+=message.length/4;if(s.tokenBudget>maxSessionTokens)return res.status(429).json({error:"Presupuesto de tokens de la sesión agotado"});
 const toolCalls:Call[]=[],record=(name:string,args:unknown,result:unknown)=>{const call={name,args,result,ts:new Date().toISOString()};toolCalls.push(call);s.calls.push(call);return call};
 const log=async()=>{await fs.mkdir(path.join(root,"out"),{recursive:true});await fs.appendFile(path.join(root,"out","log.jsonl"),toolCalls.map(x=>JSON.stringify({sessionId:id,...x})+"\n").join(""))};
 let reply="",needsConfirmation=false,caseName="";
 try{
  const confirmation=/^(s[ií]|confirmo|confirmado|autorizo|proceder|apruebo|de acuerdo|ok)[.!\s]*$/i.test(message);
  if(s.pending&&confirmation){
   const {caso,payload}=s.pending;const result=await create(caso,payload,true,{...context,sessionId:id},id);
   record("oc_crear",{caso,confirmado:true},result);s.pending=null;reply=`Orden de compra ${result.numero_oc} ${result.idempotente?"ya existente (idempotente)":"creada correctamente"} en SAP simulado. Evidencia y trazabilidad disponibles en out/${caso}/.`;
  }else if(s.pending&&/^(no|rechazo|cancelar|cancelo)/i.test(message)){
   s.pending=null;reply="Operación cancelada. No se creó ninguna orden de compra.";
  }else{
   const match=message.match(/sol-00[1-6]/i);caseName=match?.[0]?.toLowerCase()??"";
   if(!caseName){reply="Indica el caso que quieres procesar (sol-001 a sol-006). Puedes seleccionar uno de los casos de ejemplo. Para las excepciones, confirmarás en el siguiente mensaje.";if(s.pending)reply+=" Tienes una confirmación pendiente; escribe «confirmo» o «cancelar»."}
   else{
    s.pending=null;
    const ctx={...context,sessionId:id},paquete=await readPackage(caseName,ctx);record("oc_leer_paquete",{caso:caseName},{correo:paquete.correo,solicitud:paquete.solicitud,cotizacion:paquete.cotizacion?{total:paquete.cotizacion.total,referencia:paquete.cotizacion.referencia}:null,aprobacion:paquete.aprobacion,factura:paquete.factura});
    const v=await validate(caseName,paquete,ctx);record("oc_validar",{caso:caseName},{...v,derivados:v.derivados});
    if(v.bloqueos.length){
     await recordDecision(caseName,v,ctx,"bloqueada");
     reply="La solicitud "+caseName+" NO puede generar una OC. Bloqueos:\n"+v.bloqueos.map(x=>`• ${x.codigo}: ${x.detalle}. Acción: ${x.accion}`).join("\n");
    }else{
     const built=await buildPayload(caseName,paquete,v.derivados,ctx);record("oc_construir_payload",{caso:caseName},{payload:built.payload,trazabilidad:built.trazabilidad});
     const evidence={ruta:`out/${caseName}/aprobacion.txt`,sha256:built.payload.aprobador.evidencia_sha256};
     record("oc_generar_evidencia",{caso:caseName},evidence);
     const s0=paquete.solicitud;
     reply=`Solicitud ${s0.solicitud_id} · ${s0.proveedor_nombre}\nCentro: ${s0.centro_costo} / ${s0.subarea}\nMonto: ${s0.valor_total.toLocaleString("es-CO")} ${s0.moneda}\nPosición SAP: ${built.payload.posiciones[0].descripcion}\nIVA: ${built.payload.posiciones[0].indicador_iva}; pago: ${built.payload.condiciones_pago}\nEvidencia: ${evidence.ruta}\n`;
     if(v.confirmaciones.length){
      s.pending={caso:caseName,payload:built.payload};needsConfirmation=true;await recordDecision(caseName,v,ctx,"pendiente_confirmacion");
      reply+="\nATENCIÓN: se requiere confirmación humana:\n"+v.confirmaciones.map(x=>`• ${x.codigo}: ${x.detalle}`).join("\n")+"\n\n¿Confirmas expresamente la creación de esta OC? Escribe «confirmo» o «cancelar».";
     }else{
      const result=await create(caseName,built.payload,false,ctx,id);record("oc_crear",{caso:caseName,confirmado:false},result);
      reply+=`\nOC ${result.numero_oc} ${result.idempotente?"existente (idempotencia)":"creada"} en SAP simulado.`;
     }
    }
   }
  }
  if(model&&caseName){
   try{
    const agent=await runToolLoop(model,basePrompt+"\n"+knowledge+"\nResultado VERIFICADO del orquestador (no modificar):\n"+reply,message,caseName,{...context,sessionId:id});
    for(const call of agent.calls)record(call.name,call.args,call.result);
    if(agent.reply&&agent.reply.length>20)reply+="\n\nAnálisis del agente Gemini:\n"+agent.reply;
   }catch(e){reply+="\n\nAviso: no fue posible completar el ciclo del modelo ("+(e instanceof Error?e.message:"error") + "). Se conserva el resultado determinista."}
  }
  s.history.push({role:"assistant",content:reply});await log();
  res.json({sessionId:id,reply,toolCalls,needsConfirmation,pendingCase:s.pending?.caso??null,provider:model?.provider??"sin-configurar"});
 }catch(e){
  reply="No se pudo procesar la solicitud: "+(e instanceof Error?e.message:String(e));s.history.push({role:"assistant",content:reply});await log();res.status(200).json({sessionId:id,reply,toolCalls,needsConfirmation:false,error:true});
 }
});
app.use((_req,res)=>res.sendFile(path.join(root,"web","index.html")));
const port=Number(process.env.PORT||3000);app.listen(port,()=>console.log(`Reto 03: http://localhost:${port} | LLM: ${model?.model??"sin clave"}`));
