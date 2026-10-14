const fs=require('node:fs');
const path=require('node:path');
function createDiagnostics(directory){
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'noiselab.log');
  try{if(fs.statSync(file).size>2*1024*1024)fs.renameSync(file,file+'.previous');}catch{}
  const log=(event,detail={})=>{
    try{fs.appendFileSync(file,JSON.stringify({time:new Date().toISOString(),pid:process.pid,event,...detail})+'\n');}catch{}
  };
  return {file,log};
}
module.exports={createDiagnostics};
