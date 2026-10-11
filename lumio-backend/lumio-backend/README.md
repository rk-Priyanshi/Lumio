# Lumio backend

Node.js + Express + MySQL API for the Lumio frontend. Milestone 1 covers **Create** and **Read**
for movies, plus search / filter / sort / pagination, lookup endpoints, a stats endpoint, a dataset
importer and an automated test suite.

Requires **Node 20+** and **MySQL 8**.

## 1. Quick start

```bash
npm install
cp .env.example .env          # Windows: copy .env.example .env   then fill in the passwords
```

1. In MySQL Workbench, run `database/create_user.sql` as root (change the password inside it first).
2. In `.env` set `DB_PASSWORD` (the app user) and `DB_ADMIN_PASSWORD` (root, used only by `db:init`).
3. Create the database and tables:
   ```bash
   npm run db:init
   ```
4. Start the API:
   ```bash
   npm run dev
   ```
   You should see `MySQL connected` and `Lumio API running on http://localhost:5000/api`.
5. Check it: open <http://localhost:5000/api/health>.

> Upgrading from the first guide's schema? The schema changed (new columns and tables). Run
> `npm run db:init -- --reset` once. **This drops the `lumio` database and everything in it.**

## 2. Load the real dataset (optional but recommended)

Dataset: <https://huggingface.co/datasets/HenryWaltson/TMDB-IMDB-Movies-Dataset>
(one 278 MB CSV, about 435k rows).

1. On the dataset's **Files and versions** tab, download `TMDB  IMDB Movies Dataset.csv`
   and save it as `data/movies.csv`.
2. Import:
   ```bash
   npm run db:import -- data/movies.csv --limit 20000
   ```

| Flag | Meaning |
|---|---|
| `--limit N` | Stop after N accepted movies. The file appears to be ordered by vote count, so this keeps the best-known titles. |
| `--min-votes N` | Skip titles with fewer than N IMDb votes (default 500). Rows with no IMDb match count as 0 votes. |
| `--no-cast` | Skip cast members. Much faster; directors are still imported. |
| `--include-adult` | Also import rows flagged adult (skipped by default). |

The import is re-runnable: movies are matched on `tmdb_id`, so existing rows are left unchanged.
Poster and backdrop columns are stored as full `https://image.tmdb.org/t/p/...` URLs.

What the dataset does **not** contain: age certification, OTT platform availability, TV shows and
moods. Those columns stay empty for imported rows, so the Age / OTT / Mood filters will only match
movies you add yourself until you add that data.

## 3. Tests

```bash
npm run test:unit      # no database needed: validation, query builder, dataset transform
```

The API tests use a separate database so they can never touch your real data:

```bash
npm run db:init:test   # creates lumio_test (needs DB_ADMIN_* in .env)
npm test               # unit tests + API tests against lumio_test
```

The API tests refuse to run unless the database name ends in `_test`.
They cover: health, create (201), validation (400), duplicate (409), malformed JSON, persistence in
the normalised tables, pagination, search, wildcard escaping, combined filters, sorting, 404 / 400
on bad ids, SQL-injection attempts, lookups and stats.

For manual testing use `requests.http` (VS Code REST Client extension) or Postman.

## 4. API

Base URL: `http://localhost:5000/api`. All responses are JSON with `success: true | false`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | API and database status |
| GET | `/movies` | Catalogue (paginated, filterable) |
| GET | `/movies/:id` | One movie plus genres, platforms, countries, directors, cast |
| POST | `/movies` | Create a movie (201, 400 with `errors{}`, 409 duplicate) |
| GET | `/genres` `/languages` `/platforms` | Dropdown values with `movie_count` |
| GET | `/stats` | Totals, averages, top genres |

`GET /movies` query parameters:

| Param | Example | Notes |
|---|---|---|
| `search` | `inter` | Title contains |
| `genre`, `platform`, `country`, `language`, `age_rating` | `genre=Drama,Thriller` | Comma-separated or repeated; matches ANY value |
| `content_type` | `movie` | `movie` or `tv_show` |
| `year_min`, `year_max` | `2000` | |
| `min_rating` | `7.5` | IMDb rating |
| `runtime_min`, `runtime_max` | `90` | Minutes |
| `sort` | `rating` | `added` (default), `popularity`, `rating`, `year`, `title`, `runtime` |
| `order` | `asc` | `asc` or `desc` (each sort has a sensible default) |
| `page`, `limit` | `2`, `25` | `limit` 1 to 100, default 25 |

Response:

```json
{ "success": true, "count": 25, "total": 18342, "page": 1, "limit": 25, "totalPages": 734, "data": [ ... ] }
```

`count` is the number of rows in this page; use **`total`** for "Total movies".
Every movie has: `id, title, tagline, release_date, release_year, imdb_rating, imdb_votes, popularity,
runtime, age_rating, language, description, poster_url, backdrop_url, budget, revenue, content_type,
created_at, genre, ott_platform`.

## 5. Design notes (useful for the report)

- **Normalised to 3NF**: `movies` plus lookup tables (`genres`, `languages`, `countries`, `ott_platforms`,
  `people`) and junction tables (`movie_genres`, `movie_platforms`, `movie_countries`, `movie_directors`,
  `movie_cast`).
- **Transactions**: `POST /movies` writes the movie and all its links in one transaction; any failure rolls everything back.
- **SQL injection**: every user value is a bound parameter. Sort columns come from a fixed whitelist.
- **Duplicates**: there is no `UNIQUE(title, release_year)` because the dataset legitimately contains
  different films with the same title and year. `POST /movies` checks for duplicates in code instead.
- **Genres**: the importer renames TMDB's "Science Fiction" to "Sci-Fi" to match the frontend's genre list.
- **Not covered yet**: PUT / DELETE, authentication, mood tables, user tables (later milestones).

## 6. Troubleshooting

| Problem | Likely cause |
|---|---|
| `ECONNREFUSED 3306` | MySQL service isn't running |
| `ER_ACCESS_DENIED_ERROR` | Wrong `DB_USER` / `DB_PASSWORD`, or `create_user.sql` wasn't run |
| `db:init` says access denied | Set `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD` in `.env` |
| Browser CORS error | `CORS_ORIGIN` must exactly match the frontend origin (scheme, host and port) |
| Import: "CSV is missing expected columns" | Wrong file, or the dataset's columns changed; the message lists what was found |
| Frontend still hits the old URL | Restart `npm run dev` after editing the frontend's `.env` |

## Dataset credit

Movie data: HenryWaltson/TMDB-IMDB-Movies-Dataset on Hugging Face (TMDB + IMDb data). Check the
dataset card for its licence and cite it in your report. Images are served from TMDB; if you show them,
include TMDB's attribution.
