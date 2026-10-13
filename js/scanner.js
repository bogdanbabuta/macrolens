'use strict';

/* ---------------- OCR: image prep ---------------- */
async function prepareImage(file){
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open that image')); i.src = url; });
    const w = img.naturalWidth, h = img.naturalHeight, big = Math.max(w, h);
    const scale = big > 2000 ? 2000 / big : big < 1000 ? 1400 / big : 1;
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
    const ctx = cv.getContext('2d', { willReadFrequently:true });
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const id = ctx.getImageData(0, 0, cv.width, cv.height), d = id.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4){
      const g = (d[i]*299 + d[i+1]*587 + d[i+2]*114) / 1000 | 0;
      d[i] = d[i+1] = d[i+2] = g; hist[g]++;
    }
    const total = cv.width * cv.height;
    let acc = 0, lo = 0, hi = 255;
    for (let i = 0; i < 256; i++){ acc += hist[i]; if (acc >= total * 0.01){ lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--){ acc += hist[i]; if (acc >= total * 0.01){ hi = i; break; } }
    if (hi - lo > 20){            // stretch contrast so faint print gets darker
      const kf = 255 / (hi - lo);
      for (let i = 0; i < d.length; i += 4){ const v = (d[i] - lo) * kf; d[i] = d[i+1] = d[i+2] = v < 0 ? 0 : v > 255 ? 255 : v; }
    }
    ctx.putImageData(id, 0, 0);
    return cv;
  } finally { URL.revokeObjectURL(url); }
}

/* ---------------- OCR: text → numbers ---------------- */
const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Keywords below are matched on lower-cased, accent-stripped text, so "Grăsimi" is "grasimi", "Eiweiß" is "eiweiß".
// Languages: EN RO DE FR IT ES PT HU PL NL CS/SK BG TR
const KEY_RE = {
  p: /prote|protid|eiwei|eiwit|bia[lłt]ko|bielkov|bilkov|feherje|белтъ|протеин|belt[ae]\b/,
  f: /\bfats?\b|gr[a4@]s[il1!]m|\bgrasi\b|\bgrasa|\bgrasas\b|\bfett\b|\bfetten\b|lipid|mati[eè]res? gras|\bgrassi\b|gordur|zsir|t[lł]?uszcz|\bvet(?:ten)?\b|\btuk(?:y|u)?\b|мазнин|\byag\b/,
  c: /carbo|glucid|kohlenh|hidrat|\bcarbs\b|zaharid|koolhydra|szenhidrat|weglowodan|sachar|въглехидрат|karbon/
};
const ENERGY_RE = /energ|valoare|brennwert|calor|kalor|valor|enerji|енерг/;
// words that mark a sub-line ("of which sugars", "saturates", fibre, salt …) – never a main macro
const SKIP_RE = new RegExp([
  'of which','din care','davon','\\bdont\\b','di cui','de los cuales','de las cuales','dos quais','das quais','ebbol','w tym','waarvan','z toho','z tego','от които','из които','bunun',
  'satur','gesattig','telitett','nasycon','verzadigd','nasycen','nasyten','наситен','doymus','zsirsav',
  'sugar','zahar','zucker','sucre','zuccher','azucar','acucar','cukor','cukr','suiker','захар','seker',
  'fibre','fiber','fibr','ballast','rostan','vlakn','blonnik','vezeny',
  '\\bsalt\\b','\\bsare\\b','\\bsalz\\b','\\bsel\\b','\\bsale\\b','\\bsal\\b','\\bsol\\b',
  'sodiu','sodium','natri','mono','poly','polio','trans\\b','cholest','starch','amidon','polyol','vitamin'
].join('|'));
// Pull the first number out of a text fragment, repairing the usual OCR slips:
//   "llg" -> 11 g   ·   "6,39" / "579" -> the trailing 'g' was read as a 9
function firstNumber(seg){
  let m = seg.match(/<?\s*(\d{1,3}(?:[.,]\d{1,2})?)/), t;
  if (m){
    t = m[1].replace(',', '.');
    if (/^\d+\.\d9$/.test(t)) t = t.slice(0, -1);                        // 6.39 -> 6.3
    else if (/^\d{3}$/.test(t) && t[2] === '9' && +t > 100) t = t.slice(0, 2);   // 579 -> 57
    return +t;
  }
  m = seg.match(/(?:^|\s)([0-9li|!o]{1,3}(?:[.,][0-9li|!o]{1,2})?)\s*[g9q]?(?:\s|$)/);   // digits misread as letters
  if (m && (/\d/.test(m[1]) || m[1].length >= 2)){
    t = m[1].replace(/[li|!]/g, '1').replace(/o/g, '0').replace(',', '.');
    if (!isNaN(+t)) return +t;
  }
  return null;
}

function parseNutrition(raw){
  const L = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(strip);
  const out = { kcal:null, p:null, c:null, f:null, unit:null, notes:[] };
  const all = L.join('\n');
  if (/100\s*(?:ml|мл)/.test(all) && !/100\s*(?:g|г)(?![a-z])/.test(all)) out.unit = 'ml';
  else if (/100\s*(?:g|г)(?![a-z])/.test(all)) out.unit = 'g';

  // energy: strict kcal -> (garbled kcal after a slash, cross-checked with kJ) -> kJ / 4.184
  const kcalRe = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:k\s*c\s*a\s*[l1i|]|ккал|кал)/;
  const kjRe   = /(\d{1,2}[ .]\d{3}|\d{3,5})\s*k\s*[jJ]/;               // also "1 046 kJ" / "1.046 kJ"
  const calWordRe = /(?:calor|kalor)[a-z]*\s*[:\-]?\s*(\d{2,4})/;         // "Calories 250", "Kalorien 250", "Calorii 250"
  const slashRe = /\/\s*(\d{2,3})(?=\s*[a-z)|\]©(]|\s*$)/;
  for (const l of L){ const m = l.match(kcalRe); if (m){ out.kcal = num(m[1]); break; } }
  if (out.kcal == null){
    let kj = null, slash = null;
    for (const l of L){
      if (kj == null){ const m = l.match(kjRe); if (m) kj = Math.round(+m[1].replace(/[ .]/g, '') / 4.184); }
      if (slash == null && (ENERGY_RE.test(l) || /\bkj\b|kj\s*\//.test(l))){ const m = l.match(slashRe); if (m && +m[1] >= 10 && +m[1] <= 950) slash = +m[1]; }
    }
    let cw = null;
    for (const l of L){ const m = l.match(calWordRe); if (m && +m[1] >= 10 && +m[1] <= 950){ cw = +m[1]; break; } }
    if (cw != null && kj == null && slash == null) out.kcal = cw;
    else if (slash != null && (kj == null || Math.abs(slash - kj) / kj < 0.1)) out.kcal = slash;
    else if (kj != null){ out.kcal = kj; out.notes.push('Calories converted from kJ.'); }
  }

  const anyKey = l => KEY_RE.p.test(l) || KEY_RE.f.test(l) || KEY_RE.c.test(l) || ENERGY_RE.test(l) || /kcal/.test(l);
  const find = re => {
    for (let i = 0; i < L.length; i++){
      const l = L[i], m = l.match(re);
      if (!m) continue;
      const sm = l.match(SKIP_RE);
      if (sm && sm.index <= m.index) continue;                 // this line is a sub-item
      let end = m.index + m[0].length;
      while (/[a-zß\u0400-\u04ff]/.test(l[end] || '')) end++;                  // swallow the rest of the keyword ("grasim" + "i")
      const seg = sm ? l.slice(end, sm.index) : l.slice(end);
      let v = firstNumber(seg);
      if (v == null && !sm){                                     // value wrapped onto the next line
        const nx = L[i + 1];
        if (nx && /^\W{0,3}<?\d/.test(nx) && !anyKey(nx) && !SKIP_RE.test(nx)) v = firstNumber(nx);
      }
      if (v != null) return v;
    }
    return null;
  };
  out.p = find(KEY_RE.p); out.c = find(KEY_RE.c); out.f = find(KEY_RE.f);

  // sanity limits per 100 g
  for (const k of ['p','c','f']) if (out[k] != null && out[k] > 100){ out.notes.push(`Ignored an impossible ${k.toUpperCase()} value (${out[k]}).`); out[k] = null; }
  if (out.kcal != null && (out.kcal > 950 || out.kcal < 0)){ out.notes.push(`Ignored an impossible calorie value (${out.kcal}).`); out.kcal = null; }
  // dropped decimal point? ("1.5 g" read as "15 g"): if calories only add up when exactly one macro is /10, fix it
  if (out.kcal != null && out.p != null && out.c != null && out.f != null){
    const gap = (p, c, f) => Math.abs(out.kcal - (4*p + 4*c + 9*f)) / out.kcal;
    if (gap(out.p, out.c, out.f) > 0.3){
      const fixes = ['p','c','f'].filter(k => out[k] >= 10 && out[k] % 1 === 0).filter(k => {
        const v = { p:out.p, c:out.c, f:out.f }; v[k] /= 10; return gap(v.p, v.c, v.f) < 0.15;
      });
      if (fixes.length === 1){
        const k = fixes[0], old = out[k]; out[k] = old / 10;
        out.notes.push(`${{p:'Protein',c:'Carbs',f:'Fat'}[k]} was read as ${old} but ${out[k]} makes the calories add up — please verify.`);
      }
    }
  }
  out.found = ['kcal','p','c','f'].filter(k => out[k] != null).length;
  return out;
}

/* ---------------- OCR: run ---------------- */
function loadTesseract(){
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL; s.async = true;
    s.onload = () => window.Tesseract ? res(window.Tesseract) : rej(new Error('OCR engine failed to start'));
    s.onerror = () => rej(new Error('Could not download the OCR engine. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

let scanBusy = false, previewUrl = null;
function setStatus(msg, cls = '', html = false){
  const s = $('#scanStatus'); s.className = 'status ' + cls;
  if (html) s.innerHTML = msg; else s.textContent = msg;
}
function setProgress(p){ $('#progress').hidden = p == null; if (p != null) $('#progBar').style.width = clamp(p * 100, 0, 100) + '%'; }
function resetScanUI(){
  if (previewUrl){ URL.revokeObjectURL(previewUrl); previewUrl = null; }
  $('#preview').hidden = true; $('#progress').hidden = true; $('#rawBox').hidden = true;
  setStatus('Photograph the table that lists values <b>per 100 g / 100 ml</b>. Fill the frame, keep it flat and well lit.', '', true);
}

async function scanFile(file){
  if (!file || scanBusy) return;
  scanBusy = true;
  $$('[data-action=pickCamera],[data-action=pickUpload]').forEach(b => b.disabled = true);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  $('#previewImg').src = previewUrl; $('#preview').hidden = false; $('#rawBox').hidden = true;
  setProgress(0); setStatus('Preparing image…');
  let worker = null;
  try {
    const cv = await prepareImage(file);
    setStatus('Loading OCR engine… (the first scan in each language downloads a few MB)');
    const T = await loadTesseract();
    let phase = 0;                                           // 0 = pass 1, 1 = pass 2
    // tesseract.js can fail inside its worker without rejecting, so route its errors + a watchdog into one promise
    let fail; const failed = new Promise((_, rej) => { fail = rej; }); failed.catch(() => {});
    const watchdog = setTimeout(() => fail(new Error('The scan took too long')), 180000);
    const guard = p => Promise.race([p, failed]);
    worker = await guard(T.createWorker(S.scanLang, 1, {
      errorHandler: e => fail(e instanceof Error ? e : new Error(String(e && e.message || e))),
      logger: m => {
        if (!m || !m.status) return;
        if (m.status === 'recognizing text'){ setProgress(0.15 + (phase + m.progress) * 0.42); setStatus(`Reading label… ${Math.round(m.progress * 100)}%`); }
        else if (/language/.test(m.status)){ setProgress(0.03 + m.progress * 0.1); setStatus('Downloading language data (first time only)…'); }
        else if (/core/.test(m.status)) setStatus('Loading OCR engine…');
      }
    }));

    const pass = async psm => {
      await guard(worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' }));
      const { data } = await guard(worker.recognize(cv));
      return { text: data.text || '', parsed: parseNutrition(data.text || '') };
    };
    let best;
    try {
      best = await pass('6');                                // single uniform block: best for tables
      if (best.parsed.found < 4){
        phase = 1;
        const alt = await pass('4');                         // single column of variable sizes
        if (alt.parsed.found > best.parsed.found) best = alt;
      }
    } finally { clearTimeout(watchdog); }
    setProgress(1);
    $('#rawText').textContent = best.text.trim() || '(nothing recognised)';
    $('#rawBox').hidden = false;
    applyScan(best.parsed);
  } catch (err){
    console.error(err);
    setProgress(null);
    setStatus((err && err.message ? err.message : 'Scan failed') + ' — you can still type the values in below.', 'err');
  } finally {
    if (worker) try { await worker.terminate(); } catch(e){}
    scanBusy = false;
    $$('[data-action=pickCamera],[data-action=pickUpload]').forEach(b => b.disabled = false);
    setTimeout(() => setProgress(null), 600);
  }
}

function applyScan(r){
  const e = formEls();
  $$('#detailsCard input.auto').forEach(i => i.classList.remove('auto'));
  S.currentFoodId = null;
  if (r.unit) setSeg('unit', r.unit);
  const put = (el, v) => { if (v != null){ el.value = f1(v); el.classList.add('auto'); } };
  put(e.kcal, r.kcal); put(e.p, r.p); put(e.c, r.c); put(e.f, r.f);
  if (r.kcal == null && (r.p != null || r.c != null || r.f != null)) r.notes.push('Calories not found — they will be estimated from the macros.');
  updatePreview();
  const extra = r.notes.length ? ' ' + r.notes.join(' ') : '';
  if (r.found === 4) setStatus('Found all 4 values (highlighted in green). Please check them against the label, then enter the quantity.' + extra, 'ok');
  else if (r.found > 0) setStatus(`Found ${r.found} of 4 values. Fill in the missing ones by hand.` + extra, 'err');
  else setStatus('Couldn’t find any values. Try a sharper, closer photo of just the table — or enter them by hand.' + extra, 'err');
  $('#detailsCard').scrollIntoView({ behavior:'smooth', block:'start' });
}

/* =====================================================================
   FOODS
   ===================================================================== */
