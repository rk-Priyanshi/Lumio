import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  clean, toInt, splitList, isoToLanguageName, tmdbImage, transformRow,
} from '../../src/utils/datasetTransform.js';

// Modelled on the "Inception" row shown in the dataset viewer on Hugging Face.
const inception = {
  id: '27205', title: 'Inception', vote_average: '8.364', vote_count: '34495', status: 'Released',
  release_date: '2010-07-15', revenue: '825532764', runtime: '148', adult: 'false',
  backdrop_path: '/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg', budget: '160000000', homepage: 'null',
  tconst: 'tt1375666', original_language: 'en', overview: 'A thief who steals secrets...',
  popularity: '83.952', poster_path: '/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg',
  tagline: 'Your mind is the scene of the crime.',
  genres: 'Action, Science Fiction, Adventure',
  production_countries: 'United Kingdom, United States of America',
  directors: 'Christopher Nolan', averageRating: '8.8', numVotes: '2770171',
  cast: 'Leonardo DiCaprio, Joseph Gordon-Levitt, Ken Watanabe',
};

describe('helpers', () => {
  test('clean treats null-like strings as null', () => {
    for (const v of ['', 'null', 'NULL', 'NaN', undefined, null, '  ']) assert.equal(clean(v), null);
    assert.equal(clean(' hi '), 'hi');
  });

  test('toInt strips thousands separators and rejects junk', () => {
    assert.equal(toInt('27,205'), 27205);
    assert.equal(toInt('148.0'), 148);
    assert.equal(toInt('abc'), null);
    assert.equal(toInt(''), null);
  });

  test('splitList trims, de-duplicates, caps, and skips name suffixes', () => {
    assert.deepEqual(splitList('A, B, A,  C'), ['A', 'B', 'C']);
    assert.deepEqual(splitList('Sammy Davis, Jr., Frank Sinatra'), ['Sammy Davis', 'Frank Sinatra']);
    assert.deepEqual(splitList('A,B,C,D', { max: 2 }), ['A', 'B']);
    assert.deepEqual(splitList('null'), []);
    assert.deepEqual(splitList('Science Fiction, Drama', { aliases: { 'Science Fiction': 'Sci-Fi' } }), ['Sci-Fi', 'Drama']);
  });

  test('language codes become names', () => {
    assert.equal(isoToLanguageName('en'), 'English');
    assert.equal(isoToLanguageName('ta'), 'Tamil');
    assert.equal(isoToLanguageName(''), null);
  });

  test('tmdbImage builds full URLs only for valid paths', () => {
    assert.equal(tmdbImage('/abc.jpg', 'w500'), 'https://image.tmdb.org/t/p/w500/abc.jpg');
    assert.equal(tmdbImage('null', 'w500'), null);
    assert.equal(tmdbImage('abc.jpg', 'w500'), null);
  });
});

describe('transformRow', () => {
  test('maps a normal row', () => {
    const t = transformRow(inception);
    assert.equal(t.skip, undefined);
    assert.equal(t.movie.tmdb_id, 27205);
    assert.equal(t.movie.imdb_id, 'tt1375666');
    assert.equal(t.movie.title, 'Inception');
    assert.equal(t.movie.release_date, '2010-07-15');
    assert.equal(t.movie.release_year, 2010);
    assert.equal(t.movie.imdb_rating, 8.8);
    assert.equal(t.movie.imdb_votes, 2770171);
    assert.equal(t.movie.runtime, 148);
    assert.equal(t.movie.popularity, 83.952);
    assert.equal(t.movie.poster_url, 'https://image.tmdb.org/t/p/w500/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg');
    assert.equal(t.movie.backdrop_url, 'https://image.tmdb.org/t/p/w1280/8ZTVqvKDQ8emSGUEMjsS4yHAwrp.jpg');
    assert.equal(t.movie.budget, 160000000);
    assert.equal(t.languageName, 'English');
    assert.deepEqual(t.genres, ['Action', 'Sci-Fi', 'Adventure']);
    assert.deepEqual(t.countries, ['United Kingdom', 'United States of America']);
    assert.deepEqual(t.directors, ['Christopher Nolan']);
    assert.equal(t.cast.length, 3);
  });

  test('--no-cast drops the cast but keeps directors', () => {
    const t = transformRow(inception, { includeCast: false });
    assert.deepEqual(t.cast, []);
    assert.equal(t.directors.length, 1);
  });

  test('skips rows that should not be imported', () => {
    assert.equal(transformRow({ ...inception, adult: 'True' }).skip, 'adult');
    assert.equal(transformRow({ ...inception, adult: 'True' }, { includeAdult: true }).skip, undefined);
    assert.equal(transformRow({ ...inception, status: 'Planned' }).skip, 'not-released');
    assert.equal(transformRow({ ...inception, release_date: '' }).skip, 'no-date');
    assert.equal(transformRow({ ...inception, release_date: '2010' }).skip, 'no-date');
    assert.equal(transformRow({ ...inception, title: '' }).skip, 'no-title');
    assert.equal(transformRow({ ...inception, id: 'x' }).skip, 'bad-id');
    assert.equal(transformRow({ ...inception, numVotes: '10' }).skip, 'low-votes');
    assert.equal(transformRow({ ...inception, numVotes: '' }, { minVotes: 0 }).skip, undefined);
  });

  test('turns unknown values into NULL instead of bad data', () => {
    const t = transformRow({
      ...inception, runtime: '0', revenue: '0', budget: '0', averageRating: '', imdb_votes: '',
      tconst: 'null', poster_path: 'null', tagline: 'null',
    });
    assert.equal(t.movie.runtime, null);
    assert.equal(t.movie.revenue, null);
    assert.equal(t.movie.budget, null);
    assert.equal(t.movie.imdb_rating, null);
    assert.equal(t.movie.imdb_id, null);
    assert.equal(t.movie.poster_url, null);
    assert.equal(t.movie.tagline, null);
  });

  test('clamps over-long text to the column sizes', () => {
    const t = transformRow({ ...inception, title: 'x'.repeat(400), tagline: 'y'.repeat(900) });
    assert.equal(t.movie.title.length, 255);
    assert.equal(t.movie.tagline.length, 500);
  });
});
