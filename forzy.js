/* ===================================================================
   PROJETO FORZY - Sistema de Monitoramento Industrial
   Trabalho academico FIAP + Forzy-Promon

   Integrantes:
   - Arthur Baptista dos Santos       (RM 565346)
   - Joao Pedro de Moura Dutra Franco (RM 561738)
   - Nelson Felix Neto                (RM 565603)
   - Pietro Boroto Rodrigues          (RM 562407)
   - Vitor Soares Goncalves           (RM 566181)

   Arquivo: forzy.js
   O que faz: tela de Monitoramento (graficos do motor)
   =================================================================== */

(function () {
  const F = window.FORZY;
  if (!F) { console.error('forzy-data.js não carregou'); return; }

  const NS = 'http://www.w3.org/2000/svg';
  const COLS = F.meta.cols;
  const BL = F.baseline;
  const C = { ok:'#2ecc71', warn:'#f39c12', bad:'#e74c3c', m1:'#3498db', m2:'#9b59b6' };
  const FLAG_COL = [C.ok, C.warn, C.bad];
  const FLAG_LBL = ['OK', 'ALERTA', 'ALARME'];

  const NORMAS = {
    'ISO 10816 (< 15 kW)':  { alerta:1.8, alarme:4.5 },
    'ISO 20816 (15–75 kW)': { alerta:2.3, alarme:7.1 },
  };
  const ACEL_A=0.25, ACEL_AL=0.45, TEMP_A=35.0, TEMP_AL=42.0;

  const clamp = (v,a,b)=> Math.max(a, Math.min(b, v));
  const fmt = (v,d=2)=> (v==null||v!==v) ? '—' : Number(v).toFixed(d);
  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function el(tag, cls, html){ const e=document.createElement(tag); if(cls)e.className=cls; if(html!=null)e.innerHTML=html; return e; }
  function S(tag, attrs){ const e=document.createElementNS(NS,tag); for(const k in attrs) e.setAttribute(k, attrs[k]); return e; }

  function series(col){ return F[col.slice(0,2)][col.slice(3)]; }
  function readingAt(i){ const o={}; for(const c of COLS) o[c]=series(c)[i]; return o; }
  function flag(v,a,al){ v=+v||0; return v>=al?2 : v>=a?1 : 0; }
  function median(arr){ const a=arr.slice().sort((x,y)=>x-y); const m=a.length>>1; return a.length%2 ? a[m] : (a[m-1]+a[m])/2; }
  function mean(a){ let s=0; for(const x of a)s+=x; return s/a.length; }
  function std(a,mu){ mu=mu==null?mean(a):mu; let s=0; for(const x of a)s+=(x-mu)*(x-mu); return Math.sqrt(s/(a.length-1)); }
  function quantile(sorted,q){ const p=(sorted.length-1)*q, lo=Math.floor(p), hi=Math.ceil(p); return sorted[lo]+(sorted[hi]-sorted[lo])*(p-lo); }

  const T0 = new Date(F.meta.t0).getTime();
  function tlabel(i){ const d=new Date(T0 + F.t[i]*1000); return d.toLocaleTimeString('pt-BR',{hour12:false}); }

  function zscore(reading){ const z={}; for(const c of COLS){ const b=BL[c]; z[c]= b.std? Math.abs(reading[c]-b.mean)/b.std : 0; } return z; }
  function classify(score){ if(score<2) return ['Normal',C.ok]; if(score<3) return ['Alerta',C.warn]; return ['Anomalia',C.bad]; }
  function maxZ(z){ let m=0; for(const k in z) if(z[k]>m)m=z[k]; return m; }

  const rede = () => (window.FZModelo && window.FZModelo.pronto()) ? window.FZModelo : null;
  function avaliarRede(reading){ const m = rede(); return m ? m.avaliar(reading) : null; }

  function veredito(reading){
    const r = avaliarRede(reading);
    if (r && r.ok) return [r.rotulo, r.cor, r.indice, r];
    const s = maxZ(zscore(reading)); const [cl, co] = classify(s);
    return [cl, co, s, null];
  }

  function idxLinspace(n, k){ if(n<=k) return Array.from({length:n},(_,i)=>i); const out=[]; for(let i=0;i<k;i++) out.push(Math.round(i*(n-1)/(k-1))); return out; }

  function rng(seed){ let s=seed>>>0; return ()=>{ s|=0; s=s+0x6D2B79F5|0; let t=Math.imul(s^s>>>15,1|s); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function gauss(r){ let u=0,v=0; while(!u)u=r(); while(!v)v=r(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

  function rfftMag(sig){ const N=sig.length, half=N>>1, out=new Array(half+1); for(let k=0;k<=half;k++){ let re=0,im=0; for(let n=0;n<N;n++){ const a=-2*Math.PI*k*n/N; re+=sig[n]*Math.cos(a); im+=sig[n]*Math.sin(a);} out[k]=Math.sqrt(re*re+im*im)*2/N; } return out; }
  function hanning(N){ const w=new Array(N); for(let n=0;n<N;n++) w[n]=0.5-0.5*Math.cos(2*Math.PI*n/(N-1)); return w; }

  function polar(cx,cy,r,deg){ const a=deg*Math.PI/180; return [cx+r*Math.cos(a), cy-r*Math.sin(a)]; }
  function arcD(cx,cy,r,d0,d1){ const p0=polar(cx,cy,r,d0),p1=polar(cx,cy,r,d1); const large=Math.abs(d1-d0)>180?1:0; const sweep=d0>d1?1:0; return `M ${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`; }
  function gaugeSVG(v, max, a, al, unit, dec){
    v=+v||0; dec=dec==null?2:dec;
    const ang=x=>180-clamp(x/max,0,1)*180;
    const fl=flag(v,a,al), col=FLAG_COL[fl];
    const cx=100,cy=108,r=82,sw=15, trackCol=cssVar('--field')||'#eee';
    const tick=polar(cx,cy,r+9,ang(al)), tick2=polar(cx,cy,r-9,ang(al));
    return `<svg viewBox="0 0 200 124" role="img">
      <path d="${arcD(cx,cy,r,180,0)}" stroke="${trackCol}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>
      <path d="${arcD(cx,cy,r,180,ang(a))}"  stroke="${C.ok}"  stroke-width="${sw}" fill="none" opacity=".30"/>
      <path d="${arcD(cx,cy,r,ang(a),ang(al))}" stroke="${C.warn}" stroke-width="${sw}" fill="none" opacity=".34"/>
      <path d="${arcD(cx,cy,r,ang(al),0)}" stroke="${C.bad}" stroke-width="${sw}" fill="none" opacity=".30"/>
      <path d="${arcD(cx,cy,r,180,ang(v))}" stroke="${col}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>
      <line x1="${tick[0].toFixed(1)}" y1="${tick[1].toFixed(1)}" x2="${tick2[0].toFixed(1)}" y2="${tick2[1].toFixed(1)}" stroke="${C.bad}" stroke-width="2"/>
      <text class="fz-g-num" x="100" y="98" text-anchor="middle" font-size="26">${fmt(v,dec)}</text>
      <text class="fz-g-unit" x="100" y="116" text-anchor="middle" font-size="11">${unit}</text>
    </svg>`;
  }

  function lineChart(host, opt){
    host.innerHTML=''; host.classList.add('fz-chart');
    const W=720, H=opt.height||260, padL=opt.padL||50, padR=14, padT=16, padB=30;
    const plotW=W-padL-padR, plotH=H-padT-padB;
    const ser=opt.series, n=opt.n;
    let ymax=opt.yMax, ymin=opt.yMin!=null?opt.yMin:0;
    if(ymax==null){ ymax=0; for(const s of ser) for(const v of s.data) if(v>ymax)ymax=v; (opt.thresholds||[]).forEach(t=>{ if(t.y>ymax)ymax=t.y;}); ymax*=1.12||1; }
    if(ymax<=ymin) ymax=ymin+1;
    const xi = i => padL + (n<=1?0:(i*plotW/(n-1)));
    const y = v => padT + (1-(v-ymin)/(ymax-ymin))*plotH;

    const svg=S('svg',{viewBox:`0 0 ${W} ${H}`});

    (opt.bands||[]).forEach(b=>{ const y0=y(Math.min(b.y1,ymax)), y1=y(Math.max(b.y0,ymin)); svg.appendChild(S('rect',{x:padL,y:y0,width:plotW,height:Math.max(0,y1-y0),fill:b.color})); });

    const gl=cssVar('--hairline')||'#eee';
    for(let g=0;g<=4;g++){ const v=ymin+(ymax-ymin)*g/4, yy=y(v);
      svg.appendChild(S('line',{x1:padL,x2:W-padR,y1:yy,y2:yy,stroke:gl,'stroke-width':1}));
      const tx=S('text',{x:padL-8,y:yy+4,'text-anchor':'end',class:'fz-axis-label'}); tx.textContent=(+v.toFixed(v<10?2:0)); svg.appendChild(tx);
    }

    const nx=Math.min(opt.xTicks||6,n); const xfn=opt.xLabel||(i=>i);
    for(let k=0;k<nx;k++){ const i=Math.round(k*(n-1)/(nx-1||1)); const tx=S('text',{x:xi(i),y:H-8,'text-anchor':'middle',class:'fz-axis-label'}); tx.textContent=xfn(i); svg.appendChild(tx); }

    (opt.thresholds||[]).forEach(t=>{ const yy=y(clamp(t.y,ymin,ymax)); svg.appendChild(S('line',{x1:padL,x2:W-padR,y1:yy,y2:yy,class:'fz-thr',stroke:t.color})); });

    ser.forEach(s=>{ if(!s.data.length) return; let d='M '+xi(0)+' '+y(s.data[0]); for(let i=1;i<n;i++) d+=' L '+xi(i)+' '+y(s.data[i]); const p=S('path',{d,class:'fz-area-line',stroke:s.color}); svg.appendChild(p); });

    (opt.markers||[]).forEach(m=>{ m.idx.forEach(i=>{ svg.appendChild(S('circle',{cx:xi(i),cy:y(m.data[i]),r:3,fill:m.color})); }); });

    const hl=S('line',{y1:padT,y2:padT+plotH,class:'fz-hover-line'}); svg.appendChild(hl);
    const dots=ser.map(s=>{ const c=S('circle',{r:4,class:'fz-dot',fill:s.color,stroke:'#fff','stroke-width':1.5}); svg.appendChild(c); return c; });
    host.appendChild(svg);
    const tip=el('div','chart-tip'); host.appendChild(tip);
    svg.addEventListener('mousemove',e=>{ const r=svg.getBoundingClientRect(); const mx=(e.clientX-r.left)/r.width*W; let i=Math.round((mx-padL)/plotW*(n-1)); i=clamp(i,0,n-1);
      hl.setAttribute('x1',xi(i)); hl.setAttribute('x2',xi(i)); hl.style.opacity=1;
      let rows=''; ser.forEach((s,k)=>{ dots[k].setAttribute('cx',xi(i)); dots[k].setAttribute('cy',y(s.data[i])); dots[k].style.opacity=1; rows+=`<div class="tip-delta" style="color:${s.color}">${s.name}: ${fmt(s.data[i],opt.dec==null?3:opt.dec)}${opt.unit||''}</div>`; });
      tip.innerHTML=`<div class="tip-date">${xfn(i)}</div>${rows}`;
      tip.style.left=(xi(i)/W*100)+'%'; tip.style.top='6%'; tip.style.opacity=1;
    });
    svg.addEventListener('mouseleave',()=>{ hl.style.opacity=0; dots.forEach(d=>d.style.opacity=0); tip.style.opacity=0; });
  }

  function spectrumChart(host, opt){
    host.innerHTML=''; host.classList.add('fz-chart');
    const W=720,H=opt.height||360,padL=54,padR=16,padT=18,padB=40, plotW=W-padL-padR, plotH=H-padT-padB;
    const fx=opt.freqs, mag=opt.mag, n=fx.length, fmax=fx[n-1];
    let ymax=0; for(const m of mag) if(m>ymax)ymax=m; ymax=ymax*1.15||1;
    const x=f=>padL+ (f/fmax)*plotW, y=v=>padT+(1-v/ymax)*plotH;
    const svg=S('svg',{viewBox:`0 0 ${W} ${H}`}); const gl=cssVar('--hairline')||'#eee';
    for(let g=0;g<=4;g++){ const yy=padT+plotH*g/4; svg.appendChild(S('line',{x1:padL,x2:W-padR,y1:yy,y2:yy,stroke:gl,'stroke-width':1})); const tx=S('text',{x:padL-8,y:yy+4,'text-anchor':'end',class:'fz-axis-label'}); tx.textContent=(ymax*(1-g/4)).toExponential(1); svg.appendChild(tx); }
    for(let k=0;k<=5;k++){ const f=fmax*k/5; const tx=S('text',{x:x(f),y:H-8,'text-anchor':'middle',class:'fz-axis-label'}); tx.textContent=Math.round(f); svg.appendChild(tx); }

    (opt.bands||[]).forEach(b=>{ svg.appendChild(S('rect',{x:x(b.x0),y:padT,width:Math.max(1,x(b.x1)-x(b.x0)),height:plotH,fill:b.color})); });

    let d='M '+x(0)+' '+y(0); for(let i=0;i<n;i++) d+=' L '+x(fx[i])+' '+y(mag[i]); const dl=d; d+=' L '+x(fmax)+' '+y(0)+' Z';
    svg.appendChild(S('path',{d,fill:'rgba(155,89,182,0.14)'}));
    svg.appendChild(S('path',{d:dl,fill:'none',stroke:C.m2,'stroke-width':1.6}));

    (opt.vlines||[]).forEach(vl=>{ if(vl.x>fmax) return; svg.appendChild(S('line',{x1:x(vl.x),x2:x(vl.x),y1:padT,y2:padT+plotH,stroke:vl.color,'stroke-width':vl.w||1,'stroke-dasharray':vl.dash||'4 3'})); const tx=S('text',{x:x(vl.x)+3,y:padT+12,class:'fz-axis-label',fill:vl.color,'font-size':10}); tx.textContent=vl.label||''; svg.appendChild(tx); });

    const axx=S('text',{x:padL+plotW/2,y:H-2,'text-anchor':'middle',class:'fz-axis-label'}); axx.textContent='Frequência (Hz)'; svg.appendChild(axx);
    host.appendChild(svg);
  }

  function heatmap(host, opt){
    host.innerHTML=''; host.classList.add('fz-chart');
    const rows=opt.z.length, cols=opt.z[0].length;
    const W=720, cell=opt.cell||Math.max(8, Math.min(28, 640/cols)), rh=opt.rowH||Math.max(12, Math.min(26, 360/rows));
    const padL=opt.padL||70, padT=10, padB=34;
    const H=padT+rows*rh+padB, plotW=cols*cell;
    let zmin=opt.zmin, zmax=opt.zmax;
    if(zmin==null){ zmin=Infinity; zmax=-Infinity; for(const r of opt.z) for(const v of r){ if(v<zmin)zmin=v; if(v>zmax)zmax=v; } }
    const color = opt.diverging ? divColor : plasma;
    function plasma(t){ t=clamp(t,0,1); const r=Math.round(13+242*t), g=Math.round(8+Math.pow(t,1.5)*120), b=Math.round(135-80*t+ (t>0.7?(t-0.7)*300:0)); return `rgb(${r},${clamp(g,0,255)},${clamp(b,0,255)})`; }
    function divColor(t){ t=clamp(t,0,1); if(t<0.5){ const k=t*2; return `rgb(${Math.round(60+195*k)},${Math.round(80+175*k)},${Math.round(180+75*k)})`; } const k=(t-0.5)*2; return `rgb(${Math.round(255-30*k)},${Math.round(255-200*k)},${Math.round(255-220*k)})`; }
    const svg=S('svg',{viewBox:`0 0 ${Math.max(W,padL+plotW+10)} ${H}`});
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){ const v=opt.z[r][c]; const t=(v-zmin)/((zmax-zmin)||1); const rect=S('rect',{x:padL+c*cell,y:padT+r*rh,width:cell+0.5,height:rh+0.5,fill:color(t)}); svg.appendChild(rect);
      if(opt.text){ const tx=S('text',{x:padL+c*cell+cell/2,y:padT+r*rh+rh/2+3,'text-anchor':'middle',class:'fz-axis-label',fill: t>0.55?'#0a1628':'#e8f0fe','font-size':9}); tx.textContent=(+v.toFixed(2)); svg.appendChild(tx); } }

    (opt.y||[]).forEach((lab,r)=>{ if(rows>14 && r%Math.ceil(rows/14)) return; const tx=S('text',{x:padL-6,y:padT+r*rh+rh/2+3,'text-anchor':'end',class:'fz-axis-label'}); tx.textContent=lab; svg.appendChild(tx); });

    (opt.x||[]).forEach((lab,c)=>{ if(cols>10 && c%Math.ceil(cols/10)) return; const tx=S('text',{x:padL+c*cell+cell/2,y:H-12,'text-anchor':'middle',class:'fz-axis-label'}); tx.textContent=lab; svg.appendChild(tx); });
    host.appendChild(svg);
  }

  function boxplot(host, groups){
    host.innerHTML=''; host.classList.add('fz-chart');
    const W=720, H=300, padT=24, padB=24, sub=groups.length, subW=W/sub;
    const svg=S('svg',{viewBox:`0 0 ${W} ${H}`});
    groups.forEach((g,gi)=>{ const x0=gi*subW+16, w=subW-32;
      let lo=Infinity,hi=-Infinity; g.boxes.forEach(b=>{ const s=b.data.slice().sort((a,c)=>a-c); b.q1=quantile(s,.25); b.med=quantile(s,.5); b.q3=quantile(s,.75); b.mn=s[0]; b.mx=s[s.length-1]; b.mu=mean(b.data); if(b.mn<lo)lo=b.mn; if(b.mx>hi)hi=b.mx; });
      const pad=(hi-lo)*0.12||1; lo-=pad; hi+=pad; const y=v=>padT+(1-(v-lo)/(hi-lo))*(H-padT-padB);
      const tt=S('text',{x:x0+w/2,y:16,'text-anchor':'middle',class:'fz-axis-label'}); tt.textContent=g.title; svg.appendChild(tt);
      const bw=w/g.boxes.length, boxw=Math.min(34,bw*0.5);
      g.boxes.forEach((b,bi)=>{ const cx=x0+bw*bi+bw/2;
        svg.appendChild(S('line',{x1:cx,x2:cx,y1:y(b.mx),y2:y(b.mn),stroke:b.color,'stroke-width':1.4}));
        svg.appendChild(S('rect',{x:cx-boxw/2,y:y(b.q3),width:boxw,height:Math.max(1,y(b.q1)-y(b.q3)),fill:b.color,opacity:.28,stroke:b.color,'stroke-width':1.4,rx:3}));
        svg.appendChild(S('line',{x1:cx-boxw/2,x2:cx+boxw/2,y1:y(b.med),y2:y(b.med),stroke:b.color,'stroke-width':2}));
        svg.appendChild(S('circle',{cx,cy:y(b.mu),r:2.5,fill:'#fff',stroke:b.color,'stroke-width':1.4}));
        const lt=S('text',{x:cx,y:H-8,'text-anchor':'middle',class:'fz-axis-label','font-size':10}); lt.textContent=b.name; svg.appendChild(lt);
      });
    });
    host.appendChild(svg);
  }

  function legend(items){ return `<div class="fz-legend">${items.map(i=>`<span><i style="background:${i.color}"></i>${i.name}</span>`).join('')}</div>`; }
  function badge(fl){ const col=FLAG_COL[fl]; return `<span class="fz-badge" style="background:${col}22;color:${col};border:1px solid ${col}">${FLAG_LBL[fl]}</span>`; }
  function metric(lbl,val){ return `<div class="fz-metric"><div class="m-lbl">${lbl}</div><div class="m-val">${val}</div></div>`; }

  function health(vel,acel,temp,isoAL){
    const h = Math.max(0, Math.round(100 - 60*Math.min(vel/(isoAL||1),1) - 25*Math.min(Math.max((temp-35)/45,0),1) - 15*Math.min(acel/(ACEL_AL||1),1)));
    return h;
  }

  function motorCard(nome, r, iso, prefix){
    const vel=r[prefix+'_vel'], acel=r[prefix+'_acel'], temp=r[prefix+'_temp'];
    const fv=flag(vel,iso.alerta,iso.alarme), fa=flag(acel,ACEL_A,ACEL_AL), ft=flag(temp,TEMP_A,TEMP_AL);
    const h=health(vel,acel,temp,iso.alarme), hcol = h>=70?C.ok : h>=40?C.warn : C.bad;
    const card=el('div','fz-card');
    card.innerHTML=`
      <div class="fz-banner" style="background:${FLAG_COL[fv]}">${nome} — ${FLAG_LBL[fv]}</div>
      <div class="fz-health"><span class="lbl">Health Score</span>
        <div class="track"><div class="fill" style="width:${h}%;background:${hcol}"></div></div>
        <span class="pct" style="color:${hcol}">${h}/100</span></div>
      <div class="fz-kpis">
        <div class="fz-kpi"><div class="k-lbl">Velocidade RMS</div><div class="k-val">${fmt(vel,3)} <small>mm/s</small></div><span class="k-tag" style="background:${FLAG_COL[fv]}22;color:${FLAG_COL[fv]}">${FLAG_LBL[fv]}</span></div>
        <div class="fz-kpi"><div class="k-lbl">Aceleração</div><div class="k-val">${fmt(acel,3)} <small>g</small></div><span class="k-tag" style="background:${FLAG_COL[fa]}22;color:${FLAG_COL[fa]}">${FLAG_LBL[fa]}</span></div>
        <div class="fz-kpi"><div class="k-lbl">Temperatura</div><div class="k-val">${fmt(temp,1)} <small>°C</small></div><span class="k-tag" style="background:${FLAG_COL[ft]}22;color:${FLAG_COL[ft]}">${FLAG_LBL[ft]}</span></div>
      </div>
      <div class="fz-gauges">
        <div class="fz-gauge">${gaugeSVG(vel, Math.max(iso.alarme*2,10), iso.alerta, iso.alarme,'mm/s',3)}<div class="g-cap">Vel RMS</div></div>
        <div class="fz-gauge">${gaugeSVG(acel,1.0,ACEL_A,ACEL_AL,'g',3)}<div class="g-cap">Aceleração</div></div>
        <div class="fz-gauge">${gaugeSVG(temp,85,TEMP_A,TEMP_AL,'°C',1)}<div class="g-cap">Temperatura</div></div>
      </div>`;
    return card;
  }

  const escHtml = s => (s==null?'':String(s)).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  function origemFonte(){
    if(state.fonte==='esp32') return 'esp32';
    if(state.fonte==='ativo') return state.ativoCod ? ('ativo:'+state.ativoCod) : null;
    if(state.fonte==='forzy') return 'dataset-forzy';
    if(state.fonte==='sim') return 'simulado';
    if(state.fonte==='cloud') return 'forzy-cloud';
    return null;
  }

  function origemEixo(prefix){
    const base = origemFonte();
    if(!base) return null;
    if(state.fonte==='esp32' || state.fonte==='ativo') return base;
    return base + ':' + prefix;
  }

  let modalEixo = null;

  const CHIPS_EIXO = [
    'Esse nível de vibração é normal?',
    'Qual a causa provável?',
    'Preciso parar a máquina?',
  ];

  function abrirModalEixo(prefix, nome, r, iso, getWin, xlab){
    const origem = origemEixo(prefix);
    const nomeSafe = escHtml(nome).replace(/<[^>]+>/g,'');

    document.getElementById('fzEixoModal')?.remove();
    const overlay = el('div','fz-modal-overlay'); overlay.id='fzEixoModal';
    overlay.innerHTML = `
      <div class="fz-modal">
        <div class="fz-modal-header">
          <div class="fz-modal-head-left">
            <div>
              <div class="fz-modal-eyebrow">Detalhe do Eixo · <span id="fzEixoFonte"></span></div>
              <div class="fz-modal-title">${nomeSafe} <span class="fz-modal-status" id="fzEixoStatus"></span></div>
            </div>
          </div>
          <div class="fz-modal-head-right">
            <span class="fz-modal-live"><i></i>ao vivo</span>
            <button class="fz-modal-close" id="fzEixoClose" title="Fechar">✕</button>
          </div>
        </div>
        <div class="fz-modal-body">
          <div class="fz-modal-health">
            <span class="lbl">Health Score</span>
            <div class="track"><div class="fill" id="fzEixoHealthFill"></div></div>
            <span class="pct" id="fzEixoHealthPct"></span>
          </div>
          <div class="fz-modal-kpis" id="fzEixoKpis"></div>
          <div class="fz-modal-sec-head">
            <span>Histórico recente</span>
            <button class="fz-btn ghost" id="fzEixoExport">↓ Exportar CSV</button>
          </div>
          <div class="fz-modal-chart-row" id="fzEixoCharts"></div>

          <div class="fz-modal-chat">
            <div class="fz-modal-chat-head">
              <div class="fz-modal-chat-id">
                <div class="fz-modal-chat-avatar"><i data-lucide="bot"></i></div>
                <div>
                  <div class="fz-modal-chat-name">Assistente IA</div>
                  <div class="fz-modal-chat-scope">Analisando ${nomeSafe}</div>
                </div>
              </div>
              ${origem ? '<button class="fz-modal-chat-full" id="fzEixoChatFull">Conversa completa →</button>' : ''}
            </div>
            <div class="fz-modal-chat-msgs" id="fzEixoChatMsgs"></div>
            ${origem
              ? `<div class="fz-modal-chat-chips" id="fzEixoChips">
                   ${CHIPS_EIXO.map(c=>`<button class="fz-modal-chip">${escHtml(c)}</button>`).join('')}
                 </div>
                 <div class="fz-modal-chat-input-row">
                   <input type="text" id="fzEixoChatInput" placeholder="Pergunte sobre ${nomeSafe}…" autocomplete="off">
                   <button id="fzEixoChatSend" title="Enviar">
                     <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                   </button>
                 </div>`
              : `<div class="fz-modal-chat-empty">Selecione um ativo cadastrado pra poder conversar sobre ele.</div>`}
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    if(window.lucide) lucide.createIcons();

    modalEixo = { prefix, nome, origem, hist:null };
    atualizarModalEixo(r, iso, getWin, xlab);

    const fechar = () => { desinscrever?.(); overlay.remove(); modalEixo = null; };
    overlay.querySelector('#fzEixoClose').addEventListener('click', fechar);
    overlay.addEventListener('click', e => { if(e.target===overlay) fechar(); });
    document.addEventListener('keydown', function escKey(e){ if(e.key==='Escape'){ fechar(); document.removeEventListener('keydown', escKey); } });

    overlay.querySelector('#fzEixoExport').addEventListener('click', () => {
      const h = modalEixo?.hist; if(!h) return;
      let csv='indice;tempo;vel_mm_s;acel_g;temp_c\n';
      for(let i=0;i<h.vel.length;i++) csv+=`${i};${h.xlab(i)};${h.vel[i]??''};${h.acel[i]??''};${h.temp[i]??''}\n`;
      const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${nome.replace(/\s+/g,'_')}.csv`; a.click(); URL.revokeObjectURL(a.href);
    });

    let alertasEspelhados = [];

    function redesenharChat(pensando){
      const host = overlay.querySelector('#fzEixoChatMsgs'); if(!host) return;
      const s = window.FZChatScreen?.getSessao?.(origem);
      const bolha = b => `<div class="fz-modal-chat-msg fz-modal-chat-${b.role}">${b.html}</div>`;
      const proprias = (s && s.bubbles.length) ? s.bubbles.slice(-6) : [];
      let html = '';
      if(!proprias.length && !alertasEspelhados.length){
        html = '<div class="fz-modal-chat-empty">Pergunte algo sobre este eixo — a IA usa as leituras e os dados de placa.</div>';
      } else {
        html = proprias.map(bolha).join('') + alertasEspelhados.map(bolha).join('');
      }
      if(pensando) html += '<div class="fz-modal-chat-msg fz-modal-chat-ai"><span class="fz-chat-thinking"><span></span><span></span><span></span></span></div>';
      host.innerHTML = html;
      host.scrollTop = host.scrollHeight;
    }
    redesenharChat();

    const desinscrever = window.FZChatScreen?.onAlerta?.((orig, sessao) => {
      if(!document.getElementById('fzEixoModal')) return;
      if(orig === origem){ redesenharChat(); return; }
      if(orig && orig === origemFonte()){
        alertasEspelhados = sessao.bubbles.slice(-2);
        redesenharChat();
      }
    });

    const input = overlay.querySelector('#fzEixoChatInput');
    if(input){
      async function enviarPergunta(texto){
        const q = (texto || input.value).trim(); if(!q) return;
        input.value=''; input.disabled=true;
        overlay.querySelector('#fzEixoChips')?.classList.add('oculto');
        redesenharChat(true);
        try { await window.FZChatScreen?.perguntar?.(origem, nome, q); }
        finally { input.disabled=false; redesenharChat(); input.focus(); }
      }
      overlay.querySelector('#fzEixoChatSend').addEventListener('click', ()=>enviarPergunta());
      input.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); enviarPergunta(); } });
      overlay.querySelector('#fzEixoChips')?.addEventListener('click', e => {
        const chip = e.target.closest('.fz-modal-chip');
        if(chip) enviarPergunta(chip.textContent);
      });
    }
    const fullBtn = overlay.querySelector('#fzEixoChatFull');
    if(fullBtn) fullBtn.addEventListener('click', () => {
      fechar();
      window.FZChatScreen?.abrirConversa?.(origem, nome);
      if(typeof window.showScreen==='function') window.showScreen('assistente');
    });
  }

  function atualizarModalEixo(r, iso, getWin, xlab){
    if(!modalEixo) return;
    const overlay = document.getElementById('fzEixoModal');
    if(!overlay){ modalEixo=null; return; }
    const { prefix } = modalEixo;
    const vel=r[prefix+'_vel'], acel=r[prefix+'_acel'], temp=r[prefix+'_temp'];
    if(vel!==vel) return;

    const histVel=getWin(prefix+'_vel'), histAcel=getWin(prefix+'_acel'), histTemp=getWin(prefix+'_temp');
    modalEixo.hist = { vel:histVel, acel:histAcel, temp:histTemp, xlab };

    const fv=flag(vel,iso.alerta,iso.alarme), fa=flag(acel,ACEL_A,ACEL_AL), ft=flag(temp,TEMP_A,TEMP_AL);
    const h=health(vel,acel,temp,iso.alarme), hcol = h>=70?C.ok : h>=40?C.warn : C.bad;

    const fonteLbl = state.fonte==='esp32'?'ESP32 ao vivo' : state.fonte==='ativo'?('Ativo '+(state.ativoCod||'')) : state.fonte==='cloud'?'Forzy Cloud' : state.fonte==='sim'?'Simulado':'Dataset Forzy';
    overlay.querySelector('#fzEixoFonte').textContent = fonteLbl;

    const st = overlay.querySelector('#fzEixoStatus');
    st.textContent = FLAG_LBL[fv];
    st.style.cssText = `background:${FLAG_COL[fv]}22;color:${FLAG_COL[fv]};border:1px solid ${FLAG_COL[fv]}`;

    overlay.querySelector('#fzEixoHealthFill').style.cssText = `width:${h}%;background:${hcol}`;
    const pct = overlay.querySelector('#fzEixoHealthPct');
    pct.textContent = h+'/100'; pct.style.color = hcol;

    overlay.querySelector('#fzEixoKpis').innerHTML =
      [['Velocidade RMS', fmt(vel,3), 'mm/s', fv],
       ['Aceleração',     fmt(acel,3),'g',    fa],
       ['Temperatura',    fmt(temp,1),'°C',   ft]]
      .map(([lbl,v,u,f])=>`<div class="fz-kpi"><div class="k-lbl">${lbl}</div><div class="k-val">${v} <small>${u}</small></div><span class="k-tag" style="background:${FLAG_COL[f]}22;color:${FLAG_COL[f]}">${FLAG_LBL[f]}</span></div>`).join('');

    const chartsHost = overlay.querySelector('#fzEixoCharts');
    chartsHost.innerHTML='';
    [['Velocidade RMS','mm/s',histVel,C.m1,3,[{y:iso.alerta,color:C.warn},{y:iso.alarme,color:C.bad}]],
     ['Aceleração','g',histAcel,'#9b59b6',3,[{y:ACEL_AL,color:C.bad}]],
     ['Temperatura','°C',histTemp,'#e67e22',1,[{y:TEMP_AL,color:C.bad}]]
    ].forEach(([title,unit,data,color,dec,thr])=>{
      const box=el('div'); box.innerHTML=`<div class="fz-section-label">${title} (${unit})</div>`;
      const ch=el('div'); box.appendChild(ch); chartsHost.appendChild(box);
      lineChart(ch,{ n:data.length, height:140, padL:42, xTicks:3, unit:' '+unit, dec, xLabel:xlab,
        series:[{name:title,color,data}], thresholds:thr });
    });
  }

  const state = {
    tab:'mon', rendered:{},
    fonte:'forzy', norma:'ISO 10816 (< 15 kW)', ativoCod:null,
    fidx:0, step:5, interval:2000, auto:true, simMode:'normal',
    monTimer:null,
  };

  const ZERO_R = { m1_vel:0, m1_acel:0, m1_temp:0, m2_vel:NaN, m2_acel:NaN, m2_temp:NaN };
  function ativoLeituras(){
    if(!window.FZStore || !state.ativoCod) return [];
    return window.FZStore.getLeituras(state.ativoCod, 120).slice().reverse();
  }
  function ativoReadingFrom(l){
    return { m1_vel:+l.vibracao_mm_s||0, m1_acel:+l.mag_rms||+l.apeak_g||0, m1_temp:+l.temperatura_c||0,
             m2_vel:NaN, m2_acel:NaN, m2_temp:NaN };
  }

  function esp32ReadingFrom(h){
    return { m1_vel:+h.vel||0, m1_acel:+h.apeak||0, m1_temp:+h.temp||0,
             m2_vel:NaN, m2_acel:NaN, m2_temp:NaN };
  }
  function esp32Leituras(){
    if(!window.FZIoT) return [];
    return window.FZIoT.getHist();
  }

  function cloudWindow(){
    if(!window.FZCloud) return [];
    const s1=window.FZCloud.getRows('s1'), s2=window.FZCloud.getRows('s2');
    const n=Math.min(s1.length, s2.length);
    const win=[];
    for(let i=0;i<n;i++) win.push({
      ts: s1[i].timestamp,
      m1_vel:+s1[i].velocidade||0, m1_acel:+s1[i].aceleracao||0, m1_temp:+s1[i].temperatura||0,
      m2_vel:+s2[i].velocidade||0, m2_acel:+s2[i].aceleracao||0, m2_temp:+s2[i].temperatura||0,
    });
    return win;
  }
  function curReading(){
    if(state.fonte==='sim') return state.simReading || readingAt(F.meta.n-1);
    if(state.fonte==='ativo'){ const ls=ativoLeituras(); return ls.length ? ativoReadingFrom(ls[ls.length-1]) : ZERO_R; }
    if(state.fonte==='esp32'){ const h=window.FZIoT&&window.FZIoT.getLast(); return h ? esp32ReadingFrom(h) : ZERO_R; }
    if(state.fonte==='cloud'){ const w=cloudWindow(); return w.length ? w[w.length-1] : ZERO_R; }
    return readingAt(state.fidx);
  }
  function curIso(){ return NORMAS[state.norma]; }

  function simStep(){
    if(!state._simR) state._simR=rng(12345);
    const r=state._simR; const M={normal:[0.8,.2],desbalanco:[3.5,.6],cavitacao:[2.6,1.0],desalinhamento:[4.9,.7]}[state.simMode];
    const mk=()=>({ vel:Math.max(0,M[0]+gauss(r)*M[1]), acel:Math.max(0,0.06+gauss(r)*0.03+(state.simMode==='cavitacao'?Math.abs(gauss(r))*0.1:0)), temp:30+gauss(r)*2.5+(M[0]>3?6:0) });
    const a=mk(), b=mk();
    state.simReading={ m1_vel:a.vel,m1_acel:a.acel,m1_temp:a.temp, m2_vel:b.vel,m2_acel:b.acel,m2_temp:b.temp };
    if(!state.simHist) state.simHist=[]; state.simHist.push(state.simReading); if(state.simHist.length>120) state.simHist.shift();
  }

  function renderMon(){
    const p=document.getElementById('fzPanel-mon'); const iso=curIso();
    const isAtivo  = state.fonte==='ativo';
    const isEsp32  = state.fonte==='esp32';
    const isCloud  = state.fonte==='cloud';
    const isObj    = state.fonte==='sim' || isAtivo || isEsp32 || isCloud;
    let r, objWin=null, tx=null;
    if(isEsp32){
      const hist=esp32Leituras();
      objWin=hist.map(esp32ReadingFrom);
      tx=hist.map((_,i)=>'-'+(hist.length-1-i)+'s');
      r=objWin.length?objWin[objWin.length-1]:ZERO_R;
    } else if(isAtivo){
      const ls=ativoLeituras();
      objWin=ls.map(ativoReadingFrom);
      tx=ls.map(l=>new Date(l.coletado_em).toLocaleTimeString('pt-BR',{hour12:false}));
      r=objWin.length?objWin[objWin.length-1]:ZERO_R;
    } else if(isCloud){
      objWin=cloudWindow();
      tx=objWin.map(o=>new Date(o.ts).toLocaleString('pt-BR',{hour12:false}));
      r=objWin.length?objWin[objWin.length-1]:ZERO_R;
    } else if(state.fonte==='sim'){
      r=state.simReading||(simStep(),state.simReading);
      objWin=state.simHist||[state.simReading]; tx=objWin.map((_,i)=>'-'+(objWin.length-1-i)+'s');
    } else { r=readingAt(state.fidx); }

    let win;
    if(isObj){ win=objWin; }
    else { const i0=Math.max(0,state.fidx-119), i1=state.fidx+1; win=[]; for(let i=i0;i<i1;i++) win.push(i); }
    const getWin=(col)=> isObj ? win.map(o=>o[col]) : win.map(i=>series(col)[i]);
    const nWin = win.length;
    const xlab = isObj ? (i=>tx[i]||'') : (k=>tlabel(win[k]));

    atualizarModalEixo(r, iso, getWin, xlab);

    const prog = isObj ? 100 : Math.round(state.fidx/(F.meta.n-1)*100);
    const tsLabel = isEsp32 ? (window.FZIoT&&window.FZIoT.isConnected()?'ESP32 ao vivo':'ESP32 desconectado')
      : isAtivo ? (objWin.length?('leituras: '+objWin.length):'sem dados do ESP')
      : isCloud ? (objWin.length?('última coleta: '+tx[tx.length-1]):'aguardando 1ª coleta do daily_bridge.py')
      : state.fonte==='sim' ? new Date().toLocaleTimeString('pt-BR',{hour12:false}) : tlabel(state.fidx);

    const scrollY=window.scrollY;
    p.innerHTML='';

    const head=el('div','fz-card');
    head.innerHTML=`<div class="fz-controls" style="margin-bottom:12px">
        <label class="fz-toggle ${state.auto?'on':''}" data-act="auto"><span class="sw"></span>Auto-refresh</label>
        <div class="fz-field"><span>Intervalo</span><select class="fz-select" data-act="interval">${[1000,2000,5000].map(v=>`<option value="${v}" ${v==state.interval?'selected':''}>${v/1000}s</option>`).join('')}</select></div>
        <div class="fz-field"><span>Passo</span><select class="fz-select" data-act="step">${[1,5,10,20].map(v=>`<option value="${v}" ${v==state.step?'selected':''}>+${v} frames</option>`).join('')}</select></div>
        ${state.fonte==='sim'?`<div class="fz-field"><span>Cenário</span><select class="fz-select" data-act="sim">${[['normal','Normal'],['desbalanco','Desbalanceamento'],['cavitacao','Cavitação'],['desalinhamento','Desalinhamento']].map(([v,l])=>`<option value="${v}" ${v==state.simMode?'selected':''}>${l}</option>`).join('')}</select></div>`:''}
      </div>
      <div class="fz-progress"><span>${isEsp32?'ESP32 ao vivo':isAtivo?('Ativo '+(state.ativoCod||'')):isCloud?'Forzy Cloud (S1/S2)':state.fonte==='sim'?'Simulado':'Dataset'} ${isObj?'':'frame '+(state.fidx+1)+'/'+F.meta.n}</span><div class="track"><div class="fill" style="width:${prog}%"></div></div><span>${tsLabel}</span></div>`;
    p.appendChild(head);

    if(isAtivo && !objWin.length){
      const vazio=el('div','fz-card');
      vazio.style.borderLeft='3px solid var(--fz-warn)';
      vazio.innerHTML=`<div class="fz-card-title">Nenhuma leitura registrada ainda para ${esc(state.ativoCod||'este ativo')}</div>
        <div class="fz-card-sub">Este ativo foi cadastrado, mas ainda não recebeu nenhuma leitura de sensor (ESP32 ou bridge). Os gráficos abaixo ficam zerados até a primeira leitura chegar.</div>
        <button class="fz-btn ghost" id="fzAtivoFalarIA" style="margin-top:10px">💬 Conversar com o Assistente sobre ${esc(state.ativoCod||'')}</button>`;
      p.appendChild(vazio);
    }

    if(isEsp32 || isAtivo){
      const label = isEsp32 ? ('ESP32 ao vivo' + (window.FZIoT&&window.FZIoT.isConnected()?' · <span style="color:var(--fz-ok)">⬤ ONLINE</span>':' · <span style="color:var(--fz-bad)">⬤ OFF</span>')) : ('Sensor do Ativo · '+(state.ativoCod||''));

      const nomeModal = isEsp32 ? 'ESP32 ao vivo' : ('Ativo '+(state.ativoCod||''));
      const card1=motorCard(label, r, iso, 'm1'); card1.classList.add('fz-card-clicavel');
      card1.addEventListener('click', ()=>abrirModalEixo('m1', nomeModal, r, iso, getWin, xlab));
      const row=el('div'); row.appendChild(card1); p.appendChild(row);
      const noteRow=el('div','fz-card-sub'); noteRow.style.cssText='margin:8px 2px 0;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap';
      const noteTxt=el('span'); noteTxt.textContent = isEsp32
        ? 'ESP32 = 1 sensor (mapeado como Eixo 1). Espectral, Operacional e Baseline ML continuam usando o Dataset Forzy.'
        : 'Clique no card acima pra abrir o chat rápido, ou fale direto com o Assistente sobre este ativo.';
      noteRow.appendChild(noteTxt);
      if(isAtivo && state.ativoCod){
        const btnChat=el('button','fz-btn ghost'); btnChat.textContent='💬 Assistente sobre '+esc(state.ativoCod);
        btnChat.style.flexShrink='0';
        btnChat.addEventListener('click', ()=>{
          if(window.FZChatScreen && window.FZChatScreen.abrirAtivo) window.FZChatScreen.abrirAtivo(state.ativoCod);
          if(typeof window.showScreen==='function') window.showScreen('assistente');
        });
        noteRow.appendChild(btnChat);
      }
      p.appendChild(noteRow);
    } else {
      const card1=motorCard('Eixo 1', r, iso, 'm1'); card1.classList.add('fz-card-clicavel');
      card1.addEventListener('click', ()=>abrirModalEixo('m1', 'Eixo 1', r, iso, getWin, xlab));
      const card2=motorCard('Eixo 2', r, iso, 'm2'); card2.classList.add('fz-card-clicavel');
      card2.addEventListener('click', ()=>abrirModalEixo('m2', 'Eixo 2', r, iso, getWin, xlab));
      const row=el('div','fz-row2'); row.appendChild(card1); row.appendChild(card2); p.appendChild(row);
    }

    const singleSensor = isAtivo || isEsp32;
    const hc=el('div','fz-card'); hc.innerHTML='<div class="fz-card-title">Histórico Recente</div><div class="fz-card-sub">Janela deslizante — últimos 120 pontos</div>'+legend(singleSensor?[{name:'ESP32',color:C.m1}]:[{name:'Eixo 1',color:C.m1},{name:'Eixo 2',color:C.m2}]);
    const charts=el('div','fz-row3');
    const specs=[['vel','Velocidade RMS','mm/s',iso.alerta,iso.alarme],['acel','Aceleração','g',ACEL_A,ACEL_AL],['temp','Temperatura','°C',TEMP_A,TEMP_AL]];
    specs.forEach(([k,title,unit,la,lal])=>{ const box=el('div'); box.innerHTML=`<div class="fz-section-label">${title} (${unit})</div>`; const ch=el('div','fz-chart fz-chart-live'); box.appendChild(ch); charts.appendChild(box);
      lineChart(ch,{ n:nWin, height:200, unit:' '+unit, dec: k==='temp'?1:3, xLabel:xlab,
        series: singleSensor
          ? [{name:'ESP32',color:C.m1,data:getWin('m1_'+k)}]
          : [{name:'Eixo 1',color:C.m1,data:getWin('m1_'+k)},{name:'Eixo 2',color:C.m2,data:getWin('m2_'+k)}],
        thresholds:[{y:la,color:C.warn},{y:lal,color:C.bad}] });
    });
    hc.appendChild(charts); p.appendChild(hc);

    if(window.lucide) lucide.createIcons();
    p.querySelectorAll('[data-act]').forEach(node=>{ const act=node.dataset.act;
      if(act==='auto') node.addEventListener('click',()=>{ state.auto=!state.auto; node.classList.toggle('on',state.auto); manageMonTimer(); });
      else node.addEventListener('change',e=>{ const v=e.target.value; if(act==='interval'){state.interval=+v; manageMonTimer();} if(act==='step')state.step=+v; if(act==='sim'){state.simMode=v; simStep();} renderMon(); });
    });
    document.getElementById('fzAtivoFalarIA')?.addEventListener('click', ()=>{
      if(state.ativoCod && window.FZChatScreen && window.FZChatScreen.abrirAtivo) window.FZChatScreen.abrirAtivo(state.ativoCod);
      if(typeof window.showScreen==='function') window.showScreen('assistente');
    });
    window.scrollTo(0, scrollY);
    manageMonTimer();
  }
  function manageMonTimer(){
    if(state.monTimer){ clearInterval(state.monTimer); state.monTimer=null; }
    const active = state.tab==='mon' && document.getElementById('screen-dashboard').classList.contains('active');
    if(state.auto && active){ state.monTimer=setInterval(()=>{ if(state.fonte==='sim'){ simStep(); } else if(state.fonte==='forzy'){ state.fidx=(state.fidx+state.step)%F.meta.n; } renderMon(); updateEsp32Btn(); }, state.interval); }
  }

  const esp = { motor:'m1', rpm:1780, janela:256, harm:true, bandas:true };
  function renderEsp(){
    const p=document.getElementById('fzPanel-esp');
    const col=esp.motor+'_acel', frot=esp.rpm/60, fs=1000, N=esp.janela;
    const acelRms=median(series(col)); const r=rng(Math.round(Math.abs(frot*100)));
    const amp1=acelRms*0.8, amp2=acelRms*0.2; const sig=new Array(N);
    for(let i=0;i<N;i++){ const t=i/fs; sig[i]=gauss(r)*acelRms*0.05 + amp1*Math.sin(2*Math.PI*frot*t) + amp2*Math.sin(2*Math.PI*2*frot*t); }
    const mu=mean(sig); for(let i=0;i<N;i++) sig[i]-=mu; const w=hanning(N); const sw=sig.map((v,i)=>v*w[i]);
    const mag=rfftMag(sw); const freqs=mag.map((_,k)=>k*fs/N);

    let pi=1; for(let k=2;k<mag.length;k++) if(mag[k]>mag[pi])pi=k; const fpeak=freqs[pi], apeak=mag[pi];
    const harmCols=[[1,C.m1,'1x'],[2,C.ok,'2x'],[3,C.warn,'3x'],[4,'#e67e22','4x']];
    const vlines=[{x:fpeak,color:C.bad,label:'Pico '+fmt(fpeak,1)+'Hz',w:1.4,dash:'5 3'}];
    if(esp.harm) harmCols.forEach(([h,cc,l])=> vlines.push({x:frot*h,color:cc,label:l,w:1}));
    const bands = esp.bandas ? [{x0:frot*0.4,x1:frot*0.6,color:'rgba(52,152,219,.10)'},{x0:frot*0.9,x1:frot*1.1,color:'rgba(230,126,34,.12)'}] : [];

    p.innerHTML='';
    const ctl=el('div','fz-card');
    ctl.innerHTML=`<div class="fz-card-title">Análise Espectral de Vibração</div>
      <div class="fz-card-sub">FFT sintética parametrizada pelo RMS real do dataset (fs=1000 Sa/s · Hanning)</div>
      <div class="fz-controls">
        <div class="fz-field"><span>Motor</span><div class="fz-seg" data-act="motor">${[['m1','Eixo 1'],['m2','Eixo 2']].map(([v,l])=>`<button data-v="${v}" class="${v==esp.motor?'active':''}">${l}</button>`).join('')}</div></div>
        <div class="fz-field"><span>RPM (harmônicas): ${esp.rpm}</span><input class="fz-range" type="range" min="500" max="4000" step="10" value="${esp.rpm}" data-act="rpm"></div>
        <div class="fz-field"><span>Janela FFT: ${esp.janela}</span><input class="fz-range" type="range" min="64" max="1024" step="64" value="${esp.janela}" data-act="janela"></div>
        <label class="fz-toggle ${esp.harm?'on':''}" data-act="harm"><span class="sw"></span>Harmônicas</label>
        <label class="fz-toggle ${esp.bandas?'on':''}" data-act="bandas"><span class="sw"></span>Bandas de falha</label>
      </div>`;
    p.appendChild(ctl);

    const fc=el('div','fz-card'); fc.innerHTML=`<div class="fz-card-sub">Espectro FFT — ${esp.motor==='m1'?'Eixo 1':'Eixo 2'} · Acel RMS ${fmt(acelRms,3)} g</div>`;
    const fchart=el('div','fz-chart'); fc.appendChild(fchart); p.appendChild(fc);
    spectrumChart(fchart,{ freqs, mag, vlines, bands, height:360 });

    const mr=el('div','fz-metrics fz-m4');
    mr.innerHTML = metric('Pico dominante', fmt(fpeak,2)+' Hz')+metric('Amplitude do pico', fmt(apeak,4)+' g')+metric('Freq. rotação (1x)', fmt(frot,2)+' Hz')+metric('Relação pico/1x', frot?fmt(fpeak/frot,2)+'x':'—');
    const mrc=el('div','fz-card'); mrc.appendChild(mr); p.appendChild(mrc);

    const nFrames=Math.min(40, Math.floor(F.meta.n/N)); const Z=[], ylab=[];
    for(let f=0; f<nFrames; f++){ const start=f*N; const seg=series(col).slice(start,start+N); if(seg.length<N)break; const m2=mean(seg); for(let i=0;i<N;i++) seg[i]=(seg[i]-m2)*w[i]; Z.push(rfftMag(seg)); ylab.push(tlabel(start)); }
    const sc=el('div','fz-card'); sc.innerHTML='<div class="fz-card-title">Espectrograma — Evolução Temporal</div>';
    const schart=el('div','fz-chart'); sc.appendChild(schart); p.appendChild(sc);
    if(Z.length){ const xl=freqs.map(f=>Math.round(f)); heatmap(schart,{ z:Z, x:xl, y:ylab, rowH:Math.max(10,Math.min(20,340/Z.length)) }); }
    else schart.innerHTML='<div class="fz-card-sub">Dados insuficientes para o espectrograma nesta janela.</div>';

    const order=mag.map((m,i)=>[m,i]).slice(1).sort((a,b)=>b[0]-a[0]).slice(0,10);
    const tc=el('div','fz-card'); tc.innerHTML='<div class="fz-card-title">Top 10 picos espectrais</div>'+
      `<table class="fz-table"><thead><tr><th>Frequência (Hz)</th><th>Amplitude (g)</th><th>Relação 1x RPM</th></tr></thead><tbody>${order.map(([m,i])=>`<tr><td>${fmt(freqs[i],3)}</td><td>${fmt(m,6)}</td><td>${frot?fmt(freqs[i]/frot,2):'—'}</td></tr>`).join('')}</tbody></table>`;
    p.appendChild(tc);

    p.querySelectorAll('[data-act]').forEach(node=>{ const act=node.dataset.act;
      if(act==='motor') node.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ esp.motor=b.dataset.v; renderEsp(); }));
      else if(act==='harm'||act==='bandas') node.addEventListener('click',()=>{ esp[act]=!esp[act]; renderEsp(); });
      else node.addEventListener('input',e=>{ esp[act]=+e.target.value; renderEsp(); });
    });
  }

  const oper = { motor:'both', sub:'timeline', va:1.8, val:4.5, aa:0.25, aal:0.45, ta:35, tal:42 };
  let _operCache=null;
  function loadOper(){
    if(_operCache) return _operCache;
    const idx=idxLinspace(F.meta.n, 1500); const r=rng(42); const o={ idx, t:idx.map(i=>i) };
    ['m1','m2'].forEach(p=>{ const v=idx.map(i=>F[p].vel[i]), a=idx.map(i=>F[p].acel[i]), te=idx.map(i=>F[p].temp[i]);
      o[p+'_vel']=v.map((x,k)=>Math.max(0, x + x*0.10*Math.sin(2*Math.PI*0.15*k) + x*0.05*Math.sin(2*Math.PI*0.35*k+0.8) + gauss(r)*clamp(x*0.04,0.003,0.12)));
      o[p+'_acel']=a.map((x,k)=>Math.max(0, x + x*0.12*Math.sin(2*Math.PI*0.20*k+0.4) + gauss(r)*clamp(x*0.05,0.001,0.04)));
      o[p+'_temp']=te.slice();
    });
    _operCache=o; return o;
  }
  function renderOper(){
    const p=document.getElementById('fzPanel-oper'); const o=loadOper(); const n=o.idx.length;
    const last=k=>k[k.length-1];
    const v1=last(o.m1_vel),v2=last(o.m2_vel),a1=last(o.m1_acel),a2=last(o.m2_acel),t1=last(o.m1_temp),t2=last(o.m2_temp);
    const f1=Math.max(flag(v1,oper.va,oper.val),flag(a1,oper.aa,oper.aal),flag(t1,oper.ta,oper.tal));
    const f2=Math.max(flag(v2,oper.va,oper.val),flag(a2,oper.aa,oper.aal),flag(t2,oper.ta,oper.tal));
    const showM1=oper.motor!=='m2', showM2=oper.motor!=='m1';
    const xlab=k=>tlabel(o.idx[k]);

    p.innerHTML='';
    const ctl=el('div','fz-card');
    ctl.innerHTML=`<div class="fz-card-title">Operacional — Dataset Forzy</div>
      <div class="fz-controls">
        <div class="fz-field"><span>Exibir</span><div class="fz-seg" data-act="motor">${[['both','Ambos'],['m1','Eixo 1'],['m2','Eixo 2']].map(([v,l])=>`<button data-v="${v}" class="${v==oper.motor?'active':''}">${l}</button>`).join('')}</div></div>
        <div class="fz-field"><span>Vel alerta/alarme</span><div style="display:flex;gap:6px"><input class="fz-select" style="width:70px" type="number" step="0.1" value="${oper.va}" data-act="va"><input class="fz-select" style="width:70px" type="number" step="0.1" value="${oper.val}" data-act="val"></div></div>
      </div>`;
    p.appendChild(ctl);

    const cards=el('div','fz-row2');
    [['m1','Eixo 1',v1,a1,t1,f1,showM1],['m2','Eixo 2',v2,a2,t2,f2,showM2]].forEach(([pre,nome,vv,aa,tt,ff])=>{
      const nAl=o[pre+'_vel'].filter(x=>x>=oper.val).length;
      const card=el('div','fz-card'); card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span style="font-weight:700;color:${pre==='m1'?C.m1:C.m2}">${nome}</span>${badge(ff)}</div>
        <div class="fz-metrics fz-m4">${metric('Velocidade',fmt(vv,3)+' mm/s')}${metric('Aceleração',fmt(aa,3)+' g')}${metric('Temperatura',fmt(tt,1)+' °C')}${metric('Alarmes',nAl)}</div>`;
      cards.appendChild(card);
    });
    p.appendChild(cards);

    const st=el('div','fz-card');
    st.innerHTML=`<div class="fz-subtabs" data-act="sub">${[['timeline','Timeline'],['analise','Análise'],['comp','Comparação'],['eventos','Eventos'],['stats','Estatísticas']].map(([v,l])=>`<button data-v="${v}" class="fz-subtab ${v==oper.sub?'active':''}">${l}</button>`).join('')}</div><div class="fz-subpanel active" id="operSub"></div>`;
    p.appendChild(st);
    const sub=st.querySelector('#operSub');

    function mkSeries(k){ const arr=[]; if(showM1)arr.push({name:'Eixo 1',color:C.m1,data:o['m1_'+k]}); if(showM2)arr.push({name:'Eixo 2',color:C.m2,data:o['m2_'+k]}); return arr; }

    if(oper.sub==='timeline'){
      const c1=el('div'); c1.innerHTML='<div class="fz-section-label">Velocidade RMS (mm/s)</div>'; const ch1=el('div','fz-chart'); c1.appendChild(ch1); sub.appendChild(c1);
      const markers=[]; if(showM1)markers.push({data:o.m1_vel,color:C.bad,idx:o.m1_vel.map((x,i)=>x>=oper.val?i:-1).filter(i=>i>=0)}); if(showM2)markers.push({data:o.m2_vel,color:C.bad,idx:o.m2_vel.map((x,i)=>x>=oper.val?i:-1).filter(i=>i>=0)});
      lineChart(ch1,{n,height:300,unit:' mm/s',xLabel:xlab,series:mkSeries('vel'),thresholds:[{y:oper.va,color:C.warn},{y:oper.val,color:C.bad}],markers});
      const row=el('div','fz-row2');
      [['temp','Temperatura','°C',oper.ta,oper.tal],['acel','Aceleração','g',oper.aa,oper.aal]].forEach(([k,t,u,la,lal])=>{ const b=el('div'); b.innerHTML=`<div class="fz-section-label">${t} (${u})</div>`; const ch=el('div','fz-chart'); b.appendChild(ch); row.appendChild(b); lineChart(ch,{n,height:220,unit:' '+u,dec:k==='temp'?1:3,xLabel:xlab,series:mkSeries(k),thresholds:[{y:la,color:C.warn},{y:lal,color:C.bad}]}); });
      sub.appendChild(row);
    }
    else if(oper.sub==='analise'){
      const g=el('div','fz-row2');
      [['Eixo 1',v1,a1,t1],['Eixo 2',v2,a2,t2]].forEach(([nm,vv,aa,tt])=>{ const card=el('div','fz-card'); card.innerHTML=`<div class="fz-card-title">${nm}</div><div class="fz-gauges">
        <div class="fz-gauge">${gaugeSVG(vv,Math.max(oper.val*1.5,10),oper.va,oper.val,'mm/s',3)}<div class="g-cap">Velocidade</div></div>
        <div class="fz-gauge">${gaugeSVG(aa,1,oper.aa,oper.aal,'g',3)}<div class="g-cap">Aceleração</div></div>
        <div class="fz-gauge">${gaugeSVG(tt,85,oper.ta,oper.tal,'°C',1)}<div class="g-cap">Temperatura</div></div></div>`; g.appendChild(card); });
      sub.appendChild(g);

      const tcard=el('div','fz-card'); tcard.innerHTML='<div class="fz-card-title">Tendência Preditiva — próximos 30 passos</div>'; const tch=el('div','fz-chart'); tcard.appendChild(tch); sub.appendChild(tcard);
      const ser=[]; const EXT=30;
      mkSeries('vel').forEach(s=>{ const yv=s.data, m=yv.length; let sx=0,sy=0,sxx=0,sxy=0; for(let i=0;i<m;i++){sx+=i;sy+=yv[i];sxx+=i*i;sxy+=i*yv[i];} const b=(m*sxy-sx*sy)/(m*sxx-sx*sx), a=(sy-b*sx)/m; const ext=yv.concat(Array.from({length:EXT},(_,k)=>Math.max(0,a+b*(m+k)))); ser.push({name:s.name,color:s.color,data:ext}); });
      lineChart(tch,{n:n+EXT,height:280,unit:' mm/s',xLabel:i=>i<n?xlab(i):'+'+(i-n+1),series:ser,thresholds:[{y:oper.va,color:C.warn},{y:oper.val,color:C.bad}]});
    }
    else if(oper.sub==='comp'){
      const row=el('div','fz-row2');
      const bp=el('div','fz-card'); bp.innerHTML='<div class="fz-card-title">Distribuição M1 × M2</div>'+legend([{name:'Eixo 1',color:C.m1},{name:'Eixo 2',color:C.m2}]); const bpc=el('div','fz-chart'); bp.appendChild(bpc); row.appendChild(bp);
      boxplot(bpc,[ {title:'Velocidade',boxes:[{name:'M1',color:C.m1,data:o.m1_vel},{name:'M2',color:C.m2,data:o.m2_vel}]},
        {title:'Aceleração',boxes:[{name:'M1',color:C.m1,data:o.m1_acel},{name:'M2',color:C.m2,data:o.m2_acel}]},
        {title:'Temperatura',boxes:[{name:'M1',color:C.m1,data:o.m1_temp},{name:'M2',color:C.m2,data:o.m2_temp}]} ]);

      const cc=el('div','fz-card'); cc.innerHTML='<div class="fz-card-title">Matriz de Correlação</div>'; const cch=el('div','fz-chart'); cc.appendChild(cch); row.appendChild(cc);
      const labels=['M1 Vel','M1 Acel','M1 Temp','M2 Vel','M2 Acel','M2 Temp']; const cols=['m1_vel','m1_acel','m1_temp','m2_vel','m2_acel','m2_temp'];
      const Z=cols.map(a=>cols.map(b=>pearson(o[a],o[b])));
      heatmap(cch,{z:Z,x:labels,y:labels,text:true,diverging:true,zmin:-1,zmax:1,cell:Math.min(70,560/6),rowH:30,padL:64});
      sub.appendChild(row);
    }
    else if(oper.sub==='eventos'){
      const evs=[];
      [['m1','Eixo 1'],['m2','Eixo 2']].forEach(([pre,nm])=>{ [['vel',oper.va,oper.val,'mm/s'],['acel',oper.aa,oper.aal,'g'],['temp',oper.ta,oper.tal,'°C']].forEach(([k,la,lal,u])=>{ const arr=o[pre+'_'+k]; [[2,'ALARME',lal],[1,'Alerta',la]].forEach(([lvl,tipo,th])=>{ const pts=arr.map((x,i)=>x>=th && (lvl===2? x>=lal : (x>=la && x<lal))?i:-1).filter(i=>i>=0); if(pts.length){ const vals=pts.map(i=>arr[i]); evs.push({nm,vr:k,tipo,ini:tlabel(o.idx[pts[0]]),fim:tlabel(o.idx[pts[pts.length-1]]),pico:fmt(Math.max(...vals),3)+' '+u,oc:pts.length}); } }); }); });
      const card=el('div','fz-card');
      if(evs.length) card.innerHTML='<div class="fz-card-title">Eventos detectados</div>'+`<table class="fz-table"><thead><tr><th>Motor</th><th>Variável</th><th>Tipo</th><th>Primeiro</th><th>Último</th><th>Pico</th><th>Ocorrências</th></tr></thead><tbody>${evs.sort((a,b)=>a.tipo<b.tipo?1:-1).map(e=>`<tr><td>${e.nm}</td><td>${e.vr}</td><td>${badge(e.tipo==='ALARME'?2:1)}</td><td>${e.ini}</td><td>${e.fim}</td><td>${e.pico}</td><td>${e.oc}</td></tr>`).join('')}</tbody></table>`;
      else card.innerHTML='<div class="fz-card-title">Eventos detectados</div><div class="fz-banner" style="background:'+C.ok+'">Nenhum evento no período.</div>';
      sub.appendChild(card);
    }
    else if(oper.sub==='stats'){
      const map=[['M1 Vel (mm/s)','m1_vel'],['M1 Acel (g)','m1_acel'],['M1 Temp (°C)','m1_temp'],['M2 Vel (mm/s)','m2_vel'],['M2 Acel (g)','m2_acel'],['M2 Temp (°C)','m2_temp']];
      const card=el('div','fz-card'); card.innerHTML='<div class="fz-card-title">Estatísticas do período</div>'+
        `<table class="fz-table"><thead><tr><th>Variável</th><th>Mín</th><th>Média</th><th>Máx</th><th>Desvio</th><th>P95</th></tr></thead><tbody>${map.map(([l,c])=>{const d=o[c],s=d.slice().sort((a,b)=>a-b);return `<tr><td>${l}</td><td>${fmt(s[0],3)}</td><td>${fmt(mean(d),3)}</td><td>${fmt(s[s.length-1],3)}</td><td>${fmt(std(d),3)}</td><td>${fmt(quantile(s,.95),3)}</td></tr>`;}).join('')}</tbody></table>
        <button class="fz-btn ghost" id="operExport" style="margin-top:12px"><i data-lucide="download"></i> Exportar CSV</button>`;
      sub.appendChild(card);
      card.querySelector('#operExport').addEventListener('click',()=>{ let csv='timestamp,'+['m1_vel','m1_acel','m1_temp','m2_vel','m2_acel','m2_temp'].join(',')+'\n'; for(let i=0;i<n;i++) csv+=tlabel(o.idx[i])+','+['m1_vel','m1_acel','m1_temp','m2_vel','m2_acel','m2_temp'].map(c=>fmt(o[c][i],4)).join(',')+'\n'; dl(csv,'forzy_operacional.csv','text/csv'); });
    }

    if(window.lucide) lucide.createIcons();
    st.querySelector('[data-act="sub"]').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ oper.sub=b.dataset.v; renderOper(); }));
    ctl.querySelector('[data-act="motor"]').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ oper.motor=b.dataset.v; renderOper(); }));
    ctl.querySelectorAll('input[data-act]').forEach(inp=>inp.addEventListener('change',e=>{ oper[e.target.dataset.act]=+e.target.value; renderOper(); }));
  }
  function pearson(a,b){ const ma=mean(a),mb=mean(b); let n=0,da=0,db=0; for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb; n+=x*y; da+=x*x; db+=y*y;} return (da&&db)? n/Math.sqrt(da*db):0; }
  function dl(content,name,mime){ const blob=new Blob([content],{type:mime}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href); }

  const hist = { variavel:'vel', speed:150, frame:0, playing:false, timer:null, motores:{m1:true,m2:true} };
  const HVAR={ vel:{u:'mm/s',la:1.8,lal:4.5,lbl:'Velocidade',dec:3}, acel:{u:'g',la:0.25,lal:0.45,lbl:'Aceleração',dec:3}, temp:{u:'°C',la:35,lal:42,lbl:'Temperatura',dec:1} };
  let _histData=null, _histFonte=null;

  function loadHist(){
    if(_histData && _histFonte===state.fonte) return _histData;
    _histFonte = state.fonte;
    hist.frame = 0;
    if(state.fonte==='cloud'){
      const rows = cloudWindow();
      _histData = { idx: rows.map((_,i)=>i), xlabel: i => rows[i] ? new Date(rows[i].ts).toLocaleString('pt-BR',{hour12:false}) : '' };
      ['m1','m2'].forEach(pp=>{ ['vel','acel','temp'].forEach(k=>{ _histData[pp+'_'+k]=rows.map(o=>o[pp+'_'+k]||0); }); });
      return _histData;
    }
    const idx=idxLinspace(F.meta.n,200);
    _histData={ idx, xlabel: i => tlabel(idx[i]) };
    ['m1','m2'].forEach(pp=>{ ['vel','acel','temp'].forEach(k=>{ _histData[pp+'_'+k]=idx.map(i=>F[pp][k][i]); }); });
    return _histData;
  }
  function renderHist(){
    const p=document.getElementById('fzPanel-hist'); const d=loadHist(); const N=d.idx.length; const cfg=HVAR[hist.variavel];
    if(!N){
      p.innerHTML=`<div class="fz-card"><div class="fz-card-title">Histórico — Forzy Cloud</div>
        <div class="fz-card-sub">Nenhuma coleta registrada ainda. O <code>daily_bridge.py</code> grava em
        <code>dados/forzy_cloud_log.csv</code> de hora em hora — o histórico aparece aqui a partir da 1ª leitura.</div></div>`;
      return;
    }
    if(hist.frame<1) hist.frame=1; if(hist.frame>N) hist.frame=N;
    p.innerHTML='';
    const ctl=el('div','fz-card');
    ctl.innerHTML=`<div class="fz-card-title">▶ Player — Timelapse Operacional</div>
      <div class="fz-controls">
        <div class="fz-field"><span>Variável</span><div class="fz-seg" data-act="var">${Object.entries(HVAR).map(([k,c])=>`<button data-v="${k}" class="${k==hist.variavel?'active':''}">${c.lbl}</button>`).join('')}</div></div>
        <div class="fz-field"><span>Velocidade: ${hist.speed} ms/frame</span><input class="fz-range" type="range" min="50" max="800" step="50" value="${hist.speed}" data-act="speed"></div>
        <label class="fz-toggle ${hist.motores.m1?'on':''}" data-act="m1"><span class="sw"></span>Eixo 1</label>
        <label class="fz-toggle ${hist.motores.m2?'on':''}" data-act="m2"><span class="sw"></span>Eixo 2</label>
      </div>
      <div class="fz-controls" style="margin-top:10px">
        <button class="fz-btn" data-act="play">${hist.playing?'⏸ Pause':'▶ Play'}</button>
        <button class="fz-btn ghost" data-act="reset">⏮ Reset</button>
        <div class="fz-field" style="flex:1;min-width:200px"><span>T: ${d.xlabel(hist.frame-1)} — frame ${hist.frame}/${N}</span><input class="fz-range" type="range" min="1" max="${N}" value="${hist.frame}" data-act="scrub" style="width:100%"></div>
      </div>`;
    p.appendChild(ctl);

    const card=el('div','fz-card'); const ch=el('div','fz-chart'); card.appendChild(ch); p.appendChild(card);
    const sl=hist.frame; const ser=[];
    if(hist.motores.m1) ser.push({name:'Eixo 1',color:C.m1,data:d['m1_'+hist.variavel].slice(0,sl)});
    if(hist.motores.m2) ser.push({name:'Eixo 2',color:C.m2,data:d['m2_'+hist.variavel].slice(0,sl)});
    let ymax=0; ['m1','m2'].forEach(pp=>d[pp+'_'+hist.variavel].forEach(v=>{if(v>ymax)ymax=v;})); ymax*=1.15;
    const markers=ser.map(s=>({data:s.data,color: s.data[sl-1]>=cfg.lal?C.bad:(s.data[sl-1]>=cfg.la?C.warn:C.ok), idx:[sl-1]}));
    lineChart(ch,{n:sl,height:420,yMax:ymax,unit:' '+cfg.u,dec:cfg.dec,xLabel:i=>d.xlabel(i),series:ser,
      bands:[{y0:0,y1:cfg.la,color:'rgba(46,204,113,.07)'},{y0:cfg.la,y1:cfg.lal,color:'rgba(243,156,18,.07)'},{y0:cfg.lal,y1:ymax,color:'rgba(231,76,60,.07)'}],
      thresholds:[{y:cfg.la,color:C.warn},{y:cfg.lal,color:C.bad}], markers });

    const sc=el('div','fz-card'); const m1=d['m1_'+hist.variavel],m2=d['m2_'+hist.variavel];
    sc.innerHTML='<div class="fz-card-title">Estatísticas — '+cfg.lbl+'</div><div class="fz-metrics fz-m6">'+
      metric('M1 Máx',fmt(Math.max(...m1),cfg.dec))+metric('M1 Média',fmt(mean(m1),cfg.dec))+metric('M1 Desvio',fmt(std(m1),cfg.dec))+
      metric('M2 Máx',fmt(Math.max(...m2),cfg.dec))+metric('M2 Média',fmt(mean(m2),cfg.dec))+metric('M2 Desvio',fmt(std(m2),cfg.dec))+'</div>';
    p.appendChild(sc);

    ctl.querySelector('[data-act="var"]').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ hist.variavel=b.dataset.v; renderHist(); }));
    ctl.querySelector('[data-act="speed"]').addEventListener('input',e=>{ hist.speed=+e.target.value; if(hist.playing) histPlay(true); renderHistControlsOnly(ctl,d,N); });
    ['m1','m2'].forEach(m=>ctl.querySelector(`[data-act="${m}"]`).addEventListener('click',()=>{ hist.motores[m]=!hist.motores[m]; renderHist(); }));
    ctl.querySelector('[data-act="play"]').addEventListener('click',()=>{ hist.playing=!hist.playing; histPlay(hist.playing); renderHist(); });
    ctl.querySelector('[data-act="reset"]').addEventListener('click',()=>{ hist.frame=1; hist.playing=false; histPlay(false); renderHist(); });
    ctl.querySelector('[data-act="scrub"]').addEventListener('input',e=>{ hist.frame=+e.target.value; hist.playing=false; histPlay(false); renderHist(); });
  }
  function renderHistControlsOnly(){  }
  function histPlay(on){
    if(hist.timer){ clearInterval(hist.timer); hist.timer=null; }
    if(!on) return;
    const N=loadHist().idx.length;
    hist.timer=setInterval(()=>{ const active = state.tab==='hist' && document.getElementById('screen-dashboard').classList.contains('active'); if(!active){ return; } hist.frame++; if(hist.frame>=N){ hist.frame=N; hist.playing=false; histPlay(false); } renderHist(); }, hist.speed);
  }

  const ml = { vars:['m1_vel','m2_vel'] };
  let _mlSerie=null;

  function mlSerie(){
    if(_mlSerie) return _mlSerie;
    const idx=idxLinspace(F.meta.n,400);
    const rows=idx.map(i=>{
      const leitura=readingAt(i);
      const z=zscore(leitura);
      const r=avaliarRede(leitura);
      return { i, leitura, z, zs:maxZ(z),
               score: r&&r.ok ? r.indice : maxZ(z),
               nivel: r&&r.ok ? r.nivelRede : (maxZ(z)>=3?2:(maxZ(z)>=2?1:0)),
               erroCol: r&&r.ok ? r.fora : null };
    });
    _mlSerie={idx,rows}; return _mlSerie;
  }
  function renderMl(){
    const p=document.getElementById('fzPanel-ml');
    const m=rede(); const meta=m?m.info():null;
    const live=curReading();
    const r=avaliarRede(live);
    const z=zscore(live); const zs=maxZ(z);
    p.innerHTML='';

    if(!m){
      const w=el('div','fz-card');
      w.innerHTML='<div class="fz-card-title">Rede neural indisponível</div><div class="fz-card-sub">'
        +'O arquivo <code>data/forzy-model.js</code> não carregou. Rode <code>python treinar_modelo.py</code> para gerar os pesos. '
        +'Exibindo o modelo estatístico antigo (Z-score) como reserva.</div>';
      p.appendChild(w);
    }

    const net=el('div','fz-card fz-ml-net');
    net.innerHTML=`
      <div class="fz-card-title">Detector de Anomalia — Rede Neural (Autoencoder)</div>
      <div class="fz-card-sub">
        Não é uma lista de limites fixos. É uma rede treinada com o histórico completo do Dataset Forzy
        que aprendeu sozinha como as seis variáveis dos dois eixos se relacionam. Ela tenta reconstruir
        cada leitura; quando não consegue, é porque aquela <b>combinação</b> de valores nunca aconteceu na máquina —
        e isso é a anomalia.
      </div>
      ${meta?`<div class="fz-ml-specs">
        <div class="fz-ml-spec"><span>Arquitetura</span><b>${meta.arquitetura}</b><i>gargalo de 2 neurônios</i></div>
        <div class="fz-ml-spec"><span>Parâmetros</span><b>${meta.parametros}</b><i>pesos e vieses treinados</i></div>
        <div class="fz-ml-spec"><span>Amostras</span><b>${meta.amostras.toLocaleString('pt-BR')}</b><i>+ ${meta.validacao.toLocaleString('pt-BR')} de validação</i></div>
        <div class="fz-ml-spec"><span>Épocas</span><b>${meta.epocas}</b><i>otimizador Adam</i></div>
        <div class="fz-ml-spec"><span>Erro treino</span><b>${meta.mseTreino.toFixed(6)}</b><i>MSE</i></div>
        <div class="fz-ml-spec"><span>Erro validação</span><b>${meta.mseValidacao.toFixed(6)}</b><i>sem sobreajuste</i></div>
      </div>
      <div class="fz-ml-nota">Treino offline em <code>treinar_modelo.py</code> (NumPy) · pesos em <code>data/forzy-model.js</code> ·
      inferência no browser em <code>modelo.js</code> · versão ${escHtml(meta.versao)}, gerada em ${escHtml(meta.gerado)}</div>`:''}`;
    p.appendChild(net);

    const limCrit=r&&r.ok?r.limCritico:2.56;
    const isaCard=el('div','fz-card fz-isa-ref-card');
    isaCard.innerHTML=`
      <div class="fz-card-title" style="font-size:12px;color:var(--teal,#8aa9c9)">Do índice da rede para a prioridade ISA-18.2</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
        <span class="fz-badge fz-badge-isa fz-badge-ok">Índice &lt; 1,00 &nbsp;· Normal (sem alarme)</span>
        <span class="fz-badge fz-badge-isa fz-badge-warn">1,00 – ${fmt(limCrit,2)} &nbsp;· P2 Alto (verificar)</span>
        <span class="fz-badge fz-badge-isa fz-badge-bad">≥ ${fmt(limCrit,2)} &nbsp;· P1 Crítico (intervir)</span>
      </div>
      <div style="margin-top:6px;font-size:10px;color:rgba(255,255,255,.35)">
        Os limiares não foram escolhidos a dedo: saem da própria distribuição de erro da rede sobre o histórico
        (percentil 95 → atenção, percentil 99,5 → crítico). O veredito final é o <b>pior</b> entre a rede e a norma
        ISO 10816 / ISA-18.2 — o modelo pode agravar um alarme, nunca silenciar um alarme normativo.
      </div>`;
    p.appendChild(isaCard);

    const score=r&&r.ok?r.indice:zs;
    const cor=r&&r.ok?r.cor:classify(zs)[1];
    const classe=r&&r.ok?r.rotulo:classify(zs)[0];
    const gMax=Math.max(limCrit*1.6, Math.min(score*1.25, 12));

    const top=el('div','fz-card'); top.style.display='grid'; top.style.gridTemplateColumns='240px 1fr'; top.style.gap='18px';
    const ga=el('div'); ga.style.textAlign='center';
    ga.innerHTML=`<div class="fz-section-label" style="text-align:center">Índice de anomalia</div>
      <div class="fz-gauge">${gaugeSVG(Math.min(score,gMax),gMax,1,limCrit,'',2)}</div>
      <div style="margin-top:8px"><span class="fz-badge" style="background:${cor}22;color:${cor};border:1px solid ${cor};font-size:12px;padding:5px 18px">${escHtml(classe.toUpperCase())}</span></div>
      ${r&&r.ok&&score>gMax?`<div class="fz-ml-nota" style="margin-top:6px">valor real ${fmt(score,1)} — ponteiro no fim de escala</div>`:''}
      ${r&&r.ok?`<div class="fz-ml-fonte">${r.motivo==='ambos'?'rede neural + norma':r.motivo==='rede'?'detectado pela rede':r.motivo==='norma'?'limite normativo':'dentro do esperado'}</div>`:''}`;
    top.appendChild(ga);

    const dir=el('div');
    if(r&&r.ok){
      dir.appendChild(el('div','fz-ml-explica',escHtml(r.explicacao)));
      const zg=el('div','fz-zgrid');
      r.fora.forEach(f=>{
        const b=BL[f.col];
        const un=f.unidade;
        const dif=f.medido-f.esperado;
        const forte=f.pct>=0.30;
        const cc=forte?(r.nivelRede?C.warn:C.m1):'transparent';
        zg.appendChild(el('div','fz-zcard',
          `<div class="z-lbl">${escHtml(b.label)}</div>
           <div class="z-top"><span class="z-val">${fmt(f.medido,3)} ${escHtml(un)}</span>
             <span class="z-z" style="color:${forte?C.warn:'var(--text-2)'}">${(f.pct*100).toFixed(0)}%</span></div>
           <div class="z-desvio">rede esperava ${fmt(f.esperado,3)} ${escHtml(un)} <b style="color:${Math.abs(dif)>1e-9&&forte?C.warn:'inherit'}">(${dif>=0?'+':''}${fmt(dif,3)})</b></div>
           <div class="z-base">${(f.pct*100).toFixed(0)}% do erro de reconstrução</div>`));
        zg.lastChild.style.borderLeftColor=cc;
      });
      dir.appendChild(zg);
    } else {
      const zg=el('div','fz-zgrid');
      COLS.forEach(c=>{ const zz=z[c]; const [,zc]=classify(zz); const b=BL[c];
        zg.appendChild(el('div','fz-zcard',`<div class="z-lbl">${escHtml(b.label)}</div><div class="z-top"><span class="z-val">${fmt(live[c],3)} ${b.unit==='C'?'°C':escHtml(b.unit)}</span><span class="z-z" style="color:${zc}">Z=${fmt(zz,2)}</span></div><div class="z-base">média ${fmt(b.mean,3)} ± ${fmt(b.std,3)}</div>`));
        zg.lastChild.style.borderLeftColor=zc; });
      dir.appendChild(zg);
    }
    top.appendChild(dir);
    p.appendChild(top);

    const s=mlSerie();

    const ec=el('div','fz-card'); ec.innerHTML='<div class="fz-section-label">Índice de Anomalia da Rede — Dataset Histórico</div>';
    const ech=el('div','fz-chart'); ec.appendChild(ech); p.appendChild(ec);
    let smax=0; s.rows.forEach(x=>{ if(x.score>smax) smax=x.score; });
    smax=Math.max(Math.min(smax*1.1, limCrit*6), limCrit*1.4);
    lineChart(ech,{n:s.rows.length,height:260,yMax:smax,dec:3,xLabel:i=>tlabel(s.idx[i]),
      series:[{name:'Índice (rede neural)',color:'#7ec8e3',data:s.rows.map(x=>Math.min(x.score,smax))}],
      bands:[{y0:0,y1:1,color:'rgba(46,204,113,.06)'},{y0:1,y1:limCrit,color:'rgba(243,156,18,.08)'},{y0:limCrit,y1:smax,color:'rgba(231,76,60,.08)'}],
      thresholds:[{y:1,color:C.warn},{y:limCrit,color:C.bad}] });

    if(m){
      const pior=F.m1.vel.indexOf(Math.max.apply(null,F.m1.vel));
      const lPior=readingAt(pior>=0?pior:0);
      const rPior=avaliarRede(lPior); const zPior=maxZ(zscore(lPior));
      const lImp={ m1_vel:7.0, m1_acel:0.50, m1_temp:32.0, m2_vel:0.05, m2_acel:0.00, m2_temp:36.0 };
      const rImp=avaliarRede(lImp); const zImp=maxZ(zscore(lImp));

      const cmp=el('div','fz-card');
      cmp.innerHTML=`
        <div class="fz-section-label">Por que a rede substituiu o Z-score</div>
        <div class="fz-card-sub">O modelo estatístico anterior media cada variável isolada contra a própria média.
        Como a máquina fica metade do tempo parada, a distribuição é bimodal e o desvio-padrão do
        <code>m1_vel</code> (${fmt(BL.m1_vel.std,2)}) ficou maior que a média (${fmt(BL.m1_vel.mean,2)}).
        Resultado: nada dava Z alto — nem o pior frame do dataset.</div>
        <table class="fz-table" style="margin-top:10px">
          <thead><tr><th>Cenário</th><th>ISO 10816</th><th>Z-score (antigo)</th><th>Rede neural (atual)</th></tr></thead>
          <tbody>
            <tr>
              <td>Pior vibração do dataset — ${fmt(lPior.m1_vel,2)} mm/s nos dois eixos</td>
              <td style="color:${C.bad}">ALARME</td>
              <td style="color:${classify(zPior)[1]}">Z = ${fmt(zPior,2)} · ${escHtml(classify(zPior)[0])}</td>
              <td style="color:${rPior?rPior.cor:''}">índice ${rPior?fmt(rPior.indice,2):'—'} · ${escHtml(rPior?rPior.rotulo:'—')}</td>
            </tr>
            <tr>
              <td>Eixo 1 a 7,00 mm/s com o eixo 2 parado — fisicamente impossível nesta bomba</td>
              <td style="color:${C.bad}">ALARME</td>
              <td style="color:${classify(zImp)[1]}">Z = ${fmt(zImp,2)} · ${escHtml(classify(zImp)[0])}</td>
              <td style="color:${rImp?rImp.cor:''}">índice ${rImp?fmt(rImp.indice,2):'—'} · ${escHtml(rImp?rImp.rotulo:'—')}</td>
            </tr>
          </tbody>
        </table>
        <div class="fz-ml-nota" style="margin-top:8px">O segundo caso é o que nenhum limite fixo pega: cada valor, sozinho,
        passa em qualquer <i>if</i>. Só um modelo que aprendeu que os dois eixos têm correlação 1,00 percebe que a
        combinação não existe.</div>`;
      p.appendChild(cmp);

      const cmpCh=el('div','fz-card');
      cmpCh.innerHTML='<div class="fz-section-label">As duas curvas sobre o mesmo histórico (1,00 = limiar de atenção de cada modelo)</div>';
      const cch=el('div','fz-chart'); cmpCh.appendChild(cch); p.appendChild(cmpCh);
      lineChart(cch,{n:s.rows.length,height:230,yMax:4,dec:2,xLabel:i=>tlabel(s.idx[i]),
        series:[
          {name:'Rede neural (÷ 1,00)',color:'#7ec8e3',data:s.rows.map(x=>Math.min(x.score,4))},
          {name:'Z-score antigo (÷ 2,00)',color:'#9b59b6',data:s.rows.map(x=>Math.min(x.zs/2,4))},
        ],
        thresholds:[{y:1,color:C.warn}] });
    }

    if(m){
      const zc2=el('div','fz-card');
      zc2.innerHTML='<div class="fz-section-label">Erro de Reconstrução por Variável — onde a rede erra mais</div>'
        +'<div class="fz-card-sub">Quanto cada sensor contribuiu para o índice, ao longo do histórico. Um pico isolado numa variável só costuma indicar problema de sensor; picos casados indicam problema mecânico.</div>';
      const sel=el('div','fz-controls'); sel.style.marginBottom='10px';
      COLS.forEach(c=>{ const on=ml.vars.includes(c); const b=el('button','fz-subtab '+(on?'active':''),BL[c].label);
        b.addEventListener('click',()=>{ if(ml.vars.includes(c)) ml.vars=ml.vars.filter(x=>x!==c); else ml.vars.push(c); renderMl(); }); sel.appendChild(b); });
      zc2.appendChild(sel); const zch=el('div','fz-chart'); zc2.appendChild(zch); p.appendChild(zc2);
      const palette=['#3498db','#2ecc71','#e74c3c','#f39c12','#9b59b6','#1abc9c'];
      const zser=ml.vars.map((c,i)=>({name:BL[c].label,color:palette[i%palette.length],
        data:s.rows.map(x=>{ if(!x.erroCol) return 0; const f=x.erroCol.find(y=>y.col===c); return f?f.pct*100:0; })}));
      lineChart(zch,{n:s.rows.length,height:250,yMax:100,dec:1,xLabel:i=>tlabel(s.idx[i]),
        series:zser.length?zser:[{name:'—',color:C.m1,data:s.rows.map(()=>0)}]});
    }

    const tc=el('div','fz-card'); tc.innerHTML='<div class="fz-section-label">Estatísticas do Baseline (Dataset Completo)</div>'+
      `<table class="fz-table"><thead><tr><th>Variável</th><th>Unidade</th><th>Média</th><th>Desvio</th><th>P5</th><th>P95</th><th>N</th></tr></thead><tbody>${COLS.map(c=>{const b=BL[c];return `<tr><td>${b.label}</td><td>${b.unit==='C'?'°C':b.unit}</td><td>${fmt(b.mean,3)}</td><td>${fmt(b.std,3)}</td><td>${fmt(b.p5,3)}</td><td>${fmt(b.p95,3)}</td><td>${b.n}</td></tr>`;}).join('')}</tbody></table>`;
    p.appendChild(tc);
  }

  function ativosReais(){
    if(!window.FZStore) return [];
    return window.FZStore.getAtivosIndustrial().filter(a=> a.origem!=='forzy' && !['FZ-M1','FZ-M2','FZ-M3'].includes(a.tag));
  }
  function updateLiveBadge(){
    const b=document.getElementById('fzLiveBadge'); if(!b)return;
    const [cl,co,,r]=veredito(curReading());
    const tip = r ? 'Rede neural · índice '+fmt(r.indice,2)+(r.motivo?' ('+r.motivo+')':'') : 'Z-score';
    b.innerHTML=`<span class="fz-badge" style="background:${co}22;color:${co};border:1px solid ${co}" title="${escHtml(tip)}">${escHtml(cl.toUpperCase())}</span>`;
  }
  function renderSourceBar(){
    const sb=document.getElementById('fzSourceBar');
    const ativos=ativosReais();
    if(state.fonte==='ativo' && !state.ativoCod && ativos.length) state.ativoCod=ativos[0].codigo;
    const esp32Connected = window.FZIoT && window.FZIoT.isConnected();
    const cloudLoaded = window.FZCloud && window.FZCloud.isLoaded();

    const isV2 = !!document.querySelector('.nav-group-flat');

    if(!isV2){

      sb.innerHTML=`
        <div class="fz-field"><span>Fonte de dados</span><div class="fz-seg" data-act="fonte">
          ${[['forzy','Dataset Forzy (rede neural)'],['ativo','Ativo Cadastrado'],['sim','Simulado']].map(([v,l])=>`<button data-v="${v}" class="${v==state.fonte?'active':''}">${l}</button>`).join('')}
          <button data-v="esp32" class="${'esp32'==state.fonte?'active':''}" style="${esp32Connected?'color:var(--fz-ok)':'opacity:.55'}">
            ⬤ ESP32
          </button>
          <button data-v="cloud" class="${'cloud'==state.fonte?'active':''}" style="${cloudLoaded?'color:var(--fz-ok)':'opacity:.55'}" title="S1/S2 via daily_bridge.py — só a aba Monitoramento usa essa fonte">
            ⬤ Forzy Cloud
          </button>
        </div></div>
        ${state.fonte==='ativo'?`<div class="fz-field"><span>Ativo</span><select class="fz-select" data-act="ativocod">${ativos.length?ativos.map(a=>`<option value="${a.codigo}" ${a.codigo==state.ativoCod?'selected':''}>${a.codigo}${a.tag?' · '+a.tag:''}</option>`).join(''):'<option value="">— nenhum ativo criado —</option>'}</select></div>`:''}
        <div class="fz-field"><span>Norma ISO</span><select class="fz-select" data-act="norma">${Object.keys(NORMAS).map(k=>`<option ${k==state.norma?'selected':''}>${k}</option>`).join('')}</select><span class="fz-badge fz-badge-isa-sb" title="ISA-18.2:2016 — Management of Alarm Systems">ISA-18.2</span></div>
        <div class="fz-field" style="margin-left:auto"><span>Estado atual</span><div id="fzLiveBadge"></div></div>`;
      sb.querySelector('[data-act="fonte"]').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ state.fonte=b.dataset.v; if(state.fonte==='sim'){ simStep(); } if(state.fonte==='ativo' && !state.ativoCod){ state.ativoCod=ativos[0]?ativos[0].codigo:null; } renderSourceBar(); rerenderActive(true); }));
      const acs0=sb.querySelector('[data-act="ativocod"]'); if(acs0) acs0.addEventListener('change',e=>{ state.ativoCod=e.target.value; rerenderActive(true); });
      sb.querySelector('[data-act="norma"]').addEventListener('change',e=>{ state.norma=e.target.value; rerenderActive(true); });
      updateLiveBadge();
      return;
    }

    const FONTES=[
      ['forzy','Dataset Forzy (rede neural)', true],
      ['ativo','Ativo Cadastrado', true],
      ['sim','Simulado', true],
      ['esp32','ESP32', esp32Connected],
      ['cloud','Forzy Cloud', cloudLoaded],
    ];
    const cur = FONTES.find(f=>f[0]===state.fonte) || FONTES[0];
    sb.innerHTML=`
      <div class="fz-field">
        <span title="De onde vêm os números dos gráficos abaixo. Para organizar os ativos por planta/área, use Ativos → Plantas &amp; Áreas.">Fonte de dados ⓘ</span>
        <div class="fz-fonte-picker" data-act="fonte">
          <button class="fz-fonte-current" data-act="toggle-fonte" type="button">
            <span class="fz-fonte-dot" style="background:${cur[2]?'var(--fz-ok)':'var(--text-3)'}"></span>
            <span>${cur[1]}</span>
            <i data-lucide="chevron-down"></i>
          </button>
          <div class="fz-fonte-drop" id="fzFonteDrop">
            ${FONTES.filter(f=>f[0]!==state.fonte).map(([v,l,on])=>`<button data-v="${v}" ${v==='cloud'?'title="S1/S2 via daily_bridge.py — só a aba Monitoramento usa essa fonte"':v==='ativo'?'title="Mostra as leituras de UM ativo cadastrado, escolhido no campo Ativo ao lado. Pra ver a organização por planta e área, vá em Ativos → Plantas & Áreas."':''}><span class="fz-fonte-dot" style="background:${on?'var(--fz-ok)':'var(--text-3)'}"></span>${l}</button>`).join('')}
          </div>
        </div>
      </div>
      ${state.fonte==='ativo'?`<div class="fz-field"><span>Ativo</span><select class="fz-select" data-act="ativocod">${ativos.length?ativos.map(a=>`<option value="${a.codigo}" ${a.codigo==state.ativoCod?'selected':''}>${a.codigo}${a.tag?' · '+a.tag:''}</option>`).join(''):'<option value="">— nenhum ativo criado —</option>'}</select></div>`:''}
      <div class="fz-field" style="margin-left:auto"><span>Estado atual</span><div id="fzLiveBadge"></div></div>
      <div class="fz-norm-wrap">
        <button class="fz-btn ghost fz-norm-gear" id="fzNormGear" type="button" title="Norma ISO / ISA-18.2"><i data-lucide="settings-2"></i></button>
        <div class="fz-norm-pop" id="fzNormPop">
          <div class="fz-field"><span>Norma ISO</span><select class="fz-select" data-act="norma">${Object.keys(NORMAS).map(k=>`<option ${k==state.norma?'selected':''}>${k}</option>`).join('')}</select></div>
          <span class="fz-badge fz-badge-isa-sb" title="ISA-18.2:2016 — Management of Alarm Systems">ISA-18.2</span>
        </div>
      </div>`;
    const picker = sb.querySelector('.fz-fonte-picker');
    picker.querySelector('[data-act="toggle-fonte"]').addEventListener('click', e=>{ e.stopPropagation(); document.querySelectorAll('.fz-norm-pop.open').forEach(p=>p.classList.remove('open')); picker.classList.toggle('open'); });
    picker.querySelectorAll('.fz-fonte-drop button').forEach(b=>b.addEventListener('click',e=>{
      e.stopPropagation();
      state.fonte=b.dataset.v; picker.classList.remove('open');
      if(state.fonte==='sim'){ simStep(); }
      if(state.fonte==='ativo' && !state.ativoCod){ state.ativoCod=ativos[0]?ativos[0].codigo:null; }
      renderSourceBar(); rerenderActive(true);
    }));
    const acs=sb.querySelector('[data-act="ativocod"]'); if(acs) acs.addEventListener('change',e=>{ state.ativoCod=e.target.value; rerenderActive(true); });
    sb.querySelector('[data-act="norma"]').addEventListener('change',e=>{ state.norma=e.target.value; rerenderActive(true); });
    const gear = sb.querySelector('#fzNormGear'), pop = sb.querySelector('#fzNormPop');
    gear.addEventListener('click', e=>{ e.stopPropagation(); picker.classList.remove('open'); pop.classList.toggle('open'); });
    if(!document.body.dataset.fzSbOutsideBound){
      document.body.dataset.fzSbOutsideBound='1';
      document.addEventListener('click', ()=>{
        document.querySelectorAll('.fz-fonte-picker.open').forEach(p=>p.classList.remove('open'));
        document.querySelectorAll('.fz-norm-pop.open').forEach(p=>p.classList.remove('open'));
      });
    }
    if(window.lucide) lucide.createIcons();
    updateLiveBadge();
  }
  function updateEsp32Btn(){
    const btnV2 = document.querySelector('#fzSourceBar .fz-fonte-drop [data-v="esp32"] .fz-fonte-dot');
    if(btnV2){ const on = window.FZIoT && window.FZIoT.isConnected(); btnV2.style.background = on ? 'var(--fz-ok)' : 'var(--text-3)'; return; }
    const btn = document.querySelector('#fzSourceBar [data-v="esp32"]');
    if(!btn) return;
    const on = window.FZIoT && window.FZIoT.isConnected();
    btn.style.color = on ? 'var(--fz-ok)' : '';
    btn.style.opacity = on ? '1' : '0.55';
  }

  function renderToolbar(){
    const tb=document.getElementById('fzToolbar');
    tb.innerHTML=`<button class="fz-btn ghost" id="fzExportCsv"><i data-lucide="download"></i> Exportar CSV</button>`+
                 `<button class="fz-btn ghost" id="fzExportPdf"><i data-lucide="file-text"></i> Exportar PDF</button>`;
    tb.querySelector('#fzExportCsv').addEventListener('click',exportReport);
    tb.querySelector('#fzExportPdf').addEventListener('click',exportReportPDF);
    if(window.lucide) lucide.createIcons();
  }
  function exportReport(){

    let csv='Variavel;Media;Desvio;P5;P95;Min;Max;N\n';
    COLS.forEach(c=>{const b=BL[c]; csv+=`${b.label};${fmt(b.mean,4)};${fmt(b.std,4)};${fmt(b.p5,4)};${fmt(b.p95,4)};${fmt(b.min,4)};${fmt(b.max,4)};${b.n}\n`;});
    dl('﻿'+csv,'forzy_relatorio_'+new Date().toISOString().slice(0,10)+'.csv','text/csv');
  }

  function exportReportPDF(){
    const JsPDF = window.jspdf && window.jspdf.jsPDF;
    if(!JsPDF){ exportReportPrintFallback(); return; }
    const doc = new JsPDF({ orientation:'landscape', unit:'pt', format:'a4' });
    const W = doc.internal.pageSize.getWidth();
    const now = new Date();
    const stamp = now.toLocaleString('pt-BR',{hour12:false});
    const fonteLbl = state.fonte==='sim' ? 'Simulado' : 'Dataset Forzy';

    doc.setFillColor(6,13,24); doc.rect(0,0,W,56,'F');
    doc.setTextColor(126,200,227); doc.setFont('helvetica','bold'); doc.setFontSize(16);
    doc.text('IMS · Forzy — Relatório de Monitoramento', 40, 32);
    doc.setTextColor(170,190,210); doc.setFont('helvetica','normal'); doc.setFontSize(9);
    doc.text(`Gerado em ${stamp}  ·  Fonte: ${fonteLbl}  ·  Norma: ${state.norma}`, 40, 46);

    let y = 80;
    const sectionTitle = (t)=>{ doc.setTextColor(30,61,92); doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.text(t, 40, y); y += 8; };

    sectionTitle('Resumo Operacional — Estatísticas do Baseline (Dataset Completo)');
    doc.autoTable({
      startY: y,
      head: [['Variável','Unidade','Média','Desvio','P5','P95','Mín','Máx','N']],
      body: COLS.map(c=>{ const b=BL[c]; return [b.label, b.unit==='C'?'°C':b.unit, fmt(b.mean,3), fmt(b.std,3), fmt(b.p5,3), fmt(b.p95,3), fmt(b.min,3), fmt(b.max,3), String(b.n)]; }),
      theme:'grid', headStyles:{ fillColor:[15,42,69], textColor:[226,234,244] },
      styles:{ fontSize:8, cellPadding:4 }, margin:{ left:40, right:40 }
    });
    y = doc.lastAutoTable.finalY + 26;

    const live = curReading(); const [classe,,score,rr] = veredito(live);
    const mInfo = rede() ? rede().info() : null;
    sectionTitle(mInfo
      ? `Leitura Atual — Classificação: ${classe.toUpperCase()} (índice de anomalia = ${fmt(score,2)}; atenção ≥ 1,00, crítico ≥ ${fmt(mInfo.limCritico,2)})`
      : `Leitura Atual — Classificação: ${classe.toUpperCase()} (Score Z = ${fmt(score,2)})`);
    if(mInfo){
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(90,110,130);
      doc.text(doc.splitTextToSize(`Modelo: autoencoder ${mInfo.arquitetura}, ${mInfo.parametros} parâmetros, treinado em ${mInfo.amostras} amostras do Dataset Forzy (validação ${mInfo.validacao}). ${rr?rr.explicacao:''}`, W-80), 40, y);
      y += 12 + doc.splitTextToSize(`Modelo: autoencoder ${mInfo.arquitetura}, ${mInfo.parametros} parâmetros, treinado em ${mInfo.amostras} amostras do Dataset Forzy (validação ${mInfo.validacao}). ${rr?rr.explicacao:''}`, W-80).length*10;
    }
    doc.autoTable({
      startY: y,
      head: rr ? [['Variável','Medido','Esperado pela rede','% do erro','Média baseline']]
                : [['Variável','Valor','Z-score','Média baseline','Desvio']],
      body: rr
        ? rr.fora.map(f=>{ const b=BL[f.col]; return [b.label, fmt(f.medido,3)+' '+f.unidade, fmt(f.esperado,3)+' '+f.unidade, (f.pct*100).toFixed(0)+'%', fmt(b.mean,3)]; })
        : COLS.map(c=>{ const b=BL[c]; const z=zscore(live); return [b.label, fmt(live[c],3)+' '+(b.unit==='C'?'°C':b.unit), fmt(z[c],2), fmt(b.mean,3), fmt(b.std,3)]; }),
      theme:'grid', headStyles:{ fillColor:[15,42,69], textColor:[226,234,244] },
      styles:{ fontSize:8, cellPadding:4 }, margin:{ left:40, right:40 }
    });
    y = doc.lastAutoTable.finalY + 26;

    const s = mlSerie();
    const limAn = mInfo ? 1 : 2;
    const anomalias = s.rows.filter(r=>r.score>=limAn).sort((a,b)=>b.score-a.score).slice(0,25);
    if(y > doc.internal.pageSize.getHeight()-120){ doc.addPage(); y = 60; }
    sectionTitle(mInfo
      ? `Anomalias Detectadas pela Rede Neural — ${anomalias.length} ponto(s) com índice ≥ 1,00`
      : `Anomalias Detectadas (Baseline ML) — ${anomalias.length} ponto(s) com Z ≥ 2,0`);
    if(anomalias.length){
      doc.autoTable({
        startY: y,
        head: mInfo ? [['Timestamp','Índice','Classe','Variável dominante']]
                    : [['Timestamp','Score Z','Classe','Variável crítica']],
        body: anomalias.map(r=>{
          if(mInfo){
            const cl = window.FZModelo.ROTULO[r.nivel] || '—';
            const dom = r.erroCol && r.erroCol.length ? BL[r.erroCol[0].col].label : '—';
            return [tlabel(r.i), fmt(r.score,2), cl, dom];
          }
          const [cl]=classify(r.score); let mc=COLS[0],mv=-1;
          COLS.forEach(c=>{ if(Math.abs(r.z[c])>mv){mv=Math.abs(r.z[c]);mc=c;} });
          return [tlabel(r.i), fmt(r.score,2), cl, BL[mc].label];
        }),
        theme:'grid', headStyles:{ fillColor:[15,42,69], textColor:[226,234,244] },
        styles:{ fontSize:8, cellPadding:4 }, margin:{ left:40, right:40 }
      });
    } else {
      doc.setTextColor(46,204,113); doc.setFont('helvetica','normal'); doc.setFontSize(10);
      doc.text('Nenhuma anomalia detectada — operação dentro do baseline.', 40, y+14);
    }

    const total = doc.internal.getNumberOfPages();
    for(let i=1;i<=total;i++){ doc.setPage(i); doc.setTextColor(120,140,160); doc.setFontSize(8);
      doc.text('IMS · Forzy — Industrial Monitoring System', 40, doc.internal.pageSize.getHeight()-18);
      doc.text(`Página ${i}/${total}`, W-90, doc.internal.pageSize.getHeight()-18); }

    doc.save('forzy_relatorio_'+now.toISOString().slice(0,10)+'.pdf');
  }

  function exportReportPrintFallback(){
    const live = curReading(); const z = zscore(live); const [classe,,score,rr] = veredito(live);
    const stamp = new Date().toLocaleString('pt-BR',{hour12:false});
    const fonteLbl = state.fonte==='sim' ? 'Simulado' : 'Dataset Forzy';
    const rowsBL = COLS.map(c=>{ const b=BL[c]; return `<tr><td>${b.label}</td><td>${b.unit==='C'?'°C':b.unit}</td><td>${fmt(b.mean,3)}</td><td>${fmt(b.std,3)}</td><td>${fmt(b.p5,3)}</td><td>${fmt(b.p95,3)}</td><td>${b.n}</td></tr>`; }).join('');
    const rowsZ = rr
      ? rr.fora.map(f=>{ const b=BL[f.col]; return `<tr><td>${b.label}</td><td>${fmt(f.medido,3)} ${f.unidade}</td><td>${fmt(f.esperado,3)} ${f.unidade}</td><td>${(f.pct*100).toFixed(0)}%</td></tr>`; }).join('')
      : COLS.map(c=>{ const b=BL[c]; return `<tr><td>${b.label}</td><td>${fmt(live[c],3)} ${b.unit==='C'?'°C':b.unit}</td><td>${fmt(z[c],2)}</td><td>—</td></tr>`; }).join('');
    const cabZ = rr ? '<th>Variável</th><th>Medido</th><th>Esperado pela rede</th><th>% do erro</th>'
                    : '<th>Variável</th><th>Valor</th><th>Z-score</th><th></th>';
    const w = window.open('','_blank');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Forzy — Relatório</title>
      <style>@page{size:A4 landscape;margin:14mm}body{font-family:Arial,sans-serif;color:#0b1a2b}
      h1{color:#1e3d5c;font-size:18px;margin:0} .sub{color:#567;font-size:11px;margin:4px 0 16px}
      h2{color:#1e3d5c;font-size:13px;margin:18px 0 6px} table{border-collapse:collapse;width:100%;font-size:10px}
      th,td{border:1px solid #b9c6d4;padding:4px 6px;text-align:left} th{background:#0f2a45;color:#fff}</style></head>
      <body onload="window.print()"><h1>IMS · Forzy — Relatório de Monitoramento</h1>
      <div class="sub">Gerado em ${stamp} · Fonte: ${fonteLbl} · Norma: ${state.norma}</div>
      <h2>Resumo Operacional — Baseline</h2>
      <table><thead><tr><th>Variável</th><th>Unidade</th><th>Média</th><th>Desvio</th><th>P5</th><th>P95</th><th>N</th></tr></thead><tbody>${rowsBL}</tbody></table>
      <h2>Leitura Atual — ${classe.toUpperCase()} (${rr?'índice de anomalia':'Score Z'} = ${fmt(score,2)})</h2>
      ${rr?`<div class="sub">${rr.explicacao}</div>`:''}
      <table><thead><tr>${cabZ}</tr></thead><tbody>${rowsZ}</tbody></table>
      </body></html>`);
    w.document.close();
  }

  const RENDER={ mon:renderMon, esp:renderEsp, oper:renderOper, hist:renderHist, ml:renderMl };
  function showTab(name){
    state.tab=name;
    document.querySelectorAll('#fzTabs .fz-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    document.querySelectorAll('.fz-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===name));
    if(name!=='hist'){ hist.playing=false; histPlay(false); }
    if(name!=='mon'){ if(state.monTimer){clearInterval(state.monTimer);state.monTimer=null;} }
    RENDER[name](); updateLiveBadge();
  }
  function rerenderActive(force){ if(force) state.rendered={}; RENDER[state.tab](); updateLiveBadge(); }

  function init(){
    if(!document.getElementById('fzTabs')) return;
    renderToolbar(); renderSourceBar();
    document.querySelectorAll('#fzTabs .fz-tab').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
    showTab('mon');

    new MutationObserver(()=>{ RENDER[state.tab](); }).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});

    const dash=document.getElementById('screen-dashboard');
    new MutationObserver(()=>{ const active=dash.classList.contains('active'); if(!active){ if(state.monTimer){clearInterval(state.monTimer);state.monTimer=null;} histPlay(false); } else { if(state.tab==='mon') manageMonTimer(); } }).observe(dash,{attributes:true,attributeFilter:['class']});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();

  window.FZDashboard = {
    getCurrentReading: () => curReading(),
    getFonte: () => state.fonte,
    abrirAtivo: (codigo) => {
      state.fonte='ativo'; state.ativoCod=codigo; state.tab='mon';
      if(typeof window.showScreen==='function') window.showScreen('dashboard');
      renderSourceBar();
      showTab('mon');
    },
  };
})();
