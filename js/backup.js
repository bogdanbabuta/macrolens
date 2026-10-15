'use strict';

/* ---------------- backup ---------------- */
async function exportData(){
  const data = JSON.stringify({ app:'macrolens', version:1, exported:new Date().toISOString(), profile:S.profile, logs:S.logs, foods:S.foods, water:S.water, waterCfg:S.waterCfg }, null, 2);
  const name = `macrolens-backup-${todayKey()}.json`;
  try {
    const file = new File([data], name, { type:'application/json' });
    if (navigator.canShare && navigator.canShare({ files:[file] })){ await navigator.share({ files:[file], title:'MacroLens backup' }); return; }
  } catch(e){ if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type:'application/json' })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function importData(file){
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!d || d.app !== 'macrolens') throw new Error('bad');
    if (!confirm('Replace everything in this app with the backup?')) return;
    S.profile = d.profile || null; S.logs = d.logs || {}; S.foods = d.foods || [];
    S.water = d.water || {}; S.waterCfg = d.waterCfg || {};
    saveProfile(); saveLogs(); saveFoods(); store.set(K.water, S.water); store.set(K.waterCfg, S.waterCfg);
    if (!S.profile) store.del(K.profile);
    fillProfileForm(); fillCreatineForm(); renderWater(); toast('Backup restored'); setView('today');
  } catch(e){ toast('That file isn’t a MacroLens backup'); }
}
function eraseAll(){
  if (!confirm('Erase your profile, food log and saved foods from this device? This cannot be undone.')) return;
  if (!confirm('Really erase everything?')) return;
  [K.profile, K.logs, K.foods, K.water, K.waterCfg].forEach(store.del);
  S.profile = null; S.logs = {}; S.foods = []; S.water = {}; S.waterCfg = {}; S.currentFoodId = null;
  $('#targetsCard').hidden = true;
  ['pAge','pWeight','pHeight'].forEach(id => $('#' + id).value = '');
  fillCreatineForm();
  resetForm(); toast('All data erased'); setView('profile');
}

/* =====================================================================
   EVENTS
   ===================================================================== */
