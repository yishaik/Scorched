const fs=require('fs');const {createCanvas}=require('/workspace/work/cv/node_modules/canvas');
const src=fs.readFileSync('/workspace/built/sites/bee5e85c-6b52-4a9a-ad9a-b052f91b2ca7/index.html','utf8');
function grab(name){const i=src.indexOf('function '+name+'(');let d=0,j=src.indexOf('{',i);for(let k=j;;k++){if(src[k]=='{')d++;else if(src[k]=='}'){d--;if(!d)return src.slice(i,k+1);}}}
const MAP_N=160; eval(grab('mapDraw'));
const W=1920,H=1080,cv=createCanvas(W,H),c=cv.getContext('2d');
c.fillStyle='#000';c.fillRect(0,0,W,H);
// DOS-style top bar
const btn=(x,y,w,h,t,on)=>{c.fillStyle=on?'#ffff55':'#c0c0c0';c.fillRect(x,y,w,h);c.fillStyle=on?'#404040':'#fff';c.fillRect(x,y,w,4);c.fillRect(x,y,4,h);c.fillStyle=on?'#fff':'#404040';c.fillRect(x,y+h-4,w,4);c.fillRect(x+w-4,y,4,h);c.fillStyle='#000';c.font='bold 34px monospace';c.textAlign='center';c.textBaseline='middle';c.fillText(t,x+w/2,y+h/2+2);};
c.fillStyle='#0000aa';c.fillRect(0,0,W,110);c.fillStyle='#ffff55';c.font='bold 44px monospace';c.textAlign='left';c.textBaseline='middle';c.fillText('MAP BUILDER',30,55);
c.fillStyle='#000';c.fillRect(380,25,360,60);c.fillStyle='#55ffff';c.font='34px monospace';c.fillText('Twin Peaks',400,57);
[['DRAW',0],['TREE',1],['BUSH',0],['WRECK',0]].forEach(([t,on],i)=>btn(780+i*190,22,175,66,t,on));
const h=Array.from({length:160},(_,i)=>Math.round(22+38*Math.exp(-(((i-45)/16)**2))+52*Math.exp(-(((i-118)/14)**2))+4*Math.sin(i/5)));
const m=createCanvas(W-60,H-250); mapDraw(m,h,true,[[12,0],[25,1],[70,2],[84,0],[92,1],[140,0],[150,1],[100,2]]); c.drawImage(m,30,130);
// finger trail
c.strokeStyle='rgba(255,255,255,.7)';c.lineWidth=10;c.lineCap='round';c.beginPath();c.moveTo(1500,700);c.quadraticCurveTo(1620,560,1760,640);c.stroke();
c.fillStyle='rgba(255,255,255,.85)';c.beginPath();c.arc(1760,640,26,0,7);c.fill();
[['CLEAR',0],['SMOOTH',0],['SAVE',1],['BACK',0]].forEach(([t,on],i)=>btn(30+i*300,H-100,270,76,t,on));
fs.writeFileSync('/workspace/work/mk/screenshot-3-map-builder.png',cv.toBuffer('image/png'));
