import { pool } from '../config/db.js';
import { validateMovie } from '../utils/validateMovie.js';
import { parseListQuery } from '../utils/movieQuery.js';

const FROM_CLAUSE = `FROM movies m LEFT JOIN languages l ON l.language_id = m.language_id`;

const MOVIE_SELECT = `
  SELECT
    m.movie_id AS id,
    m.title,
    m.tagline,
    m.release_date,
    m.release_year,
    m.imdb_rating,
    m.imdb_votes,
    m.popularity,
    m.runtime,
    m.age_rating,
    l.name AS language,
    m.description,
    m.poster_url,
    m.backdrop_url,
    m.budget,
    m.revenue,
    m.content_type,
    m.created_at,
    (SELECT GROUP_CONCAT(g.name ORDER BY g.name SEPARATOR ', ')
       FROM movie_genres mg JOIN genres g ON g.genre_id = mg.genre_id
      WHERE mg.movie_id = m.movie_id) AS genre,
    (SELECT p.name
       FROM movie_platforms mp JOIN ott_platforms p ON p.platform_id = mp.platform_id
      WHERE mp.movie_id = m.movie_id
      ORDER BY mp.is_primary DESC, p.name
      LIMIT 1) AS ott_platform
  ${FROM_CLAUSE}
`;

// Find-or-create a row in a lookup table and return its id. `table` and `idCol`
// are internal constants, never user input.
async function getOrCreate(conn, table, idCol, name) {
  const [res] = await conn.query(
    `INSERT INTO ${table} (name) VALUES (?)
     ON DUPLICATE KEY UPDATE ${idCol} = LAST_INSERT_ID(${idCol})`,
    [name]
  );
  return res.insertId;
}

// GET /api/movies
export async function getMovies(req, res, next) {
  try {
    const q = parseListQuery(req.query);
    if (q.errors) {
      return res.status(400).json({ success: false, message: 'Invalid query parameters.', errors: q.errors });
    }

    const [countResult, listResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total ${FROM_CLAUSE} ${q.whereSql}`, q.params),
      pool.query(`${MOVIE_SELECT} ${q.whereSql} ${q.orderSql} LIMIT ? OFFSET ?`, [
        ...q.params,
        q.limit,
        q.offset,
      ]),
    ]);

    const total = Number(countResult[0][0].total);
    const rows = listResult[0];

    res.json({
      success: true,
      count: rows.length,          // rows in this page
      total,                       // rows matching the filters
      page: q.page,
      limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
      data: rows,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/movies/:id
export async function getMovieById(req, res, next) {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Movie id must be a positive integer.' });
    }
    const id = Number(req.params.id);

    const [rows] = await pool.query(`${MOVIE_SELECT} WHERE m.movie_id = ?`, [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Movie not found.' });

    const [genres, platforms, countries, directors, cast] = (
      await Promise.all([
        pool.query(
          `SELECT g.name FROM movie_genres mg JOIN genres g ON g.genre_id = mg.genre_id
            WHERE mg.movie_id = ? ORDER BY g.name`, [id]),
        pool.query(
          `SELECT p.name, mp.is_primary FROM movie_platforms mp JOIN ott_platforms p ON p.platform_id = mp.platform_id
            WHERE mp.movie_id = ? ORDER BY mp.is_primary DESC, p.name`, [id]),
        pool.query(
          `SELECT c.name FROM movie_countries mc JOIN countries c ON c.country_id = mc.country_id
            WHERE mc.movie_id = ? ORDER BY c.name`, [id]),
        pool.query(
          `SELECT pe.name FROM movie_directors md JOIN people pe ON pe.person_id = md.person_id
            WHERE md.movie_id = ? ORDER BY pe.name`, [id]),
        pool.query(
          `SELECT pe.name FROM movie_cast mc JOIN people pe ON pe.person_id = mc.person_id
            WHERE mc.movie_id = ? ORDER BY mc.billing_order, pe.name`, [id]),
      ])
    ).map((r) => r[0]);

    res.json({
      success: true,
      data: {
        ...rows[0],
        genres: genres.map((r) => r.name),
        platforms: platforms.map((r) => ({ name: r.name, is_primary: Boolean(r.is_primary) })),
        countries: countries.map((r) => r.name),
        directors: directors.map((r) => r.name),
        cast: cast.map((r) => r.name),
      },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/movies
export async function createMovie(req, res, next) {
  const { errors, clean, isValid } = validateMovie(req.body);
  if (!isValid) {
    return res.status(400).json({ success: false, message: 'Validation failed.', errors });
  }

  let conn;
  try {
    // getConnection() is inside the try so a DB outage is handled, not an unhandled rejection.
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [dups] = await conn.query(
      'SELECT movie_id FROM movies WHERE title = ? AND release_year <=> ? LIMIT 1',
      [clean.title, clean.release_year]
    );
    if (dups.length) {
      await conn.rollback();
      return res
        .status(409)
        .json({ success: false, message: 'A movie with this title and release year already exists.' });
    }

    const languageId = clean.language
      ? await getOrCreate(conn, 'languages', 'language_id', clean.language)
      : null;

    const [result] = await conn.query(
      `INSERT INTO movies
         (title, release_year, imdb_rating, runtime, age_rating, language_id, description, poster_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [clean.title, clean.release_year, clean.imdb_rating, clean.runtime,
       clean.age_rating, languageId, clean.description, clean.poster_url]
    );
    const movieId = result.insertId;

    for (const name of clean.genres) {
      const genreId = await getOrCreate(conn, 'genres', 'genre_id', name);
      await conn.query('INSERT IGNORE INTO movie_genres (movie_id, genre_id) VALUES (?, ?)', [movieId, genreId]);
    }

    if (clean.ott_platform) {
      const platformId = await getOrCreate(conn, 'ott_platforms', 'platform_id', clean.ott_platform);
      await conn.query(
        'INSERT INTO movie_platforms (movie_id, platform_id, is_primary) VALUES (?, ?, TRUE)',
        [movieId, platformId]
      );
    }

    await conn.commit();

    const [rows] = await pool.query(`${MOVIE_SELECT} WHERE m.movie_id = ?`, [movieId]);
    res.status(201).json({ success: true, message: 'Movie added successfully.', data: rows[0] });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch { /* connection already gone */ }
    }
    next(err);
  } finally {
    if (conn) conn.release();
  }
}
