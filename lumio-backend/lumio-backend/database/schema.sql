-- Lumio schema v2 (normalised to 3NF). Safe to re-run: every table uses IF NOT EXISTS.
-- To run by hand in Workbench, select the target schema first:  USE lumio;
-- `npm run db:init` creates the database and runs this file for you.

CREATE TABLE IF NOT EXISTS languages (
  language_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS genres (
  genre_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS ott_platforms (
  platform_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS countries (
  country_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS people (
  person_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS movies (
  movie_id INT AUTO_INCREMENT PRIMARY KEY,
  tmdb_id INT NULL UNIQUE,
  imdb_id VARCHAR(12) NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  tagline VARCHAR(500) NULL,
  release_date DATE NULL,
  release_year SMALLINT UNSIGNED NULL,
  imdb_rating DECIMAL(3,1) NULL,
  imdb_votes INT UNSIGNED NULL,
  popularity DECIMAL(10,3) NULL,
  runtime SMALLINT UNSIGNED NULL,
  age_rating VARCHAR(10) NULL,
  language_id INT NULL,
  description TEXT NULL,
  poster_url VARCHAR(500) NULL,
  backdrop_url VARCHAR(500) NULL,
  budget BIGINT UNSIGNED NULL,
  revenue BIGINT UNSIGNED NULL,
  content_type ENUM('movie','tv_show') NOT NULL DEFAULT 'movie',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_movies_language FOREIGN KEY (language_id)
    REFERENCES languages(language_id) ON DELETE SET NULL,
  CONSTRAINT chk_rating  CHECK (imdb_rating IS NULL OR imdb_rating BETWEEN 0 AND 10),
  CONSTRAINT chk_year    CHECK (release_year IS NULL OR release_year BETWEEN 1888 AND 2100),
  CONSTRAINT chk_runtime CHECK (runtime IS NULL OR runtime > 0),

  INDEX idx_title (title),
  INDEX idx_year (release_year),
  INDEX idx_rating (imdb_rating),
  INDEX idx_popularity (popularity),
  INDEX idx_created (created_at)
);

CREATE TABLE IF NOT EXISTS movie_genres (
  movie_id INT NOT NULL,
  genre_id INT NOT NULL,
  PRIMARY KEY (movie_id, genre_id),
  FOREIGN KEY (movie_id) REFERENCES movies(movie_id) ON DELETE CASCADE,
  FOREIGN KEY (genre_id) REFERENCES genres(genre_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS movie_platforms (
  movie_id INT NOT NULL,
  platform_id INT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (movie_id, platform_id),
  FOREIGN KEY (movie_id) REFERENCES movies(movie_id) ON DELETE CASCADE,
  FOREIGN KEY (platform_id) REFERENCES ott_platforms(platform_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS movie_countries (
  movie_id INT NOT NULL,
  country_id INT NOT NULL,
  PRIMARY KEY (movie_id, country_id),
  FOREIGN KEY (movie_id) REFERENCES movies(movie_id) ON DELETE CASCADE,
  FOREIGN KEY (country_id) REFERENCES countries(country_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS movie_directors (
  movie_id INT NOT NULL,
  person_id INT NOT NULL,
  PRIMARY KEY (movie_id, person_id),
  FOREIGN KEY (movie_id) REFERENCES movies(movie_id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(person_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS movie_cast (
  movie_id INT NOT NULL,
  person_id INT NOT NULL,
  billing_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (movie_id, person_id),
  FOREIGN KEY (movie_id) REFERENCES movies(movie_id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people(person_id) ON DELETE CASCADE
);

-- Lookup values the Add Movie form commonly needs. Not movie data.
INSERT IGNORE INTO ott_platforms (name) VALUES
  ('Netflix'),('Amazon Prime Video'),('Disney+ Hotstar'),('Apple TV+'),('JioCinema');
