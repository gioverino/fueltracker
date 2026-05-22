# ⛽ Fuel Tracker PWA

Prosta aplikacja PWA do śledzenia tankowań i obliczania spalania.

## Funkcje

- Zapisywanie tankowań (data, litry, cena, przebieg)
- Automatyczne obliczanie spalania (l/100km)
- Historia tankowań
- Statystyki (średnie spalanie, łączne wydatki, przejechane km)
- Działa offline
- Instalacja na ekranie głównym iPhone (jak natywna apka)

## Deployment na GitHub Pages

1. Utwórz nowe repozytorium na GitHub (np. `fuel-tracker`)
2. Wrzuć wszystkie pliki z tego folderu:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/TWOJ_NICK/fuel-tracker.git
   git push -u origin main
   ```
3. Wejdź w Settings → Pages → Source: Deploy from branch → Branch: main, folder: / (root)
4. Po minucie aplikacja będzie dostępna pod: `https://TWOJ_NICK.github.io/fuel-tracker/`

## Instalacja na iPhone

1. Otwórz URL w Safari
2. Kliknij ikonę Udostępnij (kwadrat ze strzałką)
3. Wybierz "Dodaj do ekranu początkowego"
4. Gotowe!

## Struktura

```
fuel-tracker/
├── index.html          ← główna strona
├── manifest.json       ← konfiguracja PWA
├── sw.js              ← Service Worker (offline)
├── css/style.css      ← style
├── js/
│   ├── app.js         ← logika UI
│   ├── db.js          ← IndexedDB
│   └── stats.js       ← obliczenia
└── icons/             ← ikony PWA
```
