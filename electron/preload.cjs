const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('desktop',Object.freeze({
  protectSource:(file)=>ipcRenderer.invoke('source:protect',webUtils.getPathForFile(file)),
  rememberModel:file=>ipcRenderer.invoke('model:remember',webUtils.getPathForFile(file)),
  loadModel:()=>ipcRenderer.invoke('model:load'),
  diagnostic:details=>ipcRenderer.invoke('diagnostic:renderer',details),
  beginSave:(request)=>ipcRenderer.invoke('save:begin',request),
  write:(token,bytes)=>ipcRenderer.invoke('save:write',{token,bytes}),
  finish:(token)=>ipcRenderer.invoke('save:finish',token),
  abort:(token)=>ipcRenderer.invoke('save:abort',token),
  memory:()=>ipcRenderer.invoke('memory'),
  versions:()=>ipcRenderer.invoke('versions')
}));
