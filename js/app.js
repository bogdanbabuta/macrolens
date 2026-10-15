'use strict';

const ACTIONS = {
  prevDay(){ S.date = shiftKey(S.date, -1); renderToday(); },
  nextDay(){ if (S.date < todayKey()){ S.date = shiftKey(S.date, 1); renderToday(); } },
  clearDay, dismissTip(){ store.set(K.tip, true); $('#installTip').hidden = true; },
  delEntry(el){ deleteEntry(el.dataset.id); },
  pickCamera(){ $('#fileCam').value = ''; $('#fileCam').click(); },
  pickUpload(){ $('#fileUp').value = ''; $('#fileUp').click(); },
  scanBarcode: openBarcodeScanner,
  lookupBarcode: lookupBarcode,
  calcProfile, logEntry, resetForm,
  quickPick(el){ const f = S.foods.find(x => x.id === el.dataset.id); if (f){ fillForm(f); renderAdd(); $('#fQty').focus(); } },
  newFood(){ openSheet(null); },
  editFood(el){ openSheet(el.dataset.id); },
  logFood(el){ const f = S.foods.find(x => x.id === el.dataset.id); if (f){ setView('add'); fillForm(f); renderAdd(); $('#fQty').focus(); } },
  saveFood: saveFoodSheet, deleteFood: deleteFoodSheet, closeSheet,
  waterPlus(){ setWater((S.water[S.date] || 0) + waterGlass()); },
  waterMinus(){ setWater(Math.max(0, (S.water[S.date] || 0) - waterGlass())); },
  waterSettings: openWaterSheet, saveWater: saveWaterSheet,
  exportData, importData(){ $('#fileImport').value = ''; $('#fileImport').click(); }, eraseAll
};

document.addEventListener('click', e => {
  const seg = e.target.closest('[data-seg] [data-val]');
  if (seg){
    const name = seg.closest('[data-seg]').dataset.seg;
    setSeg(name, seg.dataset.val);
    if (name === 'unit') updatePreview();
    if (name === 'sunit') $('#sPortionUnit').textContent = seg.dataset.val;
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab){ if (!$('.sheet.show')) setView(tab.dataset.tab); return; }
  const act = e.target.closest('[data-action]');
  if (act && ACTIONS[act.dataset.action]) ACTIONS[act.dataset.action](act);
});

['fName','fKcal','fP','fC','fF','fQty'].forEach(id => $('#' + id).addEventListener('input', ev => {
  ev.target.classList.remove('auto');
  // renaming a food that was picked from My Foods means "this is a different food"
  if (id === 'fName' && S.currentFoodId){
    const cur = S.foods.find(x => x.id === S.currentFoodId);
    if (!cur || cur.name.toLowerCase() !== ev.target.value.trim().toLowerCase()){ S.currentFoodId = null; renderAdd(); return; }
  }
  updatePreview();
}));
['fQty','fName'].forEach(id => $('#' + id).addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); }));
$('#foodSearch').addEventListener('input', renderFoods);
$('#scanLang').addEventListener('change', e => { S.scanLang = e.target.value; store.set(K.lang, S.scanLang); });
$('#pCreatineOn').addEventListener('change', e => { $('#pCreatineFields').hidden = !e.target.checked; });
$('#fileCam').addEventListener('change', e => scanFile(e.target.files[0]));
$('#fileUp').addEventListener('change', e => scanFile(e.target.files[0]));
$('#fileImport').addEventListener('change', e => importData(e.target.files[0]));
['tKcal','tP','tC','tF'].forEach(id => $('#' + id).addEventListener('change', saveTargetEdits));

// roll "today" over at midnight if the app stayed open
function checkDayRollover(){
  const t = todayKey();
  if (t !== S.lastToday){
    if (S.date === S.lastToday) S.date = t;
    S.lastToday = t;
    if (S.view === 'today') renderToday();
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayRollover(); });
window.addEventListener('focus', checkDayRollover);
setInterval(checkDayRollover, 60000);

/* =====================================================================
   PWA bits: manifest (generated at runtime) + optional service worker
   ===================================================================== */
function setupPWA(){
  try {
    const base = location.href.split('#')[0].split('?')[0];
    const manifest = {
      name:'MacroLens', short_name:'MacroLens', start_url:base, scope:base.replace(/[^/]*$/, ''),
      display:'standalone', orientation:'portrait', background_color:'#000000', theme_color:'#000000',
      icons:[{ src:ICON512, sizes:'512x512', type:'image/png', purpose:'any' }]
    };
    const l = document.createElement('link'); l.rel = 'manifest';
    l.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type:'application/manifest+json' }));
    document.head.appendChild(l);
  } catch(e){}
  // Optional offline support: only works when a sw.js file sits next to index.html. Silent if it doesn't.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

/* =====================================================================
   INIT
   ===================================================================== */
function init(){
  S.profile = store.get(K.profile, null);
  S.logs    = store.get(K.logs, {});
  S.foods   = store.get(K.foods, []);
  S.water   = store.get(K.water, {});
  S.waterCfg = store.get(K.waterCfg, {});
  fillCreatineForm();
  const savedLang = store.get(K.lang, 'ron');
  buildMacroRows();
  fillProfileForm();
  const primaryLang = typeof savedLang === 'string' ? savedLang.split('+')[0] : 'ron';
  S.scanLang = Array.from($('#scanLang').options).some(option => option.value === primaryLang) ? primaryLang : 'ron';
  $('#scanLang').value = S.scanLang;
  store.set(K.lang, S.scanLang);

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  $('#installTip').hidden = !(isIOS && !standalone && !store.get(K.tip, false));

  if (!S.profile){ $('#welcomeTip').hidden = false; setView('profile'); } else setView('today');
  setupPWA();
}
init();
