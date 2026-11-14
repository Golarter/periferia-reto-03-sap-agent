export type AgentMessage={role:"user"|"model";parts:Array<Record<string,unknown>>};
export type ToolDefinition={name:string;description:string;parametersJsonSchema:Record<string,unknown>};
export type LlmToolCall={name:string;args:Record<string,unknown>;id?:string};
export type LlmResponse={text:string;calls:LlmToolCall[];parts:Array<Record<string,unknown>>};
export interface LlmAdapter{
 readonly provider:string;
 readonly model:string;
 enviar(input:{messages:AgentMessage[];tools:ToolDefinition[];systemPrompt:string;forceTool:boolean;signal:AbortSignal}):Promise<LlmResponse>;
}
