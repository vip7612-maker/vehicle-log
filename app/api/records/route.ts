import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

// GET all records
export async function GET() {
  try {
    const result = await db.execute('SELECT * FROM records ORDER BY date ASC, departure_time ASC');
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('GET records error:', error);
    return NextResponse.json({ error: 'Failed to fetch records' }, { status: 500 });
  }
}

// POST new record
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await db.execute({
      sql: `INSERT INTO records (id, date, driver, passengers, purpose, pinned, departure, departure_time, waypoint, waypoint_time, destination, destination_time, distance, maintenance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, body.date, body.driver, body.passengers || 1, body.purpose, body.pinned ? 1 : 0, body.departure, body.departureTime || '', body.waypoint || '', body.waypointTime || '', body.destination, body.destinationTime || '', body.distance || 0, body.maintenance || ''],
    });
    return NextResponse.json({ id, ...body });
  } catch (error) {
    console.error('POST record error:', error);
    return NextResponse.json({ error: 'Failed to create record' }, { status: 500 });
  }
}

// PUT update record
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    await db.execute({
      sql: `UPDATE records SET date=?, driver=?, passengers=?, purpose=?, pinned=?, departure=?, departure_time=?, waypoint=?, waypoint_time=?, destination=?, destination_time=?, distance=?, maintenance=? WHERE id=?`,
      args: [body.date, body.driver, body.passengers || 1, body.purpose, body.pinned ? 1 : 0, body.departure, body.departureTime || '', body.waypoint || '', body.waypointTime || '', body.destination, body.destinationTime || '', body.distance || 0, body.maintenance || '', body.id],
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('PUT record error:', error);
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 });
  }
}

// DELETE record
export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    await db.execute({ sql: 'DELETE FROM records WHERE id = ?', args: [id] });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE record error:', error);
    return NextResponse.json({ error: 'Failed to delete record' }, { status: 500 });
  }
}
