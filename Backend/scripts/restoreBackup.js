const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { EJSON } = mongoose.mongo.BSON;

const [backupPath, replaceFlag] = process.argv.slice(2);
const shouldReplace = replaceFlag === '--replace';

const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};

const restore = async () => {
  if (!backupPath) {
    return fail('Usage: node scripts/restoreBackup.js <backup-file.json> [--replace]');
  }

  if (!process.env.MONGODB_URI) {
    return fail('MONGODB_URI must point to the destination MongoDB database.');
  }

  const resolvedPath = path.resolve(backupPath);
  if (!fs.existsSync(resolvedPath)) {
    return fail(`Backup file not found: ${resolvedPath}`);
  }

  let backup;
  try {
    backup = EJSON.parse(fs.readFileSync(resolvedPath, 'utf8'), { relaxed: false });
  } catch (error) {
    return fail(`Could not read the backup file: ${error.message}`);
  }

  if (backup?.format !== 'adimari-mongodb-backup' || backup?.version !== 1 || !backup.collections) {
    return fail('This is not a supported Adimari MongoDB backup file.');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const database = mongoose.connection.db;

  try {
    const existingCollections = await database.listCollections({}, { nameOnly: true }).toArray();
    const existingNames = new Set(existingCollections.map((collection) => collection.name));

    for (const [name, content] of Object.entries(backup.collections)) {
      if (existingNames.has(name)) {
        if (!shouldReplace) {
          throw new Error(`Destination collection "${name}" already exists. Re-run with --replace to delete and restore it.`);
        }

        await database.dropCollection(name);
      }

      const collection = database.collection(name);
      const documents = Array.isArray(content.documents) ? content.documents : [];
      const indexes = Array.isArray(content.indexes) ? content.indexes : [];

      if (documents.length > 0) {
        await collection.insertMany(documents);
      }

      const secondaryIndexes = indexes.filter((index) => index.name !== '_id_');
      if (secondaryIndexes.length > 0) {
        await collection.createIndexes(secondaryIndexes);
      }

      console.log(`Restored ${name}: ${documents.length} document(s).`);
    }
  } finally {
    await mongoose.disconnect();
  }
};

restore().catch((error) => fail(`Restore failed: ${error.message}`));
