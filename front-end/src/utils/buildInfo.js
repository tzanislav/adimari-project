const buildTimestamp = import.meta.env.VITE_ADIMARI_BUILD_TIMESTAMP;
const buildRevision = import.meta.env.VITE_ADIMARI_BUILD_REVISION;

function pad(value) {
  return String(value).padStart(2, '0');
}

export function formatBuildTimestamp(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return 'Build time unavailable';
  }

  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join('-') + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

export const buildInfoLabel = [
  buildRevision ? `Revision ${buildRevision}` : null,
  `Build ${formatBuildTimestamp(buildTimestamp)}`,
].filter(Boolean).join(' \u00b7 ');

export const buildInfoTitle = buildTimestamp || 'Build timestamp unavailable';
