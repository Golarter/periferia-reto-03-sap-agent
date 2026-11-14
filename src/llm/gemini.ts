import {GoogleGenAI} from "@google/genai";import type {LlmAdapter} from "./adapter.js";
export class GeminiAdapter implements LlmAdapter{
 readonly provider="google";readonly model=process.env.GEMINI_MODEL||"gemini-2.5-flash";
 private client:GoogleGenAI;
 constructor(key:string){this.client=new GoogleGenAI({apiKey:key})}
 async summarize(prompt:string,user:string,context:string){
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
  try{
   const result=await this.client.models.generateContent({model:this.model,contents:[{role:"user",parts:[{text:"Mensaje: "+user+"\n\nResultados REALES de herramientas (no modificar datos):\n"+context}]}],config:{systemInstruction:prompt,temperature:0.1,maxOutputTokens:800,abortSignal:controller.signal}});
   return result.text?.trim()||"El modelo no devolvió texto.";
  }finally{clearTimeout(timeout)}
 }
}
