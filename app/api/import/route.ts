import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import XLSX from 'xlsx-js-style';

// Convert Excel serial date to YYYY-MM-DD
function excelDateToStr(serial: number): string {
  const utcDays = Math.floor(serial - 25569);
  const d = new Date(utcDays * 86400000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parse date from various formats
function parseDate(raw: any): string {
  if (!raw && raw !== 0) return '';
  if (typeof raw === 'number') {
    return excelDateToStr(raw);
  }
  const s = String(raw).trim();
  // YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD
  const m = s.match(/(\d{4})[-./\s](\d{1,2})[-./\s](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return '';
}

// Parse place + time from a cell (may have newline separator)
function parsePlaceTime(val: any): [string, string] {
  if (!val && val !== 0) return ['', ''];
  const s = String(val).trim();
  const lines = s.split(/\n|\r\n?/);
  const place = lines[0]?.trim() || '';
  const time = lines[1]?.trim() || '';
  return [place, time];
}

// Try to find column index by checking if header contains any of the keywords
function findCol(headers: string[], ...keywords: string[]): number {
  for (const kw of keywords) {
    const idx = headers.findIndex(h => h.includes(kw));
    if (idx >= 0) return idx;
  }
  return -1;
}

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 });
    }

    console.log('Import: reading file', file.name, file.size, 'bytes');

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

    console.log('Import: total rows:', allRows.length);

    // Find the header row containing '운행일자'
    let headerRowIdx = -1;
    let headers: string[] = [];

    for (let i = 0; i < Math.min(allRows.length, 15); i++) {
      const row = allRows[i];
      if (!row) continue;
      const strs = row.map((c: any) => String(c || '').replace(/\n/g, ' ').trim());
      if (strs.some(s => s.includes('운행일자'))) {
        headerRowIdx = i;
        headers = strs;
        break;
      }
    }

    if (headerRowIdx < 0) {
      console.log('Import: header not found. First 5 rows:', allRows.slice(0, 5));
      return NextResponse.json({
        error: '엑셀 양식을 인식할 수 없습니다. "운행일자" 열을 찾을 수 없습니다.',
      }, { status: 400 });
    }

    console.log('Import: header found at row', headerRowIdx, headers);

    // Build column map
    const colDate = findCol(headers, '운행일자');
    const colDriver = findCol(headers, '사용자', '운전자');
    const colPassengers = findCol(headers, '탑승');
    const colPurpose = findCol(headers, '목적');
    const colDeparture = findCol(headers, '출발지');
    const colWaypoint = findCol(headers, '경유지');
    const colDestination = findCol(headers, '도착지');
    const colMaintenance = findCol(headers, '정비', '주유');

    // Distance columns - check sub-header row for "출발", "도착", "주행거리"
    let colStartKm = -1;
    let colEndKm = -1;
    let colDistance = -1;

    // Check if "운행거리" is in the main header (merged cell spanning multiple columns)
    const distHeaderIdx = findCol(headers, '운행거리');

    if (distHeaderIdx >= 0) {
      // Look for sub-headers in the next row
      const subRowIdx = headerRowIdx + 1;
      if (subRowIdx < allRows.length) {
        const subRow = allRows[subRowIdx].map((c: any) => String(c || '').trim());
        console.log('Import: sub-header row:', subRow);

        // Search around the distance header area for sub-headers
        for (let j = Math.max(0, distHeaderIdx - 1); j < Math.min(subRow.length, distHeaderIdx + 5); j++) {
          const h = subRow[j];
          if (h === '출발' && colStartKm < 0) colStartKm = j;
          else if (h === '도착' && colEndKm < 0) colEndKm = j;
          else if (h.includes('주행')) colDistance = j;
        }

        // If we found sub-headers, data starts after sub-header row
        if (colStartKm >= 0 || colDistance >= 0) {
          headerRowIdx = subRowIdx;
        }
      }
    }

    // Fallback: look for distance in main headers
    if (colDistance < 0 && colStartKm < 0) {
      colDistance = findCol(headers, '주행거리', '주행');
      if (colDistance < 0) {
        // Try to find by "출발" and "도착" that look like km columns
        for (let j = 0; j < headers.length; j++) {
          if (headers[j] === '출발' && colStartKm < 0) colStartKm = j;
          else if (headers[j] === '도착' && colEndKm < 0) colEndKm = j;
        }
      }
    }

    console.log('Import: colMap:', {
      date: colDate, driver: colDriver, passengers: colPassengers,
      purpose: colPurpose, departure: colDeparture, waypoint: colWaypoint,
      destination: colDestination, startKm: colStartKm, endKm: colEndKm,
      distance: colDistance, maintenance: colMaintenance,
    });

    if (colDate < 0) {
      return NextResponse.json({ error: '운행일자 열을 찾을 수 없습니다.' }, { status: 400 });
    }

    // Parse data rows
    const imported: any[] = [];
    let parseErrors = 0;

    for (let i = headerRowIdx + 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row || row.length === 0 || row.every((c: any) => !c && c !== 0)) continue;

      try {
        // Parse date
        const date = parseDate(row[colDate]);
        if (!date) { parseErrors++; continue; }

        // Parse driver
        const driver = colDriver >= 0 ? String(row[colDriver] || '').trim() : '';
        if (!driver) { parseErrors++; continue; }

        // Parse other fields
        const passengers = colPassengers >= 0 ? (parseInt(String(row[colPassengers])) || 1) : 1;
        const purpose = colPurpose >= 0 ? String(row[colPurpose] || '').trim() : '업무';

        const [departure, departureTime] = colDeparture >= 0 ? parsePlaceTime(row[colDeparture]) : ['', ''];
        const [waypoint, waypointTime] = colWaypoint >= 0 ? parsePlaceTime(row[colWaypoint]) : ['', ''];
        const [destination, destinationTime] = colDestination >= 0 ? parsePlaceTime(row[colDestination]) : ['', ''];

        if (!departure && !destination) { parseErrors++; continue; }

        // Parse distance
        let distance = 0;
        if (colDistance >= 0) {
          distance = parseInt(String(row[colDistance])) || 0;
        } else if (colStartKm >= 0 && colEndKm >= 0) {
          const sk = parseInt(String(row[colStartKm])) || 0;
          const ek = parseInt(String(row[colEndKm])) || 0;
          distance = ek - sk;
        }

        const maintenance = colMaintenance >= 0 ? String(row[colMaintenance] || '').trim() : '';

        imported.push({
          date, driver, passengers, purpose: purpose || '업무',
          departure: departure || '미입력', departureTime,
          waypoint, waypointTime,
          destination: destination || '미입력', destinationTime,
          distance: Math.abs(distance),
          maintenance, pinned: false,
        });
      } catch (rowErr) {
        parseErrors++;
        console.error('Import: row parse error at row', i, rowErr);
      }
    }

    console.log('Import: parsed', imported.length, 'records,', parseErrors, 'errors');

    if (imported.length === 0) {
      return NextResponse.json({
        error: `가져올 데이터가 없습니다. (${parseErrors}건 파싱 실패) 양식을 확인해주세요.`,
      }, { status: 400 });
    }

    // Save to DB
    let savedCount = 0;
    for (const r of imported) {
      try {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        await db.execute({
          sql: `INSERT INTO records (id, date, driver, passengers, purpose, pinned, departure, departure_time, waypoint, waypoint_time, destination, destination_time, distance, maintenance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [id, r.date, r.driver, r.passengers, r.purpose, 0, r.departure, r.departureTime, r.waypoint, r.waypointTime, r.destination, r.destinationTime, r.distance, r.maintenance],
        });
        savedCount++;
        await new Promise(resolve => setTimeout(resolve, 5));
      } catch (dbErr) {
        console.error('Import: DB save error:', dbErr);
      }
    }

    return NextResponse.json({
      ok: true,
      count: savedCount,
      parseErrors,
      message: parseErrors > 0 ? `${savedCount}건 저장, ${parseErrors}건 파싱 실패` : undefined,
    });
  } catch (error) {
    console.error('Import error:', error);
    const msg = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `파일 처리 중 오류: ${msg}` }, { status: 500 });
  }
}
