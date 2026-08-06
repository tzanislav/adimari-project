const express = require('express');
const mongoose = require('mongoose');
const { EJSON } = mongoose.mongo.BSON;

const router = express.Router();
const excludedCollectionNames = new Set(['activity_log']);

const createBackupFilename = () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `adimari-mongodb-backup-${timestamp}.json`;
};

// This router is mounted behind Firebase authentication and the admin role check in server.js.
router.get('/backup', async (req, res) => {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return res.status(503).json({ error: 'Database connection is not ready.' });
  }

  try {
    const database = mongoose.connection.db;
    const collectionInfos = await database.listCollections({}, { nameOnly: false }).toArray();
    const collections = {};

    for (const collectionInfo of collectionInfos) {
      if (collectionInfo.type !== 'collection' || excludedCollectionNames.has(collectionInfo.name)) {
        continue;
      }

      const collection = database.collection(collectionInfo.name);
      const [documents, indexes] = await Promise.all([
        collection.find({}).toArray(),
        collection.indexes(),
      ]);

      collections[collectionInfo.name] = { documents, indexes };
    }

    const backup = {
      format: 'adimari-mongodb-backup',
      version: 1,
      exportedAt: new Date(),
      database: database.databaseName,
      collections,
    };

    // Strict Extended JSON keeps ObjectIds, Dates, and other BSON values intact for restoration.
    const payload = EJSON.stringify(backup, null, 2, { relaxed: false });

    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${createBackupFilename()}"`,
      'Cache-Control': 'no-store, private',
    });
    return res.send(payload);
  } catch (error) {
    console.error('Failed to create database backup:', error);
    return res.status(500).json({ error: 'Failed to create database backup.' });
  }
});

module.exports = router;
