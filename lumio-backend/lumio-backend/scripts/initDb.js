// Creates the database (if needed) and applies database/schema.sql.
//   npm run db:init                      -> DB_NAME        (default "lumio")
//   npm run db:init:test                 -> DB_NAME_TEST   (default "lumio_test")
//   npm run db:init -- --reset           -> DROPS the database first (all data lost)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const args = process.argv.slice(2);
const isTest = args.includes('--test');
const reset = args.includes('--reset');

const dbName = isTest ? process.env.DB_NAME_TEST || 'lumio_test' : process.env.DB_NAME || 'lumio';
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error(`Refusing to use database name "${dbName}" (letters, digits and _ only).`);
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = await fs.readFile(path.join(here, '..', 'database', 'schema.sql'), 'utf8');

let conn;
try {
  conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_ADMIN_USER || process.env.DB_USER,
    password: process.env.DB_ADMIN_PASSWORD ?? process.env.DB_PASSWORD,
    multipleStatements: true,
  });

  if (reset) {
    console.log(`Dropping database ${dbName} ...`);
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  }
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.query(`USE \`${dbName}\``);
  await conn.query(schemaSql);

  const [tables] = await conn.query('SHOW TABLES');
  console.log(`Schema applied to "${dbName}". Tables:`);
  for (const row of tables) console.log('  -', Object.values(row)[0]);
} catch (err) {
  console.error('db:init failed:', err.message);
  if (err.code === 'ER_ACCESS_DENIED_ERROR' || err.code === 'ER_DBACCESS_DENIED_ERROR' || err.code === 'ER_TABLEACCESS_DENIED_ERROR')
    console.error('Set DB_ADMIN_USER / DB_ADMIN_PASSWORD in .env to an account with CREATE rights (e.g. root).');
  process.exitCode = 1;
} finally {
  if (conn) await conn.end();
}
