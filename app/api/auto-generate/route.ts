import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

interface MandatoryRecord {
  date: string;
  driver?: string;
  departure: string;
  waypoint?: string;
  destination: string;
  purpose?: string;
  distance: number;
}

interface RoutePattern {
  departure: string;
  waypoint: string;
  destination: string;
  distance: number;
  purpose: string;
  drivers: string[];          // drivers who typically do this route
  driverWeights: number[];    // frequency weight per driver
  passengers: number;
  departureTime: string;
  destinationTime: string;
  frequency: number;          // how often this route appears
}

// Analyze existing records to extract route patterns
function analyzePatterns(records: any[], routePresets: any[]): RoutePattern[] {
  const patternMap: Map<string, {
    departure: string; waypoint: string; destination: string;
    distances: number[]; purposes: Map<string, number>;
    drivers: Map<string, number>; passengers: number[];
    depTimes: string[]; destTimes: string[]; count: number;
  }> = new Map();

  for (const r of records) {
    const key = `${r.departure}|${r.waypoint || ''}|${r.destination}`;
    if (!patternMap.has(key)) {
      patternMap.set(key, {
        departure: r.departure, waypoint: r.waypoint || '', destination: r.destination,
        distances: [], purposes: new Map(), drivers: new Map(),
        passengers: [], depTimes: [], destTimes: [], count: 0,
      });
    }
    const p = patternMap.get(key)!;
    p.distances.push(r.distance || 0);
    p.purposes.set(r.purpose, (p.purposes.get(r.purpose) || 0) + 1);
    p.drivers.set(r.driver, (p.drivers.get(r.driver) || 0) + 1);
    p.passengers.push(r.passengers || 1);
    if (r.departure_time) p.depTimes.push(r.departure_time);
    if (r.destination_time) p.destTimes.push(r.destination_time);
    p.count++;
  }

  // Also include route presets that may not be in records yet
  for (const rp of routePresets) {
    const key = `${rp.departure}|${rp.waypoint || ''}|${rp.destination}`;
    if (!patternMap.has(key)) {
      patternMap.set(key, {
        departure: rp.departure, waypoint: rp.waypoint || '', destination: rp.destination,
        distances: [rp.distance], purposes: new Map([['업무', 1]]),
        drivers: new Map(), passengers: [1],
        depTimes: ['09:00'], destTimes: ['10:00'], count: 1,
      });
    }
  }

  const patterns: RoutePattern[] = [];
  for (const [, p] of patternMap) {
    const avgDist = Math.round(p.distances.reduce((a, b) => a + b, 0) / p.distances.length);
    const topPurpose = [...p.purposes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '업무';
    const driverEntries = [...p.drivers.entries()].sort((a, b) => b[1] - a[1]);
    const avgPassengers = Math.round(p.passengers.reduce((a, b) => a + b, 0) / p.passengers.length);

    patterns.push({
      departure: p.departure,
      waypoint: p.waypoint,
      destination: p.destination,
      distance: avgDist || 20,
      purpose: topPurpose,
      drivers: driverEntries.map(e => e[0]),
      driverWeights: driverEntries.map(e => e[1]),
      passengers: avgPassengers || 1,
      departureTime: p.depTimes[0] || '09:00',
      destinationTime: p.destTimes[0] || '10:00',
      frequency: p.count,
    });
  }

  // Sort by frequency (most frequent first)
  patterns.sort((a, b) => b.frequency - a.frequency);
  return patterns;
}

// Pick a driver weighted by historical frequency
function pickDriver(pattern: RoutePattern, allDrivers: string[]): string {
  if (pattern.drivers.length > 0) {
    const totalWeight = pattern.driverWeights.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalWeight;
    for (let i = 0; i < pattern.drivers.length; i++) {
      r -= pattern.driverWeights[i];
      if (r <= 0) return pattern.drivers[i];
    }
    return pattern.drivers[0];
  }
  return allDrivers[Math.floor(Math.random() * allDrivers.length)] || '운전자';
}

// Generate random time around a base time with ±30min variation
function varyTime(baseTime: string, minuteVariation: number = 30): string {
  const [h, m] = baseTime.split(':').map(Number);
  const totalMinutes = h * 60 + m + Math.floor(Math.random() * minuteVariation * 2) - minuteVariation;
  const clampedMin = Math.max(420, Math.min(1140, totalMinutes)); // 07:00~19:00
  const newH = Math.floor(clampedMin / 60);
  const newM = clampedMin % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

// Get business days between two dates
function getBusinessDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const cur = new Date(startDate);
  const end = new Date(endDate);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) { // Mon-Fri
      days.push(cur.toISOString().split('T')[0]);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { targetOdometer, startDate, endDate, mandatory } = body as {
      targetOdometer: number;
      startDate: string;
      endDate: string;
      mandatory: MandatoryRecord[];
    };

    // Get existing data
    const [recordsRes, routesRes, driversRes, settingsRes] = await Promise.all([
      db.execute('SELECT * FROM records ORDER BY date ASC, departure_time ASC'),
      db.execute('SELECT * FROM routes'),
      db.execute('SELECT name FROM drivers'),
      db.execute('SELECT * FROM settings'),
    ]);

    const existingRecords = recordsRes.rows;
    const routePresets = routesRes.rows;
    const allDrivers = driversRes.rows.map(d => d.name as string);
    const startOdometer = parseInt((settingsRes.rows.find(s => s.key === 'start_odometer')?.value as string) || '0');

    // Calculate current cumulative distance
    let currentOdo = startOdometer;
    for (const r of existingRecords) {
      currentOdo += (r.distance as number) || 0;
    }

    const distanceToFill = targetOdometer - currentOdo;
    if (distanceToFill <= 0) {
      return NextResponse.json({
        error: `현재 누적거리(${currentOdo}km)가 목표(${targetOdometer}km)보다 크거나 같습니다.`,
      }, { status: 400 });
    }

    // Analyze patterns from existing records
    const patterns = analyzePatterns(existingRecords as any[], routePresets as any[]);

    // Get available business days
    const availableDays = getBusinessDays(startDate, endDate);
    if (availableDays.length === 0) {
      return NextResponse.json({ error: '선택된 기간에 평일이 없습니다.' }, { status: 400 });
    }

    // Step 1: Include mandatory records first
    const generated: any[] = [];
    let filledDistance = 0;

    for (const m of (mandatory || [])) {
      generated.push({
        date: m.date,
        driver: m.driver || (allDrivers[0] || '운전자'),
        passengers: 1,
        purpose: m.purpose || '업무',
        pinned: true,
        departure: m.departure,
        departureTime: '09:00',
        waypoint: m.waypoint || '',
        waypointTime: '',
        destination: m.destination,
        destinationTime: '10:00',
        distance: m.distance,
        maintenance: '',
      });
      filledDistance += m.distance;
    }

    // Step 2: Fill remaining distance with pattern-based records
    let remainingDistance = distanceToFill - filledDistance;
    const usedDaySlots: Map<string, number> = new Map(); // track trips per day

    // Mark mandatory days
    for (const g of generated) {
      usedDaySlots.set(g.date, (usedDaySlots.get(g.date) || 0) + 1);
    }

    // Generate records until we've filled the distance
    let safetyCounter = 0;
    const maxIterations = 500;

    while (remainingDistance > 0 && safetyCounter < maxIterations) {
      safetyCounter++;

      // Pick a random available day (weighted toward days with fewer trips)
      const candidateDays = availableDays.filter(d => {
        const slots = usedDaySlots.get(d) || 0;
        return slots < 3; // Max 3 trips per day
      });

      if (candidateDays.length === 0) break;

      const dayIdx = Math.floor(Math.random() * candidateDays.length);
      const day = candidateDays[dayIdx];

      // Pick a route pattern (weighted by frequency)
      const totalFreq = patterns.reduce((s, p) => s + p.frequency, 0);
      let r = Math.random() * totalFreq;
      let chosenPattern: RoutePattern | null = null;
      for (const p of patterns) {
        r -= p.frequency;
        if (r <= 0) { chosenPattern = p; break; }
      }
      if (!chosenPattern) chosenPattern = patterns[0];
      if (!chosenPattern) break;

      // Ensure we don't overshoot too much
      const routeDistance = chosenPattern.distance;
      if (routeDistance > remainingDistance + 5) {
        // Try to find a shorter route
        const shorterPattern = patterns.find(p => p.distance <= remainingDistance + 5);
        if (shorterPattern) {
          chosenPattern = shorterPattern;
        } else {
          // Create a partial trip with adjusted distance
          chosenPattern = { ...chosenPattern, distance: remainingDistance };
        }
      }

      const driver = pickDriver(chosenPattern, allDrivers);
      const tripCount = usedDaySlots.get(day) || 0;
      const baseDepTime = tripCount === 0 ? (chosenPattern.departureTime || '09:00')
        : tripCount === 1 ? '13:00' : '15:30';
      const depTime = varyTime(baseDepTime, 15);
      const [dH, dM] = depTime.split(':').map(Number);
      const travelMinutes = Math.max(20, Math.round(chosenPattern.distance * 1.5));
      const arrMinutes = dH * 60 + dM + travelMinutes;
      const arrH = Math.floor(Math.min(arrMinutes, 1140) / 60);
      const arrM = Math.min(arrMinutes, 1140) % 60;
      const destTime = `${String(arrH).padStart(2, '0')}:${String(arrM).padStart(2, '0')}`;

      generated.push({
        date: day,
        driver,
        passengers: chosenPattern.passengers,
        purpose: chosenPattern.purpose,
        pinned: false,
        departure: chosenPattern.departure,
        departureTime: depTime,
        waypoint: chosenPattern.waypoint,
        waypointTime: chosenPattern.waypoint ? varyTime(depTime, 10) : '',
        destination: chosenPattern.destination,
        destinationTime: destTime,
        distance: chosenPattern.distance,
        maintenance: '',
      });

      remainingDistance -= chosenPattern.distance;
      usedDaySlots.set(day, tripCount + 1);
    }

    // Sort by date and time
    generated.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.departureTime || '').localeCompare(b.departureTime || '');
    });

    // Return preview (don't save yet)
    return NextResponse.json({
      preview: generated,
      summary: {
        totalRecords: generated.length,
        totalDistance: generated.reduce((s: number, g: any) => s + g.distance, 0),
        currentOdometer: currentOdo,
        targetOdometer,
        mandatoryCount: (mandatory || []).length,
      },
    });
  } catch (error) {
    console.error('Auto-generate error:', error);
    return NextResponse.json({ error: 'Failed to auto-generate records' }, { status: 500 });
  }
}

// PUT: confirm and save generated records
export async function PUT(request: NextRequest) {
  try {
    const { records: newRecords } = await request.json();
    for (const r of newRecords) {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      await db.execute({
        sql: `INSERT INTO records (id, date, driver, passengers, purpose, pinned, departure, departure_time, waypoint, waypoint_time, destination, destination_time, distance, maintenance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, r.date, r.driver, r.passengers || 1, r.purpose, r.pinned ? 1 : 0, r.departure, r.departureTime || '', r.waypoint || '', r.waypointTime || '', r.destination, r.destinationTime || '', r.distance || 0, r.maintenance || ''],
      });
      // Small delay to prevent ID collision
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return NextResponse.json({ ok: true, count: newRecords.length });
  } catch (error) {
    console.error('Save generated records error:', error);
    return NextResponse.json({ error: 'Failed to save records' }, { status: 500 });
  }
}
