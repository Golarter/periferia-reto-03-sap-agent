import {GoogleGenAI,FunctionCallingConfigMode,type Content} from "@google/genai";
import type {LlmAdapter,LlmResponse,AgentMessage,ToolDefinition} from "./adapter.js";
export class GeminiAdapter implements LlmAdapter{
 readonly provider="google";
 readonly model=process.env.GEMINI_MODEL||"gemini-3.5-flash-lite";
 private client:GoogleGenAI;
 constructor(key:string){this.client=new GoogleGenAI({apiKey:key})}
 async enviar(input:{messages:AgentMessage[];tools:ToolDefinition[];systemPrompt:string;forceTool:boolean;signal:AbortSignal}):Promise<LlmResponse>{
  const response=await this.client.models.generateContent({
   model:this.model,
   contents:input.messages as unknown as Content[],
   config:{
    systemInstruction:input.systemPrompt,
    temperature:0.1,maxOutputTokens:900,
    tools:[{functionDeclarations:input.tools.map(x=>({name:x.name,description:x.description,parametersJsonSchema:x.parametersJsonSchema}))}],
    toolConfig:{functionCallingConfig:input.forceTool?
     {mode:FunctionCallingConfigMode.ANY,allowedFunctionNames:["oc_leer_paquete","oc_validar","oc_construir_payload","oc_generar_evidencia"]}:
     {mode:FunctionCallingConfigMode.AUTO}},
    abortSignal:input.signal
   }
  });
  return {text:response.text?.trim()??"",parts:(response.candidates?.[0]?.content?.parts??[]) as unknown as Array<Record<string,unknown>>,
   calls:(response.functionCalls??[]).map(fc=>({name:fc.name??"",args:(fc.args??{}) as Record<string,unknown>,id:fc.id}))};
 }
}
