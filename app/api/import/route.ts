import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import XLSX from 'xlsx-js-style';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Find header row (look for '운행일자' in first few rows)
    let headerIdx = -1;
    let colMap: Record<string, number> = {};
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i].map((c: any) => String(c || '').trim());
      const dateCol = row.findIndex((c: string) => c.includes('운행일자'));
      if (dateCol >= 0) {
        headerIdx = i;
        // Map column positions
        for (let j = 0; j < row.length; j++) {
          const h = row[j];
          if (h.includes('운행일자')) colMap['date'] = j;
          else if (h.includes('사용자') || h.includes('운전자')) colMap['driver'] = j;
          else if (h.includes('탑승')) colMap['passengers'] = j;
          else if (h.includes('목적')) colMap['purpose'] = j;
          else if (h.includes('출발지') || h.includes('출발')) {
            if (!colMap['departure']) colMap['departure'] = j;
          }
          else if (h.includes('경유지') || h.includes('경유')) colMap['waypoint'] = j;
          else if (h.includes('도착지') || h.includes('도착')) {
            if (!colMap['destination']) colMap['destination'] = j;
          }
          else if (h.includes('정비') || h.includes('주유')) colMap['maintenance'] = j;
        }
        break;
      }
    }

    // Check if there's a sub-header row (for distance columns)
    if (headerIdx >= 0 && headerIdx + 1 < rows.length) {
      const subRow = rows[headerIdx + 1].map((c: any) => String(c || '').trim());
      for (let j = 0; j < subRow.length; j++) {
        const h = subRow[j];
        if (h === '출발' && !colMap['startKm']) colMap['startKm'] = j;
        else if (h === '도착' && !colMap['endKm']) colMap['endKm'] = j;
        else if (h.includes('주행')) colMap['distance'] = j;
      }
      // If sub-headers found, data starts after sub-header
      if (colMap['startKm'] !== undefined) headerIdx++;
    }

    // Also try to find distance columns in main header
    if (colMap['distance'] === undefined) {
      const row = rows[headerIdx >= 0 ? headerIdx : 0].map((c: any) => String(c || '').trim());
      for (let j = 0; j < row.length; j++) {
        const h = row[j];
        if (h.includes('주행거리') || h.includes('주행')) colMap['distance'] = j;
      }
    }

    if (headerIdx < 0) {
      return NextResponse.json({ error: '엑셀 양식을 인식할 수 없습니다. "운행일자" 열이 필요합니다.' }, { status: 400 });
    }

    // Parse data rows
    const imported: any[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const dateRaw = row[colMap['date']];
      if (!dateRaw) continue;

      // Parse date (handle various formats)
      let date = '';
      if (typeof dateRaw === 'number') {
        // Excel serial date
        const d = XLSX.SSF.parse_date_code(dateRaw);
        date = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      } else {
        const ds = String(dateRaw).trim();
        // Try YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD
        const m = ds.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
        if (m) date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
        else continue;
      }

      const driver = String(row[colMap['driver']] || '').trim();
      if (!driver) continue;

      const passengers = parseInt(row[colMap['passengers']]) || 1;
      const purpose = String(row[colMap['purpose']] || '').trim();

      // Parse departure/waypoint/destination (may contain time on newline)
      const parsePlaceTime = (val: any): [string, string] => {
        const s = String(val || '').trim();
        const lines = s.split(/\n|\r\n?/);
        const place = lines[0]?.trim() || '';
        const time = lines[1]?.trim() || '';
        return [place, time];
      };

      const [departure, departureTime] = parsePlaceTime(row[colMap['departure']]);
      const [waypoint, waypointTime] = parsePlaceTime(row[colMap['waypoint']]);
      const [destination, destinationTime] = parsePlaceTime(row[colMap['destination']]);

      let distance = 0;
      if (colMap['distance'] !== undefined) {
        distance = parseInt(row[colMap['distance']]) || 0;
      } else if (colMap['startKm'] !== undefined && colMap['endKm'] !== undefined) {
        const sk = parseInt(row[colMap['startKm']]) || 0;
        const ek = parseInt(row[colMap['endKm']]) || 0;
        distance = ek - sk;
      }

      const maintenance = colMap['maintenance'] !== undefined ? String(row[colMap['maintenance']] || '').trim() : '';

      if (!departure || !destination) continue;

      imported.push({
        date, driver, passengers, purpose: purpose || '업무',
        departure, departureTime, waypoint, waypointTime,
        destination, destinationTime, distance: Math.abs(distance),
        maintenance, pinned: false,
      });
    }

    if (imported.length === 0) {
      return NextResponse.json({ error: '가져올 데이터가 없습니다. 양식을 확인해주세요.' }, { status: 400 });
    }

    // Save to DB
    for (const r of imported) {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      await db.execute({
        sql: `INSERT INTO records (id, date, driver, passengers, purpose, pinned, departure, departure_time, waypoint, waypoint_time, destination, destination_time, distance, maintenance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, r.date, r.driver, r.passengers, r.purpose, 0, r.departure, r.departureTime, r.waypoint, r.waypointTime, r.destination, r.destinationTime, r.distance, r.maintenance],
      });
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    return NextResponse.json({ ok: true, count: imported.length });
  } catch (error) {
    console.error('Import error:', error);
    return NextResponse.json({ error: '파일 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
