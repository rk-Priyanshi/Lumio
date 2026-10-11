import { pool } from '../config/db.js';

// Dropdown data for the frontend filters / Add Movie form, with movie counts (GROUP BY).
const lookup = (sql) => async (req, res, next) => {
  try {
    const [rows] = await pool.query(sql);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    next(err);
  }
};

export const getGenres = lookup(`
  SELECT g.genre_id AS id, g.name, COUNT(mg.movie_id) AS movie_count
    FROM genres g LEFT JOIN movie_genres mg ON mg.genre_id = g.genre_id
   GROUP BY g.genre_id, g.name ORDER BY g.name`);

export const getLanguages = lookup(`
  SELECT l.language_id AS id, l.name, COUNT(m.movie_id) AS movie_count
    FROM languages l LEFT JOIN movies m ON m.language_id = l.language_id
   GROUP BY l.language_id, l.name ORDER BY movie_count DESC, l.name`);

export const getPlatforms = lookup(`
  SELECT p.platform_id AS id, p.name, COUNT(mp.movie_id) AS movie_count
    FROM ott_platforms p LEFT JOIN movie_platforms mp ON mp.platform_id = p.platform_id
   GROUP BY p.platform_id, p.name ORDER BY p.name`);

// Small aggregate summary for a dashboard widget.
export async function getStats(req, res, next) {
  try {
    const [[totals]] = await pool.query(
      `SELECT COUNT(*) AS total_movies,
              ROUND(AVG(imdb_rating), 2) AS avg_rating,
              ROUND(AVG(runtime), 0) AS avg_runtime,
              MIN(release_year) AS earliest_year,
              MAX(release_year) AS latest_year
         FROM movies`
    );
    const [topGenres] = await pool.query(
      `SELECT g.name, COUNT(*) AS movie_count, ROUND(AVG(m.imdb_rating), 2) AS avg_rating
         FROM genres g
         JOIN movie_genres mg ON mg.genre_id = g.genre_id
         JOIN movies m ON m.movie_id = mg.movie_id
        GROUP BY g.genre_id, g.name
        ORDER BY movie_count DESC, g.name
        LIMIT 5`
    );
    res.json({
      success: true,
      data: {
        total_movies: Number(totals.total_movies),
        avg_rating: totals.avg_rating,
        avg_runtime: totals.avg_runtime === null ? null : Number(totals.avg_runtime),
        earliest_year: totals.earliest_year,
        latest_year: totals.latest_year,
        top_genres: topGenres,
      },
    });
  } catch (err) {
    next(err);
  }
}
