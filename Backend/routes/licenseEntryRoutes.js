const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const LicenseEntry = require('../models/LicenseEntry');
const { authenticate, authorizeRole } = require('../auth/authMiddleware');
const {
    CLEARANCES,
    canSetClearance,
    isValidClearance,
    licenseFilterById,
    readableLicenseFilter,
} = require('../security/licenseAccessPolicy');
const { getLicensePasswordCrypto } = require('../security/licensePasswordCrypto');

const WRITABLE_FIELDS = [
    'user',
    'platform',
    'usedBy',
    'comment',
    'price',
    'imageUrl',
    'expiresAt',
];

const invalidLicenseData = (res) => res.status(400).send({ error: 'Invalid license data.' });
const unavailableLicense = (res) => res.status(404).send({ message: 'License not found.' });

const copyWritableFields = (body = {}) => WRITABLE_FIELDS.reduce((license, field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
        license[field] = body[field];
    }
    return license;
}, {});

const requestedClearance = (user, body, fallback = CLEARANCES.MODERATOR) => {
    const clearance = Object.prototype.hasOwnProperty.call(body || {}, 'clearances')
        ? body.clearances
        : fallback;

    if (!isValidClearance(clearance) || !canSetClearance(user, clearance)) {
        return null;
    }

    return clearance;
};

const isValidId = (id) => mongoose.isValidObjectId(id);

const licenseResponse = (license) => {
    const response = license.toObject ? license.toObject() : { ...license };
    response.password = getLicensePasswordCrypto().decrypt(response.passwordEncrypted);
    delete response.passwordEncrypted;
    return response;
};

const submittedPassword = (body, { required = false } = {}) => {
    if (!Object.prototype.hasOwnProperty.call(body || {}, 'password')) {
        return required ? null : undefined;
    }

    if (typeof body.password !== 'string' || body.password.length === 0) {
        return null;
    }

    return body.password;
};

const selectSecretFields = (query) => query.select('+passwordEncrypted');

router.use(authenticate, authorizeRole(['admin', 'moderator']));

router.get('/', async (req, res) => {
    try {
        const licenses = await selectSecretFields(LicenseEntry.find(readableLicenseFilter(req.user)));
        res.status(200).send(licenses.map(licenseResponse));
    } catch {
        res.status(500).send({ error: 'Failed to fetch licenses.' });
    }
});

router.post('/', async (req, res) => {
    const clearance = requestedClearance(req.user, req.body);
    const password = submittedPassword(req.body, { required: true });
    if (!clearance || password === null) {
        return invalidLicenseData(res);
    }

    try {
        const newLicense = new LicenseEntry({
            ...copyWritableFields(req.body),
            clearances: clearance,
            createdBy: req.user.email || req.user.uid,
            passwordEncrypted: getLicensePasswordCrypto().encrypt(password),
        });
        const result = await newLicense.save();
        res.status(201).send({ message: 'License added successfully!', license: licenseResponse(result) });
    } catch (error) {
        if (error.name === 'ValidationError') {
            return invalidLicenseData(res);
        }
        res.status(500).send({ error: 'Failed to add license.' });
    }
});

router.get('/:id', async (req, res) => {
    if (!isValidId(req.params.id)) {
        return unavailableLicense(res);
    }

    try {
        const license = await selectSecretFields(
            LicenseEntry.findOne(licenseFilterById(req.user, req.params.id)),
        );
        if (!license) {
            return unavailableLicense(res);
        }
        res.status(200).send(licenseResponse(license));
    } catch {
        res.status(500).send({ error: 'Failed to fetch license.' });
    }
});

router.put('/:id', async (req, res) => {
    if (!isValidId(req.params.id)) {
        return unavailableLicense(res);
    }

    try {
        const currentLicense = await selectSecretFields(
            LicenseEntry.findOne(licenseFilterById(req.user, req.params.id)),
        );
        if (!currentLicense) {
            return unavailableLicense(res);
        }

        const clearance = requestedClearance(req.user, req.body, currentLicense.clearances);
        if (!clearance) {
            return invalidLicenseData(res);
        }
        const password = submittedPassword(req.body);
        if (password === null) {
            return invalidLicenseData(res);
        }

        const updates = {
            ...copyWritableFields(req.body),
            clearances: clearance,
        };
        const updateOperation = { $set: updates };
        if (password !== undefined) {
            updates.passwordEncrypted = getLicensePasswordCrypto().encrypt(password);
        }

        const license = await selectSecretFields(LicenseEntry.findOneAndUpdate(
            licenseFilterById(req.user, req.params.id),
            updateOperation,
            { new: true, runValidators: true },
        ));
        if (!license) {
            return unavailableLicense(res);
        }
        res.status(200).send({ message: 'License updated successfully!', license: licenseResponse(license) });
    } catch (error) {
        if (error.name === 'ValidationError' || error.name === 'CastError') {
            return invalidLicenseData(res);
        }
        res.status(500).send({ error: 'Failed to update license.' });
    }
});

router.delete('/:id', async (req, res) => {
    if (!isValidId(req.params.id)) {
        return unavailableLicense(res);
    }

    try {
        const license = await LicenseEntry.findOneAndDelete(licenseFilterById(req.user, req.params.id));
        if (!license) {
            return unavailableLicense(res);
        }
        res.status(200).send({ message: 'License deleted successfully!' });
    } catch {
        res.status(500).send({ error: 'Failed to delete license.' });
    }
});




module.exports = router;
