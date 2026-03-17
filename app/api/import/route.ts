import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import XLSX from 'xlsx-js-style';

export const runtime = 'nodejs';

// Convert Excel serial date to YYYY-MM-DD
function excelDateToStr(serial: number): string {
  const utcDays = Math.floor(serial - 25569);
  const d = new Date(utcDays * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parseDate(raw: any): string {
  if (!raw && raw !== 0) return '';
  if (typeof raw === 'number' && raw > 40000 && raw < 60000) return excelDateToStr(raw);
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

// Read cell value from worksheet directly
function cellVal(ws: any, r: number, c: number): any {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = ws[addr];
  return cell ? (cell.v !== undefined ? cell.v : '') : '';
}

// Get cell as string
function cellStr(ws: any, r: number, c: number): string {
  return String(cellVal(ws, r, c) || '').trim();
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: '파일이 없습니다' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // Get worksheet range
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:L1');
    const maxRow = range.e.r;
    const maxCol = range.e.c;

    console.log('Import: range', `R0:C0 ~ R${maxRow}:C${maxCol}`);

    // Strategy 1: Find header row by scanning for '운행일자' cell
    // Strategy 2: Find first row with a date-like value in column A
    let headerRow = -1;
    let dataStartRow = -1;
    let colMap: Record<string, number> = {};

    // Scan all rows in first 15 lines to find header
    for (let r = 0; r <= Math.min(maxRow, 15); r++) {
      for (let c = 0; c <= maxCol; c++) {
        const v = cellStr(ws, r, c);
        if (v.includes('운행일자') || v === '일자' || v === '날짜') {
          headerRow = r;
          break;
        }
      }
      if (headerRow >= 0) break;
    }

    // If still not found, try merges - merged cells have the value in the top-left cell only
    if (headerRow < 0 && ws['!merges']) {
      for (const merge of ws['!merges']) {
        const v = cellStr(ws, merge.s.r, merge.s.c);
        if (v.includes('운행일자')) {
          headerRow = merge.s.r;
          break;
        }
      }
    }

    console.log('Import: headerRow =', headerRow);

    if (headerRow >= 0) {
      // Read all header cells in this row, including merged cell values
      const headerCells: string[] = [];
      for (let c = 0; c <= maxCol; c++) {
        let v = cellStr(ws, headerRow, c);
        // If cell is empty, check if it's covered by a merge from a previous row or column
        if (!v && ws['!merges']) {
          for (const m of ws['!merges']) {
            if (headerRow >= m.s.r && headerRow <= m.e.r && c >= m.s.c && c <= m.e.c) {
              v = cellStr(ws, m.s.r, m.s.c);
              break;
            }
          }
        }
        headerCells.push(v.replace(/\n/g, ' '));
      }

      console.log('Import: headerCells =', headerCells);

      // Map columns
      for (let c = 0; c < headerCells.length; c++) {
        const h = headerCells[c];
        if (h.includes('운행일자') || h === '일자' || h === '날짜') colMap['date'] = c;
        else if (h.includes('사용자') || h.includes('운전자')) colMap['driver'] = c;
        else if (h.includes('탑승')) colMap['passengers'] = c;
        else if (h.includes('목적')) colMap['purpose'] = c;
        else if (h.includes('출발지')) colMap['departure'] = c;
        else if (h.includes('경유지')) colMap['waypoint'] = c;
        else if (h.includes('도착지')) colMap['destination'] = c;
        else if (h.includes('운행거리')) colMap['distArea'] = c;
        else if (h.includes('정비') || h.includes('주유')) colMap['maintenance'] = c;
        else if (h.includes('관리자')) colMap['admin'] = c;
      }

      // Check sub-header row for distance columns
      const subRow = headerRow + 1;
      if (subRow <= maxRow) {
        const subCells: string[] = [];
        for (let c = 0; c <= maxCol; c++) {
          subCells.push(cellStr(ws, subRow, c));
        }
        console.log('Import: subRow cells =', subCells);

        let hasSubHeaders = false;
        for (let c = 0; c < subCells.length; c++) {
          const h = subCells[c];
          if (h === '출발' && colMap['startKm'] === undefined) { colMap['startKm'] = c; hasSubHeaders = true; }
          else if (h === '도착' && colMap['endKm'] === undefined) { colMap['endKm'] = c; hasSubHeaders = true; }
          else if (h.includes('주행')) { colMap['distance'] = c; hasSubHeaders = true; }
        }

        dataStartRow = hasSubHeaders ? subRow + 1 : headerRow + 1;
      } else {
        dataStartRow = headerRow + 1;
      }
    }

    // Fallback strategy: no header found, assume dates start from first data-like row
    if (headerRow < 0) {
      console.log('Import: no header found, trying fallback strategy');
      // Look for first row with a date-like value
      for (let r = 0; r <= maxRow; r++) {
        const v = cellVal(ws, r, 0);
        const dateStr = parseDate(v);
        if (dateStr) {
          dataStartRow = r;
          // Assume standard column order
          colMap = { date: 0, driver: 1, passengers: 2, purpose: 3, departure: 4, waypoint: 5, destination: 6, startKm: 7, endKm: 8, distance: 9, maintenance: 10 };
          break;
        }
      }
    }

    console.log('Import: dataStartRow =', dataStartRow, 'colMap =', colMap);

    if (dataStartRow < 0) {
      return NextResponse.json({
        error: '엑셀 양식을 인식할 수 없습니다. "운행일자" 헤더 또는 날짜 데이터를 찾을 수 없습니다.',
      }, { status: 400 });
    }

    // Parse data rows
    const imported: any[] = [];
    let parseErrors = 0;

    for (let r = dataStartRow; r <= maxRow; r++) {
      try {
        // Read date
        const dateCol = colMap['date'] ?? 0;
        const dateRaw = cellVal(ws, r, dateCol);
        const date = parseDate(dateRaw);
        if (!date) continue; // Skip rows without valid date

        // Read driver
        const driverCol = colMap['driver'] ?? 1;
        const driver = cellStr(ws, r, driverCol);
        if (!driver) { parseErrors++; continue; }

        // Read other fields
        const passCol = colMap['passengers'] ?? 2;
        const passengers = parseInt(String(cellVal(ws, r, passCol))) || 1;

        const purposeCol = colMap['purpose'] ?? 3;
        const purpose = cellStr(ws, r, purposeCol) || '업무';

        const depCol = colMap['departure'] ?? 4;
        const [departure, departureTime] = parsePlaceTime(cellVal(ws, r, depCol));

        const wpCol = colMap['waypoint'] ?? 5;
        const [waypoint, waypointTime] = parsePlaceTime(cellVal(ws, r, wpCol));

        const destCol = colMap['destination'] ?? 6;
        const [destination, destinationTime] = parsePlaceTime(cellVal(ws, r, destCol));

        if (!departure && !destination) { parseErrors++; continue; }

        // Distance
        let distance = 0;
        if (colMap['distance'] !== undefined) {
          distance = parseInt(String(cellVal(ws, r, colMap['distance']))) || 0;
        } else if (colMap['startKm'] !== undefined && colMap['endKm'] !== undefined) {
          const sk = parseInt(String(cellVal(ws, r, colMap['startKm']))) || 0;
          const ek = parseInt(String(cellVal(ws, r, colMap['endKm']))) || 0;
          distance = ek - sk;
        }

        const maintCol = colMap['maintenance'] ?? 10;
        const maintenance = cellStr(ws, r, maintCol);

        imported.push({
          date, driver, passengers, purpose,
          departure: departure || '미입력', departureTime,
          waypoint, waypointTime,
          destination: destination || '미입력', destinationTime,
          distance: Math.abs(distance), maintenance, pinned: false,
        });
      } catch (err) {
        parseErrors++;
        console.error('Import row error at R' + r, err);
      }
    }

    console.log('Import: parsed', imported.length, 'records,', parseErrors, 'errors');

    if (imported.length === 0) {
      return NextResponse.json({
        error: `가져올 데이터가 없습니다. (${parseErrors}건 파싱 실패)`,
      }, { status: 400 });
    }

    // Save to DB
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
      } catch (dbErr) {
        console.error('Import DB error:', dbErr);
      }
    }

    return NextResponse.json({ ok: true, count: saved, parseErrors });
  } catch (error) {
    console.error('Import fatal error:', error);
    const msg = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ error: `파일 처리 오류: ${msg}` }, { status: 500 });
  }
}
