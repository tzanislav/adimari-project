/**
 * Sorting helpers shared by file-explorer style views.
 *
 * Entries are expected to use the normalized explorer shape:
 * `{ kind, name, modifiedAt, sizeBytes }`.  The helpers deliberately tolerate
 * incomplete API data so a malformed row never prevents the explorer rendering.
 */

/** @typedef {'name' | 'modified' | 'size'} FileExplorerSortKey */
/** @typedef {'asc' | 'desc'} FileExplorerSortDirection */

export const FILE_EXPLORER_SORT_KEYS = Object.freeze({
  NAME: 'name',
  MODIFIED: 'modified',
  SIZE: 'size',
});

export const FILE_EXPLORER_SORT_DIRECTIONS = Object.freeze({
  ASC: 'asc',
  DESC: 'desc',
});

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

/**
 * Returns a supported sort key, defaulting safely to name sorting.
 *
 * @param {unknown} value
 * @returns {FileExplorerSortKey}
 */
export function normalizeFileExplorerSortKey(value) {
  return Object.values(FILE_EXPLORER_SORT_KEYS).includes(value)
    ? value
    : FILE_EXPLORER_SORT_KEYS.NAME;
}

/**
 * Returns a supported direction, defaulting safely to ascending order.
 *
 * @param {unknown} value
 * @returns {FileExplorerSortDirection}
 */
export function normalizeFileExplorerSortDirection(value) {
  return value === FILE_EXPLORER_SORT_DIRECTIONS.DESC
    ? FILE_EXPLORER_SORT_DIRECTIONS.DESC
    : FILE_EXPLORER_SORT_DIRECTIONS.ASC;
}

/**
 * Identifies folders in normalized entries. `isFolder` is also understood to
 * make the helper safe to use while legacy adapters are being migrated.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
export function isFileExplorerFolder(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  return entry.kind === 'folder' || entry.isFolder === true;
}

/**
 * Converts a date value to a timestamp. Invalid or absent values produce null
 * so callers can fall back to alphabetical sorting.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function getTimestamp(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Gets a display-safe filename for comparisons. The empty string makes missing
 * names deterministic without throwing for incomplete rows.
 *
 * @param {unknown} entry
 * @returns {string}
 */
function getName(entry) {
  return entry && typeof entry === 'object' && typeof entry.name === 'string'
    ? entry.name
    : '';
}

/**
 * Gets the requested numeric sort value, or null when that value is absent or
 * invalid. A null value is deliberately kept distinct from zero.
 *
 * @param {unknown} entry
 * @param {FileExplorerSortKey} key
 * @returns {number | null}
 */
function getMetric(entry, key) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  if (key === FILE_EXPLORER_SORT_KEYS.MODIFIED) {
    return getTimestamp(entry.modifiedAt);
  }

  if (key === FILE_EXPLORER_SORT_KEYS.SIZE) {
    return Number.isFinite(entry.sizeBytes) ? entry.sizeBytes : null;
  }

  return null;
}

/**
 * Compares two normalized file explorer entries.
 * Folders always precede files, regardless of sort key or direction. If the
 * requested date/size is unavailable for either entry, that comparison falls
 * back to its name.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @param {{ key?: FileExplorerSortKey, direction?: FileExplorerSortDirection }} [options]
 * @returns {number}
 */
export function compareFileExplorerEntries(left, right, options = {}) {
  const key = normalizeFileExplorerSortKey(options.key);
  const direction = normalizeFileExplorerSortDirection(options.direction);
  const leftIsFolder = isFileExplorerFolder(left);
  const rightIsFolder = isFileExplorerFolder(right);

  if (leftIsFolder !== rightIsFolder) {
    return leftIsFolder ? -1 : 1;
  }

  const nameComparison = collator.compare(getName(left), getName(right));

  if (key === FILE_EXPLORER_SORT_KEYS.NAME) {
    return direction === FILE_EXPLORER_SORT_DIRECTIONS.DESC
      ? -nameComparison
      : nameComparison;
  }

  const leftMetric = getMetric(left, key);
  const rightMetric = getMetric(right, key);

  if (leftMetric === null || rightMetric === null) {
    return direction === FILE_EXPLORER_SORT_DIRECTIONS.DESC
      ? -nameComparison
      : nameComparison;
  }

  const metricComparison = leftMetric - rightMetric;
  if (metricComparison === 0) {
    return direction === FILE_EXPLORER_SORT_DIRECTIONS.DESC
      ? -nameComparison
      : nameComparison;
  }

  return direction === FILE_EXPLORER_SORT_DIRECTIONS.DESC
    ? -metricComparison
    : metricComparison;
}

/**
 * Sorts one folder/file group without mutating it. When any entry in the group
 * lacks the requested date or size, the whole group falls back to name sorting.
 * That keeps the result deterministic while honoring the display fallback.
 *
 * @template T
 * @param {T[]} entries
 * @param {{ key?: FileExplorerSortKey, direction?: FileExplorerSortDirection }} options
 * @returns {T[]}
 */
function sortEntryGroup(entries, options) {
  const key = normalizeFileExplorerSortKey(options.key);
  const groupUsesNameFallback = key !== FILE_EXPLORER_SORT_KEYS.NAME
    && entries.some((entry) => getMetric(entry, key) === null);
  const groupOptions = groupUsesNameFallback
    ? { ...options, key: FILE_EXPLORER_SORT_KEYS.NAME }
    : options;

  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const comparison = compareFileExplorerEntries(left.entry, right.entry, groupOptions);
      return comparison || left.index - right.index;
    })
    .map(({ entry }) => entry);
}

/**
 * Returns a new, stable sorted list without mutating the supplied entries.
 * Folders are always kept before files. Values other than arrays are treated
 * as an empty list. Equal entries retain their original order.
 *
 * @template T
 * @param {T[] | unknown} entries
 * @param {{ key?: FileExplorerSortKey, direction?: FileExplorerSortDirection }} [options]
 * @returns {T[]}
 */
export function sortFileExplorerEntries(entries, options = {}) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const folders = [];
  const files = [];

  entries.forEach((entry) => {
    (isFileExplorerFolder(entry) ? folders : files).push(entry);
  });

  return [
    ...sortEntryGroup(folders, options),
    ...sortEntryGroup(files, options),
  ];
}
