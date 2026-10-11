// Builds the WHERE / ORDER BY / LIMIT parts of GET /movies from the query string.
// Pure (no DB access) so it can be unit tested. Assumes the aliases:
//   m = movies, l = languages.
// Every user value goes into `params` and is bound with `?`. The only strings
// concatenated into SQL come from the fixed whitelists below.

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

const SORTS = {
  added:      { col: 'm.created_at',  nullable: false, then: 'm.popularity DESC', defaultOrder: 'desc' },
  popularity: { col: 'm.popularity',  nullable: true,  defaultOrder: 'desc' },
  rating:     { col: 'm.imdb_rating', nullable: true,  then: 'm.imdb_votes DESC', defaultOrder: 'desc' },
  year:       { col: 'm.release_year', nullable: true, defaultOrder: 'desc' },
  title:      { col: 'm.title',       nullable: false, defaultOrder: 'asc' },
  runtime:    { col: 'm.runtime',     nullable: true,  defaultOrder: 'desc' },
};

const asList = (v) =>
  (Array.isArray(v) ? v : [v])
    .flatMap((x) => (typeof x === 'string' ? x.split(',') : []))
    .map((s) => s.trim())
    .filter(Boolean);

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

function intParam(q, name, min, max, errors) {
  const raw = q[name];
  if (raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors[name] = `${name} must be a whole number between ${min} and ${max}.`;
    return null;
  }
  return n;
}

export function parseListQuery(q = {}) {
  const errors = {};
  const where = [];
  const params = [];

  const search = typeof q.search === 'string' ? q.search.trim() : '';
  if (search) {
    where.push('m.title LIKE ?');
    params.push(`%${escapeLike(search)}%`);
  }

  // Multi-value filters: ?genre=Drama,Thriller matches movies having ANY of them.
  const genres = asList(q.genre).slice(0, 10);
  if (genres.length) {
    where.push(`EXISTS (SELECT 1 FROM movie_genres mg JOIN genres g ON g.genre_id = mg.genre_id
                        WHERE mg.movie_id = m.movie_id AND g.name IN (?))`);
    params.push(genres);
  }

  const platforms = asList(q.platform).slice(0, 10);
  if (platforms.length) {
    where.push(`EXISTS (SELECT 1 FROM movie_platforms mp JOIN ott_platforms p ON p.platform_id = mp.platform_id
                        WHERE mp.movie_id = m.movie_id AND p.name IN (?))`);
    params.push(platforms);
  }

  const countries = asList(q.country).slice(0, 10);
  if (countries.length) {
    where.push(`EXISTS (SELECT 1 FROM movie_countries mc JOIN countries c ON c.country_id = mc.country_id
                        WHERE mc.movie_id = m.movie_id AND c.name IN (?))`);
    params.push(countries);
  }

  const languages = asList(q.language).slice(0, 10);
  if (languages.length) {
    where.push('l.name IN (?)');
    params.push(languages);
  }

  const ages = asList(q.age_rating).slice(0, 10);
  if (ages.length) {
    where.push('m.age_rating IN (?)');
    params.push(ages.map((a) => a.toUpperCase()));
  }

  if (q.content_type !== undefined && q.content_type !== '') {
    if (['movie', 'tv_show'].includes(q.content_type)) {
      where.push('m.content_type = ?');
      params.push(q.content_type);
    } else errors.content_type = 'content_type must be "movie" or "tv_show".';
  }

  const yearMin = intParam(q, 'year_min', 1888, 2100, errors);
  const yearMax = intParam(q, 'year_max', 1888, 2100, errors);
  if (yearMin !== null && yearMax !== null && yearMin > yearMax)
    errors.year_min = 'year_min cannot be greater than year_max.';
  if (yearMin !== null) { where.push('m.release_year >= ?'); params.push(yearMin); }
  if (yearMax !== null) { where.push('m.release_year <= ?'); params.push(yearMax); }

  const rtMin = intParam(q, 'runtime_min', 1, 1000, errors);
  const rtMax = intParam(q, 'runtime_max', 1, 1000, errors);
  if (rtMin !== null && rtMax !== null && rtMin > rtMax)
    errors.runtime_min = 'runtime_min cannot be greater than runtime_max.';
  if (rtMin !== null) { where.push('m.runtime >= ?'); params.push(rtMin); }
  if (rtMax !== null) { where.push('m.runtime <= ?'); params.push(rtMax); }

  if (q.min_rating !== undefined && q.min_rating !== '') {
    const r = Number(q.min_rating);
    if (Number.isNaN(r) || r < 0 || r > 10) errors.min_rating = 'min_rating must be between 0 and 10.';
    else { where.push('m.imdb_rating >= ?'); params.push(r); }
  }

  // Sorting (whitelisted)
  const sortKey = q.sort === undefined || q.sort === '' ? 'added' : q.sort;
  const sort = Object.prototype.hasOwnProperty.call(SORTS, sortKey) ? SORTS[sortKey] : null;
  if (!sort) errors.sort = `sort must be one of: ${Object.keys(SORTS).join(', ')}.`;

  let order = sort ? sort.defaultOrder : 'desc';
  if (q.order !== undefined && q.order !== '') {
    const o = String(q.order).toLowerCase();
    if (o === 'asc' || o === 'desc') order = o;
    else errors.order = 'order must be "asc" or "desc".';
  }

  const page = intParam(q, 'page', 1, 1000000, errors) ?? 1;
  const limit = intParam(q, 'limit', 1, MAX_LIMIT, errors) ?? DEFAULT_LIMIT;

  let orderSql = '';
  if (sort) {
    const dir = order.toUpperCase();
    orderSql =
      'ORDER BY ' +
      (sort.nullable ? `${sort.col} IS NULL, ` : '') +
      `${sort.col} ${dir}` +
      (sort.then ? `, ${sort.then}` : '') +
      ', m.movie_id DESC';
  }

  return {
    errors: Object.keys(errors).length ? errors : null,
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    orderSql,
    page,
    limit,
    offset: (page - 1) * limit,
  };
}
