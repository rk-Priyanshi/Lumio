import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseListQuery, DEFAULT_LIMIT, MAX_LIMIT } from '../../src/utils/movieQuery.js';

describe('parseListQuery', () => {
  test('defaults: no filters, newest first, page 1', () => {
    const q = parseListQuery({});
    assert.equal(q.errors, null);
    assert.equal(q.whereSql, '');
    assert.deepEqual(q.params, []);
    assert.equal(q.page, 1);
    assert.equal(q.limit, DEFAULT_LIMIT);
    assert.equal(q.offset, 0);
    assert.match(q.orderSql, /^ORDER BY m\.created_at DESC/);
  });

  test('search is bound as a parameter and LIKE wildcards are escaped', () => {
    const q = parseListQuery({ search: '100%_off\\' });
    assert.equal(q.whereSql, 'WHERE m.title LIKE ?');
    assert.deepEqual(q.params, ['%100\\%\\_off\\\\%']);
  });

  test('SQL injection attempts never reach the SQL text', () => {
    const evil = "'; DROP TABLE movies; --";
    const q = parseListQuery({ search: evil, genre: evil, language: evil });
    assert.ok(!q.whereSql.includes('DROP'));
    assert.ok(!q.orderSql.includes('DROP'));
    assert.ok(q.params.length >= 3);
  });

  test('rejects a sort key that is not whitelisted', () => {
    const q = parseListQuery({ sort: 'title; DROP TABLE movies' });
    assert.ok(q.errors.sort);
    assert.equal(q.orderSql, '');
  });

  test('rejects unknown prototype keys as sort', () => {
    assert.ok(parseListQuery({ sort: 'constructor' }).errors.sort);
    assert.ok(parseListQuery({ sort: '__proto__' }).errors.sort);
  });

  test('sort + order', () => {
    assert.match(parseListQuery({ sort: 'rating' }).orderSql, /m\.imdb_rating IS NULL, m\.imdb_rating DESC/);
    assert.match(parseListQuery({ sort: 'rating', order: 'asc' }).orderSql, /m\.imdb_rating ASC/);
    assert.match(parseListQuery({ sort: 'title' }).orderSql, /m\.title ASC/);
    assert.ok(parseListQuery({ order: 'sideways' }).errors.order);
  });

  test('multiple filters combine with AND; list filters accept commas or repeats', () => {
    const q = parseListQuery({
      genre: 'Drama,Thriller', platform: ['Netflix', 'Hulu'], language: 'English',
      year_min: '2000', year_max: '2020', min_rating: '7.5', runtime_min: '90', runtime_max: '180',
      age_rating: 'pg-13', content_type: 'movie',
    });
    assert.equal(q.errors, null);
    assert.equal((q.whereSql.match(/ AND (?=[\w(])/g) || []).length >= 8, true);
    assert.deepEqual(q.params[0], ['Drama', 'Thriller']);
    assert.deepEqual(q.params[1], ['Netflix', 'Hulu']);
    assert.ok(q.params.includes('movie'));
    assert.ok(q.params.some((p) => Array.isArray(p) && p[0] === 'PG-13'));
  });

  test('pagination maths and limits', () => {
    const q = parseListQuery({ page: '3', limit: '10' });
    assert.equal(q.offset, 20);
    assert.ok(parseListQuery({ limit: String(MAX_LIMIT + 1) }).errors.limit);
    assert.ok(parseListQuery({ limit: '0' }).errors.limit);
    assert.ok(parseListQuery({ page: '0' }).errors.page);
    assert.ok(parseListQuery({ page: 'abc' }).errors.page);
  });

  test('range validation', () => {
    assert.ok(parseListQuery({ year_min: '2020', year_max: '2010' }).errors.year_min);
    assert.ok(parseListQuery({ min_rating: '11' }).errors.min_rating);
    assert.ok(parseListQuery({ min_rating: 'abc' }).errors.min_rating);
    assert.ok(parseListQuery({ content_type: 'podcast' }).errors.content_type);
    assert.ok(parseListQuery({ runtime_min: '200', runtime_max: '100' }).errors.runtime_min);
  });
});
