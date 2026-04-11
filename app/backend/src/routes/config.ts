import { Router, Request, Response } from 'express';
import {
  getConfig,
  getAllConfig,
  setConfigAsync,
  deleteConfig,
} from '../db.js';

const router = Router();

// Get all configuration
router.get('/config', (req: Request, res: Response) => {
  try {
    const config = getAllConfig();

    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch configuration',
    });
  }
});

// Get specific configuration key
router.get('/config/:key', (req: Request, res: Response) => {
  try {
    const value = getConfig(req.params.key);

    if (value === undefined) {
      res.status(404).json({
        success: false,
        error: 'Configuration key not found',
      });
      return;
    }

    res.json({
      success: true,
      data: {
        key: req.params.key,
        value,
      },
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch configuration',
    });
  }
});

// Update configuration
router.put('/config', async (req: Request, res: Response) => {
  try {
    const { key, value, description } = req.body;

    if (!key || value === undefined) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: key, value',
      });
      return;
    }

    await setConfigAsync(key, String(value), description);

    res.json({
      success: true,
      data: {
        key,
        value: String(value),
        description,
      },
    });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update configuration',
    });
  }
});

// Update specific configuration key
router.put('/config/:key', async (req: Request, res: Response) => {
  try {
    const { value, description } = req.body;

    if (value === undefined) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: value',
      });
      return;
    }

    await setConfigAsync(req.params.key, String(value), description);

    res.json({
      success: true,
      data: {
        key: req.params.key,
        value: String(value),
        description,
      },
    });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update configuration',
    });
  }
});

// Delete configuration key
router.delete('/config/:key', (req: Request, res: Response) => {
  try {
    const deleted = deleteConfig(req.params.key);

    if (deleted === 0) {
      res.status(404).json({
        success: false,
        error: 'Configuration key not found',
      });
      return;
    }

    res.json({
      success: true,
      message: `Configuration key '${req.params.key}' deleted`,
    });
  } catch (error) {
    console.error('Error deleting config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete configuration',
    });
  }
});

export default router;
