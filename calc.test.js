import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from './calc.js';

const P = { sex: 'm', age: 27, height: 192, startKg: 130, goalKg: 90, activity: 1.55, deficit: 700 };
const R = JSON.parse(readFileSync(new URL('./data/recipes.json', import.meta.url)));

test('Beispielrechnung für dein Profil (130 kg)', () => {
  const t = C.targets(P, 130);
  // Grundumsatz: 10·130 + 6,25·192 − 5·27 + 5 = 1300 + 1200 − 135 + 5 = 2370
  assert.equal(t.bmr, 2370);
  assert.equal(t.tdee, 3674);       // 2370 · 1,55
  assert.equal(t.kcal, 2974);       // 3674 − 700
  assert.equal(t.protein, 162);     // 1,8 · 90
  assert.equal(t.fat, 99);          // 30 % von 2974 / 9
  assert.equal(t.carbs, 359);       // (2974 − 648 − 891) / 4
  console.log('Beispiel 130 kg:', t);
});

test('Ziel nie unter Grundumsatz', () => {
  const t = C.targets({ ...P, activity: 1.2 }, 130); // 2844 − 700 < 2370
  assert.equal(t.kcal, t.bmr);
  assert.equal(C.targets(P, 130, -5000).kcal, 2370);
});

test('Neuberechnung nur alle 5 kg', () => {
  assert.equal(C.stepWeight(130, 131), 130);
  assert.equal(C.stepWeight(130, 125.1), 130);
  assert.equal(C.stepWeight(130, 125), 125);
  assert.equal(C.stepWeight(130, 119.9), 120); // 10,1 kg weg = 2 Stufen
  assert.equal(C.stepWeight(130, 114), 115);
  assert.equal(C.targets(P, 127).kcal, 2974);
  assert.equal(C.targets(P, 124).kcal, 2896); // BMR 2320 · 1,55 = 3596 − 700
});

const series = (from, days, kgAt) => Object.fromEntries([...Array(days)].map((_, i) => [C.addDays(from, i), kgAt(i)]));

test('Plateau: 3 Wochen kein Rückgang → −100 kcal, danach 21 Tage Ruhe', () => {
  const w = series('2026-09-01', 34, () => 120);
  const s0 = { step: 120, adjust: 0, since: '2026-09-01' };
  const s1 = C.plateau(P, s0, w, '2026-10-04');
  assert.equal(s1.adjust, -100);
  assert.match(s1.hint, /100 kcal/);
  assert.equal(C.plateau(P, s1, w, '2026-10-05').adjust, -100); // keine zweite Senkung sofort
});

test('Plateau: kein Eingriff, wenn Gewicht sinkt', () => {
  const w = series('2026-09-01', 34, i => 122 - i * 0.05);
  assert.equal(C.plateau(P, { step: 120, adjust: 0, since: '2026-09-01' }, w, '2026-10-04').adjust, 0);
});

test('Plateau: Untergrenze Grundumsatz', () => {
  const low = { ...P, activity: 1.2 };
  const w = series('2026-09-01', 34, () => 120);
  const s = C.plateau(low, { step: 120, adjust: 0, since: '2026-09-01' }, w, '2026-10-04');
  assert.equal(s.adjust, 0);
  assert.match(s.hint, /Untergrenze/);
});

test('Plateau: neue 5-kg-Stufe setzt Anpassung zurück', () => {
  const w = series('2026-09-28', 7, () => 114);
  assert.deepEqual(C.plateau(P, { step: 120, adjust: -200, since: '2026-08-01' }, w, '2026-10-04'),
    { step: 115, adjust: 0, since: '2026-10-04' });
});

test('Portionsskalierung trifft das Tagesziel', () => {
  const ids = R.weeks[0]['1'], kcal = ids.map(id => C.nutrition(R.recipes[id], R.ingredients).kcal);
  const base = kcal.reduce((a, b) => a + b);
  const f = C.remainingFactor(2974, 0, base);
  assert.ok(Math.abs(base * f - 2974) < 1);
  // Frühstück gegessen + 900 kcal Restaurant → Rest des Tages wird kleiner, Summe stimmt weiter
  const eaten = kcal[0] * f, open = base - kcal[0];
  const f2 = C.remainingFactor(2974, eaten + 900, open);
  assert.ok(f2 < f);
  assert.ok(Math.abs(eaten + 900 + open * f2 - 2974) < 1);
  // nach Fast-Food-Exzess: nie weniger als halbe Portionen
  assert.equal(C.remainingFactor(2974, 3500, 1000), 0.5);
  console.log(`Montag: Basis ${Math.round(base)} kcal → Faktor ${f.toFixed(2)}`);
});

test('Nährwerte eines Rezepts', () => {
  const n = C.nutrition(R.recipes.f1, R.ingredients); // Overnight Oats
  assert.equal(Math.round(n.kcal), 590);
  assert.equal(Math.round(n.p), 39);
});

test('Einkaufsliste fasst Mengen zusammen', () => {
  const list = C.shoppingList([[R.recipes.h1, 1], [R.recipes.h3, 1]], R.ingredients);
  assert.equal(list.find(x => x.name === 'Hähnchenbrust').g, 380);
  assert.equal(list.find(x => x.name === 'Hähnchenbrust').area, 'Fleisch & Fisch');
});

test('Progression: alle Sätze am oberen Ende', () => {
  assert.equal(C.allTop([12, 12, 13], 3, [8, 12]), true);
  assert.equal(C.allTop([12, 11, 12], 3, [8, 12]), false);
  assert.equal(C.allTop([12, 12], 3, [8, 12]), false);
});

test('Training: verpasst → max. 1 Tag auf freien Tag', () => {
  const days = [1, 2, 4, 5, 6]; // Mo Di Do Fr Sa
  assert.deepEqual(C.trainingFor('2026-10-05', days, {}), { plan: 0, shifted: false }); // Mo A
  assert.deepEqual(C.trainingFor('2026-10-06', days, {}), { plan: 1, shifted: false }); // Di B
  assert.deepEqual(C.trainingFor('2026-10-07', days, {}), { plan: 1, shifted: true });  // Mi: Di nachholen
  assert.equal(C.trainingFor('2026-10-07', days, { '2026-10-06': {} }), null);          // Di gemacht → frei
  assert.deepEqual(C.trainingFor('2026-10-08', days, {}), { plan: 0, shifted: false }); // Do normal
});

test('Prognose & Schrittziel', () => {
  const w = series('2026-08-20', 46, i => 130 - i * 0.1); // 0,7 kg/Woche
  const f = C.forecast(w, '2026-10-04', 90, 0.6);
  assert.equal(f.measured, true);
  assert.ok(Math.abs(f.rate - 0.7) < 0.01);
  assert.equal(C.stepGoal('2026-10-01', '2026-10-10'), 7000);
  assert.equal(C.stepGoal('2026-10-01', '2026-10-15'), 7500);
  assert.equal(C.stepGoal('2026-01-01', '2026-12-01'), 10000);
});

test('Wochenplan A/B wechselt jeden Montag', () => {
  const start = '2026-10-01'; // Do → Startwoche ab Mo 28.9.
  assert.equal(C.weekIndex(start, '2026-10-04', 2), 0); // So, gleiche Woche
  assert.equal(C.weekIndex(start, '2026-10-05', 2), 1); // Mo → Woche B
  assert.equal(C.weekIndex(start, '2026-10-11', 2), 1);
  assert.equal(C.weekIndex(start, '2026-10-12', 2), 0); // wieder A
  assert.equal(C.weekIndex(start, '2026-09-20', 2), 0); // vor dem Start kein negativer Index
  assert.equal(R.weeks.length, 2);
  for (const w of R.weeks) for (const d of Object.values(w)) d.forEach((id, i) => assert.equal(R.recipes[id].cat, R.slots[i].cat, id));
});
