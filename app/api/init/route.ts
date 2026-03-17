import { NextResponse } from 'next/server';
import db, { initDB } from '@/lib/db';

const DEFAULT_DRIVERS = ['이경진', '최종문', '김병준', '김태복', '김태묵', '신준규', '박희양', '김왕준'];
const DEFAULT_PURPOSES = ['통학지원', '병원진료', '물품구입', '출장', '고객방문', '체험학습', '학교교류협력', '회의참석'];
const DEFAULT_ROUTES = [
  { name: '통학 왕복 (7인)', departure: '해일학교', waypoint: '충전터미널', destination: '해일학교', distance: 43 },
  { name: '무덕역 왕복', departure: '해일학교', waypoint: '', destination: '무덕역', distance: 18 },
  { name: '물품구입 (무덕역)', departure: '해일학교', waypoint: '무덕역', destination: '해일학교', distance: 18 },
];

export async function POST() {
  try {
    await initDB();

    // Seed defaults if empty
    const driverCount = await db.execute('SELECT COUNT(*) as cnt FROM drivers');
    if (Number(driverCount.rows[0].cnt) === 0) {
      for (const name of DEFAULT_DRIVERS) {
        await db.execute({ sql: 'INSERT OR IGNORE INTO drivers (name) VALUES (?)', args: [name] });
      }
    }

    const purposeCount = await db.execute('SELECT COUNT(*) as cnt FROM purposes');
    if (Number(purposeCount.rows[0].cnt) === 0) {
      for (const name of DEFAULT_PURPOSES) {
        await db.execute({ sql: 'INSERT OR IGNORE INTO purposes (name) VALUES (?)', args: [name] });
      }
    }

    const routeCount = await db.execute('SELECT COUNT(*) as cnt FROM routes');
    if (Number(routeCount.rows[0].cnt) === 0) {
      for (const r of DEFAULT_ROUTES) {
        await db.execute({
          sql: 'INSERT INTO routes (name, departure, waypoint, destination, distance) VALUES (?, ?, ?, ?, ?)',
          args: [r.name, r.departure, r.waypoint, r.destination, r.distance],
        });
      }
    }

    const settingsCount = await db.execute('SELECT COUNT(*) as cnt FROM settings');
    if (Number(settingsCount.rows[0].cnt) === 0) {
      await db.execute({ sql: "INSERT OR IGNORE INTO settings (key, value) VALUES ('start_odometer', '0')", args: [] });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Init error:', error);
    return NextResponse.json({ error: 'Failed to initialize database' }, { status: 500 });
  }
}
