import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const result = await db.execute('SELECT * FROM purposes ORDER BY id ASC');
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('GET purposes error:', error);
    return NextResponse.json({ error: 'Failed to fetch purposes' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();
    await db.execute({ sql: 'INSERT INTO purposes (name) VALUES (?)', args: [name] });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('POST purpose error:', error);
    return NextResponse.json({ error: 'Failed to add purpose' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    await db.execute({ sql: 'DELETE FROM purposes WHERE id = ?', args: [id] });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE purpose error:', error);
    return NextResponse.json({ error: 'Failed to delete purpose' }, { status: 500 });
  }
}
