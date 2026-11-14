import assert from "node:assert/strict";
import {generar_evidencia} from "../src/tools/oc.js";
const ctx={directory:process.cwd(),sessionId:"security-regression"};
for(const caso of ["sol-002","sol-003"]){
 const result=JSON.parse(await generar_evidencia.execute({caso},ctx)) as {ok:boolean;error?:string};
 assert.equal(result.ok,false);
 assert.match(result.error??"",/bloqueos/);
 console.log("PASS",caso,"evidencia bloqueada");
}
