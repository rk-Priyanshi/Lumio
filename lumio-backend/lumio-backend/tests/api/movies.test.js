// Integration tests: real Express app + real MySQL (the *_test database).
// Prerequisites:  database/create_user.sql executed, then  npm run db:init:test
import '../helpers/testEnv.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/app.js';
import { pool } from '../../src/config/db.js';
import { resetTestData } from '../helpers/testEnv.js';

let server;
let base;

async function api(path, { method = 'GET', body, rawBody } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  return { status: res.status, body: await res.json() };
}

const inception = {
  title: 'Inception', release_year: 2010, genre: 'Sci-Fi, Thriller', imdb_rating: 8.8, runtime: 148,
  age_rating: 'PG-13', language: 'English', ott_platform: 'Netflix',
  description: 'A thief enters dreams.', poster_url: null,
};
const interstellar = {
  title: 'Interstellar', release_year: 2014, genre: 'Adventure, Drama, Sci-Fi', imdb_rating: 8.7, runtime: 169,
  age_rating: 'PG-13', language: 'English', ott_platform: 'Netflix',
};
const barbie = {
  title: 'Barbie', release_year: 2023, genre: 'Comedy', imdb_rating: 6.9, runtime: 114,
  age_rating: 'PG-13', language: 'English', ott_platform: 'Amazon Prime Video',
};

before(async () => {
  try {
    await pool.query('SELECT 1');
    await pool.query('SELECT 1 FROM movies LIMIT 1');
  } catch (err) {
    throw new Error(
      `Cannot use the test database "${process.env.DB_NAME}": ${err.message}\n` +
      'Run database/create_user.sql in Workbench, then: npm run db:init:test'
    );
  }
  await resetTestData(pool);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();   // fetch keeps sockets alive; don't let them stall shutdown
    await new Promise((resolve) => server.close(resolve));
  }
  await pool.end();
});

describe('health & routing', () => {
  test('GET /health reports the database as connected', async () => {
    const r = await api('/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.database, 'connected');
  });

  test('unknown route returns a JSON 404', async () => {
    const r = await api('/nope');
    assert.equal(r.status, 404);
    assert.equal(r.body.success, false);
  });
});

describe('POST /movies', () => {
  test('creates a movie and returns it from the database', async () => {
    const r = await api('/movies', { method: 'POST', body: inception });
    assert.equal(r.status, 201);
    assert.equal(r.body.success, true);
    const m = r.body.data;
    assert.ok(Number.isInteger(m.id));
    assert.equal(m.title, 'Inception');
    assert.equal(m.release_year, 2010);
    assert.equal(m.imdb_rating, 8.8);
    assert.equal(m.genre, 'Sci-Fi, Thriller');
    assert.equal(m.language, 'English');
    assert.equal(m.ott_platform, 'Netflix');
    assert.equal(m.age_rating, 'PG-13');
  });

  test('actually persisted rows in the normalised tables', async () => {
    const [[movies]] = await pool.query("SELECT COUNT(*) AS c FROM movies WHERE title = 'Inception'");
    const [[links]] = await pool.query(
      `SELECT COUNT(*) AS c FROM movie_genres mg JOIN movies m ON m.movie_id = mg.movie_id WHERE m.title = 'Inception'`
    );
    assert.equal(movies.c, 1);
    assert.equal(links.c, 2);
  });

  test('rejects an empty title with per-field errors (400)', async () => {
    const r = await api('/movies', { method: 'POST', body: { ...inception, title: '' } });
    assert.equal(r.status, 400);
    assert.ok(r.body.errors.title);
  });

  test('rejects out-of-range values (400)', async () => {
    const r = await api('/movies', {
      method: 'POST', body: { title: 'Bad', release_year: 1700, imdb_rating: 11, runtime: -5 },
    });
    assert.equal(r.status, 400);
    assert.ok(r.body.errors.release_year && r.body.errors.imdb_rating && r.body.errors.runtime);
  });

  test('rejects a duplicate title + year (409)', async () => {
    const r = await api('/movies', { method: 'POST', body: inception });
    assert.equal(r.status, 409);
    const [[{ c }]] = await pool.query("SELECT COUNT(*) AS c FROM movies WHERE title = 'Inception'");
    assert.equal(c, 1);
  });

  test('malformed JSON returns 400, not 500', async () => {
    const r = await api('/movies', { method: 'POST', rawBody: '{"title": ' });
    assert.equal(r.status, 400);
  });

  test('reuses existing genres / platforms instead of duplicating them', async () => {
    await api('/movies', { method: 'POST', body: interstellar });
    await api('/movies', { method: 'POST', body: barbie });
    const [[g]] = await pool.query("SELECT COUNT(*) AS c FROM genres WHERE name = 'Sci-Fi'");
    const [[p]] = await pool.query("SELECT COUNT(*) AS c FROM ott_platforms WHERE name = 'Netflix'");
    assert.equal(g.c, 1);
    assert.equal(p.c, 1);
  });
});

describe('GET /movies', () => {
  test('lists movies with pagination metadata', async () => {
    const r = await api('/movies');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 3);
    assert.equal(r.body.count, 3);
    assert.equal(r.body.page, 1);
    assert.equal(r.body.totalPages, 1);
    const inc = r.body.data.find((m) => m.title === 'Inception');
    assert.equal(inc.genre, 'Sci-Fi, Thriller');
    assert.equal(inc.ott_platform, 'Netflix');
  });

  test('the most recently added movie is first by default', async () => {
    const r = await api('/movies');
    assert.equal(r.body.data[0].title, 'Barbie');
  });

  test('paginates', async () => {
    const r = await api('/movies?sort=rating&limit=1&page=2');
    assert.equal(r.body.total, 3);
    assert.equal(r.body.totalPages, 3);
    assert.equal(r.body.data.length, 1);
    assert.equal(r.body.data[0].title, 'Interstellar');
  });

  test('searches by title (case-insensitive, partial)', async () => {
    const r = await api('/movies?search=inter');
    assert.deepEqual(r.body.data.map((m) => m.title), ['Interstellar']);
  });

  test('LIKE wildcards in search are treated literally', async () => {
    assert.equal((await api('/movies?search=%25')).body.total, 0);   // "%"
    assert.equal((await api('/movies?search=_')).body.total, 0);     // "_"
  });

  test('filters by genre, rating, year, platform and language together', async () => {
    assert.equal((await api('/movies?genre=Comedy')).body.total, 1);
    assert.equal((await api('/movies?min_rating=8')).body.total, 2);
    assert.equal((await api('/movies?year_min=2011')).body.total, 2);
    assert.equal((await api('/movies?year_min=2011&year_max=2020')).body.total, 1);
    assert.equal((await api('/movies?platform=Netflix')).body.total, 2);
    assert.equal((await api('/movies?language=English')).body.total, 3);
    const combo = await api('/movies?genre=Sci-Fi&min_rating=8.8&platform=Netflix');
    assert.deepEqual(combo.body.data.map((m) => m.title), ['Inception']);
    assert.equal((await api('/movies?genre=Drama,Comedy')).body.total, 2);   // ANY of the genres
  });

  test('sorts by rating, year and title in both directions, NULLs last', async () => {
    const byRating = await api('/movies?sort=rating');
    assert.deepEqual(byRating.body.data.map((m) => m.title), ['Inception', 'Interstellar', 'Barbie']);
    const byRatingAsc = await api('/movies?sort=rating&order=asc');
    assert.equal(byRatingAsc.body.data[0].title, 'Barbie');
    const byYear = await api('/movies?sort=year');
    assert.equal(byYear.body.data[0].title, 'Barbie');
    const byTitle = await api('/movies?sort=title');
    assert.deepEqual(byTitle.body.data.map((m) => m.title), ['Barbie', 'Inception', 'Interstellar']);
  });

  test('returns an empty page (not an error) when nothing matches', async () => {
    const r = await api('/movies?search=zzzzzz');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 0);
    assert.deepEqual(r.body.data, []);
  });

  test('rejects invalid query parameters with 400', async () => {
    assert.equal((await api('/movies?sort=password')).status, 400);
    assert.equal((await api('/movies?limit=1000')).status, 400);
    assert.equal((await api('/movies?page=0')).status, 400);
    assert.equal((await api('/movies?year_min=2020&year_max=2010')).status, 400);
    assert.equal((await api('/movies?min_rating=abc')).status, 400);
  });

  test("SQL injection in a filter returns normally and does not drop anything", async () => {
    const r = await api("/movies?search=%27%3B%20DROP%20TABLE%20movies%3B%20--");
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 0);
    assert.equal((await api('/movies')).body.total, 3);
  });
});

describe('GET /movies/:id', () => {
  test('returns full detail with related data', async () => {
    const list = await api('/movies?search=Interstellar');
    const id = list.body.data[0].id;
    const r = await api(`/movies/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.title, 'Interstellar');
    assert.deepEqual(r.body.data.genres, ['Adventure', 'Drama', 'Sci-Fi']);
    assert.deepEqual(r.body.data.platforms, [{ name: 'Netflix', is_primary: true }]);
    assert.deepEqual(r.body.data.cast, []);
    assert.deepEqual(r.body.data.directors, []);
  });

  test('404 for a movie that does not exist', async () => {
    assert.equal((await api('/movies/99999999')).status, 404);
  });

  test('400 for a non-numeric id', async () => {
    assert.equal((await api('/movies/abc')).status, 400);
    assert.equal((await api('/movies/1;DROP')).status, 400);
  });
});

describe('lookups & stats', () => {
  test('GET /genres returns names with counts', async () => {
    const r = await api('/genres');
    const scifi = r.body.data.find((g) => g.name === 'Sci-Fi');
    assert.equal(scifi.movie_count, 2);
  });

  test('GET /platforms and /languages work', async () => {
    const platforms = await api('/platforms');
    assert.equal(platforms.body.data.find((p) => p.name === 'Netflix').movie_count, 2);
    const languages = await api('/languages');
    assert.equal(languages.body.data.find((l) => l.name === 'English').movie_count, 3);
  });

  test('GET /stats aggregates', async () => {
    const r = await api('/stats');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.total_movies, 3);
    assert.equal(r.body.data.top_genres[0].name, 'Sci-Fi');
    assert.equal(r.body.data.earliest_year, 2010);
    assert.equal(r.body.data.latest_year, 2023);
  });
});
