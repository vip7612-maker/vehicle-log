'use client';

import { useEffect, useState, useCallback, FormEvent } from 'react';

interface Record {
  id: string;
  date: string;
  driver: string;
  passengers: number;
  purpose: string;
  pinned: number;
  departure: string;
  departure_time: string;
  waypoint: string;
  waypoint_time: string;
  destination: string;
  destination_time: string;
  distance: number;
  maintenance: string;
}

interface RecordWithCum extends Record {
  startKm: number;
  endKm: number;
}

interface Route {
  id: number;
  name: string;
  departure: string;
  waypoint: string;
  destination: string;
  distance: number;
}

interface Driver { id: number; name: string; }
interface Purpose { id: number; name: string; }

function fmt(n: number) { return n.toLocaleString('ko-KR'); }

export default function Home() {
  const [tab, setTab] = useState('record');
  const [records, setRecords] = useState<Record[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [purposes, setPurposes] = useState<Purpose[]>([]);
  const [startOdo, setStartOdo] = useState(0);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterDriver, setFilterDriver] = useState('');
  const [filterMonth, setFilterMonth] = useState('');

  // Modals
  const [modalDriver, setModalDriver] = useState(false);
  const [modalRoute, setModalRoute] = useState(false);
  const [modalPurpose, setModalPurpose] = useState(false);
  const [modalEdit, setModalEdit] = useState(false);

  // Auto-generate state
  const [autoTarget, setAutoTarget] = useState(0);
  const [autoStartDate, setAutoStartDate] = useState('');
  const [autoEndDate, setAutoEndDate] = useState('');
  const [autoMandatory, setAutoMandatory] = useState<{date:string;driver:string;departure:string;waypoint:string;destination:string;purpose:string;distance:number}[]>([]);
  const [autoPreview, setAutoPreview] = useState<any[]>([]);
  const [autoSummary, setAutoSummary] = useState<any>(null);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);

  // Modal inputs
  const [newDriverName, setNewDriverName] = useState('');
  const [newRoute, setNewRoute] = useState({ name: '', departure: '', waypoint: '', destination: '', distance: 0 });
  const [newPurposeName, setNewPurposeName] = useState('');

  // Form state
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    date: today, driver: '', passengers: 1, purpose: '', pinned: false,
    routePreset: '', departure: '', departureTime: '', waypoint: '', waypointTime: '',
    destination: '', destinationTime: '', distance: 0, maintenance: '',
  });

  // Edit state
  const [editForm, setEditForm] = useState<any>({});

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  // Load all data
  const loadAll = useCallback(async () => {
    try {
      await fetch('/api/init', { method: 'POST' });
      const [recs, drvs, rts, pps, sets] = await Promise.all([
        fetch('/api/records').then(r => r.json()),
        fetch('/api/drivers').then(r => r.json()),
        fetch('/api/routes').then(r => r.json()),
        fetch('/api/purposes').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
      ]);
      setRecords(recs);
      setDrivers(drvs);
      setRoutes(rts);
      setPurposes(pps);
      setStartOdo(parseInt(sets.start_odometer) || 0);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Cumulative calc
  const getWithCum = useCallback((): RecordWithCum[] => {
    const sorted = [...records].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.departure_time || '').localeCompare(b.departure_time || '');
    });
    let cum = startOdo;
    return sorted.map(r => {
      const s = cum;
      cum += (r.distance || 0);
      return { ...r, startKm: s, endKm: cum };
    });
  }, [records, startOdo]);

  const allWithCum = getWithCum();
  const lastOdo = allWithCum.length > 0 ? allWithCum[allWithCum.length - 1].endKm : startOdo;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthlyTrips = records.filter(r => r.date?.startsWith(currentMonth)).length;

  // Filtered records for log
  let filteredRecords = allWithCum;
  if (filterDriver) filteredRecords = filteredRecords.filter(r => r.driver === filterDriver);
  if (filterMonth) filteredRecords = filteredRecords.filter(r => r.date?.startsWith(filterMonth));
  const totalDist = filteredRecords.reduce((s, r) => s + (r.distance || 0), 0);

  // Route preset handler
  const onPresetChange = (val: string) => {
    setForm(f => ({ ...f, routePreset: val }));
    if (val) {
      const rt = routes[parseInt(val)];
      if (rt) setForm(f => ({ ...f, departure: rt.departure, waypoint: rt.waypoint || '', destination: rt.destination, distance: rt.distance }));
    }
  };

  // Submit record
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.driver || !form.purpose || !form.departure || !form.destination) {
      showToast('⚠️ 필수값을 모두 입력해주세요');
      return;
    }
    await fetch('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: form.date, driver: form.driver, passengers: form.passengers,
        purpose: form.purpose, pinned: form.pinned,
        departure: form.departure, departureTime: form.departureTime,
        waypoint: form.waypoint, waypointTime: form.waypointTime,
        destination: form.destination, destinationTime: form.destinationTime,
        distance: form.distance, maintenance: form.maintenance,
      }),
    });
    showToast('✅ 운행기록이 추가되었습니다');
    setForm({ date: today, driver: '', passengers: 1, purpose: '', pinned: false, routePreset: '', departure: '', departureTime: '', waypoint: '', waypointTime: '', destination: '', destinationTime: '', distance: 0, maintenance: '' });
    loadAll();
  };

  // Delete record
  const handleDeleteRecord = async (id: string) => {
    if (!confirm('이 기록을 삭제하시겠습니까?')) return;
    await fetch('/api/records', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    showToast('🗑️ 기록이 삭제되었습니다');
    loadAll();
  };

  // Edit record
  const openEdit = (r: RecordWithCum) => {
    setEditForm({ id: r.id, date: r.date, driver: r.driver, passengers: r.passengers, purpose: r.purpose, pinned: !!r.pinned, departure: r.departure, departureTime: r.departure_time, waypoint: r.waypoint, waypointTime: r.waypoint_time, destination: r.destination, destinationTime: r.destination_time, distance: r.distance, maintenance: r.maintenance });
    setModalEdit(true);
  };
  const saveEdit = async () => {
    await fetch('/api/records', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editForm) });
    showToast('✅ 기록이 수정되었습니다');
    setModalEdit(false);
    loadAll();
  };

  // Drivers
  const addDriver = async () => {
    if (!newDriverName.trim()) return;
    await fetch('/api/drivers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newDriverName.trim() }) });
    showToast('✅ 운전자가 추가되었습니다');
    setNewDriverName('');
    setModalDriver(false);
    loadAll();
  };
  const deleteDriver = async (id: number) => {
    if (!confirm('삭제하시겠습니까?')) return;
    await fetch('/api/drivers', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    loadAll();
  };

  // Routes
  const addRoute = async () => {
    if (!newRoute.name || !newRoute.departure || !newRoute.destination || !newRoute.distance) {
      showToast('⚠️ 이름, 출발지, 도착지, 거리는 필수입니다');
      return;
    }
    await fetch('/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newRoute) });
    showToast('✅ 경로가 추가되었습니다');
    setNewRoute({ name: '', departure: '', waypoint: '', destination: '', distance: 0 });
    setModalRoute(false);
    loadAll();
  };
  const deleteRoute = async (id: number) => {
    if (!confirm('삭제하시겠습니까?')) return;
    await fetch('/api/routes', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    loadAll();
  };

  // Purposes
  const addPurpose = async () => {
    if (!newPurposeName.trim()) return;
    await fetch('/api/purposes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newPurposeName.trim() }) });
    showToast('✅ 목적이 추가되었습니다');
    setNewPurposeName('');
    setModalPurpose(false);
    loadAll();
  };
  const deletePurpose = async (id: number) => {
    if (!confirm('삭제하시겠습니까?')) return;
    await fetch('/api/purposes', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    loadAll();
  };

  // Settings
  const saveOdometer = async (val: number) => {
    await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_odometer: String(val) }) });
    setStartOdo(val);
    showToast('✅ 시작 누적거리가 저장되었습니다');
  };

  // Auto-generate handlers
  const addMandatory = () => {
    setAutoMandatory(m => [...m, { date: '', driver: '', departure: '', waypoint: '', destination: '', purpose: '', distance: 0 }]);
  };
  const removeMandatory = (idx: number) => {
    setAutoMandatory(m => m.filter((_, i) => i !== idx));
  };
  const updateMandatory = (idx: number, field: string, value: string | number) => {
    setAutoMandatory(m => m.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };
  const handleAutoGenerate = async () => {
    if (!autoTarget || autoTarget <= lastOdo) { showToast(`⚠️ 목표 누적거리는 현재(${fmt(lastOdo)}km)보다 커야 합니다`); return; }
    if (!autoStartDate || !autoEndDate) { showToast('⚠️ 시작일과 종료일을 입력해주세요'); return; }
    if (autoStartDate > autoEndDate) { showToast('⚠️ 시작일이 종료일보다 앞서야 합니다'); return; }
    setAutoGenerating(true);
    try {
      const res = await fetch('/api/auto-generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetOdometer: autoTarget, startDate: autoStartDate, endDate: autoEndDate, mandatory: autoMandatory.filter(m => m.date && m.departure && m.destination && m.distance) }),
      });
      const data = await res.json();
      if (data.error) { showToast(`⚠️ ${data.error}`); }
      else { setAutoPreview(data.preview); setAutoSummary(data.summary); showToast(`✅ ${data.preview.length}건의 기록이 생성되었습니다. 미리보기를 확인하세요.`); }
    } catch (e) { showToast('❌ 자동생성 중 오류 발생'); }
    setAutoGenerating(false);
  };
  const handleAutoSave = async () => {
    if (!confirm(`${autoPreview.length}건의 기록을 저장하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    setAutoSaving(true);
    try {
      await fetch('/api/auto-generate', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: autoPreview }),
      });
      showToast(`✅ ${autoPreview.length}건의 기록이 저장되었습니다!`);
      setAutoPreview([]); setAutoSummary(null);
      loadAll();
    } catch (e) { showToast('❌ 저장 중 오류 발생'); }
    setAutoSaving(false);
  };

  // Excel export (server-side styled)
  const exportExcel = async () => {
    showToast('📥 엑셀 파일 생성 중...');
    try {
      const res = await fetch('/api/export');
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const now = new Date();
      a.download = `차량운행일지_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('📥 엑셀 파일이 다운로드되었습니다');
    } catch (e) {
      showToast('❌ 엑셀 다운로드 실패');
    }
  };

  // Recent 5
  const recent = [...allWithCum].reverse().slice(0, 5);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><div className="empty-icon" style={{ fontSize: '3rem' }}>⏳</div></div>;

  return (
    <>
      {/* Header */}
      <header className="app-header">
        <div className="header-content">
          <div className="logo-section">
            <div className="logo-icon">🚗</div>
            <div>
              <h1>차량운행 및 정비일지</h1>
              <p className="subtitle">Vehicle Operation &amp; Maintenance Log</p>
            </div>
          </div>
          <div className="header-actions">
            <button className="btn btn-accent" onClick={exportExcel}><span className="btn-icon">📥</span><span>엑셀 다운로드</span></button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="tab-nav">
        <div className="tab-container">
          {[['record', '✏️', '기록 작성'], ['autogen', '🤖', '자동생성'], ['log', '📋', '운행일지'], ['settings', '⚙️', '설정']].map(([key, icon, label]) => (
            <button key={key} className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
              <span className="tab-icon">{icon}</span><span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="main-content">
        {/* Record Tab */}
        {tab === 'record' && (
          <div className="panel-grid" style={{ animation: 'fadeIn 0.3s ease' }}>
            <div className="card">
              <div className="card-header"><h2>🚘 새 운행기록</h2><span className="badge">{records.length}건</span></div>
              <form onSubmit={handleSubmit} autoComplete="off">
                <div className="form-row">
                  <div className="form-group"><label>운행일자</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required /></div>
                  <div className="form-group"><label>운전자</label>
                    <select value={form.driver} onChange={e => setForm(f => ({ ...f, driver: e.target.value }))} required>
                      <option value="">선택</option>
                      {drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group"><label>탑승인원</label><input type="number" min={1} max={50} value={form.passengers} onChange={e => setForm(f => ({ ...f, passengers: parseInt(e.target.value) || 1 }))} required /></div>
                </div>
                <div className="form-row">
                  <div className="form-group flex-2"><label>사용목적</label>
                    <input type="text" value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="예: 통학지원, 출장 등" required list="purposeList" />
                    <datalist id="purposeList">{purposes.map(p => <option key={p.id} value={p.name} />)}</datalist>
                  </div>
                  <div className="form-group"><label><input type="checkbox" checked={form.pinned} onChange={e => setForm(f => ({ ...f, pinned: e.target.checked }))} /> 📌 고정 기록</label><small className="help-text">반드시 포함되는 기록</small></div>
                </div>
                <div className="route-section">
                  <h3>🗺️ 경로 정보</h3>
                  <div className="form-row"><div className="form-group"><label>저장된 경로</label>
                    <select value={form.routePreset} onChange={e => onPresetChange(e.target.value)}>
                      <option value="">직접 입력</option>
                      {routes.map((r, i) => <option key={r.id} value={i}>{r.name} ({r.distance}km)</option>)}
                    </select>
                  </div></div>
                  <div className="form-row">
                    <div className="form-group"><label>출발지</label><input type="text" value={form.departure} onChange={e => setForm(f => ({ ...f, departure: e.target.value }))} placeholder="출발지" required /></div>
                    <div className="form-group"><label>출발시간</label><input type="time" value={form.departureTime} onChange={e => setForm(f => ({ ...f, departureTime: e.target.value }))} required /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label>경유지</label><input type="text" value={form.waypoint} onChange={e => setForm(f => ({ ...f, waypoint: e.target.value }))} placeholder="경유지 (선택)" /></div>
                    <div className="form-group"><label>경유시간</label><input type="time" value={form.waypointTime} onChange={e => setForm(f => ({ ...f, waypointTime: e.target.value }))} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-group"><label>도착지</label><input type="text" value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} placeholder="도착지" required /></div>
                    <div className="form-group"><label>도착시간</label><input type="time" value={form.destinationTime} onChange={e => setForm(f => ({ ...f, destinationTime: e.target.value }))} required /></div>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label>주행거리 (km)</label><input type="number" min={0} value={form.distance} onChange={e => setForm(f => ({ ...f, distance: parseInt(e.target.value) || 0 }))} placeholder="거리" required /></div>
                  <div className="form-group"><label>차량정비/주유내역</label><input type="text" value={form.maintenance} onChange={e => setForm(f => ({ ...f, maintenance: e.target.value }))} placeholder="선택 입력" /></div>
                </div>
                <div className="form-actions"><button type="submit" className="btn btn-primary btn-lg">기록 추가</button><button type="reset" className="btn btn-ghost" onClick={() => setForm({ date: today, driver: '', passengers: 1, purpose: '', pinned: false, routePreset: '', departure: '', departureTime: '', waypoint: '', waypointTime: '', destination: '', destinationTime: '', distance: 0, maintenance: '' })}>초기화</button></div>
              </form>
            </div>
            <div className="card">
              <div className="card-header"><h2>📊 최근 기록</h2></div>
              <div className="recent-records">
                {recent.length === 0 ? <div className="empty-state"><div className="empty-icon">📝</div><p>아직 기록이 없습니다</p><small>새 운행기록을 추가해주세요</small></div> : recent.map(r => (
                  <div key={r.id} className={`record-item${r.pinned ? ' pinned' : ''}`}>
                    <div className="record-header"><span className="record-date">{r.pinned ? '📌 ' : ''}{r.date}</span><span className="record-driver">{r.driver}</span></div>
                    <div className="record-route">{r.departure} → {r.waypoint ? r.waypoint + ' → ' : ''}{r.destination}</div>
                    <div className="record-distance">{r.purpose} · {fmt(r.distance)}km (누적: {fmt(r.endKm)}km)</div>
                  </div>
                ))}
              </div>
              <div className="cumulative-info">
                <div className="info-item"><span className="info-label">현재 누적거리</span><span className="info-value">{fmt(lastOdo)} km</span></div>
                <div className="info-item"><span className="info-label">이번 달 운행</span><span className="info-value">{monthlyTrips} 건</span></div>
              </div>
            </div>
          </div>
        )}

        {/* Auto-Generate Tab */}
        {tab === 'autogen' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-header"><h2>🤖 자동 운행기록 생성</h2><span className="badge">패턴 분석</span></div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20, lineHeight: 1.6 }}>
                현재 누적거리: <strong style={{ color: 'var(--accent-light)' }}>{fmt(lastOdo)} km</strong> · 목표 누적거리를 입력하면 과거 운행 패턴(경로·운전자·시간대)을 분석하여 자동으로 기록을 생성합니다.
              </p>
              <div className="form-row">
                <div className="form-group"><label>🎯 목표 누적거리 (km)</label><input type="number" min={lastOdo + 1} value={autoTarget || ''} onChange={e => setAutoTarget(parseInt(e.target.value) || 0)} placeholder={`현재: ${fmt(lastOdo)}km`} /></div>
                <div className="form-group"><label>📅 시작일</label><input type="date" value={autoStartDate} onChange={e => setAutoStartDate(e.target.value)} /></div>
                <div className="form-group"><label>📅 종료일</label><input type="date" value={autoEndDate} onChange={e => setAutoEndDate(e.target.value)} /></div>
              </div>
              {autoTarget > lastOdo && <div style={{ background: 'var(--bg-glass)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 16px', marginBottom: 16, fontSize: '0.85rem' }}>
                📊 채워야 할 거리: <strong style={{ color: 'var(--success)' }}>{fmt(autoTarget - lastOdo)} km</strong>
              </div>}

              {/* Mandatory Records */}
              <div className="route-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3>📌 필수 기록 (꼭 포함할 운행)</h3>
                  <button className="btn btn-primary btn-sm" onClick={addMandatory}>+ 추가</button>
                </div>
                {autoMandatory.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>필수로 포함할 운행기록을 추가하세요. (선택사항)</p>}
                {autoMandatory.map((m, idx) => (
                  <div key={idx} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 14, marginBottom: 10 }}>
                    <div className="form-row">
                      <div className="form-group"><label>날짜</label><input type="date" value={m.date} onChange={e => updateMandatory(idx, 'date', e.target.value)} /></div>
                      <div className="form-group"><label>운전자</label>
                        <select value={m.driver} onChange={e => updateMandatory(idx, 'driver', e.target.value)}>
                          <option value="">자동</option>
                          {drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                        </select>
                      </div>
                      <div className="form-group"><label>목적</label>
                        <input type="text" value={m.purpose} onChange={e => updateMandatory(idx, 'purpose', e.target.value)} placeholder="예: 출장" list="purposeList" />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group"><label>출발지</label><input type="text" value={m.departure} onChange={e => updateMandatory(idx, 'departure', e.target.value)} placeholder="출발지" /></div>
                      <div className="form-group"><label>경유지</label><input type="text" value={m.waypoint} onChange={e => updateMandatory(idx, 'waypoint', e.target.value)} placeholder="선택" /></div>
                      <div className="form-group"><label>도착지</label><input type="text" value={m.destination} onChange={e => updateMandatory(idx, 'destination', e.target.value)} placeholder="도착지" /></div>
                      <div className="form-group"><label>거리(km)</label><input type="number" min={0} value={m.distance || ''} onChange={e => updateMandatory(idx, 'distance', parseInt(e.target.value) || 0)} /></div>
                      <div className="form-group" style={{ flex: 'none', alignSelf: 'flex-end' }}><button className="btn btn-danger btn-sm" onClick={() => removeMandatory(idx)}>✕ 삭제</button></div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="form-actions" style={{ marginTop: 16 }}>
                <button className="btn btn-primary btn-lg" onClick={handleAutoGenerate} disabled={autoGenerating}>
                  {autoGenerating ? '⏳ 생성 중...' : '🤖 자동 생성하기'}
                </button>
              </div>
            </div>

            {/* Auto-Generated Preview */}
            {autoPreview.length > 0 && (
              <div className="card">
                <div className="card-header">
                  <h2>👁️ 미리보기 ({autoPreview.length}건)</h2>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {autoSummary && <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {fmt(autoSummary.currentOdometer)}km → {fmt(autoSummary.targetOdometer)}km · 총 {fmt(autoSummary.totalDistance)}km
                    </span>}
                    <button className="btn btn-ghost btn-sm" onClick={() => { setAutoPreview([]); setAutoSummary(null); }}>초기화</button>
                    <button className="btn btn-accent" onClick={handleAutoSave} disabled={autoSaving}>
                      {autoSaving ? '⏳ 저장 중...' : `✅ ${autoPreview.length}건 확정 저장`}
                    </button>
                  </div>
                </div>
                <div className="table-wrapper">
                  <table className="log-table">
                    <thead><tr>
                      <th>운행일자</th><th>운전자</th><th>탑승</th><th>사용목적</th>
                      <th>출발지<br/><small>(시간)</small></th><th>경유지</th><th>도착지<br/><small>(시간)</small></th>
                      <th>주행(km)</th><th>📌</th>
                    </tr></thead>
                    <tbody>{autoPreview.map((r: any, i: number) => (
                      <tr key={i} className={r.pinned ? 'pinned-row' : ''}>
                        <td>{r.date}</td><td>{r.driver}</td><td>{r.passengers}</td>
                        <td style={{ textAlign: 'left', whiteSpace: 'normal', maxWidth: 120 }}>{r.purpose}</td>
                        <td>{r.departure}<br/><small>{r.departureTime}</small></td>
                        <td>{r.waypoint || ''}</td>
                        <td>{r.destination}<br/><small>{r.destinationTime}</small></td>
                        <td><strong>{fmt(r.distance)}</strong></td>
                        <td>{r.pinned ? '📌' : ''}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="table-footer">
                  총 {autoPreview.length}건 · 총 주행거리: {fmt(autoPreview.reduce((s: number, r: any) => s + r.distance, 0))}km
                  {autoSummary && <> · 필수기록: {autoSummary.mandatoryCount}건</>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Log Tab */}
        {tab === 'log' && (
          <div className="card" style={{ animation: 'fadeIn 0.3s ease' }}>
            <div className="card-header">
              <h2>📋 운행일지</h2>
              <div className="filter-group">
                <select className="filter-select" value={filterDriver} onChange={e => setFilterDriver(e.target.value)}>
                  <option value="">전체 운전자</option>
                  {drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
                <input type="month" className="filter-input" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
                <button className="btn btn-ghost btn-sm" onClick={() => { setFilterDriver(''); setFilterMonth(''); }}>필터 초기화</button>
              </div>
            </div>
            {filteredRecords.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📋</div><p>운행 기록이 없습니다</p></div>
            ) : (
              <>
                <div className="table-wrapper">
                  <table className="log-table">
                    <thead><tr>
                      <th>운행일자</th><th>운전자</th><th>탑승</th><th>사용목적</th>
                      <th>출발지<br /><small>(시간)</small></th><th>경유지<br /><small>(시간)</small></th><th>도착지<br /><small>(시간)</small></th>
                      <th>출발<br /><small>(km)</small></th><th>도착<br /><small>(km)</small></th><th>주행<br /><small>(km)</small></th>
                      <th>정비/주유</th><th>📌</th><th>관리</th>
                    </tr></thead>
                    <tbody>{filteredRecords.map(r => (
                      <tr key={r.id} className={r.pinned ? 'pinned-row' : ''}>
                        <td>{r.date}</td><td>{r.driver}</td><td>{r.passengers}</td>
                        <td style={{ textAlign: 'left', whiteSpace: 'normal', maxWidth: 140 }}>{r.purpose}</td>
                        <td>{r.departure}<br /><small>{r.departure_time}</small></td>
                        <td>{r.waypoint || ''}<br /><small>{r.waypoint_time || ''}</small></td>
                        <td>{r.destination}<br /><small>{r.destination_time}</small></td>
                        <td>{fmt(r.startKm)}</td><td>{fmt(r.endKm)}</td><td><strong>{fmt(r.distance)}</strong></td>
                        <td style={{ textAlign: 'left', whiteSpace: 'normal', maxWidth: 100 }}>{r.maintenance || ''}</td>
                        <td>{r.pinned ? '📌' : ''}</td>
                        <td><div className="action-btns">
                          <button className="btn-edit" onClick={() => openEdit(r)}>✏️</button>
                          <button className="btn-del" onClick={() => handleDeleteRecord(r.id)}>🗑️</button>
                        </div></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div className="table-footer">총 {filteredRecords.length}건 · 총 주행거리: {fmt(totalDist)}km</div>
              </>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {tab === 'settings' && (
          <div className="settings-grid" style={{ animation: 'fadeIn 0.3s ease' }}>
            <div className="card">
              <div className="card-header"><h2>🔧 기초 설정</h2></div>
              <div className="form-group"><label>시작 누적거리 (km)</label>
                <div className="input-with-btn">
                  <input type="number" min={0} value={startOdo} onChange={e => setStartOdo(parseInt(e.target.value) || 0)} />
                  <button className="btn btn-primary btn-sm" onClick={() => saveOdometer(startOdo)}>저장</button>
                </div><small className="help-text">첫 번째 기록 이전의 누적 주행거리</small>
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h2>👤 운전자 관리</h2><button className="btn btn-primary btn-sm" onClick={() => { setNewDriverName(''); setModalDriver(true); }}>+ 추가</button></div>
              <div className="settings-list">
                {drivers.map(d => <div key={d.id} className="settings-item"><div className="item-info"><span className="item-name">👤 {d.name}</span></div><button className="btn-delete" onClick={() => deleteDriver(d.id)}>✕</button></div>)}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h2>🗺️ 자주가는 경로</h2><button className="btn btn-primary btn-sm" onClick={() => { setNewRoute({ name: '', departure: '', waypoint: '', destination: '', distance: 0 }); setModalRoute(true); }}>+ 추가</button></div>
              <div className="settings-list">
                {routes.map(r => <div key={r.id} className="settings-item"><div className="item-info"><span className="item-name">{r.name}</span><span className="item-detail">{r.departure} → {r.waypoint ? r.waypoint + ' → ' : ''}{r.destination} · {r.distance}km</span></div><button className="btn-delete" onClick={() => deleteRoute(r.id)}>✕</button></div>)}
              </div>
            </div>
            <div className="card">
              <div className="card-header"><h2>📝 자주 쓰는 목적</h2><button className="btn btn-primary btn-sm" onClick={() => { setNewPurposeName(''); setModalPurpose(true); }}>+ 추가</button></div>
              <div className="settings-list">
                {purposes.map(p => <div key={p.id} className="settings-item"><div className="item-info"><span className="item-name">📝 {p.name}</span></div><button className="btn-delete" onClick={() => deletePurpose(p.id)}>✕</button></div>)}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modal: Driver */}
      {modalDriver && <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) setModalDriver(false); }}>
        <div className="modal"><div className="modal-header"><h3>👤 운전자 추가</h3><button className="modal-close" onClick={() => setModalDriver(false)}>&times;</button></div>
          <div className="modal-body"><div className="form-group"><label>운전자 이름</label><input type="text" value={newDriverName} onChange={e => setNewDriverName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDriver()} autoFocus placeholder="이름 입력" /></div></div>
          <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setModalDriver(false)}>취소</button><button className="btn btn-primary" onClick={addDriver}>추가</button></div>
        </div>
      </div>}

      {/* Modal: Route */}
      {modalRoute && <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) setModalRoute(false); }}>
        <div className="modal"><div className="modal-header"><h3>🗺️ 경로 추가</h3><button className="modal-close" onClick={() => setModalRoute(false)}>&times;</button></div>
          <div className="modal-body">
            <div className="form-group"><label>경로 이름</label><input type="text" value={newRoute.name} onChange={e => setNewRoute(r => ({ ...r, name: e.target.value }))} placeholder="예: 통학 왕복" autoFocus /></div>
            <div className="form-group"><label>출발지</label><input type="text" value={newRoute.departure} onChange={e => setNewRoute(r => ({ ...r, departure: e.target.value }))} /></div>
            <div className="form-group"><label>경유지 (선택)</label><input type="text" value={newRoute.waypoint} onChange={e => setNewRoute(r => ({ ...r, waypoint: e.target.value }))} /></div>
            <div className="form-group"><label>도착지</label><input type="text" value={newRoute.destination} onChange={e => setNewRoute(r => ({ ...r, destination: e.target.value }))} /></div>
            <div className="form-group"><label>기본 거리 (km)</label><input type="number" min={0} value={newRoute.distance} onChange={e => setNewRoute(r => ({ ...r, distance: parseInt(e.target.value) || 0 }))} /></div>
          </div>
          <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setModalRoute(false)}>취소</button><button className="btn btn-primary" onClick={addRoute}>추가</button></div>
        </div>
      </div>}

      {/* Modal: Purpose */}
      {modalPurpose && <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) setModalPurpose(false); }}>
        <div className="modal"><div className="modal-header"><h3>📝 목적 추가</h3><button className="modal-close" onClick={() => setModalPurpose(false)}>&times;</button></div>
          <div className="modal-body"><div className="form-group"><label>목적 이름</label><input type="text" value={newPurposeName} onChange={e => setNewPurposeName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPurpose()} autoFocus placeholder="예: 통학지원" /></div></div>
          <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setModalPurpose(false)}>취소</button><button className="btn btn-primary" onClick={addPurpose}>추가</button></div>
        </div>
      </div>}

      {/* Modal: Edit */}
      {modalEdit && <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) setModalEdit(false); }}>
        <div className="modal modal-lg"><div className="modal-header"><h3>✏️ 기록 수정</h3><button className="modal-close" onClick={() => setModalEdit(false)}>&times;</button></div>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group"><label>운행일자</label><input type="date" value={editForm.date || ''} onChange={e => setEditForm((f: any) => ({ ...f, date: e.target.value }))} /></div>
              <div className="form-group"><label>운전자</label><select value={editForm.driver || ''} onChange={e => setEditForm((f: any) => ({ ...f, driver: e.target.value }))}>{drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</select></div>
              <div className="form-group"><label>탑승인원</label><input type="number" min={1} value={editForm.passengers || 1} onChange={e => setEditForm((f: any) => ({ ...f, passengers: parseInt(e.target.value) || 1 }))} /></div>
            </div>
            <div className="form-row">
              <div className="form-group flex-2"><label>사용목적</label><input type="text" value={editForm.purpose || ''} onChange={e => setEditForm((f: any) => ({ ...f, purpose: e.target.value }))} /></div>
              <div className="form-group"><label><input type="checkbox" checked={editForm.pinned || false} onChange={e => setEditForm((f: any) => ({ ...f, pinned: e.target.checked }))} /> 📌 고정</label></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>출발지</label><input type="text" value={editForm.departure || ''} onChange={e => setEditForm((f: any) => ({ ...f, departure: e.target.value }))} /></div>
              <div className="form-group"><label>출발시간</label><input type="time" value={editForm.departureTime || ''} onChange={e => setEditForm((f: any) => ({ ...f, departureTime: e.target.value }))} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>경유지</label><input type="text" value={editForm.waypoint || ''} onChange={e => setEditForm((f: any) => ({ ...f, waypoint: e.target.value }))} /></div>
              <div className="form-group"><label>경유시간</label><input type="time" value={editForm.waypointTime || ''} onChange={e => setEditForm((f: any) => ({ ...f, waypointTime: e.target.value }))} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>도착지</label><input type="text" value={editForm.destination || ''} onChange={e => setEditForm((f: any) => ({ ...f, destination: e.target.value }))} /></div>
              <div className="form-group"><label>도착시간</label><input type="time" value={editForm.destinationTime || ''} onChange={e => setEditForm((f: any) => ({ ...f, destinationTime: e.target.value }))} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>주행거리 (km)</label><input type="number" min={0} value={editForm.distance || 0} onChange={e => setEditForm((f: any) => ({ ...f, distance: parseInt(e.target.value) || 0 }))} /></div>
              <div className="form-group"><label>정비/주유</label><input type="text" value={editForm.maintenance || ''} onChange={e => setEditForm((f: any) => ({ ...f, maintenance: e.target.value }))} /></div>
            </div>
          </div>
          <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setModalEdit(false)}>취소</button><button className="btn btn-primary" onClick={saveEdit}>저장</button></div>
        </div>
      </div>}

      {/* Toast */}
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </>
  );
}
