// Keep long recognition responses active without exposing partial model output.
export function recognitionResponse(work:()=>Promise<unknown>,failure:(error:unknown)=>{error:string;status:number},intervalMs=10000):Response {
 const encoder=new TextEncoder();let cancelled=false;let timer:ReturnType<typeof setInterval>|undefined;
 const body=new ReadableStream<Uint8Array>({
  start(controller){
   const heartbeat=()=>{if(!cancelled)controller.enqueue(encoder.encode(' '.repeat(1024)+'\n'));};
   heartbeat();timer=setInterval(heartbeat,intervalMs);
   void (async()=>{let value;try{value=await work();}catch(error){value=failure(error);}finally{clearInterval(timer);}
    if(!cancelled){controller.enqueue(encoder.encode(JSON.stringify(value)));controller.close();}
   })();
  },
  cancel(){cancelled=true;clearInterval(timer);}
 });
 return new Response(body,{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0, must-revalidate, no-transform','Content-Encoding':'identity','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Accel-Buffering':'no'}});
}
