import { useState, useEffect, useRef } from 'react';
import { db } from './firebase';
import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

// ──────────────────────────────────────────────────────────────────────────
// Status-Konfiguration
// ──────────────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  offen:       { label: 'Offen',        color: '#6b7280' },
  da:          { label: 'Da',           color: '#16a34a' },
  abgeholt:    { label: 'Abgeholt',     color: '#b45309' },
  entschuldigt:{ label: 'Entschuldigt', color: '#7c3aed' },
};
const STATUS_ORDER = { offen: 0, da: 1, abgeholt: 2, entschuldigt: 3 };

// ──────────────────────────────────────────────────────────────────────────
// Hilfsfunktionen für Datum
// ──────────────────────────────────────────────────────────────────────────
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const formatDate = (key) => {
  const [y, m, d] = key.split('-');
  return `${d}.${m}.${y}`;
};
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function sortChildren(list) {
  return [...list].sort((a, b) => {
    const diff = (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'de');
  });
}

// ──────────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState('loading');
  const [pin, setPin] = useState('');
  const [userName, setUserName] = useState('');
  const [pinError, setPinError] = useState('');
  const [children, setChildren] = useState([]);
  const [view, setView] = useState('list'); // list | emergency | calendar | day | settings
  const [newName, setNewName] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showReset, setShowReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [firebaseError, setFirebaseError] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);
  const [dayData, setDayData] = useState(null);
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [archivedDays, setArchivedDays] = useState([]);

  // ── Initial check ────────────────────────────────────────────────────
  useEffect(() => {
    const missingConfig = !import.meta.env.VITE_FIREBASE_API_KEY;
    if (missingConfig) {
      setFirebaseError(true);
      setScreen('error');
      return;
    }

    (async () => {
      try {
        const configDoc = await getDoc(doc(db, 'config', 'settings'));
        if (!configDoc.exists()) {
          setScreen('setup');
          return;
        }
        const savedPin = localStorage.getItem('schulnotfall_pin');
        const savedName = localStorage.getItem('schulnotfall_user');
        if (savedPin && savedPin === configDoc.data().pin && savedName) {
          setUserName(savedName);
          await runDailyMaintenance();
          setScreen('main');
        } else {
          localStorage.removeItem('schulnotfall_pin');
          localStorage.removeItem('schulnotfall_user');
          setScreen('login');
        }
      } catch (e) {
        console.error(e);
        setFirebaseError(true);
        setScreen('error');
      }
    })();
  }, []);

  // ── Live-Listener für Kinderliste ────────────────────────────────────
  useEffect(() => {
    if (screen !== 'main') return;
    const unsub = onSnapshot(collection(db, 'children'), snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setChildren(sortChildren(list));
    });
    return unsub;
  }, [screen]);

  // ──────────────────────────────────────────────────────────────────────
  // Tages-Reset: prüft beim Öffnen, ob ein neuer Tag begonnen hat.
  // Wenn ja: archiviert gestrigen Stand + Log, setzt alle auf "offen",
  // löscht Daten älter als 30 Tage.
  // ──────────────────────────────────────────────────────────────────────
  async function runDailyMaintenance() {
    const meta = await getDoc(doc(db, 'config', 'meta'));
    const lastDay = meta.exists() ? meta.data().lastActiveDay : null;
    const today = todayKey();

    if (lastDay && lastDay !== today) {
      // 1. Snapshot des vergangenen Tages erstellen
      const childrenSnap = await getDocs(collection(db, 'children'));
      const snapshot = childrenSnap.docs.map(d => ({
        id: d.id,
        name: d.data().name,
        status: d.data().status,
      }));
      const logSnap = await getDocs(
        query(collection(db, 'log'), where('day', '==', lastDay))
      );
      const logs = logSnap.docs.map(d => d.data());

      await setDoc(doc(db, 'archive', lastDay), {
        date: lastDay,
        snapshot,
        logs,
        savedAt: serverTimestamp(),
      });

      // 2. Alle auf "offen" zurücksetzen
      const batch = writeBatch(db);
      childrenSnap.docs.forEach(d => {
        if (d.data().status !== 'offen') {
          batch.update(d.ref, { status: 'offen' });
        }
      });
      await batch.commit();

      // 3. Alte Log-Einträge des letzten Tages löschen (sind jetzt im Archiv)
      const oldLogBatch = writeBatch(db);
      logSnap.docs.forEach(d => oldLogBatch.delete(d.ref));
      await oldLogBatch.commit();
    }

    // 4. Archive älter als 30 Tage löschen
    const archives = await getDocs(collection(db, 'archive'));
    const oldBatch = writeBatch(db);
    let hasOld = false;
    archives.docs.forEach(d => {
      if (daysBetween(d.id, today) > 30) {
        oldBatch.delete(d.ref);
        hasOld = true;
      }
    });
    if (hasOld) await oldBatch.commit();

    // 5. lastActiveDay aktualisieren
    await setDoc(doc(db, 'config', 'meta'), { lastActiveDay: today }, { merge: true });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Log-Eintrag schreiben
  // ──────────────────────────────────────────────────────────────────────
  async function writeLog(action, childName, fromStatus, toStatus) {
    await addDoc(collection(db, 'log'), {
      day: todayKey(),
      timestamp: serverTimestamp(),
      user: userName,
      action,
      childName,
      fromStatus: fromStatus || null,
      toStatus: toStatus || null,
    });
  }

  // ── Auth ─────────────────────────────────────────────────────────────
  const handleSetupPin = async () => {
    if (pin.trim().length < 4) {
      setPinError('PIN muss mindestens 4 Zeichen haben');
      return;
    }
    if (!userName.trim()) {
      setPinError('Bitte deinen Namen eingeben');
      return;
    }
    await setDoc(doc(db, 'config', 'settings'), { pin: pin.trim() });
    localStorage.setItem('schulnotfall_pin', pin.trim());
    localStorage.setItem('schulnotfall_user', userName.trim());
    await runDailyMaintenance();
    setPin('');
    setScreen('main');
  };

  const handleLogin = async () => {
    try {
      const configDoc = await getDoc(doc(db, 'config', 'settings'));
      const stored = configDoc.data()?.pin;
      if (pin.trim() !== stored) {
        setPinError('Falscher PIN');
        setPin('');
        return;
      }
      if (!userName.trim()) {
        setPinError('Bitte deinen Namen eingeben');
        return;
      }
      localStorage.setItem('schulnotfall_pin', pin.trim());
      localStorage.setItem('schulnotfall_user', userName.trim());
      await runDailyMaintenance();
      setPin('');
      setPinError('');
      setScreen('main');
    } catch {
      setPinError('Verbindungsfehler');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('schulnotfall_pin');
    localStorage.removeItem('schulnotfall_user');
    setUserName('');
    setChildren([]);
    setScreen('login');
  };

  // ── Aktionen Kinderliste ─────────────────────────────────────────────
  const handleAddChild = async () => {
    const name = newName.trim();
    if (!name) return;
    await addDoc(collection(db, 'children'), {
      name,
      status: 'offen',
      createdAt: serverTimestamp(),
    });
    await writeLog('add', name, null, null);
    setNewName('');
    setShowAdd(false);
  };

  const handleStatus = async (child, status) => {
    if (child.status === status) return;
    await updateDoc(doc(db, 'children', child.id), { status });
    await writeLog('status', child.name, child.status, status);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteDoc(doc(db, 'children', deleteTarget.id));
    await writeLog('delete', deleteTarget.name, null, null);
    setDeleteTarget(null);
  };

  const handleReset = async () => {
    setBusy(true);
    const batch = writeBatch(db);
    children.forEach(c => {
      if (c.status !== 'offen') batch.update(doc(db, 'children', c.id), { status: 'offen' });
    });
    await batch.commit();
    await writeLog('reset', '(alle)', null, null);
    setBusy(false);
    setShowReset(false);
  };

  // ── CSV Import ───────────────────────────────────────────────────────
  const handleCsvImport = async () => {
    const names = importText
      .split(/[\n,;]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (names.length === 0) return;
    setBusy(true);
    for (const name of names) {
      await addDoc(collection(db, 'children'), {
        name,
        status: 'offen',
        createdAt: serverTimestamp(),
      });
    }
    await writeLog('import', `${names.length} Kinder`, null, null);
    setImportText('');
    setShowImport(false);
    setBusy(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImportText(ev.target.result);
    reader.readAsText(file);
  };

  // ── CSV Export (letzte 30 Tage) ──────────────────────────────────────
  const handleCsvExport = async () => {
    setBusy(true);
    const archives = await getDocs(collection(db, 'archive'));
    const sorted = archives.docs
      .map(d => d.data())
      .sort((a, b) => a.date.localeCompare(b.date));

    let csv = 'Datum;Kind;Status;Uhrzeit;Aktion;Benutzer\n';
    sorted.forEach(arch => {
      arch.snapshot.forEach(c => {
        csv += `${formatDate(arch.date)};${c.name};${STATUS_CONFIG[c.status]?.label || c.status};;;\n`;
      });
      (arch.logs || []).forEach(l => {
        const time = l.timestamp?.toDate
          ? l.timestamp.toDate().toLocaleTimeString('de-DE')
          : '';
        csv += `${formatDate(arch.date)};${l.childName};;${time};${l.action} ${l.toStatus || ''};${l.user || ''}\n`;
      });
    });

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schulnotfall-export-${todayKey()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setBusy(false);
  };

  // ── Kalender: Archive-Liste laden ────────────────────────────────────
  useEffect(() => {
    if (view !== 'calendar') return;
    (async () => {
      const archives = await getDocs(collection(db, 'archive'));
      setArchivedDays(archives.docs.map(d => d.id));
    })();
  }, [view]);

  const openDay = async (dayKey) => {
    const archDoc = await getDoc(doc(db, 'archive', dayKey));
    if (archDoc.exists()) {
      setDayData(archDoc.data());
      setSelectedDay(dayKey);
      setView('day');
    }
  };

  // ── Zähler ───────────────────────────────────────────────────────────
  const counts = {
    total:        children.length,
    offen:        children.filter(c => c.status === 'offen').length,
    da:           children.filter(c => c.status === 'da').length,
    abgeholt:     children.filter(c => c.status === 'abgeholt').length,
    entschuldigt: children.filter(c => c.status === 'entschuldigt').length,
  };
  // Wer muss noch da sein? = offen + da (entschuldigt zählt nicht, abgeholt ist weg)
  const stillExpected = counts.offen + counts.da;

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────

  if (screen === 'loading') {
    return (
      <div className="center-screen">
        <div className="logo">🏫</div>
        <div className="spinner" />
      </div>
    );
  }

  if (screen === 'error') {
    return (
      <div className="center-screen">
        <div className="logo">🏫</div>
        <h2>Schulnotfall</h2>
        <div className="error-box">
          <p><strong>Firebase nicht konfiguriert.</strong></p>
          <p>Bitte die <code>.env</code>-Datei anlegen. Siehe <code>EINRICHTUNG.md</code>.</p>
        </div>
      </div>
    );
  }

  if (screen === 'setup' || screen === 'login') {
    const isSetup = screen === 'setup';
    return (
      <div className="center-screen">
        <div className="logo">🏫</div>
        <h1 className="app-title">Schulnotfall</h1>
        <div className="auth-card">
          <h2>{isSetup ? 'PIN einrichten' : 'Anmelden'}</h2>
          {isSetup && (
            <p className="hint">
              Lege einen gemeinsamen PIN fest. Alle Lehrkräfte nutzen denselben PIN.
            </p>
          )}
          <input
            className="text-input"
            type="text"
            placeholder="Dein Name (z. B. Frau Müller)"
            value={userName}
            onChange={e => setUserName(e.target.value)}
          />
          <input
            className="pin-input"
            type="text"
            inputMode="numeric"
            placeholder={isSetup ? 'PIN festlegen (min. 4 Zeichen)' : 'PIN eingeben'}
            value={pin}
            onChange={e => { setPin(e.target.value); setPinError(''); }}
            onKeyDown={e => e.key === 'Enter' && (isSetup ? handleSetupPin() : handleLogin())}
          />
          {pinError && <p className="error-text">{pinError}</p>}
          <button className="btn-primary full" onClick={isSetup ? handleSetupPin : handleLogin}>
            {isSetup ? 'PIN festlegen →' : 'Anmelden →'}
          </button>
        </div>
      </div>
    );
  }

  // ── Notfallmodus ─────────────────────────────────────────────────────
  if (view === 'emergency') {
    const expected = children.filter(c => c.status === 'offen' || c.status === 'da');
    const da = children.filter(c => c.status === 'da');
    return (
      <div className="emergency">
        <button className="btn-emergency-close" onClick={() => setView('list')}>
          ✕ Schließen
        </button>
        <div className="emergency-title">NOTFALL</div>
        <div className="emergency-big">
          <div className="emergency-number">{stillExpected}</div>
          <div className="emergency-sub">Kinder müssen anwesend sein</div>
        </div>
        <div className="emergency-counters">
          <div className="ec-card ec-green">
            <div className="ec-num">{counts.da}</div>
            <div className="ec-lbl">in Sicherheit</div>
          </div>
          <div className="ec-card ec-red">
            <div className="ec-num">{counts.offen}</div>
            <div className="ec-lbl">noch zu suchen</div>
          </div>
        </div>
        <div className="emergency-lists">
          <div className="emerg-list emerg-red">
            <h3>NOCH ZU SUCHEN ({counts.offen})</h3>
            {children.filter(c => c.status === 'offen').map(c => (
              <button
                key={c.id}
                className="emerg-name emerg-name-red"
                onClick={() => handleStatus(c, 'da')}
              >
                {c.name}
                <span className="emerg-tap">tippen wenn gefunden →</span>
              </button>
            ))}
            {counts.offen === 0 && <p className="emerg-empty">✓ Alle gefunden</p>}
          </div>
          <div className="emerg-list emerg-green">
            <h3>IN SICHERHEIT ({counts.da})</h3>
            {da.map(c => <div key={c.id} className="emerg-name emerg-name-green">{c.name}</div>)}
            {da.length === 0 && <p className="emerg-empty">Noch keiner</p>}
          </div>
        </div>
      </div>
    );
  }

  // ── Kalender ─────────────────────────────────────────────────────────
  if (view === 'calendar') {
    return <CalendarView
      month={calMonth}
      setMonth={setCalMonth}
      archived={archivedDays}
      onPick={openDay}
      onClose={() => setView('list')}
      onExport={handleCsvExport}
      busy={busy}
    />;
  }

  // ── Tagesansicht ─────────────────────────────────────────────────────
  if (view === 'day' && dayData) {
    return <DayView
      day={selectedDay}
      data={dayData}
      onBack={() => { setView('calendar'); setDayData(null); }}
    />;
  }

  // ── Hauptansicht ─────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="app-header">
        <span className="header-title">🏫 Schulnotfall</span>
        <div className="header-actions">
          <button className="btn-icon" onClick={() => setView('calendar')} title="Kalender">📅</button>
          <button className="btn-icon" onClick={handleLogout} title="Abmelden">⏻</button>
        </div>
      </header>

      <div className="user-row">
        Angemeldet als <strong>{userName}</strong>
      </div>

      {/* Emergency-Button prominent */}
      <button className="btn-emergency" onClick={() => setView('emergency')}>
        🚨 NOTFALLMODUS
      </button>

      <div className="stats-grid">
        <div className="stat-card stat-must">
          <div className="stat-number">{stillExpected}</div>
          <div className="stat-label">müssen da sein</div>
        </div>
        <div className="stat-card stat-da">
          <div className="stat-number">{counts.da}</div>
          <div className="stat-label">Da ✓</div>
        </div>
        <div className="stat-card stat-abgeholt">
          <div className="stat-number">{counts.abgeholt}</div>
          <div className="stat-label">Abgeholt</div>
        </div>
        <div className="stat-card stat-entsch">
          <div className="stat-number">{counts.entschuldigt}</div>
          <div className="stat-label">Entsch.</div>
        </div>
      </div>

      <div className="action-bar">
        <button className="btn-mini" onClick={() => setShowReset(true)}>↺ Reset</button>
        <button className="btn-mini" onClick={() => setShowImport(true)}>📋 Import</button>
        <button className="btn-add" onClick={() => setShowAdd(true)}>+ Kind</button>
      </div>

      <div className="list">
        {children.length === 0 && (
          <div className="empty">
            <p>Noch keine Kinder angelegt.</p>
            <p>Tippe „+ Kind" oder „📋 Import" für eine Liste.</p>
          </div>
        )}
        {children.map(child => (
          <div key={child.id} className={`child-row row-${child.status}`}>
            <div className="child-name-row">
              <span className={`status-dot dot-${child.status}`} />
              <span className="child-name">{child.name}</span>
              <button className="btn-del" onClick={() => setDeleteTarget(child)} aria-label="Löschen">×</button>
            </div>
            <div className="status-buttons">
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  className={`status-btn btn-${key} ${child.status === key ? 'active' : ''}`}
                  onClick={() => handleStatus(child, key)}
                >
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <Modal onClose={() => setShowAdd(false)}>
          <h2>Kind hinzufügen</h2>
          <input
            className="text-input"
            type="text"
            placeholder="Vor- und Nachname"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddChild()}
            autoFocus
          />
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => { setShowAdd(false); setNewName(''); }}>Abbrechen</button>
            <button className="btn-primary" onClick={handleAddChild} disabled={!newName.trim()}>Hinzufügen</button>
          </div>
        </Modal>
      )}

      {/* Import Modal */}
      {showImport && (
        <Modal onClose={() => setShowImport(false)}>
          <h2>Mehrere Kinder importieren</h2>
          <p className="hint">Namen einzeln pro Zeile, oder mit Komma getrennt. Du kannst auch eine CSV-Datei hochladen.</p>
          <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="file-input" />
          <textarea
            className="text-area"
            rows={8}
            placeholder={'Max Müller\nLena Schmidt\nLuca Fischer\n…'}
            value={importText}
            onChange={e => setImportText(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => { setShowImport(false); setImportText(''); }}>Abbrechen</button>
            <button className="btn-primary" onClick={handleCsvImport} disabled={!importText.trim() || busy}>
              {busy ? 'Importiere…' : 'Importieren'}
            </button>
          </div>
        </Modal>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)}>
          <h2>Kind löschen?</h2>
          <p>„<strong>{deleteTarget.name}</strong>" wirklich entfernen?</p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>Abbrechen</button>
            <button className="btn-danger" onClick={handleDelete}>Löschen</button>
          </div>
        </Modal>
      )}

      {/* Reset Confirm */}
      {showReset && (
        <Modal onClose={() => setShowReset(false)}>
          <h2>Alle zurücksetzen?</h2>
          <p>Alle {counts.total} Kinder werden auf „Offen" gesetzt.</p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setShowReset(false)}>Abbrechen</button>
            <button className="btn-warning" onClick={handleReset} disabled={busy}>
              {busy ? 'Wird zurückgesetzt…' : 'Zurücksetzen'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Kalender-Komponente
// ──────────────────────────────────────────────────────────────────────────
function CalendarView({ month, setMonth, archived, onPick, onClose, onExport, busy }) {
  const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const WEEK_DAYS = ['Mo','Di','Mi','Do','Fr','Sa','So'];

  const first = new Date(month.year, month.month, 1);
  const lastDay = new Date(month.year, month.month + 1, 0).getDate();
  const firstWeekday = (first.getDay() + 6) % 7; // 0 = Montag

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(d);

  const prev = () => {
    const m = month.month - 1;
    if (m < 0) setMonth({ year: month.year - 1, month: 11 });
    else setMonth({ year: month.year, month: m });
  };
  const next = () => {
    const m = month.month + 1;
    if (m > 11) setMonth({ year: month.year + 1, month: 0 });
    else setMonth({ year: month.year, month: m });
  };

  const today = todayKey();

  return (
    <div className="app">
      <header className="app-header">
        <button className="btn-icon" onClick={onClose}>←</button>
        <span className="header-title">Kalender</span>
        <button className="btn-icon" onClick={onExport} disabled={busy} title="CSV Export">
          {busy ? '…' : '⬇'}
        </button>
      </header>

      <div className="cal-nav">
        <button className="btn-mini" onClick={prev}>‹</button>
        <span className="cal-month">{MONTH_NAMES[month.month]} {month.year}</span>
        <button className="btn-mini" onClick={next}>›</button>
      </div>

      <div className="cal-grid">
        {WEEK_DAYS.map(d => <div key={d} className="cal-weekday">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="cal-cell-empty" />;
          const key = `${month.year}-${String(month.month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const hasData = archived.includes(key);
          const isToday = key === today;
          const future = new Date(key) > new Date(today);
          return (
            <button
              key={i}
              className={`cal-cell ${hasData ? 'cal-has' : ''} ${isToday ? 'cal-today' : ''} ${future ? 'cal-future' : ''}`}
              disabled={!hasData}
              onClick={() => hasData && onPick(key)}
            >
              <span className="cal-day">{d}</span>
              {hasData && <span className="cal-dot" />}
            </button>
          );
        })}
      </div>

      <div className="cal-info">
        <p>Punkte zeigen archivierte Tage. Tippe auf einen Tag für Details.</p>
        <p>Aufbewahrung: 30 Tage. Mit ⬇ alle als CSV exportieren.</p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Tagesansicht (historisch)
// ──────────────────────────────────────────────────────────────────────────
function DayView({ day, data, onBack }) {
  const counts = {
    da:           data.snapshot.filter(c => c.status === 'da').length,
    abgeholt:     data.snapshot.filter(c => c.status === 'abgeholt').length,
    offen:        data.snapshot.filter(c => c.status === 'offen').length,
    entschuldigt: data.snapshot.filter(c => c.status === 'entschuldigt').length,
  };
  const sorted = sortChildren(data.snapshot);
  const logs = [...(data.logs || [])].sort((a, b) => {
    const ta = a.timestamp?.seconds || 0;
    const tb = b.timestamp?.seconds || 0;
    return tb - ta;
  });

  return (
    <div className="app">
      <header className="app-header">
        <button className="btn-icon" onClick={onBack}>←</button>
        <span className="header-title">{formatDate(day)}</span>
        <span style={{ width: 36 }} />
      </header>

      <div className="stats-grid">
        <div className="stat-card stat-da">
          <div className="stat-number">{counts.da}</div>
          <div className="stat-label">Da</div>
        </div>
        <div className="stat-card stat-abgeholt">
          <div className="stat-number">{counts.abgeholt}</div>
          <div className="stat-label">Abgeholt</div>
        </div>
        <div className="stat-card stat-entsch">
          <div className="stat-number">{counts.entschuldigt}</div>
          <div className="stat-label">Entsch.</div>
        </div>
        <div className="stat-card stat-must">
          <div className="stat-number">{data.snapshot.length}</div>
          <div className="stat-label">Gesamt</div>
        </div>
      </div>

      <h3 className="day-section">Endstand des Tages</h3>
      <div className="list">
        {sorted.map((c, i) => (
          <div key={i} className={`child-row row-${c.status}`}>
            <div className="child-name-row">
              <span className={`status-dot dot-${c.status}`} />
              <span className="child-name">{c.name}</span>
              <span className="day-status">{STATUS_CONFIG[c.status]?.label}</span>
            </div>
          </div>
        ))}
      </div>

      <h3 className="day-section">Aktivitäten ({logs.length})</h3>
      <div className="log-list">
        {logs.length === 0 && <p className="empty">Keine Aktivitäten aufgezeichnet.</p>}
        {logs.map((l, i) => {
          const time = l.timestamp?.seconds
            ? new Date(l.timestamp.seconds * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
            : '–';
          let text = '';
          if (l.action === 'status') text = `${l.childName}: ${STATUS_CONFIG[l.fromStatus]?.label || l.fromStatus} → ${STATUS_CONFIG[l.toStatus]?.label || l.toStatus}`;
          else if (l.action === 'add') text = `${l.childName} hinzugefügt`;
          else if (l.action === 'delete') text = `${l.childName} gelöscht`;
          else if (l.action === 'reset') text = `Alle zurückgesetzt`;
          else if (l.action === 'import') text = `${l.childName} importiert`;
          else text = `${l.action} ${l.childName}`;
          return (
            <div key={i} className="log-item">
              <span className="log-time">{time}</span>
              <span className="log-text">{text}</span>
              <span className="log-user">{l.user}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Generisches Modal
// ──────────────────────────────────────────────────────────────────────────
function Modal({ children, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
