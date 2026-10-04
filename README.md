# Fit – persönliche Fitness- & Ernährungs-App

Reines HTML/JS, kein Build. Daten bleiben im Browser (localStorage), Backup unter ⚙ → Export.

- Rezepte, Zutaten (Nährwerte pro 100 g), Wochenplan, Notfall- & Heißhunger-Optionen: `data/recipes.json`
- Übungen (Stufen leicht → schwer, Animations-Posen `anim`), Trainingspläne A/B: `data/exercises.json`
- Rezeptbilder: Feld `img` (Emojis) in `data/recipes.json`
- Gefühl-Fragen und Tipp-Regeln: `data/tips.json`
- KI-Coach (optional): eigener Anthropic-API-Key unter ⚙, braucht Internet
- Rechenlogik: `calc.js`, Tests: `node --test`

## Lokal starten
```
python3 -m http.server 8000   # dann http://localhost:8000
```

## Kostenlos online (GitHub Pages)
1. Auf github.com ein neues **öffentliches** Repository anlegen, z. B. `fit`.
2. „Add file → Upload files“ → den gesamten Inhalt dieses Ordners hochladen (inkl. `data/`) → Commit.
3. Settings → Pages → Source: „Deploy from a branch“, Branch `main`, Ordner `/ (root)` → Save.
4. Nach ~1 Minute läuft die App unter `https://<dein-name>.github.io/fit/`.

## Aufs Handy
- **iPhone (Safari):** Seite öffnen → Teilen → „Zum Home-Bildschirm“.
- **Android (Chrome):** Seite öffnen → Menü ⋮ → „App installieren“.
- Einmal online öffnen, danach läuft sie offline.
- Erinnerungen: „⚙ → Kalender-Datei (.ics) laden“ → im Kalender übernehmen.

Änderst du JSON-Dateien, lade sie bei GitHub neu hoch – die App holt sich die neue Version beim nächsten Öffnen mit Internet.
