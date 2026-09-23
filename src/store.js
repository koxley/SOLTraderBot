import { DatabaseSync } from 'node:sqlite';

export class Store {
  constructor(path, initialBalances) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
    if (!this.get('paper')) this.set('paper', initialBalances);
  }
  get(key) { const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row && JSON.parse(row.value); }
  set(key, value) { this.db.prepare('INSERT OR REPLACE INTO kv VALUES (?, ?)').run(key, JSON.stringify(value)); }
  put(order) { this.db.prepare('INSERT OR REPLACE INTO orders VALUES (?, ?)').run(order.id, JSON.stringify(order)); return order; }
  order(id) { const row = this.db.prepare('SELECT data FROM orders WHERE id=?').get(id); return row && JSON.parse(row.data); }
  orders() { return this.db.prepare('SELECT data FROM orders ORDER BY rowid DESC').all().map(r => JSON.parse(r.data)); }
  atomic(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
