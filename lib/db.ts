import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

export default client;

export async function initDB() {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      driver TEXT NOT NULL,
      passengers INTEGER DEFAULT 1,
      purpose TEXT NOT NULL,
      pinned INTEGER DEFAULT 0,
      departure TEXT NOT NULL,
      departure_time TEXT,
      waypoint TEXT,
      waypoint_time TEXT,
      destination TEXT NOT NULL,
      destination_time TEXT,
      distance INTEGER DEFAULT 0,
      maintenance TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS drivers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )`,
    `CREATE TABLE IF NOT EXISTS routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      departure TEXT NOT NULL,
      waypoint TEXT,
      destination TEXT NOT NULL,
      distance INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS purposes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ]);
}
