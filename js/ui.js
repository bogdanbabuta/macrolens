'use strict';

const MACROS = [
  { key:'p', label:'Protein', color:'var(--pro)'  },
  { key:'c', label:'Carbs',   color:'var(--carb)' },
  { key:'f', label:'Fat',     color:'var(--fat)'  }
];
function buildMacroRows(){
  $('#macros').innerHTML = MACROS.map(m => `
    <div class="mrow" data-m="${m.key}">
      <div class="mtop"><span class="mname"><i style="background:${m.color}"></i>${m.label}</span>
        <span class="mval"><b class="cur">0</b> / <span class="tgt">0</span> g</span></div>
      <div class="bar"><span style="background:${m.color}"></span></div>
      <div class="msub"><span class="pct">0%</span><span class="left">—</span></div>
    </div>`).join('');
}

function renderToday(){
  const k = S.date, t = totalsOf(k), tg = (S.profile && S.profile.targets) || { kcal:0, p:0, c:0, f:0 };

  $('#todayTitle').textContent = dayLabel(k);
  $('#todayDate').textContent = parseKey(k).toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'long' });
  $('#nextDayBtn').disabled = k >= todayKey();
  $('#noProfileTip').hidden = !!S.profile;

  // ring
  const C = 2 * Math.PI * 60;
  const pct = tg.kcal > 0 ? t.kcal / tg.kcal : 0;
  const over = tg.kcal > 0 && t.kcal > tg.kcal;
  const arc = $('#ringArc');
  arc.style.strokeDasharray = `${(clamp(pct, 0, 1) * C).toFixed(1)} ${C.toFixed(1)}`;
  arc.classList.toggle('over', over);
  const remain = tg.kcal - t.kcal;
  $('#ringBig').textContent = tg.kcal > 0 ? f0(Math.abs(remain)) : f0(t.kcal);
  $('#ringLbl').textContent = tg.kcal > 0 ? (over ? 'kcal over' : 'kcal left') : 'kcal eaten';
  $('#sCons').textContent = f0(t.kcal);
  $('#sTgt').textContent = tg.kcal > 0 ? f0(tg.kcal) : '—';

  // macros
  MACROS.forEach(m => {
    const row = $(`.mrow[data-m="${m.key}"]`), cur = t[m.key], tgt = tg[m.key];
    const p = tgt > 0 ? cur / tgt * 100 : 0, ov = tgt > 0 && cur > tgt;
    $('.cur', row).textContent = f1(cur);
    $('.tgt', row).textContent = tgt > 0 ? f0(tgt) : '—';
    const bar = $('.bar span', row);
    bar.style.width = clamp(p, 0, 100) + '%';
    bar.style.background = ov ? 'var(--red)' : m.color;
    $('.pct', row).textContent = Math.round(p) + '%';
    const left = $('.left', row);
    left.textContent = tgt > 0 ? (ov ? f1(cur - tgt) + ' g over' : f1(tgt - cur) + ' g left') : 'no target';
    left.classList.toggle('neg', ov);
  });

  // list
  const list = entriesOf(k);
  $('#emptyLog').hidden = list.length > 0;
  $('#clearBtn').hidden = list.length === 0;
  $('#logList').innerHTML = list.slice().reverse().map(e => `
    <li class="entry">
      <div class="e-main">
        <div class="e-name">${esc(e.name)}</div>
        <div class="e-sub">${f1(e.qty)} ${e.unit} · ${new Date(e.t).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</div>
        <div class="chips"><span class="chip p">P ${f1(e.p)}g</span><span class="chip c">C ${f1(e.c)}g</span><span class="chip f">F ${f1(e.f)}g</span></div>
      </div>
      <div class="e-kcal">${f0(e.kcal)}<small>kcal</small></div>
      <button class="icon-btn" data-action="delEntry" data-id="${e.id}" aria-label="Delete ${esc(e.name)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>
      </button>
    </li>`).join('');
  renderWater();
}

/* ---------------- water ---------------- */
const waterGlass = () => S.waterCfg.glass > 0 ? S.waterCfg.glass : 250;
const waterGoal  = () => S.waterCfg.goal > 0 ? S.waterCfg.goal : (S.profile ? Math.max(1000, Math.round(S.profile.weight * 35 / 50) * 50) : 2000);
const fmtL = ml => String(Math.round(ml / 10) / 100);
function renderWater(){
  const cur = S.water[S.date] || 0, goal = waterGoal();
  $('#wCur').textContent = fmtL(cur);
  $('#wGoal').textContent = fmtL(goal);
  $('#wBar').style.width = clamp(cur / goal * 100, 0, 100) + '%';
  $('#wPlus').textContent = '+' + waterGlass() + ' ml';
  $('#waterCard').classList.toggle('done', cur >= goal);
}
function setWater(ml){
  if (ml > 0) S.water[S.date] = ml; else delete S.water[S.date];
  store.set(K.water, S.water); renderWater();
}
function openWaterSheet(){
  $('#wToday').value = S.water[S.date] || '';
  $('#wGlass').value = S.waterCfg.glass || '';
  $('#wGoalIn').value = S.waterCfg.goal || '';
  $('#wGoalIn').placeholder = 'auto · ' + waterGoal();
  openSheetEl('waterSheet');
}
function saveWaterSheet(){
  const n = id => { const v = num($('#' + id).value); return isNaN(v) ? 0 : Math.max(0, Math.round(v)); };
  S.waterCfg = { glass: clamp(n('wGlass'), 0, 2000) || 0, goal: clamp(n('wGoalIn'), 0, 10000) || 0 };
  store.set(K.waterCfg, S.waterCfg);
  setWater(clamp(n('wToday'), 0, 20000));
  closeSheet();
}

function deleteEntry(id){
  const arr = S.logs[S.date] || [];
  const i = arr.findIndex(e => e.id === id);
  if (i < 0) return;
  const [removed] = arr.splice(i, 1);
  if (!arr.length) delete S.logs[S.date];
  saveLogs();
  S.undo = { date:S.date, entry:removed, index:i };
  renderToday();
  toast('Entry deleted', 'Undo', undoDelete);
}
function undoDelete(){
  const u = S.undo; if (!u) return;
  const arr = S.logs[u.date] = S.logs[u.date] || [];
  arr.splice(Math.min(u.index, arr.length), 0, u.entry);
  saveLogs(); S.undo = null;
  if (S.view === 'today') renderToday();
}
function clearDay(){
  const arr = entriesOf(S.date); if (!arr.length) return;
  if (!confirm(`Delete all ${arr.length} entries for ${dayLabel(S.date).toLowerCase()}?`)) return;
  delete S.logs[S.date]; saveLogs(); renderToday();
  toast('Day cleared');
}

/* =====================================================================
   ADD (scanner + portion calculator)
   ===================================================================== */
const formEls = () => ({ name:$('#fName'), kcal:$('#fKcal'), p:$('#fP'), c:$('#fC'), f:$('#fF'), qty:$('#fQty') });

function readForm(){
  const e = formEls(), unit = getSeg('unit');
  const n = x => { const v = num(x.value); return isNaN(v) ? 0 : v; };
  let kcal = num(e.kcal.value), p = n(e.p), c = n(e.c), f = n(e.f), estimated = false;
  if (isNaN(kcal)) { kcal = p*4 + c*4 + f*9; estimated = kcal > 0; }
  return { name:e.name.value.trim(), unit, kcal, p, c, f, qty:n(e.qty), estimated };
}

function updatePreview(){
  const r = readForm();
  const k = r.qty / 100;
  $('#rK').textContent = f0(r.kcal * k);
  $('#rP').textContent = f1(r.p * k);
  $('#rC').textContent = f1(r.c * k);
  $('#rF').textContent = f1(r.f * k);
  $('#qtyUnit').textContent = r.unit;
  $('#logBtn').disabled = !(r.qty > 0 && (r.kcal > 0 || r.p > 0 || r.c > 0 || r.f > 0));

  // plausibility check: label calories vs calories implied by the macros
  const w = $('#warnLine');
  const kc = num($('#fKcal').value);
  const implied = r.p*4 + r.c*4 + r.f*9;
  if (!isNaN(kc) && implied > 0 && Math.abs(kc - implied) / Math.max(kc, implied) > 0.3){
    w.hidden = false;
    w.textContent = `Heads up: these macros add up to ≈${f0(implied)} kcal but calories say ${f0(kc)}. Double-check the numbers against the label.`;
  } else if (r.estimated){
    w.hidden = false;
    w.textContent = `Calories estimated from macros: ≈${f0(r.kcal)} kcal per 100 ${r.unit}.`;
  } else w.hidden = true;
}

function renderAdd(){
  const foods = S.foods.slice().sort((a, b) => (b.used || 0) - (a.used || 0) || a.name.localeCompare(b.name)).slice(0, 15);
  $('#quickWrap').hidden = foods.length === 0;
  $('#quickChips').innerHTML = foods.map(f => `<button class="qchip ${f.id === S.currentFoodId ? 'on' : ''}" data-action="quickPick" data-id="${f.id}">${esc(f.name)}</button>`).join('');
  $('#addTo').textContent = 'Adds to ' + dayLabel(S.date).toLowerCase() + (S.date === todayKey() ? "'s total" : '');
  updatePreview();
}

function fillForm(food){
  const e = formEls();
  e.name.value = food.name;
  setSeg('unit', food.unit || 'g');
  e.kcal.value = food.kcal; e.p.value = food.p; e.c.value = food.c; e.f.value = food.f;
  e.qty.value = food.portion || '';
  $$('#detailsCard input.auto').forEach(i => i.classList.remove('auto'));
  S.currentFoodId = food.id;
  $('#fSave').checked = false;
  updatePreview();
}
function resetForm(){
  ['fName','fKcal','fP','fC','fF','fQty'].forEach(id => { const i = $('#' + id); i.value = ''; i.classList.remove('auto'); });
  setSeg('unit', 'g');
  $('#fSave').checked = false;
  S.currentFoodId = null;
  resetScanUI();
  if (S.view === 'add') renderAdd();
}

function upsertFood(data){
  const key = data.name.toLowerCase();
  let food = (data.id && S.foods.find(f => f.id === data.id)) || S.foods.find(f => f.name.toLowerCase() === key);
  if (food) Object.assign(food, data, { id:food.id });
  else { food = Object.assign({ used:0 }, data, { id:uid() }); S.foods.push(food); }
  saveFoods();
  return food;
}

function logEntry(){
  const r = readForm();
  if (!(r.qty > 0)) return toast('Enter the quantity you consumed');
  const saveIt = $('#fSave').checked;
  if (saveIt && !r.name) return toast('Give the food a name to save it');
  const k = r.qty / 100;
  const entry = {
    id: uid(), name: r.name || 'Food', qty: r.qty, unit: r.unit, t: Date.now(),
    kcal: r.kcal * k, p: r.p * k, c: r.c * k, f: r.f * k,
    per100: { kcal:r.kcal, p:r.p, c:r.c, f:r.f }
  };
  (S.logs[S.date] = S.logs[S.date] || []).push(entry);
  saveLogs();

  let saved = null;
  if (saveIt) saved = upsertFood({ id:S.currentFoodId, name:r.name, unit:r.unit, kcal:round1(r.kcal), p:round1(r.p), c:round1(r.c), f:round1(r.f) });
  const used = saved || S.foods.find(f => f.id === S.currentFoodId);
  if (used){ used.used = Date.now(); saveFoods(); }

  const msg = `Logged ${f0(entry.kcal)} kcal${saved ? ' · saved to My Foods' : ''}`;
  resetForm();
  setView('today');
  toast(msg);
}
const round1 = n => Math.round(n * 10) / 10;

function renderFoods(){
  const q = $('#foodSearch').value.trim().toLowerCase();
  const all = S.foods.slice().sort((a, b) => a.name.localeCompare(b.name));
  const list = q ? all.filter(f => f.name.toLowerCase().includes(q)) : all;
  $('#foodsCount').textContent = all.length ? `${all.length} saved` : 'Your saved foods';
  $('#foodSearchWrap').hidden = all.length < 6;
  $('#emptyFoods').hidden = all.length > 0;
  $('#foodList').innerHTML = list.map(f => `
    <li class="food">
      <div class="meta"><div class="n">${esc(f.name)}</div>
        <div class="d">${f0(f.kcal)} kcal · P ${f1(f.p)} · C ${f1(f.c)} · F ${f1(f.f)} <span style="color:var(--faint)">/ 100 ${f.unit || 'g'}</span></div></div>
      <button class="pill" data-action="logFood" data-id="${f.id}">Log</button>
      <button class="edit" data-action="editFood" data-id="${f.id}" aria-label="Edit ${esc(f.name)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z"/></svg>
      </button>
    </li>`).join('') || (q ? '<li class="entry"><div class="e-sub">No matches</div></li>' : '');
}

function openSheetEl(id){ $('#backdrop').classList.add('show'); $('#' + id).classList.add('show'); }
function openSheet(id){
  const f = id ? S.foods.find(x => x.id === id) : null;
  S.editingFood = f ? f.id : null;
  $('#sheetTitle').textContent = f ? 'Edit food' : 'New food';
  $('#sDelete').hidden = !f;
  $('#sName').value = f ? f.name : '';
  $('#sKcal').value = f ? f.kcal : ''; $('#sP').value = f ? f.p : ''; $('#sC').value = f ? f.c : ''; $('#sF').value = f ? f.f : '';
  $('#sPortion').value = f && f.portion ? f.portion : '';
  setSeg('sunit', f ? (f.unit || 'g') : 'g');
  $('#sPortionUnit').textContent = getSeg('sunit');
  openSheetEl('foodSheet');
}
function closeSheet(){
  $('#backdrop').classList.remove('show');
  $$('.sheet').forEach(x => x.classList.remove('show'));
  document.activeElement && document.activeElement.blur();
  if (typeof stopBarcodeScanner === 'function') stopBarcodeScanner().catch(err => console.error('Could not stop barcode scanner', err));
}
function saveFoodSheet(){
  const name = $('#sName').value.trim();
  if (!name) return toast('Give the food a name');
  const n = id => { const v = num($('#' + id).value); return isNaN(v) ? 0 : Math.max(0, v); };
  const p = n('sP'), c = n('sC'), f = n('sF');
  let kcal = num($('#sKcal').value);
  if (isNaN(kcal)) kcal = p*4 + c*4 + f*9;
  if (!(kcal > 0 || p > 0 || c > 0 || f > 0)) return toast('Enter at least calories or one macro');
  const portion = n('sPortion');
  const dupe = S.foods.find(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== S.editingFood);
  if (dupe && !confirm(`"${dupe.name}" already exists. Replace it?`)) return;
  if (dupe){ S.foods = S.foods.filter(x => x !== dupe); }
  upsertFood({ id:S.editingFood, name, unit:getSeg('sunit'), kcal:round1(kcal), p:round1(p), c:round1(c), f:round1(f), portion: portion > 0 ? portion : undefined });
  closeSheet(); renderFoods(); toast('Food saved');
}
function deleteFoodSheet(){
  const f = S.foods.find(x => x.id === S.editingFood); if (!f) return;
  if (!confirm(`Delete "${f.name}" from My Foods? Past log entries are kept.`)) return;
  S.foods = S.foods.filter(x => x !== f); saveFoods();
  if (S.currentFoodId === f.id) S.currentFoodId = null;
  closeSheet(); renderFoods(); toast('Food deleted');
}

/* =====================================================================
   PROFILE
   ===================================================================== */
function fillProfileForm(){
  const p = S.profile; if (!p) return;
  $('#pAge').value = p.age; $('#pWeight').value = p.weight; $('#pHeight').value = p.height;
  setSeg('gender', p.gender); setSeg('goal', p.goal); $('#pActivity').value = p.activity;
  showTargets();
}
function showTargets(){
  const p = S.profile; if (!p || !p.targets) return;
  $('#targetsCard').hidden = false;
  $('#tKcal').value = p.targets.kcal; $('#tP').value = p.targets.p; $('#tC').value = p.targets.c; $('#tF').value = p.targets.f;
  const g = GOALS[p.goal];
  $('#targetNote').textContent = `${g.name}: ${g.note}, protein ${g.protein} g/kg, fat ≥ 0.8 g/kg and ≥ 25% of calories, carbs make up the rest.` +
    (p.floored ? ' Calories were raised to a safe minimum (' + (p.gender === 'male' ? 1500 : 1200) + ' kcal).' : '');
}
function calcProfile(){
  const p = {
    age: num($('#pAge').value), weight: num($('#pWeight').value), height: num($('#pHeight').value),
    gender: getSeg('gender'), activity: $('#pActivity').value, goal: getSeg('goal')
  };
  if (!(p.age >= 10 && p.age <= 100)) return toast('Enter an age between 10 and 100');
  if (!(p.weight >= 30 && p.weight <= 300)) return toast('Enter a weight between 30 and 300 kg');
  if (!(p.height >= 100 && p.height <= 250)) return toast('Enter a height between 100 and 250 cm');
  const r = calcTargets(p);
  S.profile = Object.assign(p, { bmr:r.bmr, tdee:r.tdee, floored:r.floored, targets:r.targets });
  saveProfile(); showTargets();
  $('#welcomeTip').hidden = true;
  toast('Targets saved');
  $('#targetsCard').scrollIntoView({ behavior:'smooth', block:'start' });
}
function saveTargetEdits(){
  if (!S.profile) return;
  const t = S.profile.targets;
  [['tKcal','kcal'], ['tP','p'], ['tC','c'], ['tF','f']].forEach(([id, k]) => {
    const v = num($('#' + id).value);
    if (!isNaN(v) && v >= 0) t[k] = Math.round(v);
    $('#' + id).value = t[k];
  });
  saveProfile();
}
