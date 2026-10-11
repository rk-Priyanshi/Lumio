// Imports "TMDB IMDB Movies Dataset.csv" (HenryWaltson/TMDB-IMDB-Movies-Dataset on Hugging Face)
// into the Lumio MySQL schema.
//
//   npm run db:import -- data/movies.csv [--limit 20000] [--min-votes 500] [--include-adult] [--no-cast]
//
//   --limit N          stop after N movies have been accepted (the file is ordered by vote count)
//   --min-votes N      skip movies with fewer than N IMDb votes (default 500)
//   --include-adult    also import rows flagged adult
//   --no-cast          skip cast members (much faster; directors are still imported)
//
// Safe to re-run: movies are matched on tmdb_id and existing rows are left untouched.
import fs from 'node:fs';
import { parse } from 'csv-parse';
import { pool } from '../src/config/db.js';
import { transformRow } from '../src/utils/datasetTransform.js';

const args = process.argv.slice(2);
const file = args[0] && !args[0].startsWith('--') ? args[0] : null;
const flagValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const n = Number(args[i + 1]);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`--${name} needs a non-negative number.`);
    process.exit(1);
  }
  return n;
};

if (!file) {
  console.error('Usage: npm run db:import -- <path-to-csv> [--limit N] [--min-votes N] [--include-adult] [--no-cast]');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

const LIMIT = flagValue('limit', Infinity);
const opts = {
  minVotes: flagValue('min-votes', 500),
  includeAdult: args.includes('--include-adult'),
  includeCast: !args.includes('--no-cast'),
};
const BATCH_SIZE = 500;
const REQUIRED_COLUMNS = ['id', 'title', 'release_date', 'tconst', 'averageRating', 'numVotes', 'genres'];
const importStartedAt = new Date();   // same created_at for every imported row, so manual adds sort above them

const TABLES = {
  genres: ['genres', 'genre_id'],
  countries: ['countries', 'country_id'],
  languages: ['languages', 'language_id'],
  people: ['people', 'person_id'],
};
const caches = Object.fromEntries(Object.keys(TABLES).map((k) => [k, new Map()]));

// MySQL does the name matching (so collation rules apply); we only cache the result.
async function lookupId(kind, name) {
  const [table, idCol] = TABLES[kind];
  const [res] = await pool.query(
    `INSERT INTO ${table} (name) VALUES (?)
     ON DUPLICATE KEY UPDATE ${idCol} = LAST_INSERT_ID(${idCol})`,
    [name]
  );
  caches[kind].set(name, res.insertId);
}

async function resolveAll(kind, names) {
  for (const name of new Set(names)) {
    if (!caches[kind].has(name)) await lookupId(kind, name);
  }
}

const MOVIE_COLS = [
  'tmdb_id', 'imdb_id', 'title', 'tagline', 'release_date', 'release_year', 'imdb_rating', 'imdb_votes',
  'popularity', 'runtime', 'language_id', 'description', 'poster_url', 'backdrop_url', 'budget', 'revenue',
  'created_at',
];

async function flushBatch(batch) {
  // 1. Lookup tables (autocommit, outside the transaction so cached ids stay valid)
  await resolveAll('genres', batch.flatMap((b) => b.genres));
  await resolveAll('countries', batch.flatMap((b) => b.countries));
  await resolveAll('languages', batch.map((b) => b.languageName).filter(Boolean));
  await resolveAll('people', batch.flatMap((b) => [...b.directors, ...b.cast]));

  // 2. Movies + link rows in one transaction
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const rows = batch.map((b) =>
      MOVIE_COLS.map((c) => {
        if (c === 'language_id') return b.languageName ? caches.languages.get(b.languageName) : null;
        if (c === 'created_at') return importStartedAt;
        return b.movie[c] ?? null;
      })
    );
    const [insertResult] = await conn.query(`INSERT IGNORE INTO movies (${MOVIE_COLS.join(', ')}) VALUES ?`, [rows]);

    const [idRows] = await conn.query('SELECT movie_id, tmdb_id FROM movies WHERE tmdb_id IN (?)', [
      batch.map((b) => b.movie.tmdb_id),
    ]);
    const idByTmdb = new Map(idRows.map((r) => [r.tmdb_id, r.movie_id]));

    const links = { genres: [], countries: [], directors: [], cast: [] };
    for (const b of batch) {
      const id = idByTmdb.get(b.movie.tmdb_id);
      if (!id) continue;
      b.genres.forEach((n) => links.genres.push([id, caches.genres.get(n)]));
      b.countries.forEach((n) => links.countries.push([id, caches.countries.get(n)]));
      b.directors.forEach((n) => links.directors.push([id, caches.people.get(n)]));
      b.cast.forEach((n, i) => links.cast.push([id, caches.people.get(n), i + 1]));
    }

    const insertLinks = async (sql, values) => {
      if (values.length) await conn.query(sql, [values]);
    };
    await insertLinks('INSERT IGNORE INTO movie_genres (movie_id, genre_id) VALUES ?', links.genres);
    await insertLinks('INSERT IGNORE INTO movie_countries (movie_id, country_id) VALUES ?', links.countries);
    await insertLinks('INSERT IGNORE INTO movie_directors (movie_id, person_id) VALUES ?', links.directors);
    await insertLinks('INSERT IGNORE INTO movie_cast (movie_id, person_id, billing_order) VALUES ?', links.cast);

    await conn.commit();
    return insertResult.affectedRows;   // rows actually inserted (existing tmdb_ids are ignored)
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---- main ----
const stats = { read: 0, accepted: 0, inserted: 0, skipped: {} };
let batch = [];
let headerChecked = false;

console.log(`Importing ${file}`);
console.log(`Options: min-votes=${opts.minVotes}, limit=${LIMIT === Infinity ? 'none' : LIMIT}, ` +
  `adult=${opts.includeAdult}, cast=${opts.includeCast}`);

const readStream = fs.createReadStream(file);
const parser = readStream.pipe(
  parse({ columns: true, bom: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true })
);

try {
  for await (const row of parser) {
    if (!headerChecked) {
      const missing = REQUIRED_COLUMNS.filter((c) => !(c in row));
      if (missing.length) {
        throw new Error(`CSV is missing expected columns: ${missing.join(', ')}. Found: ${Object.keys(row).join(', ')}`);
      }
      headerChecked = true;
    }
    stats.read += 1;

    const t = transformRow(row, opts);
    if (t.skip) {
      stats.skipped[t.skip] = (stats.skipped[t.skip] || 0) + 1;
      continue;
    }

    batch.push(t);
    stats.accepted += 1;

    if (batch.length >= BATCH_SIZE) {
      stats.inserted += await flushBatch(batch);
      batch = [];
      console.log(`  read ${stats.read} rows | accepted ${stats.accepted} | newly inserted ${stats.inserted}`);
    }
    if (stats.accepted >= LIMIT) break;
  }
  if (batch.length) stats.inserted += await flushBatch(batch);
} catch (err) {
  console.error('\nImport failed:', err.message);
  process.exitCode = 1;
} finally {
  readStream.destroy();
}

console.log('\nSummary');
console.log(`  rows read:        ${stats.read}`);
console.log(`  rows accepted:    ${stats.accepted}`);
console.log(`  newly inserted:   ${stats.inserted}  (accepted rows already in the DB are left unchanged)`);
console.log(`  skipped by reason: ${JSON.stringify(stats.skipped)}`);

try {
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM movies');
  console.log(`  movies table now has ${c} rows`);
} catch { /* ignore */ }

await pool.end();
