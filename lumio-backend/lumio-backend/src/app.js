import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './config/db.js';
import movieRoutes from './routes/movieRoutes.js';
import lookupRoutes from './routes/lookupRoutes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

dotenv.config();

const app = express();

const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({ origin: origins }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ success: false, status: 'error', database: 'disconnected' });
  }
});

app.use('/api/movies', movieRoutes);
app.use('/api', lookupRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
