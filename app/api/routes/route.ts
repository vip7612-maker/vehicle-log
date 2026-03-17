import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const result = await db.execute('SELECT * FROM routes ORDER BY id ASC');
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('GET routes error:', error);
    return NextResponse.json({ error: 'Failed to fetch routes' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    await db.execute({
      sql: 'INSERT INTO routes (name, departure, waypoint, destination, distance) VALUES (?, ?, ?, ?, ?)',
      args: [body.name, body.departure, body.waypoint || '', body.destination, body.distance || 0],
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('POST route error:', error);
    return NextResponse.json({ error: 'Failed to add route' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    await db.execute({ sql: 'DELETE FROM routes WHERE id = ?', args: [id] });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE route error:', error);
    return NextResponse.json({ error: 'Failed to delete route' }, { status: 500 });
  }
}
