/**
 * Database Migration Runner
 * Execute SQL migrations in order
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'autogradex',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function runMigrations() {
  const client = await pool.connect();

  try {
    console.log('Starting database migrations...\n');

    // Create migrations tracking table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Get list of executed migrations
    const executed = await client.query('SELECT name FROM _migrations ORDER BY id');
    const executedNames = new Set(executed.rows.map(r => r.name));

    // Get migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let migrationsRun = 0;

    for (const file of files) {
      if (executedNames.has(file)) {
        console.log(`⏭️  Skipping (already executed): ${file}`);
        continue;
      }

      console.log(`🔄 Running migration: ${file}`);

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✅ Completed: ${file}\n`);
        migrationsRun++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Failed: ${file}`);
        console.error(err.message);
        throw err;
      }
    }

    if (migrationsRun === 0) {
      console.log('\n✨ Database is up to date - no new migrations to run.');
    } else {
      console.log(`\n✨ Successfully ran ${migrationsRun} migration(s).`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n💥 Migration failed:', err.message);
    process.exit(1);
  });
