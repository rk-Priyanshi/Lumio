// Converts one row of "TMDB IMDB Movies Dataset.csv" (HenryWaltson, Hugging Face)
// into the shape the Lumio schema expects. Pure functions, no I/O.

const NULLISH = new Set(['', 'null', 'none', 'nan', 'undefined', '\\n']);
const NAME_SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv)$/i;   // "Sammy Davis, Jr." splits on the comma
const TMDB_IMG = 'https://image.tmdb.org/t/p';

// TMDB says "Science Fiction"; the Lumio UI says "Sci-Fi".
const GENRE_ALIASES = { 'Science Fiction': 'Sci-Fi' };

export function clean(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return NULLISH.has(s.toLowerCase()) ? null : s;
}

export function toInt(v) {
  const s = clean(v);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function toFloat(v) {
  const s = clean(v);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function splitList(v, { max = Infinity, maxLen = 150, aliases = {} } = {}) {
  const s = clean(v);
  if (!s) return [];
  const seen = new Set();
  const out = [];
  for (const part of s.split(',')) {
    let t = part.trim();
    if (!t || NAME_SUFFIX.test(t)) continue;
    t = (aliases[t] ?? t).slice(0, maxLen);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });

export function isoToLanguageName(code) {
  const c = clean(code);
  if (!c) return null;
  try {
    const name = displayNames.of(c);
    return name && name !== c ? name : c.toUpperCase();
  } catch {
    return c.toUpperCase();
  }
}

export function tmdbImage(path, size) {
  const p = clean(path);
  return p && p.startsWith('/') ? `${TMDB_IMG}/${size}${p}` : null;
}

/**
 * @returns {{ skip: string }} when the row should not be imported, else
 *          { movie, genres, countries, directors, cast, languageName }
 */
export function transformRow(row, opts = {}) {
  const { minVotes = 500, includeAdult = false, includeCast = true } = opts;

  const tmdbId = toInt(row.id);
  if (!tmdbId || tmdbId <= 0) return { skip: 'bad-id' };

  const title = clean(row.title);
  if (!title) return { skip: 'no-title' };

  const status = clean(row.status);
  if (status && status !== 'Released') return { skip: 'not-released' };

  if (!includeAdult && String(row.adult).trim().toLowerCase() === 'true') return { skip: 'adult' };

  const dateStr = clean(row.release_date);
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { skip: 'no-date' };
  const year = Number(dateStr.slice(0, 4));
  if (year < 1888 || year > 2100) return { skip: 'no-date' };

  const votes = toInt(row.numVotes) ?? 0;
  if (votes < minVotes) return { skip: 'low-votes' };

  let rating = toFloat(row.averageRating);
  if (rating !== null && (rating <= 0 || rating > 10)) rating = null;

  let runtime = toInt(row.runtime);
  if (runtime !== null && (runtime <= 0 || runtime > 1000)) runtime = null;

  let popularity = toFloat(row.popularity);
  if (popularity !== null) popularity = popularity < 0 || popularity > 9999999 ? null : Math.round(popularity * 1000) / 1000;

  const money = (v) => {
    const n = toInt(v);
    return n !== null && n > 0 ? n : null;   // 0 in this dataset means "unknown"
  };

  const imdbId = clean(row.tconst);

  return {
    movie: {
      tmdb_id: tmdbId,
      imdb_id: imdbId && /^tt\d{1,10}$/.test(imdbId) ? imdbId : null,
      title: title.slice(0, 255),
      tagline: clean(row.tagline)?.slice(0, 500) ?? null,
      release_date: dateStr,
      release_year: year,
      imdb_rating: rating,
      imdb_votes: votes || null,
      popularity,
      runtime,
      description: clean(row.overview),
      poster_url: tmdbImage(row.poster_path, 'w500'),
      backdrop_url: tmdbImage(row.backdrop_path, 'w1280'),
      budget: money(row.budget),
      revenue: money(row.revenue),
    },
    languageName: isoToLanguageName(row.original_language),
    genres: splitList(row.genres, { max: 10, maxLen: 50, aliases: GENRE_ALIASES }),
    countries: splitList(row.production_countries, { max: 10, maxLen: 100 }),
    directors: splitList(row.directors, { max: 5, maxLen: 150 }),
    cast: includeCast ? splitList(row.cast, { max: 10, maxLen: 150 }) : [],
  };
}
