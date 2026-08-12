'use strict';

const mongoose = require('mongoose');

// This collection never contains the raw enrollment token. A redeemed token is
// retained only for a short recovery window so the same connector can safely
// recover if the original successful HTTP response was lost. Eligibility is
// still checked against expiresAt atomically at first redemption.
const nasEnrollmentTokenSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  tokenHash: { type: String, required: true, unique: true, select: false },
  createdBy: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
  recoveryExpiresAt: { type: Date, required: true },
  purpose: { type: String, enum: ['initial_enrollment', 're_enrollment'], default: 'initial_enrollment', required: true, index: true },
  targetConnectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasConnector', default: null, index: true },
  // For a re-enrollment token, this binds the token to the credential state
  // that existed when an administrator issued it. It prevents a stale token
  // from rotating a credential that has already changed.
  targetCredentialHash: { type: String, default: null, select: false },
  consumedAt: { type: Date, default: null, index: true },
  consumedInstallationId: { type: String, default: null, maxlength: 200 },
  // This is an HMAC of the submitted device secret, never the raw secret.
  // It binds a recovery attempt to the exact original enrollment request.
  consumedDeviceSecretHash: { type: String, default: null, select: false },
  consumedByConnectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasConnector', default: null, index: true },
  revokedAt: { type: Date, default: null, index: true },
  revokedBy: { type: String, default: null },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

nasEnrollmentTokenSchema.index({ recoveryExpiresAt: 1 }, { expireAfterSeconds: 0 });
nasEnrollmentTokenSchema.index({ createdBy: 1, createdAt: -1 });
nasEnrollmentTokenSchema.index({ targetConnectorId: 1, purpose: 1, consumedAt: 1, revokedAt: 1 });

module.exports = mongoose.models.NasEnrollmentToken
  || mongoose.model('NasEnrollmentToken', nasEnrollmentTokenSchema, 'nas_enrollment_tokens');
