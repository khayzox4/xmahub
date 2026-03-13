import { pool } from "./db.js";

async function migrate() {
  const client = await pool.connect();
  try {
    console.log("🔄 Création des tables...");

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE giveaway_status AS ENUM ('active', 'ended');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS giveaways (
        id SERIAL PRIMARY KEY,
        prize TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        winners_count INTEGER NOT NULL DEFAULT 1,
        conditions TEXT NOT NULL DEFAULT '',
        status giveaway_status NOT NULL DEFAULT 'active',
        winners TEXT[] NOT NULL DEFAULT '{}',
        ends_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        channel_id TEXT,
        guild_id TEXT,
        message_id TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS giveaway_participants (
        id SERIAL PRIMARY KEY,
        giveaway_id INTEGER NOT NULL REFERENCES giveaways(id),
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        entered_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);

    console.log("✅ Tables créées avec succès !");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);
