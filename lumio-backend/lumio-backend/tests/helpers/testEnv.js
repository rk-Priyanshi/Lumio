// Import this FIRST in every DB-backed test file. It points the app at the *_test database
// before src/config/db.js is evaluated, so tests can never touch your real data.
import dotenv from 'dotenv';
dotenv.config();

process.env.DB_NAME = process.env.DB_NAME_TEST || 'lumio_test';

if (!/_test$/.test(process.env.DB_NAME)) {
  throw new Error(
    `Refusing to run tests against "${process.env.DB_NAME}". The test database name must end with "_test".`
  );
}

export async function resetTestData(pool) {
  if (!/_test$/.test(process.env.DB_NAME)) throw new Error('Refusing to wipe a non-test database.');
  await pool.query('DELETE FROM movies');   // ON DELETE CASCADE clears the link tables
  for (const table of ['genres', 'languages', 'ott_platforms', 'countries', 'people']) {
    await pool.query(`DELETE FROM ${table}`);
  }
}
