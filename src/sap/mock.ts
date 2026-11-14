import fs from "node:fs/promises";import path from "node:path";import type {SapAdapter,OrdenCompra} from "./adapter.js";
export class SapMock implements SapAdapter{
 constructor(private directory:string){}
 private get file(){return path.join(this.directory,"out","sap","ordenes.jsonl")}
 private async orders():Promise<Array<{numero_oc:string;fecha:string;orden:OrdenCompra}>>{
 try{return (await fs.readFile(this.file,"utf8")).trim().split("\n").filter(Boolean).map(s=>JSON.parse(s) as {numero_oc:string;fecha:string;orden:OrdenCompra})}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return [];throw e}
 }
 async consultarProveedor(nit:string){const list=JSON.parse(await fs.readFile(path.join(this.directory,"fixtures/reto-03/maestros/proveedores.json"),"utf8")) as Array<{nit:string;codigo_sap:string;activo:boolean}>;const p=list.find(x=>x.nit===nit);return p?{codigo_sap:p.codigo_sap,activo:p.activo}:null}
 async buscarOrdenPorReferencia(id:string){const row=(await this.orders()).find(x=>x.orden.referencia.solicitud_id===id);return row?{numero_oc:row.numero_oc}:null}
 async crearOrden(orden:OrdenCompra){const all=await this.orders();const found=all.find(x=>x.orden.referencia.solicitud_id===orden.referencia.solicitud_id);if(found)return {numero_oc:found.numero_oc,fecha:found.fecha};const next=String(4500000001+all.length);const fecha=new Date().toISOString();await fs.mkdir(path.dirname(this.file),{recursive:true});await fs.appendFile(this.file,JSON.stringify({numero_oc:next,fecha,orden})+"\n");return {numero_oc:next,fecha}}
}
