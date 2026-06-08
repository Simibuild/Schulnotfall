# 🏫 Schulnotfall — Einrichtungsanleitung

Schritt-für-Schritt-Anleitung, wie die App live geht. Dauert ca. 20 Minuten.

---

## Voraussetzungen

- Ein **Google-Konto** (für Firebase)
- Ein **GitHub-Konto**
- **Node.js** auf deinem Mac installiert ([nodejs.org](https://nodejs.org) → LTS-Version)
- **Git** (auf dem Mac bereits vorinstalliert)

---

## Teil 1 — Firebase einrichten (Datenbank)

### 1.1 Projekt erstellen
1. Öffne **https://console.firebase.google.com**
2. Klicke **„Projekt hinzufügen"**
3. Name: `schulnotfall` → Weiter
4. Google Analytics → kannst du deaktivieren
5. **„Projekt erstellen"**

### 1.2 Web-App registrieren
1. Auf der Projektübersicht: Klicke das **`</>`-Symbol**
2. App-Spitzname: `schulnotfall` → **„App registrieren"**
3. Du siehst einen Code-Block mit `firebaseConfig` — **Werte aufschreiben/kopieren!**
4. „Weiter zur Konsole" klicken

### 1.3 Firestore-Datenbank aktivieren
1. Linkes Menü: **„Firestore Database"** → **„Datenbank erstellen"**
2. **Im Produktionsmodus starten**
3. Region: **`eur3` (europe-west)** → **Aktivieren**

### 1.4 Sicherheitsregeln einstellen
1. Im Firestore → Reiter **„Regeln"**
2. Kompletten Inhalt durch den Inhalt aus [`firestore.rules`](firestore.rules) ersetzen
3. **„Veröffentlichen"**

---

## Teil 2 — GitHub Repository einrichten

### 2.1 Repository erstellen
1. Auf **https://github.com/new** ein neues Repository erstellen
2. Name: `schulnotfall`
3. **Public** wählen (für kostenloses GitHub Pages)
4. **Nicht** mit README initialisieren
5. **„Create repository"**

### 2.2 Lokalen Code hochladen
Im Terminal in den App-Ordner navigieren:

```bash
cd "/Pfad/zu/Claude_Arbeitsplatz/schulnotfall"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/DEIN-USERNAME/schulnotfall.git
git push -u origin main
```

### 2.3 Firebase-Zugangsdaten als GitHub Secrets hinterlegen
1. Im GitHub-Repository: **Settings → Secrets and variables → Actions**
2. **„New repository secret"** — für jeden Wert aus Schritt 1.2 einen Secret anlegen:

| Name | Wert |
|------|------|
| `VITE_FIREBASE_API_KEY` | dein apiKey |
| `VITE_FIREBASE_AUTH_DOMAIN` | dein authDomain |
| `VITE_FIREBASE_PROJECT_ID` | deine projectId |
| `VITE_FIREBASE_STORAGE_BUCKET` | dein storageBucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | deine messagingSenderId |
| `VITE_FIREBASE_APP_ID` | dein appId |

### 2.4 GitHub Pages aktivieren
1. Im GitHub-Repository: **Settings → Pages**
2. **Source**: „GitHub Actions"
3. Speichern

### 2.5 Deployment auslösen
Da die Secrets jetzt da sind, das Deployment einmal manuell starten:

1. **Actions → „Deploy to GitHub Pages" → „Run workflow"**
2. Warte ca. 1–2 Minuten

Deine App ist jetzt live unter:
**`https://DEIN-USERNAME.github.io/schulnotfall/`**

Diesen Link teilst du mit den anderen Lehrkräften 🎉

---

## Teil 3 — App auf dem Smartphone installieren

Nach dem Öffnen des Links:

**iPhone (Safari):**
1. Teilen-Symbol (Quadrat mit Pfeil) tippen
2. **„Zum Home-Bildschirm"**
3. Hinzufügen

**Android (Chrome):**
1. Menü oben rechts (drei Punkte)
2. **„Zur Startseite hinzufügen"**

→ Die App erscheint wie eine normale App auf dem Home-Screen. Antippen, fertig.

---

## Erste Verwendung

1. **Erste Person** öffnet die App:
   - Name eingeben (z. B. „Frau Müller")
   - Gemeinsamen PIN festlegen (z. B. `1234`)
2. **Alle anderen Lehrkräfte** öffnen denselben Link:
   - Eigenen Namen eingeben
   - Denselben PIN eintippen
3. **Klassenliste importieren**: Tippe auf **📋 Import**, füge die Namen ein (einer pro Zeile), oder lade eine CSV-Datei hoch.

---

## Funktionen im Überblick

| Element | Bedeutung |
|---------|-----------|
| **🚨 Notfallmodus** | Großer Button. Öffnet Vollbild-Anzeige mit Riesen-Schrift und der Liste der noch zu suchenden Kinder. |
| **📅 Kalender** (oben rechts) | Letzte 30 Tage. Auf einen Tag tippen → Endstand + komplettes Aktivitätslog dieses Tages. |
| **⬇ Im Kalender** | Alle 30 Tage als CSV exportieren. |
| **+ Kind** | Einzelnes Kind hinzufügen. |
| **📋 Import** | Mehrere Kinder auf einmal (CSV / Liste). |
| **↺ Reset** | Manueller Reset aller Status auf „Offen". |

### Status pro Kind
- **Offen** (grau) — Status noch unbekannt
- **Da** (grün) — anwesend / in Sicherheit
- **Abgeholt** (orange) — bereits abgeholt, zählt nicht mehr in „muss noch da sein"
- **Entschuldigt** (lila) — krank/abwesend, wird im Notfall nicht gesucht

### Automatischer Tages-Reset
- Beim ersten Öffnen am neuen Tag wird der gestrige Stand archiviert und alle Kinder auf „Offen" zurückgesetzt
- Archive älter als 30 Tage werden automatisch gelöscht (DSGVO-freundlich)
- Komplette Historie als CSV exportierbar

---

## Wartung

### Code-Änderung deployen
Einfach Änderungen committen und pushen:

```bash
git add .
git commit -m "Beschreibung der Änderung"
git push
```

GitHub Actions baut und deployed automatisch — ca. 1 Minute später ist die neue Version live, alle Benutzer bekommen das Update beim nächsten App-Start automatisch.

### Daten zurücksetzen / PIN ändern
Im Firebase Firestore manuell:
- Dokument `config/settings` löschen → beim nächsten App-Start kann ein neuer PIN festgelegt werden
- Collection `children` leeren → alle Kinder gelöscht

---

## Probleme?

**„Firebase nicht konfiguriert"** → Secrets in GitHub fehlen oder sind falsch. Prüfe Schritt 2.3.

**Login funktioniert nicht** → Firestore-Regeln nicht veröffentlicht. Prüfe Schritt 1.4.

**Änderungen nicht synchron** → Internetverbindung prüfen. Bei Firestore können bis zu 2 Sekunden Verzögerung normal sein.
