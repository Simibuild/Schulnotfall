# 🏫 Schulnotfall

Echtzeit-Anwesenheitsliste für Schulen — speziell für den Notfall.
Eine Progressive Web App (PWA) für bis zu 5 Lehrkräfte gleichzeitig.

## Funktionen

- 🚨 **Notfallmodus** mit Riesen-Anzeige der noch anwesenden Kinder
- 📋 **Live-Liste** aller Kinder mit Status: Offen / Da / Abgeholt / Entschuldigt
- 🔄 **Echtzeit-Sync** zwischen allen angemeldeten Geräten
- 📅 **Kalender** mit Tagesarchiv (30 Tage)
- 📊 **Aktivitätslog** pro Tag (wer hat wann was geändert)
- 📥 **CSV-Import** für Klassenlisten
- 📤 **CSV-Export** der letzten 30 Tage
- 🌙 **Auto-Reset** um Mitternacht mit Tages-Snapshot
- 📱 **Mobile-First**, installierbar als App über den Browser

## Setup

Siehe [EINRICHTUNG.md](EINRICHTUNG.md) für die Schritt-für-Schritt-Anleitung.

## Lokale Entwicklung

```bash
npm install
cp .env.example .env   # Firebase-Daten eintragen
npm run dev
```

## Deployment

Push auf `main` → automatisches Deployment via GitHub Actions auf GitHub Pages.

## Tech-Stack

- React 18 + Vite
- Firebase Firestore (Echtzeit-Sync)
- Vite PWA Plugin (Service Worker, Manifest)
- GitHub Actions + GitHub Pages
