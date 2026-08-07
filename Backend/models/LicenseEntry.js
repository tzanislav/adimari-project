const mongoose = require('mongoose');

const encryptedPasswordSchema = new mongoose.Schema({
    version: { type: Number, required: true, enum: [1] },
    algorithm: { type: String, required: true, enum: ['aes-256-gcm'] },
    keyId: { type: String, required: true },
    iv: { type: String, required: true },
    ciphertext: { type: String, required: true },
    authTag: { type: String, required: true },
}, { _id: false });

// Defines the credentials stored in the 'licenses' collection.
const licenseEntrySchema = new mongoose.Schema({
    user: { type: String, required: true },
    passwordEncrypted: { type: encryptedPasswordSchema, required: true, select: false },
    platform: { type: String, default: true },
    usedBy: { type: String, default: null },
    comment : { type: String, default: null },
    price : { type: Number, default: null },
    imageUrl : { type: String, default: null },
    expiresAt: { type: Date, default: null },
    clearances: { type: String, enum: ['moderator', 'private', 'admin'], default: 'moderator', required: true },
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: String, default: null },
    createdByUid: { type: String, default: null, immutable: true, index: true },
});

// Export the model
module.exports = mongoose.model('License', licenseEntrySchema, 'licenses');
