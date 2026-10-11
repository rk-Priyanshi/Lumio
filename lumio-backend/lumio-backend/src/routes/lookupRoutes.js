import { Router } from 'express';
import { getGenres, getLanguages, getPlatforms, getStats } from '../controllers/lookupController.js';

const router = Router();
router.get('/genres', getGenres);
router.get('/languages', getLanguages);
router.get('/platforms', getPlatforms);
router.get('/stats', getStats);
export default router;
