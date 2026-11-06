'use strict';
// MealPlan 1.6 – Cămara mea. No server; uses existing localStorage state and private recipe IDs.
// No ingredient is deducted at planning time. Cooking requires an explicit confirmation.

let pantrySearch = '';
let pantryShowAllShopping = false;
let pantryPurchaseKey = null;
let pantryLogLimit = 50;

function initPantryV16(){
  state.inventory = state.inventory && typeof state.inventory === 'object' && !Array.isArray(state.inventory) ? state.inventory : {};
  state.inventoryLog = Array.isArray(state.inventoryLog) ? state.inventoryLog : [];
  state.inventoryDefaults = state.inventoryDefaults && typeof state.inventoryDefaults === 'object' ? state.inventoryDefaults : {};
  state.inventoryMigratedV16 = true;
  if(!V15_NAV.some(x=>x[0]==='pantry')) V15_NAV.splice(4,0,['pantry','🥫','Cămara mea']);
  save();
}
function safeNum(v){let n=Number(v);return Number.isFinite(n)?n:0}
function roundStock(n){return Math.round((Number(n)||0)*100)/100}
function pantryUnit(u){
  const z=norm(u).replace(/[.]/g,'').trim();
  if(['g','gr','gram','grame','grame'].includes(z))return {unit:'g',mul:1};
  if(['kg','kilogram','kilograme'].includes(z))return {unit:'g',mul:1000};
  if(['ml','mililitru','mililitri'].includes(z))return {unit:'ml',mul:1};
  if(['l','litru','litri'].includes(z))return {unit:'ml',mul:1000};
  if(['buc','bucati','bucata','ou','oua'].includes(z))return {unit:'buc',mul:1};
  if(['lingura','linguri'].includes(z))return {unit:'lingură',mul:1};
  if(['lingurita','lingurite'].includes(z))return {unit:'linguriță',mul:1};
  if(['felie','felii'].includes(z))return {unit:'felie',mul:1};
  if(['cana','cani'].includes(z))return {unit:'cană',mul:1};
  return {unit:z||'buc',mul:1};
}
function pantryName(name){return String(name||'').trim().replace(/\s+/g,' ').replace(/[–-]\s*$/,'').trim()}
function pantryKey(name,unit){return norm(pantryName(name)).replace(/\s+/g,' ')+'|'+pantryUnit(unit).unit}
function pantryItem(name,unit){
  const un=pantryUnit(unit),key=pantryKey(name,unit);
  return {key,name:pantryName(name),unit:un.unit,cat:ingredientCategory(name)};
}
function ingredientRequirement(it,recipe,eat){
  if(!it||it.groupHeader)return null;
  const name=pantryName(it.name||it.raw),base=Number(recipe.portions),q=Number(it.qty),unit=pantryUnit(it.unit);
  if(!name)return null;
  const item=pantryItem(name,it.unit);
  const vague=/(?:^|\b)(?:dupa gust|un praf|varf de cutit|optional)(?:\b|$)/.test(norm(name));
  const known=!vague && it.qty!=null && Number.isFinite(q) && q>0 && Number.isFinite(base) && base>0 && Number(eat)>0;
  return {...item,qty:known?roundStock(q*unit.mul*Number(eat)/base):0,unknown:!known,raw:it.raw||name};
}
function needMapForMeals(meals){
  const map=new Map();
  for(const e of meals){
    let r=getRec(e.id);if(!r)continue;
    for(const it of r.ingredients||[]){
      const x=ingredientRequirement(it,r,e.eat);
      if(!x)continue;
      const prev=map.get(x.key)||{...x,qty:0,unknown:false,examples:[]};
      prev.qty=roundStock(prev.qty+x.qty);
      prev.unknown=prev.unknown||x.unknown;
      if(x.unknown&&prev.examples.length<2)prev.examples.push(x.raw);
      map.set(x.key,prev);
    }
  }
  return map;
}
function weekPendingMeals(){
  const w=weekStart(chosenDate),out=[];
  for(let i=0;i<7;i++)for(const e of (state.planByDate[plusDate(w,i)]||[])){
    if(!e.cookLogId)out.push(e);
  }
  return out;
}
function stockQuantity(key){return roundStock(state.inventory?.[key]?.qty||0)}
function shoppingNeeds(){
  return [...needMapForMeals(weekPendingMeals()).values()].map(x=>{
    let held=stockQuantity(x.key),missing=roundStock(Math.max(0,x.qty-held));
    return {...x,held,missing,needBuy:missing>0.001||x.unknown};
  }).sort((a,b)=>a.name.localeCompare(b.name,'ro'));
}
function qtyLabel(q,unit){return `${fmt(q,2)} ${esc(unit||'buc')}`}
function iconForCat(c){return SHOP_CATS.find(x=>x[0]===c)?.[1]||'🧺'}
function inventorySummary(){
  const items=Object.values(state.inventory||{}).filter(x=>Number(x.qty)>0);
  return {count:items.length,known:items.reduce((s,x)=>s+(Number(x.qty)>0?1:0),0)};
}
function newMoveId(){return 'm'+Date.now().toString(36)+Math.random().toString(36).slice(2,11)}
function applyInventoryMove(type,label,changes,extra={}){
  const next=[];
  for(const ch of changes){
    const delta=roundStock(ch.delta),item=state.inventory[ch.key];
    const current=safeNum(item?.qty),after=roundStock(current+delta);
    if(after < -0.001)throw Error('Stoc insuficient pentru '+(ch.name||item?.name||ch.key));
    if(!Number.isFinite(delta))throw Error('Cantitate invalidă');
    if(Math.abs(delta)<0.001)continue;
    next.push({...ch,delta});
  }
  for(const ch of next){
    const old=state.inventory[ch.key]||{key:ch.key,name:ch.name,unit:ch.unit,cat:ch.cat||ingredientCategory(ch.name),qty:0};
    state.inventory[ch.key]={...old,qty:roundStock(safeNum(old.qty)+ch.delta)};
  }
  const move={id:newMoveId(),type,label,date:localIso(),at:Date.now(),changes:next,extra};
  state.inventoryLog.unshift(move);
  if(state.inventoryLog.length>500)state.inventoryLog.length=500;
  save();
  return move;
}
function undoInventoryMove(token){
  const id=decodeURIComponent(token),move=state.inventoryLog.find(x=>x.id===id);
  if(!move||move.undone)return;
  if(!confirm('Anulezi operațiunea „'+move.label+'”?'))return;
  for(const ch of move.changes){
    if(stockQuantity(ch.key)-ch.delta < -0.001)return alert('Operațiunea nu poate fi anulată: o parte din produs a fost deja folosită. Corectează întâi inventarul.');
  }
  for(const ch of move.changes){
    const i=state.inventory[ch.key];if(i)i.qty=roundStock(stockQuantity(ch.key)-ch.delta);
  }
  move.undone=true;
  for(const plan of Object.values(state.planByDate||{}))for(const e of plan){if(e.cookLogId===id){e.cookLogId=null;e.cookedAt=null}}
  save();render();
}
function openPurchase(token){
  const key=decodeURIComponent(token),candidate=shoppingNeeds().find(x=>x.key===key)||state.inventory[key];
  if(!candidate)return alert('Nu am găsit ingredientul.');
  pantryPurchaseKey=key;
  const def=state.inventoryDefaults[key],unit=candidate.unit||'g';
  const suggested=def?.packQty || (unit==='g'||unit==='ml'?1000:unit==='buc'?6:1);
  document.getElementById('modal').innerHTML=`<div class="modalWrap" onclick="closeModal(event)"><div class="modal pantryModal" onclick="event.stopPropagation()"><button class="btn ghost close" onclick="hideModal()">✕</button><div class="eyebrow">🛍️ Cumpărare înregistrată</div><h2>${esc(candidate.name)}</h2><p class="sub">Cât ai cumpărat efectiv? Cantitatea intră în inventar, nu se consumă încă.</p>
   <div class="pantryModalGrid"><label class="fieldLabel">Cantitate per pachet<input class="field compact" id="buyPack" type="number" step="0.01" min="0.01" max="1000000" value="${suggested}"></label><label class="fieldLabel">Unitate<input class="field compact" value="${esc(unit)}" disabled></label><label class="fieldLabel">Număr de pachete<input class="field compact" id="buyCount" type="number" min="1" max="100" step="1" value="1"></label></div>
   <div class="pantryTip">Necesar pentru planul curent: ${qtyLabel(candidate.missing??0,unit)} · Stoc existent: ${qtyLabel(stockQuantity(key),unit)}.</div>
   <button class="btn primary block" onclick="confirmPurchase()">✓ Adaugă cumpărătura în inventar</button></div></div>`;
}
function confirmPurchase(){
  if(!pantryPurchaseKey)return;
  const item=shoppingNeeds().find(x=>x.key===pantryPurchaseKey)||state.inventory[pantryPurchaseKey];
  if(!item)return;
  const pack=Number(document.getElementById('buyPack')?.value),cnt=Number(document.getElementById('buyCount')?.value);
  if(!Number.isFinite(pack)||pack<=0||pack>1000000||!Number.isInteger(cnt)||cnt<1||cnt>100)return alert('Verifică gramajul și numărul de pachete.');
  let amount=roundStock(pack*cnt);if(amount>10000000)return alert('Cantitatea este prea mare.');
  applyInventoryMove('buy','Cumpărat '+item.name,[{key:item.key,name:item.name,unit:item.unit,cat:item.cat,delta:amount}]);
  state.inventoryDefaults[item.key]={packQty:pack};
  save();hideModal();pantryPurchaseKey=null;render();
}
function addManualInventory(){
  const name=pantryName(document.getElementById('newPantryName')?.value),q=Number(document.getElementById('newPantryQty')?.value),unit=document.getElementById('newPantryUnit')?.value;
  if(!name||name.length>100||!Number.isFinite(q)||q<=0||q>1000000)return alert('Introdu un aliment și o cantitate validă.');
  const un=pantryUnit(unit),it=pantryItem(name,unit);
  applyInventoryMove('add','Adăugat manual '+name,[{...it,delta:roundStock(q*un.mul)}]);render();
}
function adjustInventory(token){
  const key=decodeURIComponent(token),it=state.inventory[key];if(!it)return;
  const value=prompt(`Ajustează stocul pentru ${it.name} (${it.unit}). Introdu cantitatea reală din casă:`,String(it.qty));
  if(value===null)return;
  const n=Number(value.replace(',','.'));
  if(!Number.isFinite(n)||n<0||n>10000000)return alert('Introdu o valoare validă de minimum zero.');
  const delta=roundStock(n-it.qty);if(!delta)return;
  applyInventoryMove('adjust','Corecție stoc '+it.name,[{...it,delta}]);render();
}
function manualUse(token){
  const key=decodeURIComponent(token),it=state.inventory[key];if(!it)return;
  const value=prompt(`Ce cantitate ai folosit din ${it.name}? (${it.unit})`,String(Math.min(it.qty,100)));
  if(value===null)return;
  const n=Number(value.replace(',','.'));
  if(!Number.isFinite(n)||n<=0||n>it.qty)return alert('Cantitatea trebuie să fie pozitivă și să nu depășească stocul.');
  applyInventoryMove('use','Consumat separat: '+it.name,[{...it,delta:-roundStock(n)}]);render();
}
function pantryView(){
  const all=Object.values(state.inventory||{}).filter(x=>Number(x.qty)>0).filter(x=>!pantrySearch||norm(x.name).includes(norm(pantrySearch))).sort((a,b)=>a.name.localeCompare(b.name,'ro'));
  const history=(state.inventoryLog||[]).filter(x=>!x.undone).slice(0,pantryLogLimit);
  const sections=SHOP_CATS.map(([id,emoji,label])=>({id,emoji,label,items:all.filter(x=>x.cat===id)})).filter(x=>x.items.length);
  return `<div class="eyebrow">Stoc păstrat pe telefon</div><h1>Cămara mea 🥫</h1><p class="sub">Produsele cumpărate intră în stoc. La simpla planificare NU scădem nimic; scădem când confirmi „Am gătit”.</p>
    <div class="pantryHero"><div><span class="tiny">ÎN INVENTAR</span><strong>${Object.values(state.inventory||{}).filter(x=>Number(x.qty)>0).length} alimente</strong><small>Folosește „Corectează” dacă stocul real diferă.</small></div><span>🫙</span></div>
    <section class="panel"><h2>＋ Adaugă ce ai deja acasă</h2><div class="pantryAddGrid"><input class="field compact" id="newPantryName" placeholder="Ex. orez alb" maxlength="100"><input class="field compact" id="newPantryQty" type="number" min="0.01" step="0.01" placeholder="Cantitate"><select class="field compact" id="newPantryUnit"><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="buc">buc</option><option value="lingură">lingură</option><option value="linguriță">linguriță</option></select></div><button class="btn primary block" onclick="addManualInventory()">Salvează produsul</button></section>
    <div class="pantrySearch"><span>🔎</span><input type="search" class="searchInput" id="pantrySearchBox" value="${esc(pantrySearch)}" placeholder="Caută în inventar…" oninput="pantrySearch=this.value;refreshPantryItems()"></div><div id="pantryItems">${pantryItemsHTML(sections,all)}</div>
    <section class="panel"><h2>↩ Istoricul modificărilor</h2><p class="tiny">Poți anula cumpărături, corecții și gătiri introduse din greșeală.</p>${history.map(x=>`<div class="pantryHistory"><div><b>${esc(x.label)}</b><small>${esc(x.date)} · ${x.type==='cook'?'Gătire':x.type==='buy'?'Cumpărare':x.type==='use'?'Consumat':'Stoc'}</small></div><button class="btn ghost" onclick="undoInventoryMove('${encodeURIComponent(x.id)}')">Anulează</button></div>`).join('')||'<p class="tiny">Încă nu ai modificări.</p>'}</section><div class="notice">Cantitățile sunt estimate după rețete. Ingrediente similare cu nume sau unități diferite nu se unifică automat; le poți ajusta manual pentru precizie.</div>`;
}
function pantryItemsHTML(sections,all){
  return sections.map(s=>`<details class="shopSection" open><summary><div class="row start"><span class="shopEmoji">${s.emoji}</span><b>${s.label}</b></div><span class="sectionCount">${s.items.length} produse ⌄</span></summary><div class="shopBody">${s.items.map(x=>`<div class="pantryStockRow"><div><strong>${esc(x.name)}</strong><small>${qtyLabel(x.qty,x.unit)}</small></div><div class="pantryRowActions"><button onclick="manualUse('${encodeURIComponent(x.key)}')">Folosit</button><button onclick="adjustInventory('${encodeURIComponent(x.key)}')">Corectează</button></div></div>`).join('')}</div></details>`).join('')||'<div class="empty">Inventarul este gol. Adaugă manual produsele pe care le ai sau bifează cumpărături din listă.</div>';
}
function refreshPantryItems(){
  const all=Object.values(state.inventory||{}).filter(x=>Number(x.qty)>0).filter(x=>!pantrySearch||norm(x.name).includes(norm(pantrySearch))).sort((a,b)=>a.name.localeCompare(b.name,'ro'));
  const sections=SHOP_CATS.map(([id,emoji,label])=>({id,emoji,label,items:all.filter(x=>x.cat===id)})).filter(x=>x.items.length),el=document.getElementById('pantryItems');if(el)el.innerHTML=pantryItemsHTML(sections,all);
}
function shoppingV16(){
  const all=shoppingNeeds(),missing=all.filter(x=>x.needBuy),visible=pantryShowAllShopping?all:missing;
  const grouped=SHOP_CATS.map(([id,emoji,label])=>({id,emoji,label,items:visible.filter(x=>x.cat===id)})).filter(x=>x.items.length);
  return `<div class="eyebrow">Calculat din mesele încă negătite</div><h1>Cumpărături 🛒</h1>
    <div class="pantryHero"><div><span class="tiny">DE CUMPĂRAT PENTRU SĂPTĂMÂNĂ</span><strong>${missing.length} ingrediente</strong><small>${all.length-missing.length} ingrediente acoperite de inventar</small></div><span>🧺</span></div>
    <div class="pantryNavCallout"><div><strong>Ai cumpărat o pungă de 1 kg?</strong><p class="tiny">Apasă „Am cumpărat”, introdu gramajul real, iar produsul ajunge în Cămara mea. Rețetele vor consuma stocul doar când confirmi gătirea.</p></div><button class="btn ghost" onclick="go('pantry')">🥫 Cămara mea</button></div>
    <div class="shopTools"><label class="favoriteSwitch"><input type="checkbox" class="checkbox" ${pantryShowAllShopping?'checked':''} onchange="pantryShowAllShopping=this.checked;render()"> Arată și cele acoperite de stoc</label><button class="btn ghost" onclick="copyShoppingV16()">📋 Copiază lista</button></div>
    ${grouped.map(s=>`<details class="shopSection" open><summary><div class="row start"><span class="shopEmoji">${s.emoji}</span><div><b>${s.label}</b><div class="mini">${s.items.length} ingrediente</div></div></div><span class="sectionCount">⌄</span></summary><div class="shopBody">${s.items.map(x=>`<div class="pantryShopRow"><div class="grow"><strong>${esc(x.name)}</strong><div class="mini">Necesar ${qtyLabel(x.qty,x.unit)} · în stoc ${qtyLabel(x.held,x.unit)}</div>${x.unknown?'<div class="pantryWarning">⚠ Cantitate incompletă în PDF — verifică rețeta.</div>':''}</div><div class="pantryShopRight"><b class="${x.needBuy?'pantryMissing':'pantryCovered'}">${x.unknown?'De verificat':x.missing?qtyLabel(x.missing,x.unit):'✓ Acoperit'}</b>${x.needBuy?`<button class="pantryBuyButton" onclick="openPurchase('${encodeURIComponent(x.key)}')">＋ Am cumpărat</button>`:''}</div></div>`).join('')}</div></details>`).join('')}
    ${!all.length?'<div class="empty">Nu ai mese negătite planificate în această săptămână. Adaugă rețete în Planificator.</div>':!missing.length?'<div class="empty">🎉 Toate ingredientele cuantificabile sunt acoperite de inventar pentru mesele rămase!</div>':''}
    <p class="filterHint">Nu convertim automat lingurile în grame și nu combinăm ingrediente cu denumiri diferite. Rețetele cu cantități neclare rămân de verificat.</p>`;
}
async function copyShoppingV16(){
  let a=shoppingNeeds().filter(x=>x.needBuy);if(!a.length)return alert('Nu ai nimic de cumpărat.');
  let lines=[];for(let [id,emoji,label] of SHOP_CATS){let entries=a.filter(x=>x.cat===id);if(!entries.length)continue;lines.push(emoji+' '+label);for(let x of entries)lines.push('• '+x.name+': '+(x.unknown?'verifică rețeta':qtyLabel(x.missing,x.unit).replace(/<[^>]*>/g,'')));lines.push('')}
  try{await navigator.clipboard.writeText(lines.join('\n'));alert('Lista de cumpărături a fost copiată.')}catch(e){alert('Nu am putut copia lista.');}
}
function cookMeal(date,index){
  if(!validIso(date))return;
  const meal=state.planByDate?.[date]?.[index],rec=meal&&getRec(meal.id);
  if(!rec||meal.cookLogId)return;
  const items=[...needMapForMeals([meal]).values()];
  const shortage=items.filter(x=>x.qty>stockQuantity(x.key)+.001),unknown=items.filter(x=>x.unknown);
  const list=items.map(x=>`<div class="pantryCookLine"><div><strong>${esc(x.name)}</strong><small>Necesar ${x.unknown?'necunoscut':qtyLabel(x.qty,x.unit)} · inventar ${qtyLabel(stockQuantity(x.key),x.unit)}</small></div><span class="${x.qty>stockQuantity(x.key)+.001?'pantryMissing':'pantryCovered'}">${x.unknown?'⚠':x.qty>stockQuantity(x.key)+.001?'Lipsă':'✓'}</span></div>`).join('');
  document.getElementById('modal').innerHTML=`<div class="modalWrap" onclick="closeModal(event)"><div class="modal pantryModal" onclick="event.stopPropagation()"><button class="btn ghost close" onclick="hideModal()">✕</button><div class="eyebrow">Confirmare gătire</div><h2>🍲 ${esc(rec.name)}</h2><p class="sub">${fmt(meal.eat,2)} porții · ${esc(longDate(date))}. Ingredientele vor fi scăzute o singură dată.</p><div class="pantryCookList">${list}</div>
     ${shortage.length||unknown.length?`<div class="notice">⚠ ${shortage.length?'Stoc insuficient pentru '+shortage.length+' ingrediente. ':''}${unknown.length?'Cantități neclare la '+unknown.length+' ingrediente. ':''}Vom scădea numai cantitățile cunoscute și disponibile; restul rămân neînregistrate. Pentru un inventar exact, completează stocul înainte de confirmare.</div>`:''}
     <button class="btn primary block" onclick="confirmCook('${date}',${index})">✓ Confirmă: am gătit</button><button class="btn ghost block" onclick="hideModal()">Anulează</button></div></div>`;
}
function confirmCook(date,index){
  let meal=state.planByDate?.[date]?.[index],rec=meal&&getRec(meal.id);if(!rec||meal.cookLogId)return;
  let items=[...needMapForMeals([meal]).values()],changes=[],missing=[];
  for(const x of items){
    const actual=roundStock(Math.min(stockQuantity(x.key),x.qty));
    if(actual>0)changes.push({...x,delta:-actual});
    if(x.unknown||x.qty-actual>0.001)missing.push(x.name);
  }
  let move=applyInventoryMove('cook','Gătit '+rec.name,changes,{date,recipe:rec.id,missing});
  meal.cookLogId=move.id;meal.cookedAt=Date.now();save();hideModal();render();
  if(missing.length)alert('Gătirea a fost marcată. '+missing.length+' ingrediente au avut stoc insuficient sau cantități neclare; verifică inventarul.');
}
function undoCook(date,index){let m=state.planByDate?.[date]?.[index];if(!m?.cookLogId)return;undoInventoryMove(encodeURIComponent(m.cookLogId));}
function plannerV16(){
  let sum=total(chosenDate),cons=consumedTotal(chosenDate),cnt=weeklyDay(chosenDate).length;
  return `<div class="eyebrow">Meniuri organizate pe date</div><h1>Planificator 🗓️</h1><p class="sub">Alege data, apoi marchează separat mesele consumate și preparatele gătite. Stocul scade doar la „Am gătit”.</p>${calendarNav()}${daysUI()}<div class="dayPlanHeader ${dayType(chosenDate)==='post'?'fastBg':''}"><div class="row"><div><span class="tiny">MENIUL ZILEI</span><h2 style="margin:4px 0">${esc(longDate(chosenDate))}</h2><span class="tiny">${cnt} ${cnt===1?'masă planificată':'mese planificate'}</span></div><label class="fastToggle"><input class="checkbox" type="checkbox" ${dayType(chosenDate)==='post'?'checked':''} onchange="toggleFast(${chosenDay},this.checked)"> 🌿 Zi de post</label></div><div class="dayTotal"><span>🍽️ Planificate</span><b>${fmt(sum.kcal)} kcal</b><small>✅ Consumate: ${fmt(cons.kcal)} kcal</small></div></div>
    ${SLOTS.map(s=>`<section class="mealSlot"><div class="mealSlotHeader"><div class="row start"><div class="mealIcon">${SLOT_ICONS[s]}</div><b>${s}</b></div><button class="slotAdd" onclick="startAdd(${chosenDay},'${s}')">＋ Adaugă</button></div>${weeklyDay(chosenDate).map((e,i)=>{if(e.slot!==s)return '';let r=getRec(e.id);return r?`<div class="planRecipe ${e.eaten?'mealDone':''}">${r.photo?`<img src="${PLACEHOLDER_PIC}" data-pic="${esc(r.photo)}" alt="" loading="lazy">`:'<div class="planPlaceholder">🍽️</div>'}<div class="grow"><button class="recipeInline" onclick="openRecipe('${esc(r.id)}')">${esc(r.name)}</button><div class="mini">${e.eat} ${Number(e.eat)===1?'porție':'porții'} · ${fmt(e.eat*Number(macros(r).kcal||0))} kcal</div>${dayType(chosenDate)==='post'&&r.type!=='post'?'<span class="badQA">⚠️ Nepotrivit pentru zi de post</span>':''}<label class="eatenToggle"><input type="checkbox" ${e.eaten?'checked':''} onchange="markEaten('${chosenDate}',${i},this.checked)"> Consumate</label><div class="cookActions">${e.cookLogId?`<span class="pantryCooked">✓ Gătit · din inventar</span><button onclick="undoCook('${chosenDate}',${i})">Anulează gătirea</button>`:`<button class="cookButton" onclick="cookMeal('${chosenDate}',${i})">🍲 Am gătit</button>`}</div></div><button class="removeMeal" aria-label="Elimină masa" onclick="removeMeal(${chosenDay},${i})">×</button></div>`:''}).join('')||'<p class="slotEmpty">Nu ai ales încă o rețetă.</p>'}</section>`).join('')}
    <div class="panel"><p class="tiny">Ingredientele intră în lista de cumpărături în momentul planificării, dar inventarul scade numai când confirmi gătirea. Bifa „Consumate” este independentă.</p><button class="btn primary block" onclick="go('shopping')">🛒 Vezi ce mai lipsește</button></div>`;
}
function removeMeal(d,i){
  const date=idxDate(d),e=state.planByDate?.[date]?.[i];if(!e)return;
  if(e.cookLogId&&!confirm('Această rețetă a fost deja marcată ca gătită. Eliminarea din plan NU readaugă ingredientele în inventar. Continui?'))return;
  state.planByDate[date].splice(i,1);save();render();
}
function homeV16(){
  let html=homeV14();
  html=html.replace('<div class="eyebrow">Organizare simplă, mese mai bune</div>',`<div class="eyebrow">Organizare simplă, mese mai bune · ${esc(longDate(chosenDate))}</div>`);
  html=html.replace('<section class="welcome">',`<div class="homeActionGrid"><button class="homeAction analysisBtn" onclick="go('analysis')"><span>📊</span><b>Analiza progresului</b><small>Calorii, mese și istoric</small></button><button class="homeAction weightBtn" onclick="go('weight')"><span>⚖️</span><b>Progres greutate</b><small>Grafic și înregistrări</small></button></div><section class="welcome">`);
  html=html.replace('<div class="sectionHeader"><h2>Alege ziua</h2>',`${calendarNav()}<div class="sectionHeader"><h2>Alege ziua</h2>`);
  html=html.replace('<div class="homeTiles">',`<div class="homeTiles"><button class="homeTile peach" onclick="go('pantry')"><span>🥫</span><b>Cămara mea</b><small>${inventorySummary().count} alimente · inventar inteligent</small></button><button class="homeTile lilac" onclick="go('photos')"><span>📸</span><b>Fotografii progres</b><small>Galeria ta privată</small></button>`);
  return html;
}
function render(){
  chosenDay=dayIndex(chosenDate);
  let content=tab==='home'?homeV16():tab==='recipes'?library():tab==='plan'?plannerV16():tab==='shopping'?shoppingV16():tab==='pantry'?pantryView():tab==='analysis'?analysis():tab==='weight'?weightView():tab==='photos'?photosView():settings();
  document.getElementById('tabs').innerHTML='';
  document.getElementById('app').innerHTML=`<header class="v15Header"><button class="hamburger" onclick="toggleDrawer(true)" aria-label="Deschide meniul"><span>☰</span></button><button class="brandButton" onclick="go('home')"><span class="brand">🥗 meal<span>plan</span><div class="eyebrow">rețetele mele • v1.6</div></span></button><button class="headerDate" onclick="jumpToday()">${shortDate(localIso())}</button></header>`+content;
  renderDrawer();queueMicrotask(hydratePhotos);if(tab==='photos')queueMicrotask(hydrateProgressPhotos);
}
initPantryV16();render();
