import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import {SapMock} from "../src/sap/mock.js";
import {readPackage,validate,buildPayload} from "../src/tools/oc.js";
const ctx={directory:process.cwd(),sessionId:"concurrency-test"};
const pkg=await readPackage("sol-001",ctx);
const checks=await validate("sol-001",pkg,ctx);
const {payload}=await buildPayload("sol-001",pkg,checks.derivados,ctx);
const directory=await fs.mkdtemp(path.join(os.tmpdir(),"periferia-sap-test-"));
try{
 const sap=new SapMock(directory);
 const results=await Promise.all(Array.from({length:12},()=>sap.crearOrden(payload)));
 assert.equal(new Set(results.map(x=>x.numero_oc)).size,1);
 assert.equal(results[0].numero_oc,"4500000001");
 const lines=(await fs.readFile(path.join(directory,"out","sap","ordenes.jsonl"),"utf8")).trim().split("\n");
 assert.equal(lines.length,1);
 console.log("PASS concurrency: 12 solicitudes simultáneas -> una sola OC 4500000001");
}finally{await fs.rm(directory,{recursive:true,force:true})}
