/* ===== 차량운행기록 생성기 - Main App ===== */

(function () {
  'use strict';

  // ===== Storage Keys =====
  const KEYS = {
    records: 'vlog_records',
    drivers: 'vlog_drivers',
    routes: 'vlog_routes',
    purposes: 'vlog_purposes',
    startOdometer: 'vlog_start_odometer',
  };

  // ===== Default Data =====
  const DEFAULT_DRIVERS = ['이경진', '최종문', '김병준', '김태복', '김태묵', '신준규', '박희양', '김왕준'];
  const DEFAULT_PURPOSES = ['통학지원', '병원진료', '물품구입', '출장', '고객방문', '체험학습', '학교교류협력', '회의참석'];
  const DEFAULT_ROUTES = [
    { name: '통학 왕복 (7인)', departure: '해일학교', waypoint: '충전터미널', destination: '해일학교', distance: 43 },
    { name: '무덕역 왕복', departure: '해일학교', waypoint: '', destination: '무덕역', distance: 18 },
    { name: '물품구입 (무덕역)', departure: '해일학교', waypoint: '무덕역', destination: '해일학교', distance: 18 },
  ];

  // ===== Data Management =====
  function load(key, fallback) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  // State
  let records = load(KEYS.records, []);
  let drivers = load(KEYS.drivers, DEFAULT_DRIVERS);
  let routes = load(KEYS.routes, DEFAULT_ROUTES);
  let purposes = load(KEYS.purposes, DEFAULT_PURPOSES);
  let startOdometer = load(KEYS.startOdometer, 0);

  // ===== Utility =====
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  }

  function formatNumber(n) {
    return n.toLocaleString('ko-KR');
  }

  // ===== Calculate Cumulative Distances =====
  function getRecordsWithCumulative() {
    const sorted = [...records].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.departureTime !== b.departureTime) return (a.departureTime || '').localeCompare(b.departureTime || '');
      return 0;
    });

    let cumulative = startOdometer;
    return sorted.map(r => {
      const startKm = cumulative;
      cumulative += (r.distance || 0);
      return {
        ...r,
        startKm,
        endKm: cumulative,
      };
    });
  }

  // ===== Render: Drivers Select =====
  function renderDriverSelects() {
    const selects = [
      document.getElementById('recordDriver'),
      document.getElementById('filterDriver'),
      document.getElementById('editDriver'),
    ];
    selects.forEach(sel => {
      if (!sel) return;
      const val = sel.value;
      const firstOption = sel.id === 'filterDriver' ? '<option value="">전체 운전자</option>' : '<option value="">선택</option>';
      sel.innerHTML = firstOption + drivers.map(d => `<option value="${d}">${d}</option>`).join('');
      if (val) sel.value = val;
    });
  }

  // ===== Render: Route Presets =====
  function renderRoutePresets() {
    const sel = document.getElementById('recordRoutePreset');
    sel.innerHTML = '<option value="">직접 입력</option>' +
      routes.map((r, i) => `<option value="${i}">${r.name} (${r.distance}km)</option>`).join('');
  }

  // ===== Render: Datalists =====
  function renderDataLists() {
    // Places
    const places = new Set();
    routes.forEach(r => {
      if (r.departure) places.add(r.departure);
      if (r.waypoint) places.add(r.waypoint);
      if (r.destination) places.add(r.destination);
    });
    records.forEach(r => {
      if (r.departure) places.add(r.departure);
      if (r.waypoint) places.add(r.waypoint);
      if (r.destination) places.add(r.destination);
    });
    const placeList = document.getElementById('placeList');
    placeList.innerHTML = [...places].map(p => `<option value="${p}">`).join('');

    // Purposes
    const purposeList = document.getElementById('purposeList');
    const allPurposes = new Set([...purposes, ...records.map(r => r.purpose).filter(Boolean)]);
    purposeList.innerHTML = [...allPurposes].map(p => `<option value="${p}">`).join('');
  }

  // ===== Render: Recent Records =====
  function renderRecentRecords() {
    const container = document.getElementById('recentRecords');
    const withCum = getRecordsWithCumulative();
    const recent = withCum.slice(-5).reverse();

    if (recent.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📝</div>
          <p>아직 기록이 없습니다</p>
          <small>새 운행기록을 추가해주세요</small>
        </div>`;
      return;
    }

    container.innerHTML = recent.map(r => `
      <div class="record-item${r.pinned ? ' pinned' : ''}">
        <div class="record-header">
          <span class="record-date">${r.pinned ? '📌 ' : ''}${r.date}</span>
          <span class="record-driver">${r.driver}</span>
        </div>
        <div class="record-route">${r.departure} → ${r.waypoint ? r.waypoint + ' → ' : ''}${r.destination}</div>
        <div class="record-distance">${r.purpose} · ${formatNumber(r.distance)}km (누적: ${formatNumber(r.endKm)}km)</div>
      </div>
    `).join('');

    // Update stats
    const lastRecord = withCum[withCum.length - 1];
    document.getElementById('currentOdometer').textContent = lastRecord ? formatNumber(lastRecord.endKm) + ' km' : formatNumber(startOdometer) + ' km';

    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);
    const monthlyCount = records.filter(r => r.date && r.date.startsWith(currentMonth)).length;
    document.getElementById('monthlyTrips').textContent = monthlyCount + ' 건';

    // Badge
    document.getElementById('badgeRecordCount').textContent = records.length + '건';
  }

  // ===== Render: Log Table =====
  function renderLogTable() {
    const tbody = document.getElementById('logTableBody');
    const emptyEl = document.getElementById('logEmpty');
    const tableWrapper = document.querySelector('.table-wrapper');
    const footer = document.getElementById('tableFooter');

    const filterDriver = document.getElementById('filterDriver').value;
    const filterMonth = document.getElementById('filterMonth').value;

    let withCum = getRecordsWithCumulative();

    if (filterDriver) {
      withCum = withCum.filter(r => r.driver === filterDriver);
    }
    if (filterMonth) {
      withCum = withCum.filter(r => r.date && r.date.startsWith(filterMonth));
    }

    if (withCum.length === 0) {
      tbody.innerHTML = '';
      tableWrapper.style.display = 'none';
      emptyEl.style.display = 'block';
      footer.style.display = 'none';
      return;
    }

    tableWrapper.style.display = 'block';
    emptyEl.style.display = 'none';
    footer.style.display = 'block';

    tbody.innerHTML = withCum.map(r => `
      <tr class="${r.pinned ? 'pinned-row' : ''}" data-id="${r.id}">
        <td>${r.date}</td>
        <td>${r.driver}</td>
        <td>${r.passengers}</td>
        <td style="text-align:left;white-space:normal;max-width:140px;">${r.purpose}</td>
        <td>${r.departure}<br><small>${r.departureTime || ''}</small></td>
        <td>${r.waypoint || ''}<br><small>${r.waypointTime || ''}</small></td>
        <td>${r.destination}<br><small>${r.destinationTime || ''}</small></td>
        <td>${formatNumber(r.startKm)}</td>
        <td>${formatNumber(r.endKm)}</td>
        <td><strong>${formatNumber(r.distance)}</strong></td>
        <td style="text-align:left;white-space:normal;max-width:100px;">${r.maintenance || ''}</td>
        <td>${r.pinned ? '📌' : ''}</td>
        <td>
          <div class="action-btns">
            <button class="btn-edit" title="수정" onclick="app.editRecord('${r.id}')">✏️</button>
            <button class="btn-del" title="삭제" onclick="app.deleteRecord('${r.id}')">🗑️</button>
          </div>
        </td>
      </tr>
    `).join('');

    const totalDist = withCum.reduce((s, r) => s + (r.distance || 0), 0);
    document.getElementById('tableStats').textContent =
      `총 ${withCum.length}건 · 총 주행거리: ${formatNumber(totalDist)}km`;
  }

  // ===== Render: Settings Lists =====
  function renderDriverList() {
    const container = document.getElementById('driverList');
    if (drivers.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>등록된 운전자가 없습니다</p></div>';
      return;
    }
    container.innerHTML = drivers.map((d, i) => `
      <div class="settings-item">
        <div class="item-info">
          <span class="item-name">👤 ${d}</span>
        </div>
        <button class="btn-delete" onclick="app.deleteDriver(${i})" title="삭제">✕</button>
      </div>
    `).join('');
  }

  function renderRouteList() {
    const container = document.getElementById('routeList');
    if (routes.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>등록된 경로가 없습니다</p></div>';
      return;
    }
    container.innerHTML = routes.map((r, i) => `
      <div class="settings-item">
        <div class="item-info">
          <span class="item-name">${r.name}</span>
          <span class="item-detail">${r.departure} → ${r.waypoint ? r.waypoint + ' → ' : ''}${r.destination} · ${r.distance}km</span>
        </div>
        <button class="btn-delete" onclick="app.deleteRoute(${i})" title="삭제">✕</button>
      </div>
    `).join('');
  }

  function renderPurposeList() {
    const container = document.getElementById('purposeSettingsList');
    if (purposes.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>등록된 목적이 없습니다</p></div>';
      return;
    }
    container.innerHTML = purposes.map((p, i) => `
      <div class="settings-item">
        <div class="item-info">
          <span class="item-name">📝 ${p}</span>
        </div>
        <button class="btn-delete" onclick="app.deletePurpose(${i})" title="삭제">✕</button>
      </div>
    `).join('');
  }

  // ===== Full Render =====
  function renderAll() {
    renderDriverSelects();
    renderRoutePresets();
    renderDataLists();
    renderRecentRecords();
    renderLogTable();
    renderDriverList();
    renderRouteList();
    renderPurposeList();
    document.getElementById('settingStartOdometer').value = startOdometer;
  }

  // ===== Tab Navigation =====
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  // ===== Modals =====
  function openModal(id) {
    document.getElementById(id).classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }

  function initModals() {
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });
  }

  // ===== Record Form =====
  function initRecordForm() {
    const form = document.getElementById('formRecord');

    // Set today as default date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('recordDate').value = today;

    // Route preset change
    document.getElementById('recordRoutePreset').addEventListener('change', (e) => {
      const idx = e.target.value;
      if (idx === '') return;
      const route = routes[parseInt(idx)];
      if (!route) return;
      document.getElementById('recordDeparture').value = route.departure;
      document.getElementById('recordWaypoint').value = route.waypoint || '';
      document.getElementById('recordDestination').value = route.destination;
      document.getElementById('recordDistance').value = route.distance;
    });

    // Submit
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const record = {
        id: generateId(),
        date: document.getElementById('recordDate').value,
        driver: document.getElementById('recordDriver').value,
        passengers: parseInt(document.getElementById('recordPassengers').value) || 1,
        purpose: document.getElementById('recordPurpose').value.trim(),
        pinned: document.getElementById('recordPinned').checked,
        departure: document.getElementById('recordDeparture').value.trim(),
        departureTime: document.getElementById('recordDepartureTime').value,
        waypoint: document.getElementById('recordWaypoint').value.trim(),
        waypointTime: document.getElementById('recordWaypointTime').value,
        destination: document.getElementById('recordDestination').value.trim(),
        destinationTime: document.getElementById('recordDestinationTime').value,
        distance: parseInt(document.getElementById('recordDistance').value) || 0,
        maintenance: document.getElementById('recordMaintenance').value.trim(),
      };

      records.push(record);
      save(KEYS.records, records);
      renderAll();
      showToast('✅ 운행기록이 추가되었습니다');

      // Reset form but keep date
      form.reset();
      document.getElementById('recordDate').value = today;
    });
  }

  // ===== Filter =====
  function initFilters() {
    document.getElementById('filterDriver').addEventListener('change', renderLogTable);
    document.getElementById('filterMonth').addEventListener('change', renderLogTable);
    document.getElementById('btnClearFilter').addEventListener('click', () => {
      document.getElementById('filterDriver').value = '';
      document.getElementById('filterMonth').value = '';
      renderLogTable();
    });
  }

  // ===== Settings Event Handlers =====
  function initSettings() {
    // Start odometer
    document.getElementById('btnSaveOdometer').addEventListener('click', () => {
      startOdometer = parseInt(document.getElementById('settingStartOdometer').value) || 0;
      save(KEYS.startOdometer, startOdometer);
      renderAll();
      showToast('✅ 시작 누적거리가 저장되었습니다');
    });

    // Driver add
    document.getElementById('btnAddDriver').addEventListener('click', () => {
      document.getElementById('inputDriverName').value = '';
      openModal('modalDriver');
      setTimeout(() => document.getElementById('inputDriverName').focus(), 100);
    });
    document.getElementById('btnConfirmDriver').addEventListener('click', () => {
      const name = document.getElementById('inputDriverName').value.trim();
      if (!name) return;
      if (drivers.includes(name)) {
        showToast('⚠️ 이미 등록된 운전자입니다');
        return;
      }
      drivers.push(name);
      save(KEYS.drivers, drivers);
      closeModal('modalDriver');
      renderAll();
      showToast('✅ 운전자가 추가되었습니다');
    });
    document.getElementById('inputDriverName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btnConfirmDriver').click();
      }
    });

    // Route add
    document.getElementById('btnAddRoute').addEventListener('click', () => {
      ['inputRouteName', 'inputRouteDeparture', 'inputRouteWaypoint', 'inputRouteDestination', 'inputRouteDistance']
        .forEach(id => document.getElementById(id).value = '');
      openModal('modalRoute');
      setTimeout(() => document.getElementById('inputRouteName').focus(), 100);
    });
    document.getElementById('btnConfirmRoute').addEventListener('click', () => {
      const name = document.getElementById('inputRouteName').value.trim();
      const departure = document.getElementById('inputRouteDeparture').value.trim();
      const destination = document.getElementById('inputRouteDestination').value.trim();
      const distance = parseInt(document.getElementById('inputRouteDistance').value) || 0;
      if (!name || !departure || !destination || !distance) {
        showToast('⚠️ 이름, 출발지, 도착지, 거리는 필수입니다');
        return;
      }
      routes.push({
        name,
        departure,
        waypoint: document.getElementById('inputRouteWaypoint').value.trim(),
        destination,
        distance,
      });
      save(KEYS.routes, routes);
      closeModal('modalRoute');
      renderAll();
      showToast('✅ 경로가 추가되었습니다');
    });

    // Purpose add
    document.getElementById('btnAddPurpose').addEventListener('click', () => {
      document.getElementById('inputPurposeName').value = '';
      openModal('modalPurpose');
      setTimeout(() => document.getElementById('inputPurposeName').focus(), 100);
    });
    document.getElementById('btnConfirmPurpose').addEventListener('click', () => {
      const name = document.getElementById('inputPurposeName').value.trim();
      if (!name) return;
      if (purposes.includes(name)) {
        showToast('⚠️ 이미 등록된 목적입니다');
        return;
      }
      purposes.push(name);
      save(KEYS.purposes, purposes);
      closeModal('modalPurpose');
      renderAll();
      showToast('✅ 목적이 추가되었습니다');
    });
    document.getElementById('inputPurposeName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btnConfirmPurpose').click();
      }
    });

    // Data management
    document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
    document.getElementById('btnImportJSON').addEventListener('click', () => {
      document.getElementById('fileImportJSON').click();
    });
    document.getElementById('fileImportJSON').addEventListener('change', importJSON);
    document.getElementById('btnClearAll').addEventListener('click', () => {
      if (confirm('정말로 모든 데이터를 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) {
        Object.values(KEYS).forEach(k => localStorage.removeItem(k));
        records = [];
        drivers = [...DEFAULT_DRIVERS];
        routes = [...DEFAULT_ROUTES];
        purposes = [...DEFAULT_PURPOSES];
        startOdometer = 0;
        save(KEYS.drivers, drivers);
        save(KEYS.routes, routes);
        save(KEYS.purposes, purposes);
        renderAll();
        showToast('🗑️ 전체 데이터가 초기화되었습니다');
      }
    });
  }

  // ===== Edit Record =====
  function editRecord(id) {
    const rec = records.find(r => r.id === id);
    if (!rec) return;

    document.getElementById('editRecordId').value = id;
    document.getElementById('editDate').value = rec.date;

    // Populate edit driver select
    const editDriverSel = document.getElementById('editDriver');
    editDriverSel.innerHTML = drivers.map(d => `<option value="${d}">${d}</option>`).join('');
    editDriverSel.value = rec.driver;

    document.getElementById('editPassengers').value = rec.passengers;
    document.getElementById('editPurpose').value = rec.purpose;
    document.getElementById('editPinned').checked = rec.pinned;
    document.getElementById('editDeparture').value = rec.departure;
    document.getElementById('editDepartureTime').value = rec.departureTime;
    document.getElementById('editWaypoint').value = rec.waypoint || '';
    document.getElementById('editWaypointTime').value = rec.waypointTime || '';
    document.getElementById('editDestination').value = rec.destination;
    document.getElementById('editDestinationTime').value = rec.destinationTime;
    document.getElementById('editDistance').value = rec.distance;
    document.getElementById('editMaintenance').value = rec.maintenance || '';

    openModal('modalEdit');
  }

  document.getElementById('btnConfirmEdit').addEventListener('click', () => {
    const id = document.getElementById('editRecordId').value;
    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return;

    records[idx] = {
      ...records[idx],
      date: document.getElementById('editDate').value,
      driver: document.getElementById('editDriver').value,
      passengers: parseInt(document.getElementById('editPassengers').value) || 1,
      purpose: document.getElementById('editPurpose').value.trim(),
      pinned: document.getElementById('editPinned').checked,
      departure: document.getElementById('editDeparture').value.trim(),
      departureTime: document.getElementById('editDepartureTime').value,
      waypoint: document.getElementById('editWaypoint').value.trim(),
      waypointTime: document.getElementById('editWaypointTime').value,
      destination: document.getElementById('editDestination').value.trim(),
      destinationTime: document.getElementById('editDestinationTime').value,
      distance: parseInt(document.getElementById('editDistance').value) || 0,
      maintenance: document.getElementById('editMaintenance').value.trim(),
    };

    save(KEYS.records, records);
    closeModal('modalEdit');
    renderAll();
    showToast('✅ 기록이 수정되었습니다');
  });

  // ===== Delete Record =====
  function deleteRecord(id) {
    if (!confirm('이 기록을 삭제하시겠습니까?')) return;
    records = records.filter(r => r.id !== id);
    save(KEYS.records, records);
    renderAll();
    showToast('🗑️ 기록이 삭제되었습니다');
  }

  // ===== Delete Settings Items =====
  function deleteDriver(idx) {
    if (!confirm(`"${drivers[idx]}" 운전자를 삭제하시겠습니까?`)) return;
    drivers.splice(idx, 1);
    save(KEYS.drivers, drivers);
    renderAll();
    showToast('🗑️ 운전자가 삭제되었습니다');
  }

  function deleteRoute(idx) {
    if (!confirm(`"${routes[idx].name}" 경로를 삭제하시겠습니까?`)) return;
    routes.splice(idx, 1);
    save(KEYS.routes, routes);
    renderAll();
    showToast('🗑️ 경로가 삭제되었습니다');
  }

  function deletePurpose(idx) {
    if (!confirm(`"${purposes[idx]}" 목적을 삭제하시겠습니까?`)) return;
    purposes.splice(idx, 1);
    save(KEYS.purposes, purposes);
    renderAll();
    showToast('🗑️ 목적이 삭제되었습니다');
  }

  // ===== Excel Export =====
  function exportExcel() {
    const withCum = getRecordsWithCumulative();
    if (withCum.length === 0) {
      showToast('⚠️ 내보낼 기록이 없습니다');
      return;
    }

    const data = withCum.map(r => ({
      '운행일자': r.date,
      '사용자(운전자)': r.driver,
      '탑승인원': r.passengers,
      '사용목적': r.purpose,
      '출발지': r.departure,
      '출발시간': r.departureTime || '',
      '경유지': r.waypoint || '',
      '경유시간': r.waypointTime || '',
      '도착지': r.destination,
      '도착시간': r.destinationTime || '',
      '출발(km)': r.startKm,
      '도착(km)': r.endKm,
      '주행거리(km)': r.distance,
      '차량정비/주유내역': r.maintenance || '',
      '고정기록': r.pinned ? '📌' : '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);

    // Column widths
    ws['!cols'] = [
      { wch: 12 }, // 운행일자
      { wch: 12 }, // 운전자
      { wch: 6 },  // 탑승인원
      { wch: 20 }, // 사용목적
      { wch: 14 }, // 출발지
      { wch: 8 },  // 출발시간
      { wch: 14 }, // 경유지
      { wch: 8 },  // 경유시간
      { wch: 14 }, // 도착지
      { wch: 8 },  // 도착시간
      { wch: 10 }, // 출발km
      { wch: 10 }, // 도착km
      { wch: 10 }, // 주행거리
      { wch: 18 }, // 정비
      { wch: 6 },  // 고정
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '차량운행일지');

    const now = new Date();
    const filename = `차량운행일지_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.xlsx`;
    XLSX.writeFile(wb, filename);
    showToast('📥 엑셀 파일이 다운로드되었습니다');
  }

  // ===== JSON Export / Import =====
  function exportJSON() {
    const data = {
      records,
      drivers,
      routes,
      purposes,
      startOdometer,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `차량운행기록_백업_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('💾 데이터 백업이 다운로드되었습니다');
  }

  function importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!confirm(`${data.records?.length || 0}건의 기록을 포함한 백업을 복원하시겠습니까?\n기존 데이터가 덮어씌워집니다.`)) return;

        if (data.records) { records = data.records; save(KEYS.records, records); }
        if (data.drivers) { drivers = data.drivers; save(KEYS.drivers, drivers); }
        if (data.routes) { routes = data.routes; save(KEYS.routes, routes); }
        if (data.purposes) { purposes = data.purposes; save(KEYS.purposes, purposes); }
        if (data.startOdometer !== undefined) { startOdometer = data.startOdometer; save(KEYS.startOdometer, startOdometer); }

        renderAll();
        showToast('📂 데이터가 복원되었습니다');
      } catch (err) {
        showToast('❌ 파일 형식이 올바르지 않습니다');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ===== Excel Button =====
  document.getElementById('btnExportExcel').addEventListener('click', exportExcel);

  // ===== Initialize =====
  function init() {
    initTabs();
    initModals();
    initRecordForm();
    initFilters();
    initSettings();
    renderAll();
  }

  // ===== Expose to global for inline handlers =====
  window.app = {
    editRecord,
    deleteRecord,
    deleteDriver,
    deleteRoute,
    deletePurpose,
  };

  // Run
  document.addEventListener('DOMContentLoaded', init);

  // If DOM already loaded
  if (document.readyState !== 'loading') {
    init();
  }
})();
