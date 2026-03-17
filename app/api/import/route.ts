import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';

function excelDateToStr(serial: number): string {
  const utcDays = Math.floor(serial - 25569);
  const d = new Date(utcDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parseDate(raw: any): string {
  if (!raw && raw !== 0) return '';
  if (typeof raw === 'number' && raw > 30000 && raw < 60000) return excelDateToStr(raw);
  const s = String(raw).trim();
  const m = s.match(/(\d{4})[-./\s](\d{1,2})[-./\s](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}

function parsePlaceTime(val: any): [string, string] {
  if (!val && val !== 0) return ['', ''];
  const s = String(val).trim();
  const lines = s.split(/\n|\r\n?/);
  return [lines[0]?.trim() || '', lines[1]?.trim() || ''];
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];

    if (!ws['!ref']) {
      return NextResponse.json({ error: '빈 엑셀 파일입니다. 데이터가 있는 파일을 업로드해주세요.' }, { status: 400 });
    }

    const range = XLSX.utils.decode_range(ws['!ref']);
    const maxRow = range.e.r;
    const maxCol = range.e.c;

    // Helper: read cell
    const cv = (r: number, c: number): any => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      return cell ? (cell.v !== undefined ? cell.v : '') : '';
    };
    const cs = (r: number, c: number): string => String(cv(r, c) || '').replace(/\n/g, ' ').trim();

    console.log('Import: ref=', ws['!ref'], 'rows=', maxRow + 1, 'cols=', maxCol + 1);

    // Find header row
    let headerRow = -1;
    for (let r = 0; r <= Math.min(maxRow, 15); r++) {
      for (let c = 0; c <= maxCol; c++) {
        const v = cs(r, c);
        if (v.includes('운행일자') || v === '일자' || v === '날짜') {
          headerRow = r;
          break;
        }
      }
      if (headerRow >= 0) break;
    }

    // Check merges
    if (headerRow < 0 && ws['!merges']) {
      for (const m of ws['!merges']) {
        const v = cs(m.s.r, m.s.c);
        if (v.includes('운행일자')) { headerRow = m.s.r; break; }
      }
    }

    // Build column map
    let colMap: Record<string, number> = {};
    let dataStartRow = -1;

    if (headerRow >= 0) {
      // Read header cells (accounting for merges)
      const hdrs: string[] = [];
      for (let c = 0; c <= maxCol; c++) {
        let v = cs(headerRow, c);
        if (!v && ws['!merges']) {
          for (const m of ws['!merges']) {
            if (headerRow >= m.s.r && headerRow <= m.e.r && c >= m.s.c && c <= m.e.c) {
              v = cs(m.s.r, m.s.c);
              break;
            }
          }
        }
        hdrs.push(v);
      }

      console.log('Import: headers=', hdrs);

      for (let c = 0; c < hdrs.length; c++) {
        const h = hdrs[c];
        if (h.includes('운행일자') || h === '일자') colMap['date'] = c;
        else if (h.includes('사용자') || h.includes('운전자')) colMap['driver'] = c;
        else if (h.includes('탑승')) colMap['passengers'] = c;
        else if (h.includes('목적')) colMap['purpose'] = c;
        else if (h.includes('출발지')) colMap['departure'] = c;
        else if (h.includes('경유지')) colMap['waypoint'] = c;
        else if (h.includes('도착지')) colMap['destination'] = c;
        else if (h.includes('운행거리')) colMap['distArea'] = c;
        else if (h.includes('정비') || h.includes('주유')) colMap['maintenance'] = c;
      }

      // Check sub-header row
      const sr = headerRow + 1;
      let hasSub = false;
      if (sr <= maxRow) {
        for (let c = 0; c <= maxCol; c++) {
          const h = cs(sr, c);
          if (h === '출발' && !colMap['startKm']) { colMap['startKm'] = c; hasSub = true; }
          else if (h === '도착' && !colMap['endKm']) { colMap['endKm'] = c; hasSub = true; }
          else if (h.includes('주행')) { colMap['distance'] = c; hasSub = true; }
        }
      }
      dataStartRow = hasSub ? sr + 1 : headerRow + 1;
    } else {
      // Fallback: find first row with date
      for (let r = 0; r <= maxRow; r++) {
        if (parseDate(cv(r, 0))) {
          dataStartRow = r;
          colMap = { date: 0, driver: 1, passengers: 2, purpose: 3, departure: 4, waypoint: 5, destination: 6, startKm: 7, endKm: 8, distance: 9, maintenance: 10 };
          break;
        }
      }
    }

    console.log('Import: dataStart=', dataStartRow, 'colMap=', colMap);

    if (dataStartRow < 0) {
      return NextResponse.json({ error: '엑셀 양식을 인식할 수 없습니다.' }, { status: 400 });
    }

    // Parse data
    const imported: any[] = [];
    let skipped = 0;

    for (let r = dataStartRow; r <= maxRow; r++) {
      try {
        const date = parseDate(cv(r, colMap['date'] ?? 0));
        if (!date) continue;

        const driver = cs(r, colMap['driver'] ?? 1);
        if (!driver) { skipped++; continue; }

        const passengers = parseInt(String(cv(r, colMap['passengers'] ?? 2))) || 1;
        const purpose = cs(r, colMap['purpose'] ?? 3) || '업무';

        const [dep, depT] = parsePlaceTime(cv(r, colMap['departure'] ?? 4));
        const [wp, wpT] = parsePlaceTime(cv(r, colMap['waypoint'] ?? 5));
        const [dest, destT] = parsePlaceTime(cv(r, colMap['destination'] ?? 6));

        if (!dep && !dest) { skipped++; continue; }

        let dist = 0;
        if (colMap['distance'] !== undefined) {
          dist = parseInt(String(cv(r, colMap['distance']))) || 0;
        } else if (colMap['startKm'] !== undefined && colMap['endKm'] !== undefined) {
          const sk = parseInt(String(cv(r, colMap['startKm']))) || 0;
          const ek = parseInt(String(cv(r, colMap['endKm']))) || 0;
          dist = ek - sk;
        }

        const maint = colMap['maintenance'] !== undefined ? cs(r, colMap['maintenance']) : '';

        imported.push({
          date, driver, passengers, purpose,
          departure: dep || '미입력', departureTime: depT,
          waypoint: wp, waypointTime: wpT,
          destination: dest || '미입력', destinationTime: destT,
          distance: Math.abs(dist), maintenance: maint,
        });
      } catch { skipped++; }
    }

    console.log('Import: parsed=', imported.length, 'skipped=', skipped);

    if (imported.length === 0) {
      return NextResponse.json({ error: `가져올 데이터가 없습니다. (${skipped}건 건너뜀)` }, { status: 400 });
    }

    let saved = 0;
    for (const rec of imported) {
      try {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        await db.execute({
          sql: `INSERT INTO records (id, date, driver, passengers, purpose, pinned, departure, departure_time, waypoint, waypoint_time, destination, destination_time, distance, maintenance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [id, rec.date, rec.driver, rec.passengers, rec.purpose, 0, rec.departure, rec.departureTime, rec.waypoint, rec.waypointTime, rec.destination, rec.destinationTime, rec.distance, rec.maintenance],
        });
        saved++;
        await new Promise(resolve => setTimeout(resolve, 3));
      } catch (e) { console.error('Import DB err:', e); }
    }

    return NextResponse.json({ ok: true, count: saved, skipped });
  } catch (error) {
    console.error('Import fatal:', error);
    return NextResponse.json({ error: `파일 처리 오류: ${error instanceof Error ? error.message : '알 수 없음'}` }, { status: 500 });
  }
}
