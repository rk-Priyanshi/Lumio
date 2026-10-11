import app from './app.js';
import { pool } from './config/db.js';

const PORT = process.env.PORT || 5000;

try {
  await pool.query('SELECT 1');
  console.log('MySQL connected');
} catch (err) {
  console.error('MySQL connection failed:', err.message);
  console.error('The API will start, but requests that need the database will return 503.');
}

app.listen(PORT, () => console.log(`Lumio API running on http://localhost:${PORT}/api`));
