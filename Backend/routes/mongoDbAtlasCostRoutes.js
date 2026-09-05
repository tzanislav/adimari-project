'use strict';

const express = require('express');
const { createMongoDbAtlasCostConfig } = require('../config/mongoDbAtlasCostConfig');
const { createMongoDbAtlasCostService } = require('../services/mongoDbAtlasCostService');

const router = express.Router();
let mongoDbAtlasCostService;

const getMongoDbAtlasCostService = () => {
  const config = createMongoDbAtlasCostConfig();
  if (!config.enabled) return null;

  if (!mongoDbAtlasCostService) {
    mongoDbAtlasCostService = createMongoDbAtlasCostService({ config });
  }

  return mongoDbAtlasCostService;
};

router.get('/summary', async (req, res) => {
  try {
    const service = getMongoDbAtlasCostService();
    if (!service) {
      return res.status(503).json({ error: 'MongoDB Atlas cost reporting has not been configured for this environment.' });
    }

    const summary = await service.getSummary();
    res.set('Cache-Control', 'no-store, private');
    return res.json(summary);
  } catch (error) {
    console.error('Failed to retrieve MongoDB Atlas cost data:', error);
    return res.status(503).json({
      error: 'MongoDB Atlas cost data is unavailable. Confirm the Atlas service account can view organization billing data.',
    });
  }
});

module.exports = router;
