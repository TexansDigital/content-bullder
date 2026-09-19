import { chromium } from 'playwright';
const SB='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const B='http://localhost:4400';
const b = await chromium.launch({ executablePath: SB });
const ok=[],bad=[];
const t=(n,c)=> (c?ok:bad).push(n);
const j = async (p,o)=> (await fetch(B+p,{headers:{'content-type':'application/json'},...o})).json();

t('directory GET does not crash', (await fetch(B+'/content/')).status===404);
t('server alive after', (await fetch(B+'/api/adapters')).status===200);

await Promise.all(Array.from({length:10},(_,i)=>
  j('/api/pull',{method:'POST',body:JSON.stringify({adapter:'manual',config:{urls:`https://a.example/p${i}.jpg`}})})));
const stored = (await j('/api/items')).items.length;
t(`10 concurrent pulls all persist (${stored}/10)`, stored===10);

const items = (await j('/api/items')).items;
const id = items[0].id, pid = items[1].id;
const pub = await j('/api/items',{method:'PATCH',body:JSON.stringify({id,changes:{status:'published',headline:'Untitled',media:{kind:'none'}}})});
t('API refuses to publish an invalid card', pub.updated===0 && !!pub.rejected);

const xo = await fetch(B+'/api/items',{method:'DELETE',headers:{'content-type':'application/json',origin:'http://evil.example'},body:JSON.stringify({ids:[id]})});
t('cross-origin write refused', xo.status===403);

const svg = await j('/api/upload',{method:'POST',body:JSON.stringify({filename:'x.svg',dataUrl:'data:image/svg+xml;base64,PHN2Zy8+'})});
t('SVG upload rejected', /unsupported/i.test(svg.error||''));

const bad1 = await j('/api/items',{method:'PATCH',body:JSON.stringify({id,changes:{overlays:'nope'}})});
t('malformed overlays does not 500', bad1.updated!==undefined);

const cld = await j('/api/pull',{method:'POST',body:JSON.stringify({adapter:'cloudinary',config:{assets:'https://x.test/video/xupload/a.mp4\nhttps://x.test/video/xupload/b.mp4',baseUrl:'https://x.test'}})});
t('unresolvable cloudinary rows dropped', cld.added===0);

const ssrf = await j('/api/pull',{method:'POST',body:JSON.stringify({adapter:'rss',config:{url:'http://127.0.0.1:4400/api/items'}})});
t('RSS refuses private addresses', /private address/i.test(ssrf.error||''));

await j('/api/items',{method:'PATCH',body:JSON.stringify({id:pid,changes:{status:'published',headline:'ok',media:{kind:'youtube',youtubeId:'abc'},poster:['https://x.invalid/miss.jpg',"a';window.__PWNED=1;'"]}})});
await j('/api/items',{method:'PATCH',body:JSON.stringify({id,changes:{collection:'<img src=x onerror=window.__PWNED_STUDIO=1>'}})});

const f = await b.newPage({viewport:{width:430,height:880}});
await f.goto(B+'/feed',{waitUntil:'networkidle'}); await f.waitForTimeout(600);
t('feed: no XSS via poster chain', !(await f.evaluate(()=>window.__PWNED)));
t('feed: one segment strip, not one per slide', (await f.evaluate(()=>document.querySelectorAll('.segs').length))===1);

const st = await b.newPage({viewport:{width:1440,height:960}});
const errs=[]; st.on('pageerror',e=>errs.push(e.message)); st.on('dialog',d=>d.accept());
await st.goto(B+'/',{waitUntil:'networkidle'}); await st.waitForTimeout(500);
t('studio: no XSS via collection', !(await st.evaluate(()=>window.__PWNED_STUDIO)));
t('queue rows focusable', await st.evaluate(()=>!!document.querySelector('.card[tabindex="0"]')));
t('toast announces to AT', await st.evaluate(()=>document.querySelector('#toast')?.getAttribute('role')==='status'));
t('first adapter is not Upload', await st.evaluate(()=>document.querySelector('#adapter').options[0].value!=='upload'));

await st.click('.card'); await st.waitForTimeout(400);
await st.fill('#e-h','DIRTY EDIT'); await st.waitForTimeout(200);
t('dirty state shows in header', (await st.textContent('#store-state')).toLowerCase().includes('unsaved'));
t('collection is a select in the editor', await st.evaluate(()=>document.querySelector('#e-c')?.tagName==='SELECT'));

await st.selectOption('#adapter','manual'); await st.waitForTimeout(250);
t('collection is a select in Sources', await st.evaluate(()=>document.querySelector('#f-collection')?.tagName==='SELECT'));
await st.selectOption('#adapter','cloudinary'); await st.waitForTimeout(250);
t('cloudinary offers a baseUrl field', await st.evaluate(()=>!!document.querySelector('#f-baseUrl')));
await st.selectOption('#adapter','upload'); await st.waitForTimeout(250);
t('Pull hidden for the Upload source', await st.evaluate(()=>document.querySelector('#pull')?.hidden===true));

await st.click('[data-tpl="letterbox"]'); await st.waitForTimeout(900);
await st.click('.card'); await st.waitForTimeout(500);
await st.hover('[data-tpl="quote"]'); await st.hover('#tpl-name'); await st.waitForTimeout(300);
t('layout warning restored after hover', (await st.textContent('#tpl-note')).includes('replaces'));
t('blocks focusable', await st.evaluate(()=>!!document.querySelector('#cv .ov[tabindex="0"]')));
await st.focus('#cv .ov'); await st.waitForTimeout(200);
const y0 = await st.evaluate(()=>document.querySelector('#cv .ov').style.top);
await st.keyboard.press('ArrowDown'); await st.keyboard.press('ArrowDown'); await st.waitForTimeout(250);
const y1 = await st.evaluate(()=>document.querySelector('#cv .ov').style.top);
t(`arrow keys move a block (${y0} -> ${y1})`, y0!==y1);
await st.click('[data-add="text"]'); await st.waitForTimeout(250);
await st.click('[data-add="text"]'); await st.waitForTimeout(250);
const tops = await st.evaluate(()=>[...document.querySelectorAll('#cv .ov')].map(e=>e.style.top));
t(`new blocks do not stack (${tops.join(',')})`, new Set(tops).size===tops.length);

await st.setViewportSize({width:1024,height:900}); await st.waitForTimeout(500);
t('panes not clipped under 1100px', await st.evaluate(()=>getComputedStyle(document.querySelectorAll('.pane')[0]).overflowY!=='auto'));
t('Add to inbox reachable at 1024', await st.evaluate(()=>{const r=document.querySelector('#n-add').getBoundingClientRect();return r.width>0&&r.height>0;}));

console.log('PASS '+ok.length); ok.forEach(x=>console.log('  + '+x));
if(bad.length){console.log('\nFAIL '+bad.length); bad.forEach(x=>console.log('  - '+x));}
if(errs.length) console.log('\npage errors:\n'+errs.join('\n'));
await b.close();
