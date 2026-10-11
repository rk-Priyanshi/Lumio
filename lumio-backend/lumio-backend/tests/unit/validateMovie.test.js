import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateMovie } from '../../src/utils/validateMovie.js';

const valid = {
  title: '  Inception ',
  release_year: 2010,
  genre: 'Sci-Fi, Thriller',
  imdb_rating: 8.8,
  runtime: 148,
  age_rating: 'pg-13',
  language: 'English',
  ott_platform: 'Netflix',
  description: 'A thief enters dreams.',
  poster_url: null,
};

describe('validateMovie', () => {
  test('accepts a complete valid movie and normalises it', () => {
    const r = validateMovie(valid);
    assert.equal(r.isValid, true);
    assert.deepEqual(r.errors, {});
    assert.equal(r.clean.title, 'Inception');
    assert.deepEqual(r.clean.genres, ['Sci-Fi', 'Thriller']);
    assert.equal(r.clean.age_rating, 'PG-13');
    assert.equal(r.clean.poster_url, null);
  });

  test('only the title is required', () => {
    const r = validateMovie({ title: 'Only Title' });
    assert.equal(r.isValid, true);
    assert.equal(r.clean.release_year, null);
    assert.deepEqual(r.clean.genres, []);
  });

  test('rejects missing / blank title', () => {
    assert.ok(validateMovie({}).errors.title);
    assert.ok(validateMovie({ title: '   ' }).errors.title);
    assert.ok(validateMovie(undefined).errors.title);
    assert.ok(validateMovie({ title: 123 }).errors.title);
  });

  test('rejects out-of-range numbers', () => {
    const r = validateMovie({ ...valid, release_year: 1700, imdb_rating: 11, runtime: 0 });
    assert.equal(r.isValid, false);
    assert.ok(r.errors.release_year);
    assert.ok(r.errors.imdb_rating);
    assert.ok(r.errors.runtime);
  });

  test('rejects non-numeric and fractional values', () => {
    assert.ok(validateMovie({ ...valid, release_year: 'abc' }).errors.release_year);
    assert.ok(validateMovie({ ...valid, release_year: 2010.5 }).errors.release_year);
    assert.ok(validateMovie({ ...valid, runtime: 90.5 }).errors.runtime);
    assert.ok(validateMovie({ ...valid, imdb_rating: {} }).errors.imdb_rating);
  });

  test('accepts numeric strings and empty strings from form inputs', () => {
    const r = validateMovie({ title: 'X', release_year: '2020', imdb_rating: '7.5', runtime: '' });
    assert.equal(r.isValid, true);
    assert.equal(r.clean.release_year, 2020);
    assert.equal(r.clean.imdb_rating, 7.5);
    assert.equal(r.clean.runtime, null);
  });

  test('rejects unsupported age certification', () => {
    assert.ok(validateMovie({ ...valid, age_rating: 'XYZ' }).errors.age_rating);
  });

  test('validates poster URL', () => {
    assert.ok(validateMovie({ ...valid, poster_url: 'not a url' }).errors.poster_url);
    assert.ok(validateMovie({ ...valid, poster_url: 'ftp://example.com/a.jpg' }).errors.poster_url);
    assert.ok(validateMovie({ ...valid, poster_url: 'javascript:alert(1)' }).errors.poster_url);
    assert.equal(validateMovie({ ...valid, poster_url: 'https://example.com/a.jpg' }).isValid, true);
  });

  test('enforces genre limits and de-duplicates', () => {
    assert.deepEqual(validateMovie({ title: 'X', genre: 'Drama, Drama,  ' }).clean.genres, ['Drama']);
    assert.ok(validateMovie({ title: 'X', genre: 'a'.repeat(51) }).errors.genre);
    const many = Array.from({ length: 11 }, (_, i) => `G${i}`).join(',');
    assert.ok(validateMovie({ title: 'X', genre: many }).errors.genre);
  });

  test('enforces title length', () => {
    assert.ok(validateMovie({ title: 'a'.repeat(256) }).errors.title);
  });
});
