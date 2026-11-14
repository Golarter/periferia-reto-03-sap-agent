import {GoogleGenAI} from "@google/genai";
import {z} from "zod";
import {tools,readPackage,validate,buildPayload,create,type Context} from "../tools/oc.js";
export type AgentCall={name:string;args:unknown;result:unknown};
export async function runToolLoop(apiKey:string,modelName:string,prompt:string,userMessage:string,caso:string,ctx:Context):Promise<{reply:string;calls:AgentCall[]}>{
 const ai=new GoogleGenAI({apiKey}),declarations=Object.entries(tools).map(([name,tool])=>({name,description:tool.description,parametersJsonSchema:z.toJSONSchema(z.object(tool.args))}));
 const contents:Array<{role:string;parts:Array<Record<string,unknown>>}>=[{role:"user",parts:[{text:userMessage}]}];
 const calls:AgentCall[]=[];
 const timeout=AbortSignal.timeout(20000);
 for(let i=0;i<8;i++){
  const response=await ai.models.generateContent({model:modelName,contents,config:{systemInstruction:prompt,temperature:0.1,maxOutputTokens:900,tools:[{functionDeclarations:declarations}],abortSignal:timeout}});
  const functionCalls=response.functionCalls??[];
  const candidate=response.candidates?.[0]?.content;
  if(candidate?.parts)contents.push({role:"model",parts:candidate.parts as Array<Record<string,unknown>>});
  if(!functionCalls.length)return {reply:response.text?.trim()??"Análisis terminado con herramientas.",calls};
  const responses:Array<Record<string,unknown>>=[];
  for(const fc of functionCalls){
   const name=fc.name??"",args=fc.args??{},argCase=(args as {caso?:string}).caso;
   let data:unknown;
   if(argCase!==caso){data={ok:false,error:"Caso no autorizado para esta conversación"}}
   else{
    try{
     const pkg=await readPackage(caso,ctx),v=await validate(caso,pkg,ctx);
     if(name==="oc_leer_paquete")data=JSON.parse(await tools.oc_leer_paquete.execute({caso},ctx));
     else if(name==="oc_validar")data=JSON.parse(await tools.oc_validar.execute({caso,paquete:pkg},ctx));
     else if(name==="oc_construir_payload")data=JSON.parse(await tools.oc_construir_payload.execute({caso,paquete:pkg,derivados:v.derivados},ctx));
     else if(name==="oc_generar_evidencia")data=JSON.parse(await tools.oc_generar_evidencia.execute({caso},ctx));
     else if(name==="oc_crear")data={ok:false,error:"La creación está protegida por el orquestador. El modelo no puede aprobar ni ejecutar compras; la API de chat ya aplica RC1–RC10 y confirmación humana."};
     else data={ok:false,error:"Herramienta desconocida"};
    }catch(e){data={ok:false,error:String(e)}}
   }
   calls.push({name,args,result:data});responses.push({functionResponse:{name,response:{result:data}}});
  }
  contents.push({role:"user",parts:responses});
 }
 return {reply:"Se alcanzó el límite de iteraciones del modelo; consulta el resultado de los controles verificados.",calls};
}
