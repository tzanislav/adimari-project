// firebase-admin.js
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const loadServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const configuredPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    return JSON.parse(fs.readFileSync(configuredPath, 'utf8'));
  }

  const localPath = path.join(__dirname, 'account.json');
  if (process.env.NODE_ENV !== 'production' && fs.existsSync(localPath)) {
    return require(localPath);
  }

  throw new Error('Firebase service account credentials are not configured.');
};

// Use the Firebase service account key
const serviceAccount = loadServiceAccount();

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
