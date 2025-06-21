import * as sqlite3 from 'sqlite3';
import { Database } from 'sqlite';
import { randomUUID } from 'crypto';

sqlite3.verbose();

export interface User {
  id: number,
  email: string,
  slug: string,
}

export interface Timer {
  id: number,
  epoch: number,
  title: string,
  slug: string,
  secret: string,
  userid: number,
  format: number,
  createdAt: number,
}

export interface Group {
  id: number,
  title: string,
  slug: string,
  createdAt: number,
  timers: Timer[],
}

const timerFields = 't.id, t.epoch, t.title, t.slug, t.secret, t.userid, t.format, t.createdAt';

// characters to use in a slug, with easily mistakable characters removed
const slugChars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'


const setupStatements: string[] = [
  `CREATE TABLE IF NOT EXISTS Settings (
    key TEXT UNIQUE NOT NULL,
    value
  );`,
  `INSERT OR IGNORE INTO Settings
    (key, value) VALUES ('version', 1);
  `,

  `CREATE TABLE IF NOt EXISTS Slugs (
    slug TEXT UNIQUE NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    slug TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS UserEmails ON Users (email)`,
  `CREATE INDEX IF NOT EXISTS UserSlugs ON Users (slug)`,

  `CREATE TABLE IF NOT EXISTS Timers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    epoch INTEGER NOT NULL DEFAULT (unixepoch()),
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    secret TEXT NOT NULL,
    userid INTEGER NOT NULL,
    format INTEGER NOT NULL DEFAULT (2),
    createdAt INTEGER NOT NULL DEFAULT (unixepoch()),

    resetAt INTEGER NOT NULL DEFAULT (unixepoch()),
    duration INTEGER NOT NULL DEFAULT (0),

    FOREIGN KEY (userid) REFERENCES Users(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS TimerSlugs ON Timers (slug)`,

  `CREATE TABLE IF NOT EXISTS Groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    userid INTEGER NOT NULL,
    createdAt INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (userid) REFERENCES Users(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS GroupSlugs ON Groups (slug)`,

  `CREATE TABLE IF NOT EXISTS TimerGroups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    groupid INTEGER NOT NULL,
    timerid INTEGER NOT NULL,
    userid INTEGER NOT NULL,
    createdAt INTEGER NOT NULL DEFAULT (unixepoch()), 

    FOREIGN KEY (groupid) REFERENCES Groups(id) ON DELETE CASCADE,
    FOREIGN KEY (timerid) REFERENCES Timers(id) ON DELETE CASCADE
  )`,
];

export async function init(path?: string) {
  const db = new Data(path);
  await db.init();
  return db;
}

export class Data {
  private path: string;
  private db: Database;
  private ready: Promise<void>;
  public constructor(path?: string) {
    this.path = path ?? 'database.sqlite3';
    this.db = new Database({
      filename: this.path,
      driver: sqlite3.Database
    });
    this.ready = this.db.open();
  }

  public async init() {
    await this.ready;
    for (const stmt of setupStatements) {
      await this.db.run(stmt);
    }
  }

  public async getSetting<T extends number|string>(key: string): Promise<T|undefined> {
    const res = await this.db.get(
      `SELECT value FROM Settings WHERE key = ?`, key
    );
    return res?.value as T;
  }

  public async setSetting(key: string, value: string|number) {
    await this.db.run(`
      INSERT OR IGNORE INTO Settings
      (key, value) VALUES (?, ?)
      ON CONFLICT(Settings.key) DO UPDATE SET value = ?
    `, key, value, value);
  }

  /** Creates a globally unique slug for use by most nouns. */
  public async createSlug() {
    for (let length=6; length<12; length+=2) {
      for (let attempt=0; attempt < 9; attempt++) {
        let slug = ''
        for (let i=0; i<length; i++) {
          slug += slugChars[Math.floor(Math.random() * slugChars.length)]!;
        }
        const result = await this.db.run(
          `INSERT OR IGNORE INTO Slugs (slug) VALUES (?)`, slug);
        if (result.lastID !== undefined) {
          return slug;
        }
      }
    }
    throw new Error('token space exhausted')
  }

  public async getOrCreateUser(email: string): Promise<User> {
    const slug = await this.createSlug();
    await this.db.run(
      `INSERT OR IGNORE INTO USERS (email, slug) VALUES (?, ?)`,
      email, slug
    );
    const res = await this.db.get(
      `SELECT id, slug FROM Users WHERE email = ?`,
      email
    );
    return {
      email, id: res.id, slug: res.slug
    };
  }

  public async getTimersForUser(userid: number): Promise<Timer[]> {
    return this.db.all(`
      SELECT ${timerFields}
      FROM Timers t WHERE userid = ?`, userid)
  }

  /** 
   * Returns timers from a slug, where the slug can be either
   * a timer, a group of timers, or a user.
   */
  public async getTimersBySlug(slug: string): Promise<Timer[]> {
    return this.db.all(`
      SELECT ${timerFields} FROM Groups g
        INNER JOIN TimerGroups tg ON g.id = tg.groupid
        INNER JOIN Timers t ON tg.timerid = t.id
      WHERE g.slug = ?
      ORDER BY tg.createdAt ASC
      UNION ALL
      SELECT ${timerFields} FROM Timers t WHERE t.slug = ?
      UNION ALL
      SELECT ${timerFields} FROM Users u
        INNER JOIN Timers t ON t.userid = u.id
      WHERE u.slug = ?
      ORDER BY t.createdAt ASC
    `, slug, slug);
  }

  public async getTimers(userId: number): Promise<Timer[]> {
    return this.db.all(`
      SELECT ${timerFields} FROM Timers t WHERE t.userId = ?`, userId);
  }

  public async getGroups(userId: number): Promise<Group[]> {
    const rows = await this.db.all<Array<{
      g_id: number,
      g_title: string,
      g_slug: string,
      g_createdAt: number,
    } & Timer>>(`
      SELECT
        g.id AS g_id, g.title as g_title, g.slug as g_slug,
        g.createdAt as g_createdAt, ${timerFields}
      FROM Groups g
        INNER JOIN TimerGroups tg ON tg.groupid = g.id
        INNER JOIN Timers t ON tg.timerid = t.id
      WHERE g.userid = ?`, userId
    );
    const groups: Record<number, Group> = {};
    for (const row of rows) {
      if (groups[row.g_id] === undefined) {
        groups[row.g_id] = {
          id: row.g_id,
          title: row.g_title,
          slug: row.g_slug,
          createdAt: row.g_createdAt,
          timers: [],
        };
      }
      groups[row.g_id].timers.push({
        id: row.id,
        epoch: row.epoch,
        title: row.title,
        slug: row.slug,
        secret: row.secret,
        userid: row.userid,
        format: row.format,
        createdAt: row.createdAt,
      })
    }
    const arr = Object.values(groups);
    arr.sort((a, b) => a.createdAt - b.createdAt);
    return arr;
  }

  public async createTimer(userId: number, title: string) {
    const slug = await this.createSlug();
    await this.db.run(
      `INSERT INTO Timers (title, slug, secret, userid) VALUES (?, ?, ?, ?)`,
      title, slug, randomUUID(), userId
    );
    return slug;
  }

  public async deleteTimer(userId: number, slug: string) {
    await this.db.run(
      `DELETE FROM Timers WHERE userid = ? AND slug = ?`,
      userId, slug
    );
  }
  
  public async resetTimer(slug: string, secret: string) {
    await this.db.run(
      `UPDATE Timers SET epoch = unixepoch() WHERE slug = ? AND secret = ?`,
      slug, secret
    );
  }

  public async createGroup(userId: number, title: string) {
    const slug = await this.createSlug();
    const res = await this.db.run(
      `INSERT INTO Groups (title, slug, userid) VALUES (?, ?, ?)`,
      title, slug, userId
    );
    if (!res.lastID) {
      // if this happens, things broke
      throw new Error('Did not receive group id')
    }
    return slug;
  }

  public async deleteGroup(slug: string) {
    await this.db.run('DELETE FROM Groups WHERE slug = ?', slug)
  }

  public async addTimer(userId: number, groupId: number, timerId: number) {
    await this.db.run(
      `INSERT INTO TimerGroups (userid, groupid, timerid) VALUES (?, ?, ?)`,
      userId, groupId, timerId
    );
  }

  public async removeTimer(userId: number, groupId: number, timerId: number) {
    await this.db.run(
      `DELETE FROM TimerGroups WHERE userid = ? AND groupid = ? AND timerid = ?`,
      userId, groupId, timerId
    );
  }
}

type Scale = {name: string, scale: number};
type Scales = Array<Scale>;
const units: Scales = [
  {name: 'Year', scale: 365 * 24 * 3600},
  {name: 'Week', scale: 7 * 24 * 3600},
  {name: 'Day', scale: 24 * 3600},
  {name: 'Hour', scale: 24 * 3600},
  {name: 'Minute', scale: 60},
];

function scaleToStr(s: Scale) {
  return `${s.scale} ${s.name}${s.scale === 1 ? '' : 's'}`;
}

function makeScaleFormatter(name: string) {
  return (epoch: number, now: number) => {
    const scale = units.filter((v) => v.name === 'Year')[0]?.scale;
    if (scale === undefined) {
      throw new Error(`Unrecoznied scale "${name}"`)
    }
    return scaleToStr({
      name,
      scale: Math.floor((now - epoch) / scale),
    })
  }
}

function bucketTimes(diff: number) {
  const diffs: Scales = [];
  for (const unit of units) {
    const qty = Math.floor(diff / unit.scale);
    if (qty > 0 || diffs.length > 0) {
      diffs.push({name: unit.name, scale: qty});
    }
    diff = diff - qty * unit.scale;
  }
  return diffs;
}

type Formatter = (epoch: number, now: number) => string

const formatters: Array<[string, Formatter]> = [
  ['Show Epoch', (e) => e.toString()],
  ['One Unit', (e, n) => {
    const b = bucketTimes(n - e)[0];
    if (b === undefined) return '-';
    return scaleToStr(b);
  }],
  ['Two Units', (e, n) => {
    const [b1, b2] = bucketTimes(n - e);
    if (b1 === undefined) return '-';
    let s = scaleToStr(b1);
    if (b2 !== undefined) {
      s += `, ${scaleToStr(b2)}`;
    }
    return s;
  }],
  ['Years', makeScaleFormatter('Year')],
  ['Weeks', makeScaleFormatter('Week')],
  ['Days', makeScaleFormatter('Day')],
  ['Hours', makeScaleFormatter('Hour')],
  ['Minutes', makeScaleFormatter('Minute')],
];

export function listFormatters() {
  const arr: string[] = [];
  for (const formatter of formatters) {
    arr.push(formatter[0]);
  }
  return arr;
}

export function formatTime(epoch: number, format: number) {
  const [_, formatter] = formatters[format] ?? formatters[1];
  let now = Date.now() / 1000;
  return formatter(epoch, now);
}
