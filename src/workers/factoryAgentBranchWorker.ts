/// <reference lib="webworker" />
import { simulateFactoryBranch } from '../game/factoryAgent'
import type { AgentFactoryContext, FactoryPatch } from '../game/agentTypes'

interface Request { requestId: string; patch: FactoryPatch; context: AgentFactoryContext; horizonSec: number }
self.onmessage=(event:MessageEvent<Request>)=>{const {requestId,patch,context,horizonSec}=event.data;try{self.postMessage({requestId,ok:true,result:simulateFactoryBranch(patch,context,horizonSec)})}catch(error){self.postMessage({requestId,ok:false,error:error instanceof Error?error.message:'Simulation branch failed'})}}
export {}
