import express from 'express';
import { getAnalyticsSummary, recordVisit } from '../utils/analytics.js';

const router = express.Router();

/**
 * POST /api/analytics/ping
 * Record client-side page view
 */
router.post('/analytics/ping', (req, res) => {
  try {
    recordVisit(req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/analytics/stats
 * Real-time visitor and download stats summary
 */
router.get('/analytics/stats', (req, res) => {
  try {
    const summary = getAnalyticsSummary();
    res.json({
      success: true,
      data: summary
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
