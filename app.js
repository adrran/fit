import * as C from './calc.js';

const [R, E, TIPS, FOODS] = await Promise.all(['data/recipes.json', 'data/exercises.json', 'data/tips.json', 'data/foods.json'].map(f => fetch(f).then(r => r.json())));
const NUT = Object.fromEntries(Object.entries(R.recipes).map(([id, r]) => [id, C.nutrition(r, R.ingredients)]));

// ---------- Speicher ----------
const KEY = 'fitapp', AI_KEY = 'fitapp-key'; // API-Key getrennt, landet nie im Backup
const DEFAULT = {
  profile: { sex: 'm', age: 27, height: 192, startKg: 130, goalKg: 90, activity: 1.55, deficit: 700,
    trainDays: [1, 2, 4, 5, 6], mealTimes: ['08:00', '13:00', '16:30', '19:30'], start: null },
  reminders: { wiegen: { on: true, time: '07:30' }, essen: { on: true }, training: { on: true, time: '17:00' }, checkin: { on: true, time: '21:00' } },
  weights: {}, waist: {}, days: {}, workouts: {}, progress: {}, plan: {}, shop: {}, feel: {}, foods: {}, plateau: null,
};
function init(d) {
  const s = { ...structuredClone(DEFAULT), ...d };
  s.profile = { ...DEFAULT.profile, ...d.profile };
  s.reminders = { ...DEFAULT.reminders, ...d.reminders };
  s.profile.start ??= C.key(new Date());
  for (const k of Object.keys(s.plan)) if (!k.includes('-')) { s.plan['0-' + k] ??= s.plan[k]; delete s.plan[k]; }
  return s;
}
let S;
try { S = init(JSON.parse(localStorage.getItem(KEY)) || {}); } catch { S = init({}); }
const save = () => localStorage.setItem(KEY, JSON.stringify(S));

// ---------- Helfer ----------
const $ = s => document.querySelector(s);
const r0 = Math.round;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const today = () => C.key(new Date());
const day = k => (S.days[k] ??= { eaten: {}, extra: [] });
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const fmtDate = k => C.parse(k).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
const kg = v => v == null ? '–' : v.toFixed(1).replace('.', ',') + ' kg';
const cap = s => s[0].toUpperCase() + s.slice(1);
const lvl = ex => S.progress[ex]?.level ?? 0;
const exName = ex => E.exercises[ex].levels[lvl(ex)].name;
const dlg = html => { $('#dlgBody').innerHTML = html; if (!$('#dlg').open) $('#dlg').showModal(); };
const tabs = (act, cur, list) => `<div class=tabs>${list.map(([id, label]) =>
  `<button class="btn ${cur === id ? '' : 'ghost'}" data-act=${act} data-t=${id}>${label}</button>`).join('')}</div>`;
const download = (name, text, type) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
};

// Tagesziel inkl. Plateau-Anpassung
function T(k = today()) {
  const pl = C.plateau(S.profile, S.plateau, S.weights, k);
  if (JSON.stringify(pl) !== JSON.stringify(S.plateau)) { S.plateau = pl; save(); }
  return C.targets(S.profile, C.avg7(S.weights, k), pl.adjust);
}
// Getauschte Mahlzeiten liegen pro Woche + Wochentag in S.plan, z. B. "1-3" = Woche B, Mittwoch
const weekOf = k => C.weekIndex(S.profile.start, k, R.weeks.length);
const planKey = k => `${weekOf(k)}-${C.weekday(k)}`;
const idsFor = k => R.slots.map((_, i) => S.plan[planKey(k)]?.[i] ?? R.weeks[weekOf(k)][C.weekday(k)][i]);

function meals(k) {
  const d = S.days[k] ?? { eaten: {}, extra: [] }, t = T(k), ids = idsFor(k);
  const used = Object.values(d.eaten).reduce((a, e) => a + e.kcal, 0) + d.extra.reduce((a, e) => a + e.kcal, 0);
  const openBase = ids.reduce((a, id, i) => d.eaten[i] ? a : a + NUT[id].kcal, 0);
  const f = C.remainingFactor(t.kcal, used, openBase);
  return { t, d, f, used, left: t.kcal - used,
    list: ids.map((id, i) => ({ i, id, r: R.recipes[id], slot: R.slots[i], time: S.profile.mealTimes[i],
      eaten: d.eaten[i], f: d.eaten[i]?.f ?? f, kcal: d.eaten[i]?.kcal ?? NUT[id].kcal * f })) };
}

// Gegessene Makros. Geschätzte Abweichungen (Restaurant etc.) kennen nur kcal →
// ponytail: grobe Fast-Food-Verteilung 15 % P / 45 % KH / 40 % F, genauer geht's ohne Einzelzählung nicht
const est = kcal => ({ p: kcal * 0.15 / 4, c: kcal * 0.45 / 4, fat: kcal * 0.4 / 9 });
function consumed(m) {
  const n = { kcal: m.used, p: 0, c: 0, fat: 0, guessed: false };
  for (const e of [...Object.values(m.d.eaten), ...m.d.extra]) {
    if (e.p == null) n.guessed = true;
    const x = e.p != null ? e : est(e.kcal);
    n.p += x.p; n.c += x.c; n.fat += x.fat;
  }
  return n;
}

// ---------- Bilder ----------
const plate = (id, big) => `<div class="plate ${big ? 'big' : ''}" aria-hidden=true>${R.recipes[id]?.img ?? '🍽️'}</div>`;

// Animierte Strichfigur aus zwei Posen (a ↔ b) in exercises.json
const BONES = [['P', 'K'], ['K', 'F'], ['N', 'E'], ['E', 'W']];
function figure(ex) {
  const an = E.exercises[ex].anim;
  if (!an) return '';
  const A = an.a, B = an.b ?? an.a;
  const pt = (pose, j, far) => (far && pose[j + '2']) || pose[j];
  const anim = (attr, a, b) => a === b ? '' : `<animate attributeName="${attr}" values="${a};${b};${a}" dur="3s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"/>`;
  const line = (j1, j2, far) => {
    const [a1, a2, b1, b2] = [pt(A, j1, far), pt(A, j2, far), pt(B, j1, far), pt(B, j2, far)];
    return `<line class="${far ? 'far' : ''}" x1=${a1[0]} y1=${a1[1]} x2=${a2[0]} y2=${a2[1]}>${anim('x1', a1[0], b1[0])}${anim('y1', a1[1], b1[1])}${anim('x2', a2[0], b2[0])}${anim('y2', a2[1], b2[1])}</line>`;
  };
  return `<svg class=fig viewBox="0 0 100 100" role=img aria-label="Bewegungsablauf">
    <path class=prop d="M0 90h100"/>${an.props.map(d => `<path class=prop d="${d}"/>`).join('')}
    ${BONES.map(b => line(...b, true)).join('')}${line('N', 'P')}${BONES.map(b => line(...b)).join('')}
    <circle r=6 cx=${A.H[0]} cy=${A.H[1]}>${anim('cx', A.H[0], B.H[0])}${anim('cy', A.H[1], B.H[1])}</circle></svg>`;
}
const videoLink = ex => `<a class="btn ghost" target=_blank rel=noopener href="https://www.youtube.com/results?search_query=${encodeURIComponent(exName(ex) + ' Übung richtig ausführen')}">▶ Video ansehen (online)</a>`;

// ---------- Start ----------
function rings(rows) {
  const R0 = [92, 75, 58, 41];
  return `<svg class=rings viewBox="0 0 200 200">${rows.map(([v, of, cls], i) => `
    <circle class="track ${cls}" cx=100 cy=100 r=${R0[i]} />
    <circle class="ring ${cls}" cx=100 cy=100 r=${R0[i]} pathLength=100 stroke-dasharray="${Math.min(100, of ? v / of * 100 : 0).toFixed(1)} 100" transform="rotate(-90 100 100)" />`).join('')}
  </svg>`;
}
function start() {
  const k = today(), m = meals(k), n = consumed(m), t = m.t;
  const rows = [[n.kcal, t.kcal, 'k', 'Kalorien', 'kcal'], [n.p, t.protein, 'p', 'Protein', 'g'], [n.c, t.carbs, 'c', 'Kohlenhydrate', 'g'], [n.fat, t.fat, 'f', 'Fett', 'g']];
  return `<header class=row><div><h1>Heute</h1><p class=muted>${WDL[C.weekday(k)]}, ${fmtDate(k)}</p></div>
    <a class="btn ghost sm" href=#einstellungen aria-label=Einstellungen>⚙</a></header>
  <div class=ringbox>${rings(rows)}<div class=center><div class=num>${r0(n.kcal)}</div><div class=muted>von ${t.kcal} kcal</div></div></div>
  <p class=left>${m.left >= 0 ? `Noch <b>${r0(m.left)} kcal</b> übrig` : `<b>${r0(-m.left)} kcal</b> über dem Ziel – morgen ganz normal weiter`}</p>
  <div class=legend>${rows.map(([v, of, cls, label, unit]) =>
    `<div><i class=${cls}></i>${label}<b>${r0(v)} / ${of} ${unit}</b></div>`).join('')}</div>
  ${n.guessed ? '<p class="muted left">≈ Makros teilweise geschätzt (grobe Angaben). Für genaue Werte „Genau eintragen“ nutzen.</p>' : ''}`;
}

// ---------- Ernährung: 7 Tage voraus ----------
function essen() {
  const k = today(), y = S.days[C.addDays(k, -1)], t = T(k), hints = [];
  if (y?.status === 'teilweise' || y?.status === 'nein') hints.push('Ein Tag ändert nichts, einfach weitermachen.');
  if (S.plateau?.hint && C.diffDays(k, S.plateau.since) < 7) hints.push(S.plateau.hint);
  const days = [...Array(7)].map((_, i) => C.addDays(k, i));
  return `<header class=row><h1>Ernährung</h1><button class="btn warn" data-act=craving>Heißhunger</button></header>
  ${hints.map(h => `<p class=hint>${h}</p>`).join('')}
  ${days.map((d, i) => i === 0 ? todayMeals(d) : dayMeals(d, t)).join('')}
  <section class=card><h2>Notfall-Optionen</h2><p class=muted>Für Tage ohne Kochen: bei einer Mahlzeit „Anders“ wählen.</p>
    <ul>${R.emergency.map(e => `<li>${e.name} – ~${e.kcal} kcal</li>`).join('')}</ul></section>`;
}
const recipeDetails = (id, f) => {
  const r = R.recipes[id], n = NUT[id];
  return `<details><summary>Rezept · ${r.min} Min.</summary>${plate(id, true)}
    <p class=muted>${r0(n.kcal * f)} kcal · Protein ${r0(n.p * f)} g · KH ${r0(n.c * f)} g · Fett ${r0(n.f * f)} g</p>
    <ul>${r.items.map(([name, g]) => { const pc = R.ingredients[name].piece;
      return `<li>${C.roundG(g * f)} g ${name}${pc ? ` (≈ ${Math.round(g * f / pc * 2) / 2} Stk.)` : ''}</li>`; }).join('')}</ul>
    <ol>${r.steps.map(s => `<li>${s}</li>`).join('')}</ol></details>`;
};
function todayMeals(k) {
  const m = meals(k);
  return `<section class="card today"><div class=row><h2>Heute <span class=muted>Woche ${'AB'[weekOf(k)]}</span></h2><span class=muted>noch <b>${r0(m.left)}</b> kcal</span></div>
    ${m.list.map(x => `<div class="meal ${x.eaten ? 'done' : ''}">
      <div class=mrow>${plate(x.eaten?.label ? null : x.id)}<div class=grow>
        <div class=row><span><span class=time>${x.time}</span> ${x.slot.name}</span><span>${r0(x.kcal)} kcal</span></div>
        <b>${x.eaten?.label ? esc(x.eaten.label) : x.r.name}</b></div></div>
      ${x.eaten?.label ? '' : recipeDetails(x.id, x.f)}
      <div class=btns3><button class="btn ${x.eaten ? '' : 'ghost'}" data-act=eat data-i=${x.i}>${x.eaten ? '✓ Gegessen' : 'Gegessen'}</button>
        <button class="btn ghost" data-act=other data-slot=${x.i}>Anders</button>
        <button class="btn ghost" data-act=swap data-k=${k} data-i=${x.i} ${x.eaten ? 'disabled' : ''}>Tauschen</button></div></div>`).join('')}
    ${m.d.extra.map((e, j) => `<div class="row extra"><span>+ ${esc(e.label)}</span><span>${e.kcal} kcal <button class=lnk data-act=delExtra data-j=${j} aria-label=Entfernen>✕</button></span></div>`).join('')}
    <button class="btn ghost" data-act=other data-slot="">+ Extra gegessen</button>
    <h3>Ernährungsplan eingehalten?</h3>
    <div class=btns3>${['ja', 'teilweise', 'nein'].map(s => `<button class="btn ${m.d.status === s ? '' : 'ghost'}" data-act=status data-s=${s}>${cap(s)}</button>`).join('')}</div></section>`;
}
function dayMeals(k, t) {
  const wd = C.weekday(k), ids = idsFor(k);
  const f = C.remainingFactor(t.kcal, 0, ids.reduce((a, id) => a + NUT[id].kcal, 0));
  return `<section class=card><h2>${C.diffDays(k, today()) === 1 ? 'Morgen' : WDL[wd]} <span class=muted>${fmtDate(k)} · Woche ${'AB'[weekOf(k)]}</span></h2>
    ${ids.map((id, i) => `<div class=meal><div class=mrow>${plate(id)}<div class=grow>
      <div class=row><span><span class=time>${S.profile.mealTimes[i]}</span> ${R.slots[i].name}</span><span>${r0(NUT[id].kcal * f)} kcal</span></div>
      <b>${R.recipes[id].name}</b></div>
      <button class="btn ghost sm" data-act=swap data-k=${k} data-i=${i} aria-label=Tauschen>⇄</button></div>
      ${recipeDetails(id, f)}</div>`).join('')}</section>`;
}

function swapMeal(k, i) {
  const ids = idsFor(k), cat = R.slots[i].cat;
  // nach kcal sortiert → der Nachbar hat ähnliche Kalorien
  const list = Object.keys(R.recipes).filter(id => R.recipes[id].cat === cat).sort((a, b) => NUT[a].kcal - NUT[b].kcal);
  S.plan[planKey(k)] = ids.with(i, list[(list.indexOf(ids[i]) + 1) % list.length]);
}

function otherDlg(slot) {
  const b = (label, kcal, plan = 0) => `<button class="btn ghost" data-act=pick data-slot="${slot}" data-kcal=${kcal} data-label="${label}" data-plan=${plan}>${label} · ~${kcal} kcal</button>`;
  dlg(`<h2>${slot === '' ? 'Was kam dazu?' : 'Was gab es stattdessen?'}</h2>
    <button class=btn data-act=food data-slot="${slot}">🔍 Genau eintragen (mit Nährwerten)</button>
    <h3>Grob schätzen</h3>
    <div class=stack>${R.quick.map(q => b(q.label, q.kcal)).join('')}</div>
    ${slot === '' ? '' : `<h3>Notfall-Optionen (zählen als Plan)</h3><div class=stack>${R.emergency.map(q => b(q.name, q.kcal, 1)).join('')}</div>`}
    <h3>Eigene Schätzung</h3>
    <form class=row data-form=pickNum><input type=hidden name=slot value="${slot}"><input name=kcal type=number inputmode=numeric placeholder=kcal required><button class=btn>OK</button></form>`);
}

// ---------- Genau eintragen: Lebensmittel-Suche ----------
// Quellen: eigene Einträge (offline) → Tabelle data/foods.json + Rezept-Zutaten (offline) → Open Food Facts (online)
let FOOD = null; // { slot, q, results, sel, g, busy, err }
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const per = (x, g) => ({ kcal: x.kcal * g / 100, p: x.p * g / 100, c: x.c * g / 100, fat: x.f * g / 100 });
const prevTxt = n => `${r0(n.kcal)} kcal · P ${r0(n.p)} g · KH ${r0(n.c)} g · F ${r0(n.fat)} g`;
const myFoods = () => Object.values(S.foods).sort((a, b) => b.used - a.used).map(f => ({ ...f, src: 'Meine' }));
const localFoods = () => [...myFoods(), ...FOODS.map(f => ({ ...f, src: 'Tabelle (Durchschnitt)' })),
  ...Object.entries(R.ingredients).map(([name, i]) => ({ name, kcal: i.kcal, p: i.p, c: i.c, f: i.f, portion: i.piece, src: 'Tabelle (Durchschnitt)' }))];

async function offSearch(q) {
  const u = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&json=1&page_size=15`
    + '&sort_by=unique_scans_n&tagtype_0=countries&tag_contains_0=contains&tag_0=germany&fields=product_name,brands,serving_quantity,nutriments';
  let j;
  for (let i = 0; !j; i++) { // die API hakt gelegentlich → 1× wiederholen
    try { j = await (await fetch(u, { signal: AbortSignal.timeout(8000) })).json(); } catch (e) { if (i) throw e; }
  }
  const one = v => Math.round(+v * 10) / 10;
  return j.products.map(p => {
    const n = p.nutriments ?? {}, kcal = n['energy-kcal_100g'] ?? (n.energy_100g != null ? n.energy_100g / 4.184 : null);
    if (kcal == null || !p.product_name) return null;
    return { name: p.product_name + (p.brands ? ` (${p.brands.split(',')[0].trim()})` : ''), kcal: one(kcal),
      p: one(n.proteins_100g ?? 0), c: one(n.carbohydrates_100g ?? 0), f: one(n.fat_100g ?? 0),
      portion: +p.serving_quantity > 0 ? r0(+p.serving_quantity) : null, src: 'Open Food Facts' };
  }).filter(Boolean);
}

function foodDlg() {
  const F = FOOD;
  if (F.sel) {
    const x = F.sel, u = x.unit || (x.src === 'Open Food Facts' ? 'g/ml' : 'g'); // OFF sagt nicht, ob fest oder flüssig
    return dlg(`<h2>${esc(x.name)}</h2>
      <p class=muted>pro 100 ${u}: ${r0(x.kcal)} kcal · P ${x.p} g · KH ${x.c} g · F ${x.f} g<br>Quelle: ${x.src}</p>
      <form data-form=foodAdd class=stack>
        <label>Wie viel? (${u})<input name=g type=number inputmode=decimal step=any min=1 value="${F.g}" data-grams required></label>
        ${x.portion ? `<button type=button class="btn ghost" data-act=foodPortion>1 Portion = ${x.portion} ${u}</button>` : ''}
        <p id=foodPrev class=big>${prevTxt(per(x, F.g))}</p>
        <button class=btn>Eintragen</button></form>
      <button class="btn ghost" data-act=foodBack>← zurück zur Suche</button>`);
  }
  dlg(`<h2>Genau eintragen</h2>
    <form data-form=foodSearch class=row><input name=q type=search value="${esc(F.q)}" placeholder="z. B. Cola, Snickers, Döner" enterkeyhint=search><button class=btn>Suchen</button></form>
    ${F.busy ? '<p class=muted>Suche auch online …</p>' : ''}${F.err ? `<p class=hint>${F.err}</p>` : ''}
    ${!F.q && F.results.length ? '<h3>Zuletzt</h3>' : ''}
    <div>${F.results.map((x, i) => `<button class=item data-act=foodPick data-i=${i}><span>${esc(x.name)}<br><small class=muted>${x.src}</small></span>
      <span class=muted>${r0(x.kcal)} kcal/100</span></button>`).join('')}</div>
    <h3>Von der Packung abtippen (pro 100 g/ml)</h3>
    <form data-form=foodManual class="stack form">
      <label>Name<input name=name required placeholder="z. B. Proteinriegel XY"></label>
      <div class=grid2><label>kcal<input name=kcal type=number step=any inputmode=decimal required></label>
        <label>Protein g<input name=p type=number step=any inputmode=decimal required></label>
        <label>Kohlenhydrate g<input name=c type=number step=any inputmode=decimal required></label>
        <label>Fett g<input name=f type=number step=any inputmode=decimal required></label></div>
      <button class="btn ghost">Weiter</button></form>`);
}
const pickFood = x => { FOOD.sel = x; FOOD.g = x.portion || 100; foodDlg(); };

// ---------- Einkaufsliste: pro Tag ----------
let shopDay = 0; // 0 = heute … 6
function einkauf() {
  const k0 = today(), t = T(k0), k = C.addDays(k0, shopDay), ids = idsFor(k);
  for (const key in S.shop) if (key.split('|')[0] < k0) delete S.shop[key]; // alte Tage aufräumen
  const f = C.remainingFactor(t.kcal, 0, ids.reduce((a, id) => a + NUT[id].kcal, 0));
  const all = C.shoppingList(ids.map(id => [R.recipes[id], f]), R.ingredients);
  const list = all.filter(x => !R.ingredients[x.name].pantry), pantry = all.filter(x => R.ingredients[x.name].pantry);
  const amt = x => (x.g >= 1000 ? (x.g / 1000).toFixed(1).replace('.', ',') + ' kg' : x.g + ' g') + (x.pieces ? ` (${x.pieces} Stk.)` : '');
  const id = x => `${k}|${x.name}`, open = list.filter(x => !S.shop[id(x)]).length;
  return `<h1>Einkaufsliste</h1>
  <div class=chips>${[...Array(7)].map((_, i) => { const d = C.addDays(k0, i);
    return `<button class="btn ${i === shopDay ? '' : 'ghost'}" data-act=shopDay data-i=${i}>${i ? WD[C.weekday(d)] : 'Heute'}<small>${C.parse(d).getDate()}.</small></button>`; }).join('')}</div>
  <p class=muted>${WDL[C.weekday(k)]}, ${fmtDate(k)} · Woche ${'AB'[weekOf(k)]} · ${open ? `noch ${open} von ${list.length}` : '✓ alles da'}</p>
  <p class=muted>Für: ${ids.map(i => R.recipes[i].name).join(' · ')}</p>
  ${R.areas.map(a => {
    const items = list.filter(x => x.area === a);
    return items.length ? `<section class=card><h2>${a}</h2>${items.map(x =>
      `<button class="item ${S.shop[id(x)] ? 'checked' : ''}" data-act=shop data-n="${id(x)}"><span>${S.shop[id(x)] ? '☑' : '☐'} ${x.name}</span><span>${amt(x)}</span></button>`).join('')}</section>` : '';
  }).join('')}
  ${pantry.length ? `<section class=card><h2>Vorrat prüfen</h2><p class=muted>Hält lange – nur nachkaufen, wenn's leer wird.</p>
    ${pantry.map(x => `<div class=row><span>${x.name}</span><span class=muted>${amt(x)}</span></div>`).join('')}</section>` : ''}
  <p class=muted>Auf dein Tagesziel (${t.kcal} kcal) skaliert. Gewürze, Salz, Essig, Zitrone nicht aufgeführt.</p>`;
}

// ---------- Körper ----------
let bodyTab = 'gewicht', aiBusy = false;
function koerper() {
  const view = { gewicht: bodyWeight, training: bodyTraining, gefuehl: bodyFeel }[bodyTab];
  return `<h1>Körper</h1>${tabs('bodyTab', bodyTab, [['gewicht', 'Gewicht'], ['training', 'Training'], ['gefuehl', 'Gefühl']])}${view()}`;
}

function bodyWeight() {
  const k = today(), p = S.profile, t = T(k);
  const fc = C.forecast(S.weights, k, p.goalKg, (t.tdee - t.kcal) * 7 / 7700);
  const mon = C.monday(k), waist = Object.entries(S.waist).sort().reverse().slice(0, 4);
  return `<section class=card><h2>Gewicht heute</h2>
    <form class=row data-form=weight><input name=v type=number step=0.1 inputmode=decimal placeholder=kg value="${S.weights[k] ?? ''}"><button class=btn>Speichern</button></form></section>
  <section class="card grid2">
    <div><div class=muted>7-Tage-Schnitt</div><div class=big>${kg(fc?.now)}</div></div>
    <div><div class=muted>Noch</div><div class=big>${fc ? kg(fc.left) : '–'}</div></div>
    <div><div class=muted>Ziel ${p.goalKg} kg ca.</div><div class=big>${fc?.left ? C.parse(fc.date).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' }) : '–'}</div></div>
    <div><div class=muted>Tempo</div><div class=big>${fc ? fc.rate.toFixed(2).replace('.', ',') + ' kg/Wo.' : '–'}</div></div>
  </section>
  ${fc ? `<p class=muted>Prognose ${fc.measured ? 'aus deinem Verlauf der letzten 4 Wochen' : 'aus dem geplanten Defizit (ab 4 Wochen Daten aus deinem Verlauf)'}.</p>` : ''}
  <section class=card>${chart()}</section>
  ${weekCard('Diese Woche', weekStats(mon))}
  ${weekCard('Letzte Woche', weekStats(C.addDays(mon, -7)))}
  <section class=card><h2>Wo es hakt</h2>${deviations()}</section>
  <section class=card><h2>Bauchumfang (wöchentlich)</h2>
    <form class=row data-form=waist><input name=v type=number step=0.5 inputmode=decimal placeholder=cm value="${S.waist[k] ?? ''}"><button class=btn>Speichern</button></form>
    ${waist.map(([d, v]) => `<div class=row><span>${fmtDate(d)}</span><span>${v} cm</span></div>`).join('')}</section>`;
}

function chart() {
  const keys = Object.keys(S.weights).sort();
  if (keys.length < 2) return '<p class=muted>Diagramm ab 2 Einträgen.</p>';
  const from = keys[0], to = keys.at(-1), span = C.diffDays(to, from) || 1;
  const vals = keys.map(k => S.weights[k]), lo = Math.min(...vals) - 1, hi = Math.max(...vals) + 1;
  const W = 340, H = 180, P = 28;
  const x = k => P + C.diffDays(k, from) / span * (W - P - 8), y = v => 8 + (hi - v) / (hi - lo) * (H - 30);
  const avg = keys.map(k => `${x(k).toFixed(1)},${y(C.avg7(S.weights, k)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" role=img aria-label="Gewichtsverlauf">
    <text x=0 y=${y(hi - 1) + 4}>${r0(hi - 1)}</text><text x=0 y=${y(lo + 1) + 4}>${r0(lo + 1)}</text>
    ${keys.map(k => `<circle cx=${x(k).toFixed(1)} cy=${y(S.weights[k]).toFixed(1)} r=2 class=dot />`).join('')}
    <polyline points="${avg}" class=avg />
    <text x=${P} y=${H - 4}>${fmtDate(from)}</text><text x=${W - 8} y=${H - 4} text-anchor=end>${fmtDate(to)}</text></svg>
    <p class=muted>Linie = 7-Tage-Schnitt, Punkte = Tageswerte</p>`;
}

function weekStats(mon) {
  const k = today(), keys = [...Array(7)].map((_, i) => C.addDays(mon, i)), past = keys.filter(x => x <= k);
  const w = past.map(x => S.weights[x]).filter(Boolean), st = past.map(x => S.days[x]?.steps).filter(Boolean);
  return {
    avg: w.length ? w.reduce((a, b) => a + b) / w.length : null,
    days: past.length, kept: past.filter(x => S.days[x]?.status === 'ja').length,
    planned: keys.filter(x => S.profile.trainDays.includes(C.weekday(x))).length,
    done: keys.filter(x => S.workouts[x]).length,
    steps: st.length ? r0(st.reduce((a, b) => a + b) / st.length) : null,
  };
}
const bar = (n, of) => `<div class=bar><i style="width:${of ? Math.min(100, n / of * 100) : 0}%"></i><b></b></div>`;
const weekCard = (title, s) => `<section class=card><h2>${title}</h2>
    <div class=row><span>Ø Gewicht</span><b>${kg(s.avg)}</b></div>
    <div class=row><span>Plan eingehalten</span><b>${s.kept}/${s.days} Tage</b></div>${bar(s.kept, s.days)}
    <div class=row><span>Trainings</span><b>${s.done}/${s.planned}</b></div>${bar(s.done, s.planned)}
    <div class=row><span>Ø Schritte</span><b>${s.steps?.toLocaleString('de-DE') ?? '–'}</b></div>
    <p class=muted>Strich = 80 %. Das ist das Ziel, nicht 100 %.</p></section>`;

function deviations() {
  const k = today(), byWd = Array(7).fill(0), bySlot = {};
  const inc = n => (bySlot[n] = (bySlot[n] || 0) + 1);
  for (let i = 0; i < 56; i++) {
    const x = C.addDays(k, -i), d = S.days[x];
    if (!d) continue;
    let dev = d.extra.length > 0 || d.status === 'teilweise' || d.status === 'nein';
    for (const [slot, e] of Object.entries(d.eaten)) if (!e.plan) { dev = true; inc(R.slots[slot].name); }
    d.extra.forEach(() => inc('Extra-Snacks'));
    if (dev) byWd[C.weekday(x)]++;
  }
  const wd = byWd.map((n, i) => [WDL[i], n]).filter(a => a[1]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const sl = Object.entries(bySlot).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!wd.length && !sl.length) return '<p class=muted>Noch keine Abweichungen erfasst.</p>';
  return `<p>Häufigste Tage: ${wd.map(([n, c]) => `${n} (${c}×)`).join(', ') || '–'}</p>
    <p>Häufigste Mahlzeiten: ${sl.map(([n, c]) => `${n} (${c}×)`).join(', ') || '–'}</p>
    <p class=muted>Letzte 8 Wochen. Dort lohnt es sich, den Plan anzupassen.</p>`;
}

function bodyTraining() {
  const k = today(), tr = C.trainingFor(k, S.profile.trainDays, S.workouts), done = S.workouts[k];
  const goal = C.stepGoal(S.profile.start, k);
  let n = 0;
  const sched = [1, 2, 3, 4, 5, 6, 0].map(wd => S.profile.trainDays.includes(wd) ? `${WD[wd]} ${'AB'[n++ % 2]}` : `${WD[wd]} –`).join(' · ');
  const last = Object.entries(S.workouts).sort().reverse().slice(0, 6);
  const todayPlan = done?.plan ?? tr?.plan;
  return `<section class=card><h2>Heute</h2>
    ${todayPlan == null ? '<p>Ruhetag. Nur das Schrittziel.</p>' : `<p><b>${E.plans[todayPlan].name}</b></p>
      ${tr?.shifted && !done ? '<p class=hint>Gestern ausgefallen – heute nachholen oder einfach lassen.</p>' : ''}
      ${done ? `<p class=ok>✓ Erledigt${done.short ? ' (20-Min.-Version)' : ''}</p>` :
      `<div class=btns2><button class=btn data-act=start data-short=0 data-plan=${todayPlan}>Starten</button><button class="btn ghost" data-act=start data-short=1 data-plan=${todayPlan}>20 Min.</button></div>`}`}
    <h3>Schritte · Ziel ${goal.toLocaleString('de-DE')}</h3>
    <form class=row data-form=steps><input name=v type=number inputmode=numeric placeholder=Schritte value="${S.days[k]?.steps ?? ''}"><button class=btn>Speichern</button></form>
    <p class=muted>${sched}</p></section>
  ${E.plans.map((p, pi) => `<section class=card><h2>${p.name}</h2>
    ${p.items.map(it => { const pr = S.progress[it.ex];
      return `<button class="item exrow" data-act=exInfo data-ex=${it.ex}>${figure(it.ex)}<span class=grow>${exName(it.ex)}${pr?.kg ? ` +${pr.kg} kg` : ''}
        <span class=muted><br>${it.sets}×${it.reps[0]}–${it.reps[1]} ${E.exercises[it.ex].unit} · Pause ${it.rest}s</span></span>›</button>`; }).join('')}
    <div class=btns2><button class=btn data-act=start data-short=0 data-plan=${pi}>Starten</button><button class="btn ghost" data-act=start data-short=1 data-plan=${pi}>20 Min.</button></div></section>`).join('')}
  <section class=card><h2>Regeln</h2><ul class=muted>
    <li>Alle Sätze am oberen Ende geschafft → nächstes Mal schwerere Stufe (auf der letzten Stufe: +2,5 kg im Rucksack).</li>
    <li>Verpasst? Rutscht auf den nächsten freien Tag, sonst entfällt es.</li></ul></section>
  <section class=card><h2>Zuletzt</h2>${last.length ? last.map(([d, w]) =>
    `<div class=row><span>${WD[C.weekday(d)]} ${fmtDate(d)}</span><span class=muted>${E.plans[w.plan].name}${w.short ? ' (20 Min.)' : ''}</span></div>`).join('') : '<p class=muted>Noch nichts.</p>'}</section>`;
}

function exInfo(ex) {
  const e = E.exercises[ex], L = lvl(ex);
  dlg(`<h2>${e.levels[L].name}</h2>${figure(ex)}${videoLink(ex)}
    ${e.levels.map((l, i) => `<div class="lv ${i === L ? 'cur' : ''}"><b>Stufe ${i + 1}: ${l.name}</b><p>${l.desc}</p><p class=muted>Tipp: ${l.tips}</p></div>`).join('')}
    <p class=muted>Noch leichter: ${e.easier}</p>`);
}

// Gefühl → Tipps (Regeln offline, optional KI)
function feelCtx(k) {
  const f = S.feel[k] ?? {}, m = meals(k), h = new Date().getHours(), w = weekStats(C.monday(k));
  const tr = C.trainingFor(k, S.profile.trainDays, S.workouts);
  return { ...f, training: !!tr && !S.workouts[k], abend: h >= 18,
    proteinLow: h >= 15 && consumed(m).p < m.t.protein * 0.5, behind: w.days >= 3 && w.kept / w.days < 0.8 };
}
function bodyFeel() {
  const k = today(), f = S.feel[k] ?? {}, ctx = feelCtx(k);
  const answered = TIPS.questions.some(q => f[q.id] != null);
  const tips = [...new Set(TIPS.rules.filter(r => Object.entries(r.if).every(([key, v]) => ctx[key] === v)).map(r => r.tip))].slice(0, 4);
  const hasKey = !!localStorage.getItem(AI_KEY);
  return `<section class=card><h2>Wie geht's dir heute?</h2>
    ${TIPS.questions.map(q => `<div class=q><span>${q.label}</span><div class=btns3>${q.opts.map((o, i) =>
      `<button class="btn ${f[q.id] === i ? '' : 'ghost'}" data-act=feel data-q=${q.id} data-v=${i}>${o}</button>`).join('')}</div></div>`).join('')}
    <form data-form=note class=stack><textarea name=note rows=2 placeholder="Notiz (optional), z. B. Knie zwickt, viel Stress …">${esc(f.note)}</textarea><button class="btn ghost">Notiz speichern</button></form></section>
  ${answered ? `<section class=card><h2>Tipps für heute</h2>${tips.length ? `<ul>${tips.map(t => `<li>${t}</li>`).join('')}</ul>` : '<p>Läuft. Einfach weitermachen.</p>'}</section>` : ''}
  <section class=card><h2>KI-Coach</h2>
    ${hasKey ? `<button class=btn data-act=ai ${aiBusy ? 'disabled' : ''}>${aiBusy ? 'Denkt nach …' : 'KI nach Tipps fragen'}</button>
      ${f.ai ? `<div class=ai>${esc(f.ai)}</div>` : ''}<p class=muted>Braucht Internet. Schickt Gefühl, Notiz und Tageszahlen an Claude (Anthropic).</p>`
    : '<p class=muted>Optional: Unter ⚙ Einstellungen einen eigenen Anthropic-API-Key eintragen, dann gibt Claude dir persönliche Tipps (online, kostet wenige Cent pro Frage).</p>'}</section>`;
}

async function askAI() {
  const k = today(), f = S.feel[k] ?? {}, m = meals(k), n = consumed(m), ctx = feelCtx(k), p = S.profile;
  const feelTxt = TIPS.questions.filter(q => f[q.id] != null).map(q => `${q.label}: ${q.opts[f[q.id]]}`).join(', ') || 'keine Angabe';
  const a7 = C.avg7(S.weights, k), a7old = C.avg7(S.weights, C.addDays(k, -7)), w = weekStats(C.monday(k));
  const tr = C.trainingFor(k, p.trainDays, S.workouts);
  const summary = `Profil: ${p.sex === 'w' ? 'weiblich' : 'männlich'}, ${p.age} J., ${p.height} cm, Start ${p.startKg} kg, Ziel ${p.goalKg} kg. Training nur mit Körpergewicht zu Hause.
Gewicht (7-Tage-Schnitt): ${kg(a7)}, vor einer Woche ${kg(a7old)}.
Heute: ${r0(n.kcal)} von ${m.t.kcal} kcal gegessen, Protein ${r0(n.p)} von ${m.t.protein} g. Uhrzeit ${new Date().toTimeString().slice(0, 5)}.
Training heute: ${S.workouts[k] ? 'erledigt' : tr ? `${E.plans[tr.plan].name} steht noch an` : 'Ruhetag'}.
Diese Woche: Plan an ${w.kept}/${w.days} Tagen eingehalten, ${w.done}/${w.planned} Trainings.
Gefühl: ${feelTxt}.${f.note ? `\nNotiz: ${f.note}` : ''}`;
  let Anthropic;
  try { ({ default: Anthropic } = await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm')); }
  catch { return 'Offline – der KI-Coach braucht Internet. Die Tipps oben funktionieren auch offline.'; }
  const client = new Anthropic({ apiKey: localStorage.getItem(AI_KEY), dangerouslyAllowBrowser: true });
  try {
    const res = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: 'Du bist ein ruhiger, sachlicher Coach für Abnehmen und Krafttraining mit Körpergewicht. Gib auf Deutsch 3 bis 5 kurze, konkrete Tipps für den Rest des heutigen Tages, passend zu Gefühl und Zahlen. Kein Schuldgefühl, keine Kompensation über mehrere Tage, 80 % reichen. Keine Diagnosen; bei Schmerzen oder Warnzeichen zum Arzt raten. Nur Klartext, jede Zeile beginnt mit "– ", kein Markdown.',
      messages: [{ role: 'user', content: summary }],
    });
    if (res.stop_reason === 'refusal') return 'Dazu kann die KI gerade nichts sagen.';
    return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return 'API-Key ungültig. Bitte unter ⚙ Einstellungen prüfen.';
    if (e instanceof Anthropic.RateLimitError) return 'Zu viele Anfragen – in einer Minute nochmal versuchen.';
    if (e instanceof Anthropic.APIConnectionError) return 'Keine Verbindung zur KI. Internet prüfen.';
    if (e instanceof Anthropic.APIError) return `KI-Fehler (${e.status}): ${e.message}`;
    throw e;
  }
}

// ---------- Geführter Trainingsmodus ----------
let RUN = null, tick = null, audio = null, wake = null;
function startRun(short, planIdx) {
  const p = E.plans[planIdx];
  const items = short ? p.items.filter(it => p.short.includes(it.ex)).map(it => ({ ...it, sets: E.shortSets })) : p.items;
  RUN = { plan: planIdx, short, items, i: 0, set: 0, res: {}, restEnd: 0, ups: null };
  try { audio ??= new AudioContext(); audio.resume(); } catch {}
  navigator.wakeLock?.request('screen').then(l => (wake = l)).catch(() => {});
  location.hash = 'run';
}
const secs = () => { const s = Math.max(0, Math.ceil((RUN.restEnd - Date.now()) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function beep() {
  navigator.vibrate?.([300, 100, 300]);
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = 880; g.gain.value = 0.3; o.connect(g).connect(audio.destination);
  o.start(); o.stop(audio.currentTime + 0.5);
}
function startRest(s) {
  RUN.restEnd = Date.now() + s * 1000;
  clearInterval(tick);
  tick = setInterval(() => {
    if (RUN.restEnd <= Date.now()) { clearInterval(tick); beep(); render(); }
    else if ($('#timer')) $('#timer').textContent = secs();
  }, 250);
}
function finish() {
  clearInterval(tick);
  const ups = [];
  for (const it of RUN.items) {
    const r = RUN.res[it.ex], pr = (S.progress[it.ex] ??= { level: 0, kg: 0 });
    if (!r) continue;
    pr.up = C.allTop(r.reps, it.sets, it.reps);
    if (!pr.up) continue;
    const e = E.exercises[it.ex];
    if (r.level < e.levels.length - 1) { pr.level = r.level + 1; ups.push(`${e.levels[r.level].name} → ${e.levels[pr.level].name}`); }
    else { pr.kg = (pr.kg || 0) + 2.5; ups.push(`${e.levels[r.level].name}: +2,5 kg Rucksack`); }
  }
  S.workouts[today()] = { plan: RUN.plan, short: RUN.short, res: RUN.res };
  RUN.i = RUN.items.length; RUN.ups = ups;
  wake?.release(); wake = null;
}
function run() {
  if (!RUN) return `<p>Kein Training aktiv.</p><a class=btn href=#koerper>Zurück</a>`;
  if (RUN.ups) return `<div class=run><h1>Geschafft ✓</h1>
    ${RUN.ups.length ? `<p>Nächstes Mal schwerer:</p><ul>${RUN.ups.map(u => `<li>${u}</li>`).join('')}</ul>` : '<p class=muted>Gleiche Stufen beim nächsten Mal.</p>'}
    <a class=btn href=#start>Fertig</a></div>`;
  const it = RUN.items[RUN.i], e = E.exercises[it.ex], L = lvl(it.ex), lv = e.levels[L], pr = S.progress[it.ex];
  if (RUN.restEnd > Date.now()) return `<div class=run><p class=muted>Pause</p><div class=timer id=timer>${secs()}</div>
    <p>Als Nächstes: ${lv.name} · Satz ${RUN.set + 1}/${it.sets}</p>${figure(it.ex)}<button class="btn ghost" data-act=skipRest>Pause überspringen</button></div>`;
  const prev = RUN.res[it.ex]?.reps.at(-1) ?? it.reps[0];
  return `<div class=run>
    ${RUN.i === 0 && RUN.set === 0 ? `<p class=hint>${E.warmup}</p>` : ''}
    <p class=muted>Übung ${RUN.i + 1}/${RUN.items.length} · Satz ${RUN.set + 1}/${it.sets}${RUN.short ? ' · 20 Min.' : ''}</p>
    <h1>${lv.name}</h1>${figure(it.ex)}
    ${pr?.up ? '<p class=ok>⬆ Neue Stufe – letztes Mal alles geschafft.</p>' : ''}
    ${pr?.kg ? `<p class=hint>+ ${pr.kg} kg im Rucksack</p>` : ''}
    <p>${lv.desc}</p><p class=muted>Tipp: ${lv.tips}</p>
    <p class=num>${it.reps[0]}–${it.reps[1]} <small>${e.unit}</small></p>
    <form data-form=set class=row><input name=reps type=number inputmode=numeric value="${prev}" aria-label=Geschafft><button class=btn>Satz fertig</button></form>
    ${L > 0 ? `<button class="btn ghost" data-act=easier data-ex=${it.ex}>Leichter: ${e.levels[L - 1].name}</button>` : `<p class=muted>Zu schwer? ${e.easier}</p>`}
    ${videoLink(it.ex)}
    <div class=btns2><button class="btn ghost" data-act=skipEx>Übung überspringen</button><button class="btn ghost" data-act=quit>Beenden</button></div></div>`;
}

// ---------- Einstellungen ----------
function einstellungen() {
  const p = S.profile, t = T(), rm = S.reminders;
  const num = (path, label, v, step = 1) => `<label>${label}<input type=number step=${step} data-set=${path} value="${v}"></label>`;
  const sel = (path, label, v, opts) => `<label>${label}<select data-set=${path}>${opts.map(([val, txt]) => `<option value=${val} ${val == v ? 'selected' : ''}>${txt}</option>`).join('')}</select></label>`;
  const rem = (id, label, time = true) => `<div class=row><label class=check><input type=checkbox data-set=reminders.${id}.on ${rm[id].on ? 'checked' : ''}> ${label}</label>
    ${time ? `<input type=time class=w-auto data-set=reminders.${id}.time value="${rm[id].time}">` : '<span class=muted>zu den Essenszeiten</span>'}</div>`;
  return `<header class=row><h1>Einstellungen</h1><a class="btn ghost sm" href=#start aria-label=Zurück>✕</a></header>
  <section class=card><h2>Rechner</h2>
    <div class=row><span>Grundumsatz (Mifflin-St-Jeor)</span><b>${t.bmr} kcal</b></div>
    <div class=row><span>Gesamtumsatz</span><b>${t.tdee} kcal</b></div>
    <div class=row><span>Tagesziel</span><b>${t.kcal} kcal</b></div>
    <div class=row><span>Protein / KH / Fett</span><b>${t.protein} / ${t.carbs} / ${t.fat} g</b></div>
    <p class=muted>Gerechnet mit ${t.kg} kg (neu alle 5 kg)${S.plateau?.adjust ? `, Plateau-Anpassung ${S.plateau.adjust} kcal` : ''}. Nie unter Grundumsatz.</p></section>
  <section class="card form"><h2>Profil</h2>
    ${sel('profile.sex', 'Geschlecht', p.sex, [['m', 'männlich'], ['w', 'weiblich']])}
    ${num('profile.age', 'Alter', p.age)}${num('profile.height', 'Größe (cm)', p.height)}
    ${num('profile.startKg', 'Startgewicht (kg)', p.startKg, 0.1)}${num('profile.goalKg', 'Zielgewicht (kg)', p.goalKg, 0.1)}
    ${sel('profile.activity', 'Aktivität', p.activity, [[1.2, 'kaum (1,2)'], [1.375, 'leicht (1,375)'], [1.55, 'mäßig (1,55)'], [1.725, 'hoch (1,725)']])}
    ${sel('profile.deficit', 'Defizit', p.deficit, [[500, '500 kcal'], [600, '600 kcal'], [700, '700 kcal']])}
    <label>Start (für Schrittziel)<input type=date data-set=profile.start value="${p.start}"></label></section>
  <section class=card><h2>Trainingstage</h2><div class=days>${[1, 2, 3, 4, 5, 6, 0].map(wd =>
    `<label class=check><input type=checkbox data-td=${wd} ${p.trainDays.includes(wd) ? 'checked' : ''}> ${WD[wd]}</label>`).join('')}</div></section>
  <section class="card form"><h2>Essenszeiten</h2>${R.slots.map((s, i) =>
    `<label>${s.name}<input type=time data-set=profile.mealTimes.${i} value="${p.mealTimes[i]}"></label>`).join('')}</section>
  <section class=card><h2>Erinnerungen</h2>
    ${rem('wiegen', 'Wiegen')}${rem('essen', 'Mahlzeiten', false)}${rem('training', 'Training')}${rem('checkin', 'Check-in')}
    <button class=btn data-act=ics>Kalender-Datei (.ics) laden</button>
    <p class=muted>Datei öffnen → in den Handy-Kalender übernehmen. Nach Änderungen neu laden und den alten Kalender löschen.</p></section>
  <section class="card form"><h2>KI-Coach (optional)</h2>
    <label>Anthropic-API-Key<input type=password autocomplete=off data-aikey placeholder="sk-ant-…" value="${esc(localStorage.getItem(AI_KEY))}"></label>
    <p class=muted>Key von console.anthropic.com. Bleibt nur auf diesem Gerät und ist nicht im Backup.</p></section>
  <section class=card><h2>Backup</h2>
    <div class=btns2><button class=btn data-act=export>Export (JSON)</button>
    <label class="btn ghost">Import<input type=file accept="application/json,.json" data-import hidden></label></div></section>`;
}

function ics() {
  const rm = S.reminders, p = S.profile, start = C.addDays(today(), 1).replaceAll('-', '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const BY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fitapp//DE', 'X-WR-CALNAME:Fitness'];
  const ev = (id, title, time, rrule = 'FREQ=DAILY') => L.push('BEGIN:VEVENT', `UID:${id}@fitapp`, `DTSTAMP:${stamp}`,
    `DTSTART:${start}T${time.replace(':', '')}00`, 'DURATION:PT10M', `RRULE:${rrule}`, `SUMMARY:${title}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
  if (rm.wiegen.on) ev('wiegen', 'Wiegen', rm.wiegen.time);
  if (rm.essen.on) R.slots.forEach((s, i) => ev('essen' + i, s.name, p.mealTimes[i]));
  if (rm.training.on && p.trainDays.length) ev('training', 'Training', rm.training.time, `FREQ=WEEKLY;BYDAY=${p.trainDays.map(d => BY[d]).join(',')}`);
  if (rm.checkin.on) ev('checkin', 'Check-in: Plan eingehalten?', rm.checkin.time);
  L.push('END:VCALENDAR');
  download('fitness-erinnerungen.ics', L.join('\r\n'), 'text/calendar');
}

// ---------- Aktionen ----------
const addEat = (slot, kcal, label, plan, mac = {}) => {
  const d = day(today()), e = { kcal, label, ...mac };
  const o = d.eaten[slot], m = x => x.p != null ? x : { ...x, ...est(x.kcal) };
  if (slot === '') d.extra.push(e);
  else if (o && !o.plan && !plan) { // mehrere Sachen statt einer Mahlzeit → aufsummieren
    const a = m(o), b = m(e), guessed = o.p == null || e.p == null;
    d.eaten[slot] = { kcal: a.kcal + b.kcal, label: `${o.label} + ${label}`, plan: false,
      ...(guessed ? {} : { p: a.p + b.p, c: a.c + b.c, fat: a.fat + b.fat }) };
  } else d.eaten[slot] = { ...e, plan };
  FOOD = null;
  $('#dlg').close();
};
const ACT = {
  eat: ({ i }) => {
    const d = day(today());
    if (d.eaten[i]) return void delete d.eaten[i];
    const x = meals(today()).list[i], n = NUT[x.id];
    d.eaten[i] = { kcal: r0(x.kcal), f: x.f, plan: true, p: n.p * x.f, c: n.c * x.f, fat: n.f * x.f };
  },
  other: ({ slot }) => otherDlg(slot),
  food: ({ slot }) => { FOOD = { slot, q: '', results: myFoods().slice(0, 8), sel: null, g: 100, busy: false, err: '' }; foodDlg(); },
  foodPick: ({ i }) => pickFood(FOOD.results[+i]),
  foodPortion: () => { FOOD.g = FOOD.sel.portion; foodDlg(); },
  foodBack: () => { FOOD.sel = null; foodDlg(); },
  pick: ({ slot, kcal, label, plan }) => addEat(slot, +kcal, label, plan === '1'),
  delExtra: ({ j }) => day(today()).extra.splice(j, 1),
  swap: ({ k, i }) => swapMeal(k, +i),
  status: ({ s }) => { day(today()).status = s; if (s !== 'ja') otherDlg(''); },
  craving: () => dlg(`<h2>Heißhunger</h2><p>Erst eins davon:</p><ul>${R.alternatives.map(a => `<li>${a}</li>`).join('')}</ul>
    <h3>Immer noch? Sättigend & leicht:</h3><div class=stack>${R.cravings.map(c =>
      `<button class="btn ghost" data-act=pick data-slot="" data-kcal=${c.kcal} data-label="${c.name}" data-plan=0>${c.name} · ${c.kcal} kcal</button>`).join('')}</div>`),
  shop: ({ n }) => (S.shop[n] = !S.shop[n]),
  shopDay: ({ i }) => (shopDay = +i),
  bodyTab: ({ t }) => (bodyTab = t),
  feel: ({ q, v }) => { const f = (S.feel[today()] ??= {}); f[q] = f[q] === +v ? undefined : +v; },
  ai: async () => {
    aiBusy = true; render();
    try { (S.feel[today()] ??= {}).ai = await askAI(); } finally { aiBusy = false; save(); render(); }
  },
  exInfo: ({ ex }) => exInfo(ex),
  start: ({ short, plan }) => startRun(short === '1', +plan),
  skipRest: () => { RUN.restEnd = 0; clearInterval(tick); },
  easier: ({ ex }) => { S.progress[ex].level--; S.progress[ex].up = false; },
  skipEx: () => { RUN.i++; RUN.set = 0; if (RUN.i >= RUN.items.length) finish(); },
  quit: () => { if (Object.keys(RUN.res).length) finish(); else { RUN = null; location.hash = 'koerper'; } },
  export: () => download(`fitness-backup-${today()}.json`, JSON.stringify(S), 'application/json'),
  ics,
};
const FORMS = {
  weight: fd => { const v = +fd.get('v'); if (v > 30 && v < 400) S.weights[today()] = v; else delete S.weights[today()]; },
  steps: fd => { day(today()).steps = +fd.get('v') || undefined; },
  waist: fd => { const v = +fd.get('v'); if (v) S.waist[today()] = v; },
  note: fd => { (S.feel[today()] ??= {}).note = fd.get('note').trim() || undefined; },
  foodSearch: async fd => {
    const q = fd.get('q').trim();
    if (!q) return;
    const words = norm(q).split(/\s+/), local = localFoods().filter(x => words.every(w => norm(x.name).includes(w)));
    Object.assign(FOOD, { q, results: local, busy: true, err: '' }); foodDlg();
    try {
      const online = await offSearch(q);
      if (FOOD?.q !== q) return; // Dialog inzwischen zu oder neue Suche
      FOOD.results = [...local, ...online];
      if (!FOOD.results.length) FOOD.err = 'Nichts gefunden. Anders schreiben (z. B. Marke weglassen) oder unten von der Packung abtippen.';
    } catch {
      if (FOOD?.q !== q) return;
      FOOD.err = navigator.onLine ? 'Online-Datenbank gerade nicht erreichbar – nochmal suchen oder von der Packung abtippen.' : 'Offline – nur gespeicherte Treffer.';
    }
    FOOD.busy = false; foodDlg();
  },
  foodManual: fd => pickFood({ name: fd.get('name').trim(), kcal: +fd.get('kcal'), p: +fd.get('p'), c: +fd.get('c'), f: +fd.get('f'), src: 'Packung' }),
  foodAdd: fd => {
    const g = +fd.get('g'), x = FOOD.sel;
    if (!(g > 0)) return;
    const n = per(x, g), u = x.unit || (x.src === 'Open Food Facts' ? 'g/ml' : 'g');
    S.foods[x.name] = { name: x.name, kcal: x.kcal, p: x.p, c: x.c, f: x.f, portion: x.portion ?? null, unit: x.unit, used: Date.now() };
    addEat(FOOD.slot, r0(n.kcal), `${x.name} · ${g} ${u}`, false, { p: n.p, c: n.c, fat: n.fat });
  },
  pickNum: fd => { const v = +fd.get('kcal'); if (v > 0) addEat(fd.get('slot'), v, `${v} kcal (geschätzt)`, false); },
  set: fd => {
    const it = RUN.items[RUN.i], r = (RUN.res[it.ex] ??= { reps: [] });
    r.level = lvl(it.ex); r.reps.push(+fd.get('reps') || 0);
    if (++RUN.set >= it.sets) { RUN.i++; RUN.set = 0; }
    if (RUN.i >= RUN.items.length) finish(); else startRest(it.rest);
  },
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  ACT[b.dataset.act](b.dataset); save(); render();
});
document.addEventListener('submit', e => {
  const f = e.target.dataset.form;
  if (!f) return;
  e.preventDefault(); FORMS[f](new FormData(e.target)); save(); render();
});
document.addEventListener('input', e => {
  if (!('grams' in e.target.dataset) || !FOOD?.sel) return;
  FOOD.g = +e.target.value || 0;
  $('#foodPrev').textContent = prevTxt(per(FOOD.sel, FOOD.g));
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.td) {
    const wd = +el.dataset.td, td = S.profile.trainDays;
    S.profile.trainDays = el.checked ? [...td, wd] : td.filter(x => x !== wd);
  } else if (el.dataset.set) {
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' || (el.tagName === 'SELECT' && !isNaN(el.value)) ? +el.value : el.value;
    const path = el.dataset.set.split('.'), last = path.pop();
    path.reduce((o, k) => o[k], S)[last] = v;
  } else if ('aikey' in el.dataset) {
    const v = el.value.trim();
    v ? localStorage.setItem(AI_KEY, v) : localStorage.removeItem(AI_KEY);
  } else if ('import' in el.dataset) {
    try {
      const d = JSON.parse(await el.files[0].text());
      if (!d.profile) throw 0;
      if (!confirm('Alle aktuellen Daten durch das Backup ersetzen?')) return;
      S = init(d);
    } catch { alert('Keine gültige Backup-Datei.'); return; }
  } else return;
  save(); render();
});

// ---------- Router ----------
const VIEWS = { start, koerper, einkauf, essen, einstellungen, run };
function render() {
  const v = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'start';
  document.body.classList.toggle('running', v === 'run');
  $('#app').innerHTML = VIEWS[v]();
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.hash === '#' + v));
}
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
document.addEventListener('visibilitychange', () => document.hidden || render()); // neuer Tag nach Mitternacht
render();
navigator.serviceWorker?.register('sw.js');
