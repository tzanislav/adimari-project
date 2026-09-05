'use strict';

const express = require('express');
const { createOpenAiCostConfig } = require('../config/openAiCostConfig');
const { createOpenAiCostService } = require('../services/openAiCostService');

const router = express.Router();
let openAiCostService;

const getOpenAiCostService = () => {
  const config = createOpenAiCostConfig();

  if (!config.enabled) {
    return null;
  }

  if (!openAiCostService) {
    openAiCostService = createOpenAiCostService({ config });
  }

  return openAiCostService;
};

router.get('/summary', async (req, res) => {
  try {
    const service = getOpenAiCostService();

    if (!service) {
      return res.status(503).json({
        error: 'OpenAI cost reporting has not been configured for this environment.',
      });
    }

    const summary = await service.getSummary();

    res.set('Cache-Control', 'no-store, private');
    return res.json(summary);
  } catch (error) {
    console.error('Failed to retrieve OpenAI cost data:', error);
    return res.status(503).json({
      error: 'OpenAI cost data is unavailable. Confirm the server has a valid Organization Admin API key.',
    });
  }
});

module.exports = router;
