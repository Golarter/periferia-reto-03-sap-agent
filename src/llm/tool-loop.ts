import {z} from "zod";
import type {LlmAdapter,AgentMessage,ToolDefinition} from "./adapter.js";
import {tools,readPackage,validate,type Context} from "../tools/oc.js";
export type AgentCall={name:string;args:unknown;result:unknown};
export async function runToolLoop(adapter:LlmAdapter,prompt:string,userMessage:string,caso:string,ctx:Context):Promise<{reply:string;calls:AgentCall[]}>{
 const definitions:ToolDefinition[]=Object.entries(tools).map(([name,tool])=>({name,description:tool.description,parametersJsonSchema:z.toJSONSchema(z.object(tool.args)) as Record<string,unknown>}));
 const messages:AgentMessage[]=[{role:"user",parts:[{text:userMessage}]}];
 const calls:AgentCall[]=[];
 const timeout=AbortSignal.timeout(30000);
 for(let i=0;i<8;i++){
  const response=await adapter.enviar({messages,tools:definitions,systemPrompt:prompt,forceTool:i===0,signal:timeout});
  if(response.parts.length)messages.push({role:"model",parts:response.parts});
  if(!response.calls.length)return {reply:response.text||"Análisis terminado con herramientas.",calls};
  const results:Array<Record<string,unknown>>=[];
  for(const fc of response.calls){
   const name=fc.name,args=fc.args??{},argCase=(args as {caso?:string}).caso;
   const definition=Object.entries(tools).find(([toolName])=>toolName===name)?.[1];
   const valid=definition?z.object(definition.args as Record<string,z.ZodTypeAny>).safeParse(args):null;
   let data:unknown;
   if(!definition)data={ok:false,error:"Herramienta desconocida"};
   else if(!valid?.success)data={ok:false,error:"Argumentos inválidos",details:valid?.error.issues};
   else if(argCase!==caso)data={ok:false,error:"El modelo intentó cambiar de solicitud"};
   else{
    try{
     const pkg=await readPackage(caso,ctx),v=await validate(caso,pkg,ctx);
     if(name==="oc_leer_paquete")data=JSON.parse(await tools.oc_leer_paquete.execute({caso},ctx));
     else if(name==="oc_validar")data=JSON.parse(await tools.oc_validar.execute({caso,paquete:pkg},ctx));
     else if(name==="oc_construir_payload")data=JSON.parse(await tools.oc_construir_payload.execute({caso,paquete:pkg,derivados:v.derivados},ctx));
     else if(name==="oc_generar_evidencia")data=JSON.parse(await tools.oc_generar_evidencia.execute({caso},ctx));
     else if(name==="oc_crear")data={ok:false,error:"Creación exclusiva del orquestador tras controles y confirmación humana"};
     else data={ok:false,error:"Herramienta desconocida"};
    }catch(e){data={ok:false,error:String(e)}
    }
   }
   calls.push({name,args,result:data});
   results.push({functionResponse:{name,response:{result:data},...(fc.id?{id:fc.id}:{})}});
  }
  messages.push({role:"user",parts:results});
 }
 return {reply:"Límite de ocho iteraciones; se conserva el resultado determinista.",calls};
}
