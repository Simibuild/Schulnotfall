import { useState, useEffect } from 'react';
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
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

// ──────────────────────────────────────────────────────────────────────────
// Status- und Klassen-Konfiguration
// ──────────────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  offen:       { label: 'Offen',        color: '#6b7280' },
  da:          { label: 'Da',           color: '#16a34a' },
  abgeholt:    { label: 'Abgeholt',     color: '#b45309' },
  entschuldigt:{ label: 'Entschuldigt', color: '#7c3aed' },
};

// Feste Reihenfolge der Klassen
const CLASSES = ['1a', '1b', '2a', '2b', '3a', '3b', '4a', '4b'];
const DEFAULT_CLASS = '1a';

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

// Stabile Sortierung: nach Klasse, dann alphabetisch — NIE nach Status
function sortChildren(list) {
  return [...list].sort((a, b) => {
    const ka = CLASSES.indexOf(a.klasse || DEFAULT_CLASS);
    const kb = CLASSES.indexOf(b.klasse || DEFAULT_CLASS);
    const ia = ka === -1 ? 999 : ka;
    const ib = kb === -1 ? 999 : kb;
    if (ia !== ib) return ia - ib;
    return (a.name || '').localeCompare(b.name || '', 'de');
  });
}

// CSV/Text-Parser: erkennt "1a Max Müller" / "1a;Max Müller" / "1a,Max Müller" / nur "Max Müller"
function parseImportLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Versuche Klassen-Prefix zu erkennen
  const m = trimmed.match(/^([1-4][ab])\s*[;,\s]\s*(.+)$/i);
  if (m) {
    return { klasse: m[1].toLowerCase(), name: m[2].trim() };
  }
  return { klasse: DEFAULT_CLASS, name: trimmed };
}

// ──────────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState('loading');
  const [pin, setPin] = useState('');
  const [userName, setUserName] = useState('');
  const [pinError, setPinError] = useState('');
  const [children, setChildren] = useState([]);
  const [view, setView] = useState('list'); // list | emergency | calendar | day
  const [newName, setNewName] = useState('');
  const [newClass, setNewClass] = useState(DEFAULT_CLASS);
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
  const [filter, setFilter] = useState(null); // null | 'expected' | 'abgeholt' | 'entschuldigt'
  const [showEmergencyReset, setShowEmergencyReset] = useState(false);

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
  // Tages-Reset
  // ──────────────────────────────────────────────────────────────────────
  async function runDailyMaintenance() {
    const meta = await getDoc(doc(db, 'config', 'meta'));
    const lastDay = meta.exists() ? meta.data().lastActiveDay : null;
    const today = todayKey();

    if (lastDay && lastDay !== today) {
      const childrenSnap = await getDocs(collection(db, 'children'));
      const snapshot = childrenSnap.docs.map(d => ({
        id: d.id,
        name: d.data().name,
        klasse: d.data().klasse || DEFAULT_CLASS,
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

      // Status zurücksetzen UND emergencySafe zurücksetzen
      const batch = writeBatch(db);
      childrenSnap.docs.forEach(d => {
        const updates = {};
        if (d.data().status !== 'offen') updates.status = 'offen';
        if (d.data().emergencySafe) updates.emergencySafe = false;
        if (Object.keys(updates).length > 0) batch.update(d.ref, updates);
      });
      await batch.commit();

      const oldLogBatch = writeBatch(db);
      logSnap.docs.forEach(d => oldLogBatch.delete(d.ref));
      await oldLogBatch.commit();
    }

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

    await setDoc(doc(db, 'config', 'meta'), { lastActiveDay: today }, { merge: true });
  }

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
    if (pin.trim().length < 4) { setPinError('PIN muss mindestens 4 Zeichen haben'); return; }
    if (!userName.trim()) { setPinError('Bitte deinen Namen eingeben'); return; }
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
      if (pin.trim() !== stored) { setPinError('Falscher PIN'); setPin(''); return; }
      if (!userName.trim()) { setPinError('Bitte deinen Namen eingeben'); return; }
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
      klasse: newClass,
      status: 'offen',
      emergencySafe: false,
      createdAt: serverTimestamp(),
    });
    await writeLog('add', `${newClass} ${name}`, null, null);
    setNewName('');
    setNewClass(DEFAULT_CLASS);
    setShowAdd(false);
  };

  const handleStatus = async (child, status) => {
    if (child.status === status) return;
    await updateDoc(doc(db, 'children', child.id), { status });
    await writeLog('status', child.name, child.status, status);
  };

  const handleEmergencyToggle = async (child) => {
    const newSafe = !child.emergencySafe;
    await updateDoc(doc(db, 'children', child.id), { emergencySafe: newSafe });
    await writeLog('emergency', child.name, null, newSafe ? 'sicher' : 'gesucht');
  };

  const handleEmergencyReset = async () => {
    setBusy(true);
    const batch = writeBatch(db);
    children.forEach(c => {
      if (c.emergencySafe) batch.update(doc(db, 'children', c.id), { emergencySafe: false });
    });
    await batch.commit();
    await writeLog('emergency-reset', '(alle)', null, null);
    setBusy(false);
    setShowEmergencyReset(false);
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

  // ── CSV Import (mit Klassen-Erkennung) ────────────────────────────────
  const handleCsvImport = async () => {
    const lines = importText.split(/\n/);
    const entries = [];
    for (const line of lines) {
      // Erlaube auch mehrere Namen pro Zeile (durch Komma/Semikolon getrennt)
      // wenn KEIN Klassen-Prefix da ist
      const sub = line.split(/[;,]/);
      if (sub.length > 1 && !/^([1-4][ab])/i.test(line.trim())) {
        for (const s of sub) {
          const e = parseImportLine(s);
          if (e) entries.push(e);
        }
      } else {
        const e = parseImportLine(line);
        if (e) entries.push(e);
      }
    }
    if (entries.length === 0) return;
    setBusy(true);
    for (const entry of entries) {
      await addDoc(collection(db, 'children'), {
        name: entry.name,
        klasse: entry.klasse,
        status: 'offen',
        emergencySafe: false,
        createdAt: serverTimestamp(),
      });
    }
    await writeLog('import', `${entries.length} Kinder`, null, null);
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

  // ── CSV Export ──────────────────────────────────────────────────────
  const handleCsvExport = async () => {
    setBusy(true);
    const archives = await getDocs(collection(db, 'archive'));
    const sorted = archives.docs
      .map(d => d.data())
      .sort((a, b) => a.date.localeCompare(b.date));

    let csv = 'Datum;Klasse;Kind;Status;Uhrzeit;Aktion;Benutzer\n';
    sorted.forEach(arch => {
      arch.snapshot.forEach(c => {
        csv += `${formatDate(arch.date)};${c.klasse || ''};${c.name};${STATUS_CONFIG[c.status]?.label || c.status};;;\n`;
      });
      (arch.logs || []).forEach(l => {
        const time = l.timestamp?.toDate
          ? l.timestamp.toDate().toLocaleTimeString('de-DE')
          : '';
        csv += `${formatDate(arch.date)};;${l.childName};;${time};${l.action} ${l.toStatus || ''};${l.user || ''}\n`;
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

  // ── Kalender ─────────────────────────────────────────────────────────
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
  const stillExpected = counts.offen + counts.da;

  // Filter anwenden für Listenanzeige
  const filteredChildren = (() => {
    if (filter === 'expected') return children.filter(c => c.status === 'offen' || c.status === 'da');
    if (filter === 'abgeholt') return children.filter(c => c.status === 'abgeholt');
    if (filter === 'entschuldigt') return children.filter(c => c.status === 'entschuldigt');
    return children;
  })();

  // Nach Klassen gruppieren für Anzeige
  const groupedChildren = CLASSES.map(klasse => ({
    klasse,
    items: filteredChildren.filter(c => (c.klasse || DEFAULT_CLASS) === klasse),
  })).filter(g => g.items.length > 0);

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
    // Erwartete Kinder = die, die heute da sein müssten (offen + da)
    const expected = children.filter(c => c.status === 'offen' || c.status === 'da');
    const safeList = expected.filter(c => c.emergencySafe);
    const searchList = expected.filter(c => !c.emergencySafe);

    // Nach Klassen gruppieren
    const groupBy = (list) => CLASSES.map(k => ({
      klasse: k,
      items: list.filter(c => (c.klasse || DEFAULT_CLASS) === k),
    })).filter(g => g.items.length > 0);

    return (
      <div className="emergency">
        <button className="btn-emergency-close" onClick={() => setView('list')}>
          ✕ Schließen
        </button>
        <div className="emergency-title">NOTFALL</div>
        <div className="emergency-big">
          <div className="emergency-number">{expected.length}</div>
          <div className="emergency-sub">Kinder müssen anwesend sein</div>
        </div>
        <div className="emergency-counters">
          <div className="ec-card ec-green">
            <div className="ec-num">{safeList.length}</div>
            <div className="ec-lbl">in Sicherheit</div>
          </div>
          <div className="ec-card ec-red">
            <div className="ec-num">{searchList.length}</div>
            <div className="ec-lbl">noch zu suchen</div>
          </div>
        </div>

        <button
          className="btn-emergency-reset"
          onClick={() => setShowEmergencyReset(true)}
          disabled={safeList.length === 0}
        >
          ↺ Notfall-Übung neu starten
        </button>

        <div className="emergency-lists">
          <div className="emerg-list emerg-red">
            <h3>NOCH ZU SUCHEN ({searchList.length})</h3>
            {groupBy(searchList).map(g => (
              <div key={g.klasse} className="emerg-class-group">
                <div className="emerg-class-head">Klasse {g.klasse}</div>
                {g.items.map(c => (
                  <button
                    key={c.id}
                    className="emerg-name emerg-name-red"
                    onClick={() => handleEmergencyToggle(c)}
                  >
                    {c.name}
                    <span className="emerg-tap">tippen wenn in Sicherheit →</span>
                  </button>
                ))}
              </div>
            ))}
            {searchList.length === 0 && <p className="emerg-empty">✓ Alle in Sicherheit</p>}
          </div>
          <div className="emerg-list emerg-green">
            <h3>IN SICHERHEIT ({safeList.length})</h3>
            {groupBy(safeList).map(g => (
              <div key={g.klasse} className="emerg-class-group">
                <div className="emerg-class-head">Klasse {g.klasse}</div>
                {g.items.map(c => (
                  <button
                    key={c.id}
                    className="emerg-name emerg-name-green"
                    onClick={() => handleEmergencyToggle(c)}
                    title="Tippen rückgängig machen"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            ))}
            {safeList.length === 0 && <p className="emerg-empty">Noch keiner</p>}
          </div>
        </div>

        {showEmergencyReset && (
          <Modal onClose={() => setShowEmergencyReset(false)}>
            <h2>Notfall-Übung neu starten?</h2>
            <p>Alle Kinder werden wieder als „noch zu suchen" markiert.</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowEmergencyReset(false)}>Abbrechen</button>
              <button className="btn-warning" onClick={handleEmergencyReset} disabled={busy}>
                {busy ? '…' : 'Zurücksetzen'}
              </button>
            </div>
          </Modal>
        )}
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

      <button className="btn-emergency" onClick={() => setView('emergency')}>
        🚨 NOTFALLMODUS
      </button>

      <div className="stats-grid">
        <button
          className={`stat-card stat-must ${filter === 'expected' ? 'stat-active' : ''}`}
          onClick={() => setFilter(filter === 'expected' ? null : 'expected')}
        >
          <div className="stat-number">{stillExpected}</div>
          <div className="stat-label">müssen da sein</div>
        </button>
        <div className="stat-card stat-da">
          <div className="stat-number">{counts.da}</div>
          <div className="stat-label">Da ✓</div>
        </div>
        <button
          className={`stat-card stat-abgeholt ${filter === 'abgeholt' ? 'stat-active' : ''}`}
          onClick={() => setFilter(filter === 'abgeholt' ? null : 'abgeholt')}
        >
          <div className="stat-number">{counts.abgeholt}</div>
          <div className="stat-label">Abgeholt</div>
        </button>
        <button
          className={`stat-card stat-entsch ${filter === 'entschuldigt' ? 'stat-active' : ''}`}
          onClick={() => setFilter(filter === 'entschuldigt' ? null : 'entschuldigt')}
        >
          <div className="stat-number">{counts.entschuldigt}</div>
          <div className="stat-label">Entsch.</div>
        </button>
      </div>

      {filter && (
        <div className="filter-bar">
          Filter aktiv: <strong>
            {filter === 'expected' && 'Müssen da sein'}
            {filter === 'abgeholt' && 'Abgeholt'}
            {filter === 'entschuldigt' && 'Entschuldigt'}
          </strong>
          <button className="btn-mini" onClick={() => setFilter(null)}>✕ Filter aufheben</button>
        </div>
      )}

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
        {children.length > 0 && groupedChildren.length === 0 && (
          <div className="empty">
            <p>Keine Kinder mit diesem Filter.</p>
          </div>
        )}
        {groupedChildren.map(group => (
          <div key={group.klasse} className="class-group">
            <div className="class-header">
              <span className="class-name">Klasse {group.klasse}</span>
              <span className="class-count">{group.items.length}</span>
            </div>
            {group.items.map(child => (
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
        ))}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <Modal onClose={() => setShowAdd(false)}>
          <h2>Kind hinzufügen</h2>
          <label className="form-label">Klasse</label>
          <select
            className="text-input"
            value={newClass}
            onChange={e => setNewClass(e.target.value)}
          >
            {CLASSES.map(k => <option key={k} value={k}>Klasse {k}</option>)}
          </select>
          <label className="form-label">Name</label>
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
          <p className="hint">
            <strong>Format:</strong> Klasse vor dem Namen, eine Zeile pro Kind.<br/>
            Beispiele:<br/>
            <code>1a Max Müller</code><br/>
            <code>1a;Lena Schmidt</code><br/>
            <code>2b,Luca Fischer</code><br/>
            Ohne Klassen-Prefix → Klasse {DEFAULT_CLASS}.
          </p>
          <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="file-input" />
          <textarea
            className="text-area"
            rows={10}
            placeholder={'1a Max Müller\n1a Lena Schmidt\n1b Luca Fischer\n2a Emma Bauer\n…'}
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
  const firstWeekday = (first.getDay() + 6) % 7;

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
  const grouped = CLASSES.map(k => ({
    klasse: k,
    items: sorted.filter(c => (c.klasse || DEFAULT_CLASS) === k),
  })).filter(g => g.items.length > 0);

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
        {grouped.map(group => (
          <div key={group.klasse} className="class-group">
            <div className="class-header">
              <span className="class-name">Klasse {group.klasse}</span>
              <span className="class-count">{group.items.length}</span>
            </div>
            {group.items.map((c, i) => (
              <div key={i} className={`child-row row-${c.status}`}>
                <div className="child-name-row">
                  <span className={`status-dot dot-${c.status}`} />
                  <span className="child-name">{c.name}</span>
                  <span className="day-status">{STATUS_CONFIG[c.status]?.label}</span>
                </div>
              </div>
            ))}
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
          else if (l.action === 'emergency') text = `Notfall: ${l.childName} → ${l.toStatus}`;
          else if (l.action === 'emergency-reset') text = `Notfall-Übung zurückgesetzt`;
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
function Modal({ children, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
