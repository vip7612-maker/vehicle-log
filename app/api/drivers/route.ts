import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const result = await db.execute('SELECT * FROM drivers ORDER BY id ASC');
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('GET drivers error:', error);
    return NextResponse.json({ error: 'Failed to fetch drivers' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();
    await db.execute({ sql: 'INSERT INTO drivers (name) VALUES (?)', args: [name] });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('POST driver error:', error);
    return NextResponse.json({ error: 'Failed to add driver' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    await db.execute({ sql: 'DELETE FROM drivers WHERE id = ?', args: [id] });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE driver error:', error);
    return NextResponse.json({ error: 'Failed to delete driver' }, { status: 500 });
  }
}
