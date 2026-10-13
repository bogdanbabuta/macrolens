'use strict';

/* ---------------- OCR: image prep ---------------- */
async function prepareImage(file){
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open that image')); i.src = url; });
    const w = img.naturalWidth, h = img.naturalHeight, big = Math.max(w, h);
    const scale = big > 2600 ? 2600 / big : big < 1200 ? 1800 / big : 1;
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

function parseNutritionTable(data, raw){
  const out = parseNutrition(raw);
  const words = (data.words || []).filter(word =>
    word.text && word.bbox && [word.bbox.x0,word.bbox.y0,word.bbox.x1,word.bbox.y1].every(Number.isFinite) &&
    word.bbox.x1 > word.bbox.x0 && word.bbox.y1 > word.bbox.y0
  ).map(word => ({
    text:word.text.trim(),
    x0:word.bbox.x0, x1:word.bbox.x1, y0:word.bbox.y0, y1:word.bbox.y1,
    confidence:Number.isFinite(word.confidence) ? word.confidence : 0
  })).filter(word => word.text);
  if (!words.length) return out;

  words.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1) || a.x0 - b.x0);
  const visualRows = [];
  for (const word of words){
    const center = (word.y0 + word.y1) / 2, height = word.y1 - word.y0;
    let row = null, bestDistance = Infinity;
    for (const candidate of visualRows){
      const distance = Math.abs(center - candidate.center);
      if (distance <= Math.max(5, Math.min(height, candidate.height) * 0.4)){
        if (distance < bestDistance){ row = candidate; bestDistance = distance; }
      }
    }
    if (!row){ visualRows.push({ center, height, words:[word] }); continue; }
    row.words.push(word);
    row.center = row.words.reduce((sum, item) => sum + (item.y0 + item.y1) / 2, 0) / row.words.length;
    row.height = row.words.reduce((sum, item) => sum + item.y1 - item.y0, 0) / row.words.length;
  }

  const wordTable = [];
  const valueTable = [];
  for (const row of visualRows){
    row.words.sort((a, b) => a.x0 - b.x0);
    const text = strip(row.words.map(word => word.text).join(' '));
    const spans = [];
    let offset = 0;
    let compactOffset = 0;
    for (const word of row.words){
      const start = offset;
      offset += word.text.length;
      const compactStart = compactOffset;
      compactOffset += word.text.length;
      spans.push({ word, start, end:offset, compactStart, compactEnd:compactOffset });
      offset++;
    }
    const labels = [];
    const skip = SKIP_RE.exec(text);
    const compactText = text.replace(/\s+/g, '');
    for (const field of ['p','c','f']){
      let label = KEY_RE[field].exec(text), compactMatch = false;
      if (!label){ label = KEY_RE[field].exec(compactText); compactMatch = Boolean(label); }
      if (!label) continue;
      const firstSpan = spans.find(span => compactMatch ? span.compactEnd > label.index : span.end > label.index);
      const lastSpan = spans.find(span => compactMatch
        ? span.compactEnd >= label.index + label[0].length
        : span.end >= label.index + label[0].length);
      if (!firstSpan || !lastSpan) continue;
      if (skip && skip.index <= firstSpan.start) continue;
      labels.push({ field, textStart:label.index, textEnd:label.index + label[0].length,
        x0:firstSpan.word.x0, x1:lastSpan.word.x1 });
    }
    if (ENERGY_RE.test(text)){
      const energy = parseNutrition(text);
      if (energy.kcal != null) out.kcal = energy.kcal;
    }
    const values = row.words.map(word => ({ word, value:firstNumber(word.text) }))
      .filter(item => item.value != null && item.value >= 0 && item.value <= 100);
    wordTable.push({ center:row.center, text, labels, words:row.words, spans });
    valueTable.push({ center:row.center, values });
  }

  const imageWidth = data.imageSize && Number.isFinite(data.imageSize.width)
    ? data.imageSize.width
    : Math.max(...words.map(word => word.x1));
  const labelRows = wordTable.flatMap((row, index) =>
    row.labels.map(label => ({ ...label, rowIndex:index, center:row.center }))
  );
  if (labelRows.length){
    const numericColumnPositions = [];
    for (const label of labelRows){
      const row = wordTable[label.rowIndex];
      for (const item of valueTable[label.rowIndex].values){
        if (item.word.x0 > label.x1 && item.word.x0 < label.x1 + imageWidth * 0.75)
          numericColumnPositions.push(item.word.x0);
      }
    }
    const columnTolerance = Math.max(8, imageWidth * 0.045);
    const columns = [];
    for (const x of numericColumnPositions.sort((a, b) => a - b)){
      let column = columns.find(item => Math.abs(item.center - x) <= columnTolerance);
      if (!column){ column = { center:x, count:0 }; columns.push(column); }
      column.center = (column.center * column.count + x) / (column.count + 1);
      column.count++;
    }

    let preferredColumn = columns[0] || null;
    for (const row of wordTable){
      for (let i = 0; i < row.words.length; i++){
        const headerWord = row.words[i].text.toLowerCase().replace(/\s/g, '');
        let headerCenter;
        if (/^100(?:g|ml)$/.test(headerWord)) headerCenter = (row.words[i].x0 + row.words[i].x1) / 2;
        else if (headerWord === '100' && row.words[i + 1] && /^(?:g|ml)$/i.test(row.words[i + 1].text))
          headerCenter = (row.words[i].x0 + row.words[i + 1].x1) / 2;
        else continue;
        const headerColumn = columns.slice().sort((a, b) =>
          Math.abs(a.center - headerCenter) - Math.abs(b.center - headerCenter)
        )[0];
        if (headerColumn) preferredColumn = headerColumn;
      }
    }

    const assigned = { p:null, c:null, f:null };
    const assignedFields = new Set();
    for (const label of labelRows.sort((a, b) => a.center - b.center || a.x0 - b.x0)){
      assignedFields.add(label.field);
      const row = valueTable[label.rowIndex];
      const nextLabel = labelRows.find(other => other.rowIndex === label.rowIndex && other.x0 > label.x1);
      const wordRow = wordTable[label.rowIndex];
      const skip = SKIP_RE.exec(wordRow.text);
      const skipSpan = skip && wordRow.spans.find(span => span.end > skip.index);
      const candidates = row.values.filter(item =>
        item.word.x0 >= label.x1 - columnTolerance &&
        (!nextLabel || item.word.x0 < nextLabel.x0) &&
        (!skipSpan || item.word.x0 < skipSpan.word.x0)
      );
      if (!candidates.length) continue;
      let selected;
      if (preferredColumn){
        selected = candidates.slice().sort((a, b) =>
          Math.abs(a.word.x0 - preferredColumn.center) - Math.abs(b.word.x0 - preferredColumn.center)
        )[0];
      } else selected = candidates[0];
      if (assigned[label.field] == null) assigned[label.field] = selected.value;
    }
    for (const field of assignedFields) out[field] = assigned[field];
  }
  out.found = ['kcal','p','c','f'].filter(key => out[key] != null).length;
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

function zoomNutritionRow(image, box){
  const rowHeight = Math.max(1, box.y1 - box.y0);
  const height = Math.min(image.height, Math.max(44, Math.ceil(rowHeight * 3.2)));
  const top = clamp(Math.round((box.y0 + box.y1) / 2 - height * 0.42), 0, image.height - height);
  const scale = Math.min(4, 6000 / image.width, 180 / height);
  const zoom = document.createElement('canvas');
  zoom.width = Math.max(1, Math.round(image.width * scale));
  zoom.height = Math.max(1, Math.round(height * scale));
  const ctx = zoom.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, top, image.width, height, 0, 0, zoom.width, zoom.height);
  return zoom;
}

function zoomImageSections(image){
  const width = Math.ceil(image.width * 0.56), height = Math.ceil(image.height * 0.56);
  const regions = [];
  for (const y of [0, image.height - height]){
    for (const x of [0, image.width - width]){
      const scale = Math.min(3, 1800 / Math.max(width, height));
      const zoom = document.createElement('canvas');
      zoom.width = Math.max(1, Math.round(width * scale));
      zoom.height = Math.max(1, Math.round(height * scale));
      const ctx = zoom.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, x, y, width, height, 0, 0, zoom.width, zoom.height);
      regions.push(zoom);
    }
  }
  return regions;
}

function nutritionRows(results, image){
  const rows = new Map();
  for (const result of results){
    if (result.image !== image) continue;
    for (const line of result.data.lines || []){
      const text = strip(line.text || '');
      const skip = SKIP_RE.exec(text);
      let field = null;
      for (const key of ['p','c','f']){
        const match = KEY_RE[key].exec(text);
        if (match && (!skip || skip.index > match.index)){ field = key; break; }
      }
      if (!field && ENERGY_RE.test(text)) field = 'kcal';
      const box = line.bbox;
      if (!field || !box || ![box.x0,box.y0,box.x1,box.y1].every(Number.isFinite)) continue;
      const height = box.y1 - box.y0;
      if (height <= 0 || box.y0 < 0 || box.y1 > image.height) continue;
      const previous = rows.get(field);
      if (!previous || height > previous.height) rows.set(field, { field, box, height });
    }
  }
  return Array.from(rows.values());
}

function nutritionScore(result){
  let score = result.found * 10;
  if (result.kcal > 0 && result.p != null && result.c != null && result.f != null){
    const difference = Math.abs(result.kcal - (4 * result.p + 4 * result.c + 9 * result.f)) / result.kcal;
    if (difference < 0.15) score += 3;
    else if (difference > 0.35) score -= 3;
  }
  return score;
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
    // Tesseract may fail inside its worker without rejecting, so route worker errors and the watchdog through one promise.
    let fail; const failed = new Promise((_, rej) => { fail = rej; }); failed.catch(() => {});
    const watchdog = setTimeout(() => fail(new Error('The scan took too long')), 180000);
    const guard = p => Promise.race([p, failed]);
    let best;
    try {
      worker = await guard(T.createWorker(S.scanLang, 1, {
        errorHandler: e => fail(e instanceof Error ? e : new Error(String(e && e.message || e))),
        logger: m => {
          if (!m || !m.status) return;
          if (m.status === 'recognizing text'){ setProgress(0.12 + m.progress * 0.72); setStatus(`Reading label… ${Math.round(m.progress * 100)}%`); }
          else if (/language/.test(m.status)){ setProgress(0.03 + m.progress * 0.08); setStatus('Downloading language data (first time only)…'); }
          else if (/core/.test(m.status)) setStatus('Loading OCR engine…');
        }
      }));

      const results = [];
      const pass = async (image, psm) => {
        await guard(worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' }));
        const { data } = await guard(worker.recognize(image));
        const text = data.text || '';
        const result = { data, image, text, parsed:parseNutritionTable(data, text) };
        results.push(result);
        return result;
      };

      best = await pass(cv, '6');
      if (best.parsed.found < 4){
        setStatus('Searching the label with an alternate layout…');
        const alternate = await pass(cv, '4');
        if (nutritionScore(alternate.parsed) > nutritionScore(best.parsed)) best = alternate;
      }

      if (best.parsed.found < 4){
        const sections = zoomImageSections(cv);
        for (let i = 0; i < sections.length && best.parsed.found < 4; i++){
          setStatus(`Searching enlarged section ${i + 1} of ${sections.length}…`);
          const section = await pass(sections[i], '6');
          if (nutritionScore(section.parsed) > nutritionScore(best.parsed)) best = section;
        }
      }

      const rows = nutritionRows(results, cv);
      const focused = { ...best.parsed };
      const zoomedText = [];
      for (const row of rows){
        setStatus(`Zooming in on ${row.field === 'kcal' ? 'calories' : row.field === 'p' ? 'protein' : row.field === 'c' ? 'carbohydrates' : 'fat'}…`);
        const zoom = await pass(zoomNutritionRow(cv, row.box), '7');
        zoomedText.push(zoom.text.trim());
        if (zoom.parsed[row.field] != null) focused[row.field] = zoom.parsed[row.field];
      }
      focused.found = ['kcal','p','c','f'].filter(key => focused[key] != null).length;
      if (nutritionScore(focused) >= nutritionScore(best.parsed)){
        best = { ...best, parsed:focused, text:[best.text, ...zoomedText].filter(Boolean).join('\n\n') };
      } else if (zoomedText.length){
        best.text = [best.text, ...zoomedText].filter(Boolean).join('\n\n');
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
