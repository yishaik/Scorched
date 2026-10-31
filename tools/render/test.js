// Builds .cache/gen.js: a scene renderer assembled from the game's own drawing functions
// (sky, terrain, decor, tanks, smoke). Run directly to render a sample to <out>/g.png.
'use strict';
const fs = require('fs');
const path = require('path');
const { gameSource, grab, outDir, seedRandom } = require('./lib');

const src = gameSource();
const hshMatch = src.match(/const hsh = .*\n/);
if (!hshMatch) throw new Error('const hsh not found in game/index.html');
const code = `
const {createCanvas}=require('canvas'); const fs=require('fs');
const rgb = (r, g, b) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
${hshMatch[0]}
module.exports=(kind,out,W=900,H=420,shots)=>{
let S=Math.max(0.6,Math.min(W,H)/400),dpr=2,TW=W,TH=H,wind=5,mask,decor=[];
const gy=x=>{x=Math.round(x);for(let y=0;y<TH;y++)if(mask[y*TW+x])return y;return TH};
let stars=Array.from({length:120},(_, i)=>[(i*0.618)%1,(i*0.377)%1,1,0.5]);
const skyCv=createCanvas(1,1); let skyKey="";
const cv=createCanvas(W*2,H*2); const ctx=cv.getContext('2d'); ctx.setTransform(2,0,0,2,0,0);
${grab(src, 'vnoise')}
${grab(src, 'modernPx')}
${grab(src, 'ridge')}
${grab(src, 'ridgeProps')}
${grab(src, 'paintSky')}
${grab(src, 'drawDecor')}
${grab(src, 'drawTankModern')}
${grab(src, 'drawSmoke')}
const muzzle=(t)=>({x:t.x+Math.cos(t.angle*Math.PI/180)*20*S,y:t.y-8*S-Math.sin(t.angle*Math.PI/180)*20*S});
paintSky(kind); ctx.drawImage(skyCv,0,0,W,H);
mask=new Uint8Array(TW*TH);
for(let x=0;x<TW;x++){let top=H-H*(0.28+0.12*Math.sin(x/W*5+1)+0.06*Math.sin(x/W*13+2));
 const cx=W*0.47; if(Math.abs(x-cx)<40){const dx=x-cx;top=top+Math.sqrt(Math.max(0,1600-dx*dx))*0.8;}
 for(let y=Math.round(top);y<TH;y++)mask[y*TW+x]=1;}
const tc=createCanvas(TW,TH),tx=tc.getContext('2d'),img=tx.createImageData(TW,TH),d32=new Uint32Array(img.data.buffer);
for(let x=0;x<TW;x++){let depth=0;for(let y=0,i=x;y<TH;y++,i+=TW){const m=mask[i];if(!m)depth=0;else depth++; d32[i]=m?modernPx(m,x,y,depth):0;}}
tx.putImageData(img,0,0); ctx.imageSmoothingEnabled=false; ctx.drawImage(tc,0,0);
decor=[{x:W*.07,t:'tree',v:0.2},{x:W*.33,t:'tree',v:0.7,burnt:true},{x:W*.38,t:'bush',v:0.4},{x:W*.58,t:'wreck',v:0.3},{x:W*.78,t:'bush',v:0.8,burnt:true},{x:W*.95,t:'tree',v:0.9},{x:W*.25,t:'tree',v:0.5}]; drawDecor();
[[W*.13,'#ff5555',40,100],[W*.67,'#55ff55',130,100],[W*.89,'#5599ff',60,0]].forEach(([x,c,a,h],i)=>{const t={x,y:gy(x),color:c,angle:a,health:h};ctx.globalAlpha=h<=0?0.4:1;drawTankModern(t);ctx.globalAlpha=1;if(h<=0)drawSmoke(t,i);});
if(shots) shots(ctx,W,H,S);
fs.writeFileSync(out,cv.toBuffer('image/png')); return cv;};
`;
const cacheDir = path.join(__dirname, '.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const genPath = path.join(cacheDir, 'gen.js');
fs.writeFileSync(genPath, code);
module.exports = genPath;

if (require.main === module) {
  seedRandom();
  const out = path.join(outDir(), 'g.png');
  require(genPath)('Gradient', out);
  console.log('wrote', out);
}
