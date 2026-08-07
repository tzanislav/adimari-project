'use strict';

const CLEARANCES = Object.freeze({
  MODERATOR: 'moderator',
  ADMIN: 'admin',
});

const VALID_CLEARANCES = new Set(Object.values(CLEARANCES));

const isAdmin = (user) => user?.role === 'admin';
const isModerator = (user) => user?.role === 'moderator';

const isSupportedLicenseRole = (user) => isAdmin(user) || isModerator(user);

const isValidClearance = (clearance) => VALID_CLEARANCES.has(clearance);

const canSetClearance = (user, clearance) => {
  if (!isValidClearance(clearance)) {
    return false;
  }

  return isAdmin(user) || (isModerator(user) && clearance === CLEARANCES.MODERATOR);
};

const readableLicenseFilter = (user) => {
  if (isAdmin(user)) {
    return {};
  }

  if (isModerator(user)) {
    return { clearances: CLEARANCES.MODERATOR };
  }

  return { _id: null };
};

const licenseFilterById = (user, id) => ({
  _id: id,
  ...readableLicenseFilter(user),
});

module.exports = {
  CLEARANCES,
  canSetClearance,
  isSupportedLicenseRole,
  isValidClearance,
  licenseFilterById,
  readableLicenseFilter,
};
