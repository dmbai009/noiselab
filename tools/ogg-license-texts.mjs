import{writeFile,mkdir}from'node:fs/promises';
await mkdir('licenses',{recursive:true});
for(const[name,url]of[
 ['libvorbis-BSD.txt','https://raw.githubusercontent.com/xiph/vorbis/master/COPYING'],
 ['libogg-BSD.txt','https://raw.githubusercontent.com/xiph/ogg/master/COPYING'],
 ['libopus-BSD.txt','https://raw.githubusercontent.com/xiph/opus/main/COPYING'],
 ['GPL-3.0.txt','https://raw.githubusercontent.com/gcc-mirror/gcc/master/COPYING3']
]){const response=await fetch(url);if(!response.ok)throw new Error(response.status+' '+url);await writeFile('licenses/'+name,await response.text());}
console.log('Official Xiph codec notices and GPL-3 text retained. LGPL parser text is copied from its installed package.');
