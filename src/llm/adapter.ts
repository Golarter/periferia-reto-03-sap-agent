export interface LlmAdapter{
 readonly provider:string;
 readonly model:string;
 summarize(prompt:string,user:string,context:string):Promise<string>;
}
