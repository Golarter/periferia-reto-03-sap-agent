// Renderizador de Markdown limitado, sin innerHTML ni ejecución de HTML del modelo.
(function(){
 function inline(node,line){
  const fragments=line.split(/(\*\*[^*]+\*\*|\`[^\`]+\`)/g);
  for(const s of fragments){
   if(s.startsWith("**")&&s.endsWith("**")){const strong=document.createElement("strong");strong.textContent=s.slice(2,-2);node.append(strong)}
   else if(s.startsWith("\`")&&s.endsWith("\`")){const code=document.createElement("code");code.textContent=s.slice(1,-1);node.append(code)}
   else node.append(document.createTextNode(s))
  }
 }
 function parse(text){
  const root=document.createElement("div");root.className="rich";
  const lines=String(text).split(/\r?\n/);let code=null,codeLines=[];
  for(const line of lines){
   if(/^\s*```/.test(line)){
    if(!code){code=true;codeLines=[]}
    else{const pre=document.createElement("pre");pre.textContent=codeLines.join("\n");root.append(pre);code=null}
    continue;
   }
   if(code){codeLines.push(line);continue}
   if(!line.trim()){const gap=document.createElement("div");gap.className="rich-gap";root.append(gap);continue}
   let match;let tag="p",value=line;
   if((match=line.match(/^\s*(#{1,4})\s+(.+)$/))){tag="h"+Math.min(match[1].length+2,6);value=match[2]}
   else if((match=line.match(/^\s*[-*]\s+(.+)$/))){tag="p";value="• "+match[1]}
   else if((match=line.match(/^\s*\d+\.\s+(.+)$/))){tag="p";value=match[0].trim()}
   if(value.trim()==="---"){root.append(document.createElement("hr"));continue}
   const item=document.createElement(tag);inline(item,value);root.append(item)
  }
  if(code){const pre=document.createElement("pre");pre.textContent=codeLines.join("\n");root.append(pre)}
  return root
 }
 window.renderAgentText=function(div,text){
  const marker="\n\nAnálisis del agente Gemini:\n";const i=text.indexOf(marker);
  div.append(parse(i>=0?text.slice(0,i):text));
  if(i>=0){const details=document.createElement("details");details.className="ai-analysis";const summary=document.createElement("summary");summary.textContent="Ver explicación adicional de Gemini";details.append(summary,parse(text.slice(i+marker.length)));div.append(details)}
 }
})();
