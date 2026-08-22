import { simulateFactoryBranch } from './factoryAgent'
import type { AgentFactoryContext, BranchSimulationResult, FactoryPatch } from './agentTypes'

export async function compareAgentBranches(patch:FactoryPatch,context:AgentFactoryContext,horizonSec:number):Promise<BranchSimulationResult>{
  const local=()=>simulateFactoryBranch(structuredClone(patch),structuredClone(context),horizonSec)
  if(typeof Worker==='undefined')return local()
  try{
    const worker=new Worker(new URL('../workers/factoryAgentBranchWorker.ts',import.meta.url),{type:'module',name:'forgecore-simulation-branch'})
    const requestId=`branch-${Date.now().toString(36)}`
    return await new Promise((resolve,reject)=>{const timeout=window.setTimeout(()=>{worker.terminate();reject(new Error('仿真分支运行超时'))},120_000);worker.onmessage=(event:MessageEvent<{requestId:string;ok:boolean;result?:BranchSimulationResult;error?:string}>)=>{if(event.data.requestId!==requestId)return;window.clearTimeout(timeout);worker.terminate();if(event.data.ok&&event.data.result)resolve(event.data.result);else reject(new Error(event.data.error??'仿真分支运行失败'))};worker.onerror=(event)=>{window.clearTimeout(timeout);worker.terminate();reject(new Error(event.message||'仿真 Worker 加载失败'))};worker.postMessage({requestId,patch:structuredClone(patch),context:structuredClone(context),horizonSec})})
  }catch{return local()}
}
