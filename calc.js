// Reine Rechenlogik ohne DOM – wird von app.js und calc.test.js genutzt.

// --- Datum (lokale Tage als "YYYY-MM-DD", nie toISOString → UTC-Versatz) ---
export const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return key(d); };
export const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
export const weekday = k => parse(k).getDay(); // 0 = Sonntag
export const monday = k => addDays(k, -((weekday(k) + 6) % 7));

// --- Kalorien & Makros ---
export const bmr = ({ sex, age, height }, kg) => 10 * kg + 6.25 * height - 5 * age + (sex === 'w' ? -161 : 5);

// Neuberechnung alle 5 kg: das Rechengewicht springt nur in 5-kg-Stufen nach unten
export const stepWeight = (startKg, kg) => kg >= startKg ? startKg : startKg - 5 * Math.floor((startKg - kg) / 5);

export function targets(p, kgNow, adjust = 0) {
  const kg = stepWeight(p.startKg, kgNow ?? p.startKg);
  const b = Math.round(bmr(p, kg)), tdee = Math.round(b * p.activity);
  const kcal = Math.max(b, tdee - p.deficit + adjust); // nie unter Grundumsatz
  const protein = Math.round(1.8 * p.goalKg);
  const fat = Math.round(kcal * 0.3 / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kg, bmr: b, tdee, kcal, protein, fat, carbs };
}

export function avg7(weights, k) {
  const v = [];
  for (let i = 0; i < 7; i++) { const w = weights[addDays(k, -i)]; if (w) v.push(w); }
  return v.length ? v.reduce((a, b) => a + b) / v.length : null;
}

// Plateau-Regel: 7-Tage-Schnitt heute nicht unter dem von vor 21 Tagen → -100 kcal,
// danach mind. 21 Tage Ruhe. Neue 5-kg-Stufe setzt die Anpassung zurück.
export function plateau(p, s, weights, today) {
  const t0 = targets(p, avg7(weights, today), 0);
  if (!s || s.step !== t0.kg) s = { step: t0.kg, adjust: 0, since: today };
  if (diffDays(today, s.since) < 21) return s;
  const now = avg7(weights, today), before = avg7(weights, addDays(today, -21));
  if (now == null || before == null || now < before) return s;
  const adjust = Math.max(s.adjust - 100, t0.bmr - t0.kcal);
  const hint = adjust < s.adjust
    ? `Plateau: 3 Wochen kein Rückgang – Tagesziel um ${s.adjust - adjust} kcal gesenkt.`
    : 'Plateau, aber Untergrenze (Grundumsatz) erreicht – Ziel bleibt. Mehr Schritte helfen.';
  return { ...s, adjust, since: today, hint };
}

// Realistische Prognose: gemessenes Tempo der letzten 4 Wochen, sonst Defizit/7700 kcal pro kg.
// ponytail: lineares Tempo – echte Abnahme wird langsamer, Prognose daher eher optimistisch
export function forecast(weights, today, goalKg, plannedKgWeek) {
  const now = avg7(weights, today);
  if (now == null) return null;
  const past = avg7(weights, addDays(today, -28));
  const measured = past != null && past > now;
  // Tempo auf max. 1 % Körpergewicht/Woche deckeln (Wasserverlust am Anfang)
  const rate = Math.min(measured ? (past - now) / 4 : plannedKgWeek, now * 0.01);
  const left = Math.max(0, now - goalKg);
  return { now, left, rate, measured, date: addDays(today, Math.ceil(left / rate * 7)) };
}

// --- Rezepte & Portionen ---
export function nutrition(r, ing) {
  const n = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const [name, g] of r.items) for (const k in n) n[k] += ing[name][k] * g / 100;
  return n;
}

// Faktor für die noch offenen Mahlzeiten: Restbudget / Basis-kcal der offenen Mahlzeiten.
// Grenzen 0,5–2: auch nach viel Extra-Essen noch halbe Portionen (Protein), nie absurde Mengen.
export const remainingFactor = (target, used, openBase) =>
  openBase ? Math.min(2, Math.max(0.5, (target - used) / openBase)) : 1;

export const roundG = g => Math.max(5, Math.round(g / 5) * 5);

export function shoppingList(meals /* [[recipe, factor]] */, ing) {
  const sum = {};
  for (const [r, f] of meals) for (const [n, g] of r.items) sum[n] = (sum[n] || 0) + g * f;
  return Object.entries(sum).map(([name, g]) => ({
    name, area: ing[name].area, g: Math.ceil(g / 10) * 10,
    pieces: ing[name].piece ? Math.ceil(g / ing[name].piece) : null,
  }));
}

// --- Training ---
// Alle Sätze geschafft und jeder am oberen Ende der Wiederholungen?
export const allTop = (reps, sets, [, top]) => reps.length >= sets && reps.every(r => r >= top);

// Plan des Tages. Verpasstes Training rutscht max. 1 Tag auf den nächsten freien Tag, sonst entfällt es.
export function trainingFor(k, trainDays, done) {
  const sorted = [...trainDays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Mo zuerst
  const idx = sorted.indexOf(weekday(k));
  if (idx >= 0) return { plan: idx % 2, shifted: false };
  const y = addDays(k, -1), yi = sorted.indexOf(weekday(y));
  if (yi >= 0 && !done[y]) return { plan: yi % 2, shifted: true };
  return null;
}

// Schrittziel: Start 7.000, alle 2 Wochen +500, max. 10.000
export const stepGoal = (start, k) => Math.min(10000, 7000 + 500 * Math.floor(Math.max(0, diffDays(k, start)) / 14));

// Welcher Wochenplan gilt? Wechselt jeden Montag, gezählt ab der Startwoche.
export const weekIndex = (start, k, n) => (((Math.floor(diffDays(monday(k), monday(start)) / 7)) % n) + n) % n;
