import puppeteer from 'puppeteer-core';
import {existsSync} from 'node:fs';import path from 'node:path';
export async function launch({profile='chrome-profile'}={}){
  const executablePath=process.env.NOISELAB_CHROME||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  if(!executablePath)throw new Error('Set NOISELAB_CHROME to Chrome/Edge executable');
  return puppeteer.launch({executablePath,headless:true,userDataDir:path.resolve('test-output',profile),args:['--autoplay-policy=no-user-gesture-required','--no-first-run','--disable-background-networking','--disable-component-update'],protocolTimeout:300000});
}
