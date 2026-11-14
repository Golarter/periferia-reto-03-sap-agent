import fs from "node:fs/promises";
import {PDFDocument,StandardFonts,rgb} from "pdf-lib";
export async function createEvidencePdf(content:string,hash:string,file:string){
 const pdf=await PDFDocument.create(),page=pdf.addPage([595.28,841.89]),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const width=page.getWidth(),margin=55;let y=width+190;
 page.drawRectangle({x:0,y:780,width:595,height:62,color:rgb(0.07,0.16,0.34)});
 page.drawText("PERIFERIA | EVIDENCIA DE APROBACION",{x:margin,y:804,font:bold,size:15,color:rgb(1,1,1)});
 y=750;
 const raw=[...content.split(/\r?\n/),"","SHA256: "+hash];
 const safe=(s:string)=>s.replace(/[\u2013\u2014]/g,"-").replace(/[\u201c\u201d]/g,'"').replace(/[^\x20-\x7e\u00a1-\u00ff]/g,"");
 for(const line of raw){
  const strong=/^(De:|Para:|Fecha:|Asunto:|SHA256:)/.test(line);
  const selected=strong?bold:font;const size=strong?10:11;
  const words=safe(line).split(/\s+/);let current="";
  const pieces:string[]=[];
  for(const word of words){const next=current?current+" "+word:word;if(selected.widthOfTextAtSize(next,size)>width-2*margin&&current){pieces.push(current);current=word}else current=next}pieces.push(current);
  for(const t of pieces){if(y<65)throw new Error("Evidencia demasiado extensa para una página");if(t)page.drawText(t,{x:margin,y,font:selected,size,color:rgb(0.13,0.19,0.3)});y-=16}
  if(!line)y-=6;
 }
 page.drawLine({start:{x:margin,y:55},end:{x:width-margin,y:55},thickness:1,color:rgb(0.76,0.81,0.9)});
 page.drawText("Documento generado desde los fixtures · Huella SHA-256 verificable",{x:margin,y:38,font,size:8,color:rgb(0.42,0.47,0.58)});
 await fs.writeFile(file,await pdf.save());
}
