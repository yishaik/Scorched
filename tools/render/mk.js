// Renders the store graphics (feature graphic, two screenshots, promo square) into <out>
// (argv[2], $RENDER_OUT, or marketing/).
'use strict';
const path = require('path');
const { outDir, seedRandom } = require('./lib');
seedRandom();
const f = require(require('./test.js'));
const OUT = outDir();
const fs = require('fs');
const { createCanvas } = require('canvas');
// The scene renders at 2x; store assets with a fixed size (Play feature graphic 1024x500) are resampled.
const fit = (cv, out, w, h) => { const t = createCanvas(w, h), x = t.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cv, 0, 0, w, h); fs.writeFileSync(out, t.toBuffer('image/png')); };
const traj=(ctx,W,H,S)=>{ // a shell arc and an explosion
  ctx.setLineDash([2*S,4*S]);ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=1.5*S;ctx.beginPath();
  const x0=W*.13+10*S,y0=H*.55,x1=W*.6,peak=H*.12;for(let t=0;t<=1;t+=.02){const x=x0+(x1-x0)*t,y=y0-(y0-peak)*4*t*(1-t)+t*(H*.06);t?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();ctx.setLineDash([]);
  const bx=W*.6,by=H*.58,r=28*S;const g=ctx.createRadialGradient(bx,by,0,bx,by,r);g.addColorStop(0,'#fff6b0');g.addColorStop(.4,'#ffb02e');g.addColorStop(.8,'#e0401a');g.addColorStop(1,'rgba(160,30,10,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(bx,by,r,0,7);ctx.fill();};
const title=(ctx,W,H,S,big)=>{ctx.textAlign='left';ctx.textBaseline='alphabetic';
  ctx.font=`900 ${big}px sans-serif`;ctx.lineWidth=big*0.12;ctx.strokeStyle='#1a0e2a';ctx.lineJoin='round';
  ctx.strokeText('SCORCHED TANKS',W*.05,H*.2);const g=ctx.createLinearGradient(0,H*.2-big,0,H*.2);g.addColorStop(0,'#fff3b0');g.addColorStop(1,'#ff8a2a');ctx.fillStyle=g;ctx.fillText('SCORCHED TANKS',W*.05,H*.2);
  ctx.font=`600 ${big*.36}px sans-serif`;ctx.lineWidth=big*.06;ctx.strokeText('Turn-based artillery · Online with friends · Draw your own maps',W*.05,H*.2+big*.6,W*.9);ctx.fillStyle='#fff';ctx.fillText('Turn-based artillery · Online with friends · Draw your own maps',W*.05,H*.2+big*.6,W*.9);};
fit(f('Gradient',path.join(OUT,'feature-graphic.png'),1024,500,(c,W,H,S)=>{traj(c,W,H,S);title(c,W,H,S,62);}),path.join(OUT,'feature-graphic.png'),1024,500);
f('Gradient',path.join(OUT,'screenshot-1-sunset.png'),960,540,(c,W,H,S)=>traj(c,W,H,S));
f('Stars',path.join(OUT,'screenshot-2-night.png'),960,540,(c,W,H,S)=>traj(c,W,H,S));
fit(f('Gradient',path.join(OUT,'promo-square.png'),600,600,(c,W,H,S)=>{traj(c,W,H,S);title(c,W,H,S,44);}),path.join(OUT,'promo-square.png'),1080,1080);
console.log('wrote 4 images to', OUT);
