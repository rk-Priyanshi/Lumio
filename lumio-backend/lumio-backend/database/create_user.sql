-- Run once in MySQL Workbench as root. Change the password first.
-- If lumio_user already exists from an earlier setup, the CREATE USER line is skipped
-- and only the grants are added.
CREATE USER IF NOT EXISTS 'lumio_user'@'localhost' IDENTIFIED BY 'ChooseAStrongPassword!';

CREATE DATABASE IF NOT EXISTS lumio      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS lumio_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

GRANT SELECT, INSERT, UPDATE, DELETE ON lumio.*      TO 'lumio_user'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON lumio_test.* TO 'lumio_user'@'localhost';
FLUSH PRIVILEGES;
