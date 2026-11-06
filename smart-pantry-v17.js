'use strict';
/* MealPlan v1.7 - Smart Pantry: fully local extension to v1.6.
   Inventory lots (optionally expiring), virtual reservations, cooked portions and source-grounded fixes.
   Private cookbook data is not embedded in public files. */
let v17ExpiryForNextPurchase='';
let v17RecipeSearch='';
let v17ReviewSearch='';
const V17_CORR_UNITS=['g','kg','ml','l','buc','lingură','linguriță','cană','felie','pachet'];
const V17_ORIGINAL={
  getRec,ingredientDisplay,showRecipe,ingredientRequirement,applyInventoryMove,undoInventoryMove,
  openPurchase,confirmPurchase,pantryView,pantryItemsHTML,shoppingNeeds,weekPendingMeals,
  shoppingV16,cookMeal,confirmCook,undoCook,removeMeal,plannerV16,homeV16,render,
  manualUse,adjustInventory,addManualInventory
};
function v17Init(){
  if(!state.pantryLots||typeof state.pantryLots!=='object'||Array.isArray(state.pantryLots))state.pantryLots={};
  if(!Array.isArray(state.cookedBatches))state.cookedBatches=[];
  if(!state.ingredientCorrections||typeof state.ingredientCorrections!=='object')state.ingredientCorrections={};
  // One-time, non-destructive migration: current 1.6 inventory becomes a lot without expiry.
  if(!state.pantryLotsMigratedV17){
    for(const [key,it] of Object.entries(state.inventory||{})){
      if(Number(it.qty)>0){state.pantryLots[key]=[{id:newMoveId(),qty:roundStock(Number(it.qty)),created:localIso(),expiry:''}];}
    }
    state.pantryLotsMigratedV17=true;
  }
  if(!V15_NAV.some(x=>x[0]==='prepared'))V15_NAV.splice(5,0,['prepared','🍱','Porții gătite']);
  if(!V15_NAV.some(x=>x[0]==='review'))V15_NAV.splice(6,0,['review','📐','Verifică gramaje']);
  v17SyncInventory();save();
}
function v17Lots(key){return (state.pantryLots[key]??=[]).filter(x=>Number(x.qty)>0.000001)}
function v17ExpiryBad(lot){return !!(lot.expiry&&validIso(lot.expiry)&&lot.expiry<localIso())}
function v17Usable(key){return roundStock(v17Lots(key).filter(x=>!v17ExpiryBad(x)).reduce((a,b)=>a+Number(b.qty||0),0))}
function v17ExpiryCount(){return Object.values(state.pantryLots).flat().filter(x=>x.qty>0&&x.expiry&&validIso(x.expiry)&&x.expiry<=plusDate(localIso(),3)).length}
function v17SyncInventory(){
 for(const [key,lots] of Object.entries(state.pantryLots||{})){
   const total=roundStock(lots.reduce((s,l)=>s+Math.max(0,Number(l.qty)||0),0));
   const existing=state.inventory[key];if(existing)existing.qty=total;
 }
}
function v17SortLots(a,b){return (a.expiry||'9999-99-99').localeCompare(b.expiry||'9999-99-99')||(a.created||'').localeCompare(b.created||'')}
function v17RecordLots(changes,expiry,allowExpired=true){
  const parts=[];
  for(const ch of changes){
    let delta=roundStock(ch.delta);
    if(!delta)continue;
    const list=state.pantryLots[ch.key]??=[];
    if(delta>0){
      let lot={id:newMoveId(),qty:delta,created:localIso(),expiry:validIso(expiry)?expiry:''};
      list.push(lot);parts.push({key:ch.key,lotId:lot.id,delta:delta});
    }else{
      let remain=-delta;
      for(const lot of [...list].filter(l=>l.qty>0&& (allowExpired||!v17ExpiryBad(l))).sort(v17SortLots)){
        let take=roundStock(Math.min(lot.qty,remain));if(take<=0)continue;
        lot.qty=roundStock(lot.qty-take);remain=roundStock(remain-take);
        parts.push({key:ch.key,lotId:lot.id,delta:-take,expiry:lot.expiry,created:lot.created});
        if(remain<.001)break;
      }
      if(remain>.001)throw Error('Loturile nu acoperă cantitatea pentru '+ch.key);
    }
  }
  return parts;
}
applyInventoryMove=function(type,label,changes,extra={}){
  // Validate lot availability first; this makes batch and legacy inventory operations atomic.
  for(const ch of changes){
    if(Number(ch.delta)<0 && (state.pantryLots[ch.key]||[]).reduce((s,l)=>s+Number(l.qty||0),0)+Number(ch.delta)<-.001)
      throw Error('Stoc insuficient pentru '+ch.name);
  }
  let move=V17_ORIGINAL.applyInventoryMove(type,label,changes,extra);
  const parts=v17RecordLots(move.changes,v17ExpiryForNextPurchase,type!=='cook');
  move.extra={...(move.extra||{}),lotParts:parts};
  v17ExpiryForNextPurchase='';
  v17SyncInventory();save();
  return move;
};
undoInventoryMove=function(token){
  const id=decodeURIComponent(token),move=state.inventoryLog.find(m=>m.id===id);
  if(!move||move.undone)return;
  const parts=move.extra?.lotParts;
  if(move.type==='cook'){
    let batch=state.cookedBatches.find(x=>x.logId===id);
    if(batch && batch.available < batch.produced-.00001){
      // Original cooking meal can be the sole allocation. Disallow undo if any other meal has received servings.
      let refs=Object.values(state.planByDate||{}).flat().filter(e=>e.fromPreparedId===batch.id);
      if(refs.length>1||refs.some(e=>e.cookLogId!==id))return alert('Nu poți anula gătirea: o parte din porțiile preparate sunt deja rezervate pentru alte mese. Elimină mai întâi acele mese.');
      if(batch.available<batch.produced-(refs[0]?.eat||0)-.001)return alert('Nu poți anula: unele porții au fost folosite.');
    }
  }
  if(parts){
    for(const p of parts.filter(p=>p.delta>0)){
      let lot=(state.pantryLots[p.key]||[]).find(l=>l.id===p.lotId);
      if(!lot||lot.qty<p.delta-.001)return alert('Această cumpărare a fost deja folosită, deci nu poate fi anulată integral. Folosește „Corectează”.');
    }
  }
  V17_ORIGINAL.undoInventoryMove(token);
  if(!move.undone)return;
  if(parts)for(const p of parts){
    let lots=state.pantryLots[p.key]??=[];
    let lot=lots.find(l=>l.id===p.lotId);
    if(!lot){lot={id:p.lotId,qty:0,created:p.created||localIso(),expiry:p.expiry||''};lots.push(lot)}
    lot.qty=roundStock(lot.qty-p.delta);
  }
  if(move.type==='cook'){
    let batch=state.cookedBatches.find(x=>x.logId===id);
    if(batch){for(let day of Object.values(state.planByDate||{}))for(let e of day){if(e.fromPreparedId===batch.id)e.fromPreparedId=null}
      state.cookedBatches=state.cookedBatches.filter(x=>x.id!==batch.id)}
  }
  v17SyncInventory();save();render();
};
openPurchase=function(token){
 V17_ORIGINAL.openPurchase(token);
 let grid=document.querySelector('.pantryModalGrid');if(grid){
  let label=document.createElement('label');label.className='fieldLabel';label.style.gridColumn='1/-1';
  label.innerHTML='Expiră la (opțional)<input type="date" class="field compact" id="v17PurchaseExpiry">';grid.appendChild(label);
 }
};
confirmPurchase=function(){v17ExpiryForNextPurchase=document.getElementById('v17PurchaseExpiry')?.value||'';V17_ORIGINAL.confirmPurchase();v17ExpiryForNextPurchase=''};
addManualInventory=function(){v17ExpiryForNextPurchase=document.getElementById('v17ManualExpiry')?.value||'';V17_ORIGINAL.addManualInventory();v17ExpiryForNextPurchase=''};
function v17EditLot(keyToken,lotId){
 const key=decodeURIComponent(keyToken),lot=v17Lots(key).find(x=>x.id===lotId);if(!lot)return;
 const target=prompt('Data expirării (AAAA-LL-ZZ). Lasă gol dacă nu este cunoscută:',lot.expiry||'');if(target===null)return;
 if(target.trim()&&!validIso(target.trim()))return alert('Data nu este validă.');
 lot.expiry=target.trim();save();render();
}
function v17CreateLotsPanel(){
 let all=Object.entries(state.pantryLots||{}).flatMap(([key,lots])=>lots.filter(l=>l.qty>0).map(l=>({key,...l,item:state.inventory[key]})));
 all.sort((a,b)=>v17SortLots(a,b));
 return `<section class="panel"><div class="row"><h2 style="margin:0">📅 Loturi și termene</h2><span class="chip">${v17ExpiryCount()} apropiate/expirate</span></div><p class="tiny">Datele de expirare sunt opționale. Loturile expirate nu sunt folosite la recomandări sau pentru acoperirea cumpărăturilor.</p>
 ${all.slice(0,100).map(l=>`<div class="v17LotRow"><div><b>${esc(l.item?.name||l.key)}</b><small>${qtyLabel(l.qty,l.item?.unit||'g')} · ${l.expiry?`Expiră: ${esc(l.expiry)}`:'Fără expirare'} ${v17ExpiryBad(l)?'⚠ EXPIRAT':l.expiry&&l.expiry<=plusDate(localIso(),3)?'⏳ Aproape de expirare':''}</small></div><button class="btn ghost" onclick="v17EditLot('${encodeURIComponent(l.key)}','${esc(l.id)}')">Dată</button></div>`).join('')||'<p class="tiny">Niciun lot introdus.</p>'}
 ${all.length>100?'<p class="tiny">Sunt afișate primele 100 de loturi.</p>':''}</section>`;
}
// Source-checked ingredient corrections are stored separately from the copyrighted source JSON.
function v17FixFor(id,index){return state.ingredientCorrections?.[id]?.[index]}
getRec=function(id){
 const original=V17_ORIGINAL.getRec(id);if(!original)return original;
 const fixes=state.ingredientCorrections?.[id];if(!fixes||!Object.keys(fixes).length)return original;
 return {...original,ingredients:(original.ingredients||[]).map((it,i)=>{
  const fix=fixes[i];if(!fix)return it;
  if(fix.unquantified)return {...it,raw:it.raw,qty:null,_v17SkipStock:true,_v17Corrected:true};
  return {...it,qty:fix.qty,unit:fix.unit||it.unit,name:it.name,_v17Corrected:true};
 })};
};
function v17IntentionallyUnmeasured(it){
 if(!it||it.qty!=null)return false;
 const raw=norm(it.raw||it.name||'');
 // Only clear qualitative quantities from the PDF. Do not infer numeric amounts.
 return /(dupa gust|un praf|cat doresti|cat preferi|dupa preferinta|cat este nevoie|la alegere)/.test(raw);
}
function v17NeedsReview(it){
 if(!it||it.groupHeader||it._v17SkipStock||v17IntentionallyUnmeasured(it))return false;
 return it.qty==null||!(Number(it.qty)>0)||!Number.isFinite(Number(it.qty));
}
ingredientRequirement=function(it,recipe,eat){
 if(it?._v17SkipStock||v17IntentionallyUnmeasured(it))return null;
 return V17_ORIGINAL.ingredientRequirement(it,recipe,eat);
};
ingredientDisplay=function(it,r,n){
 if(it?._v17Corrected&&!it._v17SkipStock){
   const base=Number(r.portions)||1;
   return {value:formatAmount(Number(it.qty)*(Number(n)||base)/base)+' '+(it.unit||'')+' '+(it.name||''),uncertain:false};
 }
 return V17_ORIGINAL.ingredientDisplay(it,r,n);
};
function v17Unresolved(r){return (r.ingredients||[]).map((it,i)=>({it,i})).filter(({it})=>v17NeedsReview(it))}
function v17ReviewCount(){return recipes.reduce((n,r)=>n+v17Unresolved(getRec(r.id)).length,0)}
showRecipe=function(){
 V17_ORIGINAL.showRecipe();const r=getRec(selectedRecipe),missing=v17Unresolved(r);
 const target=document.querySelector('.modal .ingredientsBox');if(!target)return;
 const panel=document.createElement('div');panel.className='v17Verification';panel.innerHTML=`<div class="row"><div><strong>📐 Verificare cantități</strong><div class="tiny">Corecțiile se salvează doar pe acest dispozitiv.</div></div><button class="btn ghost" onclick="v17OpenRecipeCorrections('${esc(r.id)}')">${missing.length?'⚠ '+missing.length+' de verificat':'✏️ Editează'}</button></div>${missing.length?'<p class="v17Warning">În PDF pot exista cantități neclare. Confirmă ingredientele pentru un inventar exact.</p>':'<p class="tiny">Cantitățile sunt disponibile pentru calculele inventarului; verifică pagina originală dacă observi erori.</p>'}`;
 target.after(panel);
};
function v17OpenRecipeCorrections(id,focus=-1){
 let r=getRec(id);if(!r)return;
 selectedRecipe=id;selectedPortions=portionsBase(r)||1;
 let list=(r.ingredients||[]).map((it,i)=>({it,i})).filter(x=>!x.it.groupHeader);
 document.getElementById('modal').innerHTML=`<div class="modalWrap" onclick="closeModal(event)"><div class="modal v17ReviewModal" onclick="event.stopPropagation()"><button class="btn ghost close" onclick="hideModal()">✕</button><div class="eyebrow">Compară cu PDF-ul</div><h2>📐 ${esc(r.name)}</h2><p class="tiny">${esc(r.source)} · pagina ${r.page}. Introdu doar valoarea pe care o vezi în sursa originală. Nu modifica rețeta dacă nu ești sigur.</p><div class="row"><button class="btn" onclick="showSourcePage('${esc(r.id)}')">🖼️ Deschide pagina din PDF</button><button class="btn ghost" onclick="openRecipe('${esc(r.id)}')">← Rețetă</button></div>
 ${list.map(({it,i})=>{let correction=v17FixFor(r.id,i),flag=v17NeedsReview(it);return `<div class="v17ReviewItem ${flag?'needsReview':''}" id="v17Fix-${i}"><div class="row"><b>${esc(it.name||it.raw||'Ingredient')}</b><span class="chip">${flag?'⚠ Verifică':correction?'✓ Corectat':'Identificat'}</span></div><p class="tiny">Text extras: ${esc(V17_ORIGINAL.getRec(r.id)?.ingredients?.[i]?.raw||it.raw||'—')}</p><div class="v17FixGrid"><label>Cantitate<input class="field compact" type="number" min="0.01" step="any" id="v17Qty-${i}" value="${it.qty==null?'':esc(it.qty)}" placeholder="Ex. 150"></label><label>Unitate<select class="field compact" id="v17Unit-${i}">${[...new Set([it.unit||'g',...V17_CORR_UNITS])].map(u=>`<option value="${esc(u)}" ${u===it.unit?'selected':''}>${esc(u)}</option>`).join('')}</select></label></div><div class="v17FixActions"><button class="btn primary" onclick="v17SaveFix('${esc(r.id)}',${i})">✓ Salvează valoarea</button><button class="btn ghost" onclick="v17MarkUnquantified('${esc(r.id)}',${i})">Fără cantitate exactă</button>${correction?`<button class="btn ghost" onclick="v17RemoveFix('${esc(r.id)}',${i})">Revino la PDF</button>`:''}</div></div>`}).join('')}</div></div>`;
 if(focus>=0){document.getElementById('v17Fix-'+focus)?.scrollIntoView({block:'center'})}
}
function v17SaveFix(id,i){
 const rec=V17_ORIGINAL.getRec(id),it=rec?.ingredients?.[i];if(!it)return;
 const raw=document.getElementById('v17Qty-'+i)?.value.replace(',','.');
 const q=Number(raw),unit=document.getElementById('v17Unit-'+i)?.value;
 if(!raw||!Number.isFinite(q)||q<=0||q>10000000||!V17_CORR_UNITS.includes(unit))return alert('Introdu o cantitate pozitivă și o unitate validă, după PDF.');
 (state.ingredientCorrections[id]??={})[i]={qty:q,unit,source:'user-confirmed-from-PDF',updated:localIso()};
 save();v17OpenRecipeCorrections(id,i);
}
function v17MarkUnquantified(id,i){if(!confirm('În pagina PDF ingredientul este într-adevăr „după gust” sau fără cantitate numerică? Acesta nu va modifica inventarul.'))return;
 (state.ingredientCorrections[id]??={})[i]={unquantified:true,source:'user-confirmed-unquantified',updated:localIso()};save();v17OpenRecipeCorrections(id,i)}
function v17RemoveFix(id,i){if(state.ingredientCorrections?.[id])delete state.ingredientCorrections[id][i];save();v17OpenRecipeCorrections(id,i)}
function v17ReviewView(){
 const list=recipes.map(x=>getRec(x.id)).map(r=>({r,count:v17Unresolved(r).length})).filter(x=>x.count>0).filter(x=>!v17ReviewSearch||norm(x.r.name).includes(norm(v17ReviewSearch))).sort((a,b)=>b.count-a.count||a.r.name.localeCompare(b.r.name,'ro'));
 return `<div class="eyebrow">Revizuire în raport cu sursa</div><h1>Verifică gramajele 📐</h1><p class="sub">Nu inventăm cantități. Deschizi pagina fotografiată din PDF și confirmi manual valoarea, care se salvează pentru această rețetă.</p><div class="pantryHero"><div><span class="tiny">NECLARITĂȚI RĂMASE</span><strong>${v17ReviewCount()} ingrediente</strong><small>În rețete cu valori nedeterminate automat</small></div><span>📄</span></div>
 <div class="pantrySearch">🔎 <input class="searchInput" placeholder="Caută rețetă de verificat" value="${esc(v17ReviewSearch)}" onchange="v17ReviewSearch=this.value;render()"></div>
 ${list.slice(0,100).map(({r,count})=>`<button class="v17Recommendation" onclick="v17OpenRecipeCorrections('${esc(r.id)}')"><b>${esc(r.name)}</b><small>${count} de verificat · ${r.type==='post'?'De post':'Normal'} · pagina ${r.page}</small><span>Verifică →</span></button>`).join('')||'<div class="empty">Toate cantitățile neclare au fost revizuite.</div>'}${list.length>100?'<p class="tiny">Primele 100 de rețete sunt afișate. Caută după nume.</p>':''}`;
}
function v17AllFuturePending(){
 const out=[],start=localIso();
 for(const [date,meals] of Object.entries(state.planByDate||{})){
   if(!validIso(date)||date<start||!Array.isArray(meals))continue;
   for(const e of meals){if(!e.cookLogId&&!e.fromPreparedId)out.push({date,e})}
 }
 return out.sort((a,b)=>a.date.localeCompare(b.date));
}
function v17ReservedMap(){return needMapForMeals(v17AllFuturePending().map(x=>x.e))}
function v17ReservedForKey(key){return roundStock(v17ReservedMap().get(key)?.qty||0)}
function v17Available(key){return roundStock(Math.max(0,v17Usable(key)-v17ReservedForKey(key)))}
weekPendingMeals=function(){
 const w=weekStart(chosenDate),out=[];
 for(let d=0;d<7;d++)for(const e of(state.planByDate[plusDate(w,d)]||[])){if(!e.cookLogId&&!e.fromPreparedId)out.push(e)}
 return out;
};
shoppingNeeds=function(){
 const weekly=needMapForMeals(weekPendingMeals()),prior=needMapForMeals(v17AllFuturePending().filter(x=>x.date<weekStart(chosenDate)).map(x=>x.e));
 return [...weekly.values()].map(x=>{
  const held=v17Usable(x.key),pre=roundStock(prior.get(x.key)?.qty||0);
  const available=roundStock(Math.max(0,held-pre)),missing=roundStock(Math.max(0,x.qty-available));
  return {...x,held,available,missing,needBuy:missing>.001||x.unknown};
 }).sort((a,b)=>a.name.localeCompare(b.name,'ro'));
};
function v17BatchAvailable(batch){return roundStock(batch.available||0)}
function v17ReadyBatches(){return state.cookedBatches.filter(x=>v17BatchAvailable(x)>.001)}
function v17PreparedView(){
 const all=state.cookedBatches.slice().sort((a,b)=>b.created.localeCompare(a.created));
 return `<div class="eyebrow">Gătește o dată, folosește de mai multe ori</div><h1>Porții gătite 🍱</h1><p class="sub">Porțiile gata preparate sunt separate de ingredientele crude. Planificarea lor nu scade din nou produsele din Cămară.</p><div class="pantryHero"><div><span class="tiny">PORȚII NEREPARTIZATE</span><strong>${fmt(v17ReadyBatches().reduce((a,b)=>a+b.available,0),2)} ${v17ReadyBatches().reduce((a,b)=>a+b.available,0)===1?'porție':'porții'}</strong></div><span>🍲</span></div>
 ${all.map(b=>{const r=getRec(b.recipeId);return `<div class="v17BatchCard"><div class="row"><b>${esc(r?.name||'Rețetă indisponibilă')}</b><span class="chip">${fmt(b.available,2)} libere</span></div><div class="tiny">Gătit: ${esc(b.created)} · ${fmt(b.produced,2)} preparate${b.expiry?' · Păstrează până la '+esc(b.expiry):''}</div>${b.expiry&&b.expiry<localIso()?'<div class="v17Warning">⚠ Data introdusă a trecut; verifică siguranța alimentului.</div>':''}<button class="btn primary" ${b.available<=0||b.expiry&&b.expiry<localIso()?'disabled':''} onclick="v17OpenUsePrepared('${esc(b.id)}')">＋ Pune în plan</button></div>`}).join('')||'<div class="empty">Nu ai încă porții gătite. Marchează o rețetă cu „Am gătit” din Planificator.</div>'}
 <div class="notice">Porțiile sunt doar o evidență personală. Respectă regulile reale de refrigerare și siguranță alimentară; aplicația nu poate verifica dacă mâncarea este încă sigură.</div>`;
}
function v17OpenUsePrepared(id){
 const b=state.cookedBatches.find(x=>x.id===id);if(!b||b.available<=0)return;
 const r=getRec(b.recipeId);if(!r)return;
 document.getElementById('modal').innerHTML=`<div class="modalWrap" onclick="closeModal(event)"><div class="modal pantryModal" onclick="event.stopPropagation()"><button class="btn ghost close" onclick="hideModal()">✕</button><h2>🍱 Repartizează porții</h2><p>${esc(r.name)} · ${fmt(b.available,2)} porții disponibile</p><label class="fieldLabel">Data mesei<input id="v17PreparedDate" type="date" class="field compact" value="${chosenDate}"></label><label class="fieldLabel">Momentul mesei<select id="v17PreparedSlot" class="field compact">${SLOTS.map(s=>`<option>${s}</option>`).join('')}</select></label><label class="fieldLabel">Porții<input id="v17PreparedCount" class="field compact" type="number" min="0.25" step="0.25" max="${b.available}" value="${Math.min(1,b.available)}"></label><button class="btn primary block" onclick="v17PlanPrepared('${esc(b.id)}')">Adaugă în plan</button></div></div>`;
}
function v17PlanPrepared(id){
 const batch=state.cookedBatches.find(x=>x.id===id);if(!batch)return;
 const date=document.getElementById('v17PreparedDate')?.value,n=Number(document.getElementById('v17PreparedCount')?.value),slot=document.getElementById('v17PreparedSlot')?.value;
 const rec=getRec(batch.recipeId);
 if(!validIso(date)||!SLOTS.includes(slot)||!Number.isFinite(n)||n<=0||n>batch.available+.001)return alert('Verifică data și numărul de porții disponibile.');
 if(dayType(date)==='post'&&rec.type!=='post')return alert('Această rețetă nu este de post, dar data selectată este marcată ca zi de post.');
 if(batch.expiry&&date>batch.expiry&&!confirm('Data planificată este după termenul introdus pentru preparat. Recomand să nu îl folosești. Continui totuși?'))return;
 (state.planByDate[date]??=[]).push({id:batch.recipeId,eat:n,slot,eaten:false,fromPreparedId:batch.id});
 batch.available=roundStock(batch.available-n);save();hideModal();chosenDate=date;chosenDay=dayIndex(date);tab='plan';render();
}
function v17CookMeal(date,index){
 if(!validIso(date))return;
 const meal=state.planByDate?.[date]?.[index],rec=meal&&getRec(meal.id);
 if(!rec||meal.cookLogId||meal.fromPreparedId)return;
 const base=Math.max(Number(meal.eat),Number(rec.portions)||Number(meal.eat));
 const ingredients=[...needMapForMeals([{...meal,eat:base}]).values()];
 const missing=ingredients.filter(x=>x.unknown),shortages=ingredients.filter(x=>x.qty>v17Usable(x.key)+.001);
 document.getElementById('modal').innerHTML=`<div class="modalWrap" onclick="closeModal(event)"><div class="modal pantryModal" onclick="event.stopPropagation()"><button class="btn ghost close" onclick="hideModal()">✕</button><div class="eyebrow">Meal Prep</div><h2>🍲 ${esc(rec.name)}</h2><p class="tiny">Masa planificată are ${fmt(meal.eat,2)} porții. Poți găti mai multe, iar diferența se păstrează în „Porții gătite”.</p><label class="fieldLabel">Câte porții gătești?<input class="field compact" type="number" min="${meal.eat}" step="0.25" id="v17CookCount" value="${base}" oninput="v17CookPreview('${date}',${index})"></label><label class="fieldLabel">Păstrezi preparatul până la (opțional)<input type="date" id="v17CookExpiry" class="field compact"></label><div id="v17CookCheck"></div><button class="btn primary block" onclick="v17ConfirmCook('${date}',${index})">✓ Confirmă gătirea</button><button class="btn ghost block" onclick="hideModal()">Anulează</button></div></div>`;
 v17CookPreview(date,index);
}
function v17CookPreview(date,index){
 const meal=state.planByDate?.[date]?.[index],r=meal&&getRec(meal.id),n=Number(document.getElementById('v17CookCount')?.value),el=document.getElementById('v17CookCheck');
 if(!r||!el)return;
 if(!Number.isFinite(n)||n<meal.eat||n>100){el.innerHTML='<p class="v17Warning">Numărul de porții trebuie să fie cel puțin cât ai planificat și cel mult 100.</p>';return}
 const needs=[...needMapForMeals([{...meal,eat:n}]).values()];
 const shortages=needs.filter(x=>x.qty>v17Usable(x.key)+.001),unknown=needs.filter(x=>x.unknown);
 el.innerHTML=`<div class="v17CookNeeds">${needs.map(x=>`<div class="v17CookNeed"><span>${esc(x.name)}</span><span>${x.unknown?'⚠ de verificat':qtyLabel(x.qty,x.unit)} / ${qtyLabel(v17Usable(x.key),x.unit)}</span></div>`).join('')}</div>${unknown.length?`<div class="v17Warning">⚠ ${unknown.length} ingrediente fără cantitate verificată. <button class="btn ghost" onclick="v17OpenRecipeCorrections('${esc(r.id)}')">Verifică gramajele</button></div>`:''}${shortages.length?`<div class="v17Warning">⚠ Stoc insuficient pentru ${shortages.length} ingrediente. Completează inventarul înainte să confirmi gătirea.</div>`:''}`;
}
function v17ConfirmCook(date,index){
 const meal=state.planByDate?.[date]?.[index],rec=meal&&getRec(meal.id);if(!rec||meal.cookLogId||meal.fromPreparedId)return;
 const count=Number(document.getElementById('v17CookCount')?.value),expiry=document.getElementById('v17CookExpiry')?.value||'';
 if(!Number.isFinite(count)||count<meal.eat||count>100||Math.round(count*100)!==count*100)return alert('Numărul porțiilor nu este valid.');
 if(expiry&&!validIso(expiry))return alert('Data expirării nu este validă.');
 const need=[...needMapForMeals([{...meal,eat:count}]).values()];
 const unknown=need.filter(x=>x.unknown),short=need.filter(x=>x.qty>v17Usable(x.key)+.001);
 if(unknown.length)return alert('Verifică mai întâi cele '+unknown.length+' ingrediente fără cantitate exactă, în pagina din PDF.');
 if(short.length)return alert('Inventar insuficient pentru '+short.length+' ingrediente. Completează stocul sau corectează cantitățile.');
 const changes=need.filter(x=>x.qty>.0001).map(x=>({...x,delta:-x.qty}));
 // Cook only from usable lots, by earliest expiry.
 const expiresFirst=[];for(const ch of changes){const valid=v17Lots(ch.key).filter(l=>!v17ExpiryBad(l)).reduce((s,l)=>s+l.qty,0);if(valid+0.001<-ch.delta)return alert('Produs expirat sau inventar insuficient: '+ch.name)}
 // Base inventory move selects earliest expiries. With sufficient usable quantity, expired lots are never touched.
 let move;try{move=applyInventoryMove('cook','Gătit '+rec.name,changes,{date,recipe:rec.id,cookedPortions:count});}catch(e){return alert(e.message)}
 const id=newMoveId();state.cookedBatches.push({id,recipeId:rec.id,created:localIso(),expiry,produced:count,available:roundStock(count-meal.eat),logId:move.id});
 meal.cookLogId=move.id;meal.cookedAt=Date.now();meal.fromPreparedId=id;
 save();hideModal();render();
}
cookMeal=v17CookMeal;confirmCook=v17ConfirmCook;
removeMeal=function(d,i){
 const date=idxDate(d),entry=state.planByDate?.[date]?.[i];if(!entry)return;
 if(entry.fromPreparedId){
   const batch=state.cookedBatches.find(x=>x.id===entry.fromPreparedId);
   if(entry.cookLogId&&!confirm('Această masă a fost gătită. Eliminarea ei nu readaugă ingredientele crude; porțiile sunt returnate în stocul de preparate. Continui?'))return;
   if(batch)batch.available=roundStock(batch.available+Number(entry.eat||0));
   state.planByDate[date].splice(i,1);save();render();return;
 }
 V17_ORIGINAL.removeMeal(d,i);
};
function v17RecommendationData(){
 const available=Object.create(null),reserve=v17ReservedMap();
 for(let [key,lots] of Object.entries(state.pantryLots||{}))available[key]=Math.max(0,v17Usable(key)-Number(reserve.get(key)?.qty||0));
 return recipes.map(z=>{
   const r=getRec(z.id),ingredients=[...needMapForMeals([{id:r.id,eat:1}]).values()];
   let missing=[],unknown=[],covered=0;
   for(const it of ingredients){if(it.unknown){unknown.push(it.name);continue}if(it.qty>Number(available[it.key]||0)+.001)missing.push(it.name);else covered++}
   return {r,covered,missing,unknown,score:covered/(ingredients.length||1)};
 }).filter(x=>x.covered>0).sort((a,b)=>a.missing.length-b.missing.length||a.unknown.length-b.unknown.length||b.covered-a.covered||a.r.name.localeCompare(b.r.name,'ro'));
}
function v17RecommendationView(){
 const arr=v17RecommendationData().filter(x=>dayType(chosenDate)!=='post'||x.r.type==='post')
 .filter(x=>!v17RecipeSearch||norm(x.r.name).includes(norm(v17RecipeSearch))||norm(x.r.ingredients.map(y=>y.name).join(' ')).includes(norm(v17RecipeSearch)));
 const complete=arr.filter(x=>!x.missing.length&&!x.unknown.length),partial=arr.filter(x=>x.missing.length||x.unknown.length);
 const card=x=>`<article class="v17RecipeMatch"><div class="v17RecipeWithPhoto">${x.r.photo?`<img data-pic="${esc(x.r.photo)}" alt="Fotografia preparatului" loading="lazy">`:''}<div class="grow"><div class="row"><div><b>${esc(x.r.name)}</b><small>${x.r.type==='post'?'🌿 De post':'🍽️ Normal'} · ${x.covered} ingrediente acoperite</small></div><span class="chip">${!x.missing.length&&!x.unknown.length?'✓ Complet':'Parțial'}</span></div>${x.missing.length?`<div class="tiny">Lipsesc: ${esc(x.missing.slice(0,4).join(', '))}</div>`:''}${x.unknown.length?`<div class="v17Warning">${x.unknown.length} cantități neclare · verifică PDF-ul</div>`:''}<button class="btn ghost" onclick="openRecipe('${esc(x.r.id)}')">Vezi rețeta →</button></div></div></article>`;
 return `<div class="eyebrow">Din ceea ce ai deja acasă</div><h1>Ce pot găti? 🍳</h1><p class="sub">Verificăm ingrediente după unitățile din rețetă, fără conversii inventate. Rezultatele țin cont de rezervările pentru mesele viitoare.</p><div class="pantrySearch">🔎 <input class="searchInput" placeholder="Caută preparat sau ingredient" value="${esc(v17RecipeSearch)}" onchange="v17RecipeSearch=this.value;render()"></div><h2>✅ Ai ingredientele (${complete.length})</h2>${complete.slice(0,14).map(card).join('')||'<p class="tiny">Nicio rețetă verificată integral cu stocul disponibil.</p>'}<h2>🛒 Îți mai lipsesc ingrediente (${partial.length})</h2>${partial.slice(0,15).map(card).join('')||'<p class="tiny">Nicio recomandare parțială.</p>'}<p class="filterHint">Recomandările nu verifică gustul, substituțiile, alergenii sau siguranța alimentelor. Produsele expirate sunt ignorate.</p>`;
}
function v17RenderPantry(){
 let html=V17_ORIGINAL.pantryView();
 // Enhance the original manual-add form while preserving the 1.6 inventory/history.
 html=html.replace('</div><button class="btn primary block" onclick="addManualInventory()">','</div><label class="fieldLabel">Expiră la (opțional)<input id="v17ManualExpiry" type="date" class="field compact"></label><button class="btn primary block" onclick="addManualInventory()">');
 return `<div class="v17Navigation"><button class="btn primary" onclick="go('recommendations')">🍳 Ce pot găti?</button><button class="btn ghost" onclick="go('prepared')">🍱 Porții gătite</button><button class="btn ghost" onclick="go('review')">📐 ${v17ReviewCount()} de verificat</button></div>`+html.replace('<section class="panel"><h2>↩ Istoricul modificărilor</h2>',v17CreateLotsPanel()+'<section class="panel"><h2>↩ Istoricul modificărilor</h2>');
}
function v17PantryItemsHTML(sections,all){
 return sections.map(s=>`<details class="shopSection" open><summary><div class="row start"><span class="shopEmoji">${s.emoji}</span><b>${s.label}</b></div><span class="sectionCount">${s.items.length} produse ⌄</span></summary><div class="shopBody">${s.items.map(x=>{const reserve=v17ReservedForKey(x.key),usable=v17Usable(x.key),free=Math.max(0,usable-reserve);return `<div class="pantryStockRow"><div><strong>${esc(x.name)}</strong><small>Total: ${qtyLabel(x.qty,x.unit)} · utilizabil ${qtyLabel(usable,x.unit)}</small><small>🔒 Rezervat ${qtyLabel(reserve,x.unit)} · liber ${qtyLabel(free,x.unit)}</small></div><div class="pantryRowActions"><button onclick="manualUse('${encodeURIComponent(x.key)}')">Folosit</button><button onclick="adjustInventory('${encodeURIComponent(x.key)}')">Corectează</button></div></div>`}).join('')}</div></details>`).join('')||'<div class="empty">Inventarul este gol. Adaugă manual produsele pe care le ai sau bifează cumpărături din listă.</div>';
}
pantryItemsHTML=v17PantryItemsHTML;
pantryView=v17RenderPantry;
function v17Shopping(){
 let base=V17_ORIGINAL.shoppingV16();
 const pending=v17ReservedMap(),active=[...pending.values()].filter(x=>x.qty>0),expired=v17ExpiryCount();
 const pre=`<div class="v17Navigation"><button class="btn ghost" onclick="go('pantry')">🥫 Inventar</button><button class="btn ghost" onclick="go('prepared')">🍱 Porții gătite</button><button class="btn ghost" onclick="go('review')">📐 Corectează gramajele</button></div><div class="v17SmallPanel"><b>🔒 Rezervări virtuale</b><p class="tiny">${active.length} ingrediente necesare în planificările viitoare. Stocul efectiv scade numai după „Am gătit”. ${expired?'⚠ '+expired+' loturi aproape de expirare sau expirate.':''}</p></div>`;
 return pre+base.replace('Calculat din mesele încă negătite','Calculat după stocul neexpirat și rezervările viitoare');
}
shoppingV16=v17Shopping;
// Maintain existing planner screen; append prepared-stock status and new menu link.
plannerV16=function(){
 let html=V17_ORIGINAL.plannerV16();
 const link=`<div class="v17SmallPanel"><div class="row"><div><b>🍱 Ai gătit în avans?</b><p class="tiny">Folosește porții deja preparate fără să scazi iar ingredientele crude.</p></div><button class="btn primary" onclick="go('prepared')">Vezi porțiile</button></div></div>`;
 html=html.replace('<div class="eyebrow">Meniuri organizate pe date</div>',link+'<div class="eyebrow">Meniuri organizate pe date</div>');
 return html.replaceAll('✓ Gătit · din inventar','✓ Gătit · porții pregătite').replaceAll('<div class="cookActions">','<div class="cookActions">');
};
homeV16=function(){
 let html=V17_ORIGINAL.homeV16();
 html=html.replace('<div class="homeTiles">',`<div class="homeTiles"><button class="homeTile peach" onclick="go('recommendations')"><span>🍳</span><b>Gătește din cămară</b><small>Rețete potrivite stocului tău</small></button><button class="homeTile lilac" onclick="go('prepared')"><span>🍱</span><b>Porții deja gătite</b><small>${fmt(v17ReadyBatches().reduce((s,b)=>s+b.available,0),2)} porții disponibile</small></button>`);
 return html;
};
render=function(){
 if(['pantry','prepared','review','recommendations','shopping','plan','home'].includes(tab)){
  const content=tab==='pantry'?pantryView():tab==='prepared'?v17PreparedView():tab==='review'?v17ReviewView():tab==='recommendations'?v17RecommendationView():tab==='shopping'?shoppingV16():tab==='plan'?plannerV16():homeV16();
  document.getElementById('tabs').innerHTML='';
  document.getElementById('app').innerHTML=`<header class="v15Header"><button class="hamburger" onclick="toggleDrawer(true)" aria-label="Deschide meniul"><span>☰</span></button><button class="brandButton" onclick="go('home')"><span class="brand">🥗 meal<span>plan</span><div class="eyebrow">rețetele mele • v1.7</div></span></button><button class="headerDate" onclick="jumpToday()">${shortDate(localIso())}</button></header>`+content;
  renderDrawer();queueMicrotask(hydratePhotos);if(tab==='photos')queueMicrotask(hydrateProgressPhotos);
 }else{
  V17_ORIGINAL.render();let v=document.querySelector('.v15Header .eyebrow');if(v)v.textContent='rețetele mele • v1.7';
 }
};
V15_NAV.splice(V15_NAV.findIndex(x=>x[0]==='pantry')+1,0,['recommendations','🍳','Ce pot găti?']);
v17Init();render();
