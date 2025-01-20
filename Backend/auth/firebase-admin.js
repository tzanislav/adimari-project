// firebase-admin.js
const admin = require('firebase-admin');

// Use the Firebase service account key
const serviceAccount = require('./account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

module.exports = admin;
