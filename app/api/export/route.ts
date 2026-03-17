import { NextResponse } from 'next/server';
import db from '@/lib/db';
import XLSX from 'xlsx-js-style';

const thin = { style: 'thin', color: { rgb: '000000' } };
const border = { top: thin, bottom: thin, left: thin, right: thin };

const headerStyle = {
  font: { bold: true, sz: 9, name: '맑은 고딕' },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border,
  fill: { fgColor: { rgb: 'F2F2F2' } },
};

const titleStyle = {
  font: { bold: true, sz: 16, name: '맑은 고딕' },
  alignment: { horizontal: 'center', vertical: 'center' },
};

const cellStyle = {
  font: { sz: 9, name: '맑은 고딕' },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border,
};

const cellStyleLeft = {
  ...cellStyle,
  alignment: { ...cellStyle.alignment, horizontal: 'left' },
};

const cellStyleNum = {
  ...cellStyle,
  alignment: { ...cellStyle.alignment, horizontal: 'right' },
  numFmt: '#,##0',
};

const pinnedRowStyle = {
  font: { sz: 9, name: '맑은 고딕', bold: true },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border,
  fill: { fgColor: { rgb: 'FFFDE7' } },
};

export async function GET() {
  try {
    const [recordsRes, settingsRes] = await Promise.all([
      db.execute('SELECT * FROM records ORDER BY date ASC, departure_time ASC'),
      db.execute('SELECT * FROM settings'),
    ]);

    const records = recordsRes.rows;
    const startOdometer = parseInt(
      (settingsRes.rows.find(s => s.key === 'start_odometer')?.value as string) || '0'
    );

    // Build worksheet data
    const wsData: any[][] = [];

    // Row 0: Title (merged across all columns)
    wsData.push([
      { v: '차량운행 및 정비일지', s: titleStyle },
      '', '', '', '', '', '', '', '', '', '', '',
    ]);

    // Row 1: Empty (for spacing)
    wsData.push([]);

    // Row 2: Header row 1 (merged cells)
    wsData.push([
      { v: '운행일자', s: headerStyle },
      { v: '사용자\n(운전자)', s: headerStyle },
      { v: '탑승\n인원', s: headerStyle },
      { v: '사용\n목적', s: headerStyle },
      { v: '출발지\n(시간)', s: headerStyle },
      { v: '경유지\n(시간)', s: headerStyle },
      { v: '도착지\n(시간)', s: headerStyle },
      { v: '운행거리(km)', s: headerStyle },
      '', '',
      { v: '차량정비\n주유내역', s: headerStyle },
      { v: '관리자\n확인', s: headerStyle },
    ]);

    // Row 3: Header row 2 (sub-headers for 운행거리)
    wsData.push([
      { v: '', s: headerStyle },
      { v: '', s: headerStyle },
      { v: '', s: headerStyle },
      { v: '', s: headerStyle },
      { v: '', s: headerStyle },
      { v: '', s: headerStyle },
      { v: '', s: headerStyle },
      { v: '출발', s: headerStyle },
      { v: '도착', s: headerStyle },
      { v: '주행거리', s: headerStyle },
      { v: '', s: headerStyle },
      { v: '', s: headerStyle },
    ]);

    // Data rows
    let cumKm = startOdometer;
    for (const r of records) {
      const distance = (r.distance as number) || 0;
      const startKm = cumKm;
      cumKm += distance;
      const endKm = cumKm;
      const isPinned = !!(r.pinned as number);

      const baseStyle = isPinned ? pinnedRowStyle : cellStyle;
      const numStyle = isPinned
        ? { ...pinnedRowStyle, alignment: { ...pinnedRowStyle.alignment, horizontal: 'right' }, numFmt: '#,##0' }
        : cellStyleNum;

      const depInfo = r.departure_time ? `${r.departure}\n${r.departure_time}` : String(r.departure);
      const wpInfo = r.waypoint_time ? `${r.waypoint || ''}\n${r.waypoint_time}` : String(r.waypoint || '');
      const destInfo = r.destination_time ? `${r.destination}\n${r.destination_time}` : String(r.destination);

      wsData.push([
        { v: r.date, s: baseStyle },
        { v: r.driver, s: baseStyle },
        { v: r.passengers || 1, s: baseStyle },
        { v: r.purpose, s: isPinned ? pinnedRowStyle : cellStyleLeft },
        { v: depInfo, s: baseStyle },
        { v: wpInfo, s: baseStyle },
        { v: destInfo, s: baseStyle },
        { v: startKm, t: 'n', s: numStyle },
        { v: endKm, t: 'n', s: numStyle },
        { v: distance, t: 'n', s: numStyle },
        { v: r.maintenance || '', s: isPinned ? pinnedRowStyle : cellStyleLeft },
        { v: '', s: baseStyle }, // 관리자 확인 (empty)
      ]);
    }

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Merge cells
    ws['!merges'] = [
      // Title row: A1:L1
      { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
      // Spacing row: A2:L2
      { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
      // Header: 운행거리(km) H3:J3
      { s: { r: 2, c: 7 }, e: { r: 2, c: 9 } },
      // Header vertical merges (row 3-4)
      { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }, // 운행일자
      { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } }, // 사용자
      { s: { r: 2, c: 2 }, e: { r: 3, c: 2 } }, // 탑승인원
      { s: { r: 2, c: 3 }, e: { r: 3, c: 3 } }, // 사용목적
      { s: { r: 2, c: 4 }, e: { r: 3, c: 4 } }, // 출발지
      { s: { r: 2, c: 5 }, e: { r: 3, c: 5 } }, // 경유지
      { s: { r: 2, c: 6 }, e: { r: 3, c: 6 } }, // 도착지
      { s: { r: 2, c: 10 }, e: { r: 3, c: 10 } }, // 차량정비
      { s: { r: 2, c: 11 }, e: { r: 3, c: 11 } }, // 관리자확인
    ];

    // Column widths
    ws['!cols'] = [
      { wch: 12 },  // A: 운행일자
      { wch: 10 },  // B: 사용자
      { wch: 5 },   // C: 탑승인원
      { wch: 22 },  // D: 사용목적
      { wch: 14 },  // E: 출발지(시간)
      { wch: 14 },  // F: 경유지(시간)
      { wch: 14 },  // G: 도착지(시간)
      { wch: 8 },   // H: 출발km
      { wch: 8 },   // I: 도착km
      { wch: 8 },   // J: 주행거리
      { wch: 16 },  // K: 차량정비/주유
      { wch: 8 },   // L: 관리자확인
    ];

    // Row heights
    ws['!rows'] = [
      { hpx: 36 }, // Title
      { hpx: 8 },  // Spacing
      { hpx: 28 }, // Header 1
      { hpx: 22 }, // Header 2
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '차량운행일지');

    // Write to buffer
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const now = new Date();
    const filename = `차량운행일지_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.xlsx`;

    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 });
  }
}
