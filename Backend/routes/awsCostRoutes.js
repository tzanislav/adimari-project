'use strict';

const express = require('express');
const { createAwsCostConfig } = require('../config/awsCostConfig');
const { createAwsCostService } = require('../services/awsCostService');

const router = express.Router();
let awsCostService;

const getAwsCostService = () => {
  const config = createAwsCostConfig();

  if (!config.enabled) {
    return null;
  }

  if (!awsCostService) {
    awsCostService = createAwsCostService({ config });
  }

  return awsCostService;
};

router.get('/summary', async (req, res) => {
  try {
    const service = getAwsCostService();

    if (!service) {
      return res.status(503).json({
        error: 'AWS cost reporting has not been configured for this environment.',
      });
    }

    const summary = await service.getSummary();

    res.set('Cache-Control', 'no-store, private');
    return res.json(summary);
  } catch (error) {
    console.error('Failed to retrieve AWS cost data:', error);
    return res.status(503).json({
      error: 'AWS cost data is unavailable. Confirm Cost Explorer is enabled and the server IAM identity can read it.',
    });
  }
});

module.exports = router;
