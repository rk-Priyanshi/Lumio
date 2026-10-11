export const AGE_RATINGS = [
  'G', 'PG', 'PG-13', 'R', 'NC-17', 'U', 'U/A', 'A', 'TV-MA', 'TV-14', 'TV-PG',
];

const LIMITS = { title: 255, name: 50, platform: 80, poster: 500, description: 10000, genres: 10 };

function toNumber(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : Number(t);
  }
  return NaN;
}

function toText(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Validates and normalises the POST /movies body.
 * Returns { isValid, errors, clean }. Never throws.
 */
export function validateMovie(body) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {};
  const clean = {};

  const title = toText(b.title);
  if (!title) errors.title = 'Title is required.';
  else if (title.length > LIMITS.title) errors.title = `Title must be ${LIMITS.title} characters or fewer.`;
  clean.title = title;

  const year = toNumber(b.release_year);
  if (year !== null && (!Number.isInteger(year) || year < 1888 || year > 2100))
    errors.release_year = 'Release year must be a whole number between 1888 and 2100.';
  clean.release_year = year;

  const rating = toNumber(b.imdb_rating);
  if (rating !== null && (Number.isNaN(rating) || rating < 0 || rating > 10))
    errors.imdb_rating = 'IMDb rating must be between 0 and 10.';
  clean.imdb_rating = rating;

  const runtime = toNumber(b.runtime);
  if (runtime !== null && (!Number.isInteger(runtime) || runtime <= 0 || runtime > 1000))
    errors.runtime = 'Runtime must be a positive whole number of minutes (max 1000).';
  clean.runtime = runtime;

  const age = toText(b.age_rating);
  if (age && !AGE_RATINGS.includes(age.toUpperCase())) errors.age_rating = 'Unsupported age certification.';
  clean.age_rating = age ? age.toUpperCase() : null;

  // genre may arrive as "Drama" or "Drama, Thriller"
  const genreText = toText(b.genre);
  const genres = genreText
    ? [...new Set(genreText.split(',').map((g) => g.trim()).filter(Boolean))]
    : [];
  if (genres.length > LIMITS.genres) errors.genre = `At most ${LIMITS.genres} genres are allowed.`;
  else if (genres.some((g) => g.length > LIMITS.name))
    errors.genre = `Each genre must be ${LIMITS.name} characters or fewer.`;
  clean.genres = genres;

  const language = toText(b.language);
  if (language && language.length > LIMITS.name) errors.language = `Language must be ${LIMITS.name} characters or fewer.`;
  clean.language = language;

  const platform = toText(b.ott_platform);
  if (platform && platform.length > LIMITS.platform)
    errors.ott_platform = `OTT platform must be ${LIMITS.platform} characters or fewer.`;
  clean.ott_platform = platform;

  const description = toText(b.description);
  if (description && description.length > LIMITS.description)
    errors.description = `Description must be ${LIMITS.description} characters or fewer.`;
  clean.description = description;

  const poster = toText(b.poster_url);
  if (poster) {
    let ok = poster.length <= LIMITS.poster;
    if (ok) {
      try {
        ok = ['http:', 'https:'].includes(new URL(poster).protocol);
      } catch {
        ok = false;
      }
    }
    if (!ok) errors.poster_url = 'Poster URL must be a valid http:// or https:// link (max 500 characters).';
  }
  clean.poster_url = poster;

  return { isValid: Object.keys(errors).length === 0, errors, clean };
}
