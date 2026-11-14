import fs from "node:fs/promises";
import path from "node:path";
import {readPackage,validate,buildPayload,create,recordDecision} from "./src/tools/oc.js";
const directory=process.cwd(),ctx={directory,sessionId:"demo"};
async function main(){
 await fs.rm(path.join(directory,"out"),{recursive:true,force:true});
 let passed=0;
 for(let i=1;i<=6;i++){
  const caso=`sol-${String(i).padStart(3,"0")}`;
  try{
   const paquete=await readPackage(caso,ctx),v=await validate(caso,paquete,ctx);
   let numero="",reason="";
   if(v.apta){
    const {payload}=await buildPayload(caso,paquete,v.derivados,ctx);
    if(v.confirmaciones.length){
     try{await create(caso,payload,false,ctx);throw new Error("FALLÓ: creación sin confirmación")}catch(e){if(String(e).includes("FALLÓ"))throw e}
    }
    const result=await create(caso,payload,v.confirmaciones.length>0,ctx);
    numero=result.numero_oc;
    if(i===1){
     const retry=await create(caso,payload,false,ctx);
     if(!retry.idempotente||retry.numero_oc!==numero)throw new Error("Idempotencia falló");
    }
   }else{
    await recordDecision(caso,v,ctx,"bloqueada");
    reason=v.bloqueos.map(x=>x.codigo).join(",");
   }
   const expected=i===2||i===3?!v.apta:i===1?v.apta&&!v.confirmaciones.length&&!!numero:v.apta&&v.confirmaciones.length>0&&!!numero;
   if(!expected)throw new Error("Resultado distinto del esperado");
   passed++;
   console.log(JSON.stringify({caso,apta:v.apta,bloqueos:v.bloqueos,confirmaciones:v.confirmaciones,retroactiva:v.retroactiva,numero_oc:numero||null,motivo:reason||null,resultado:"PASS"}));
  }catch(e){console.error(JSON.stringify({caso,resultado:"FAIL",error:String(e)}))}
 }
 console.log(`RESULTADO: ${passed}/6 casos aprobados`);
 if(passed!==6)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
