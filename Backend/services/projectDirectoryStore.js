const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const seedPath = path.join(__dirname, '../seeds/projectDirectory.json');
const allowedAccess = new Set(['public', 'mod', 'admin']);

function validateHttpUrl(value, field) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${field} must be a valid HTTP(S) URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${field} must be a valid HTTP(S) URL without credentials.`);
  }
  return url.href;
}

function validateProject(input) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const thumbnailAlt = typeof input.thumbnailAlt === 'string' ? input.thumbnailAlt.trim() : '';
  const thumbnail = typeof input.thumbnail === 'string' ? input.thumbnail.trim() : '';
  const healthUrl = typeof input.healthUrl === 'string' ? input.healthUrl.trim() : '';
  const type = input.link?.type;
  const value = typeof input.link?.value === 'string' ? input.link.value.trim() : '';
  if (!title || title.length > 100) throw new Error('Title must be 1–100 characters.');
  if (description.length > 500) throw new Error('Description must be at most 500 characters.');
  if (!allowedAccess.has(input.access)) throw new Error('Choose Public, Mod, or Admin access.');
  if (!['internal', 'external'].includes(type)) throw new Error('Choose an internal or external link.');
  if (type === 'internal' && (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[?#]/.test(value))) {
    throw new Error('Internal link must be a local path starting with /.');
  }
  if (type === 'external') validateHttpUrl(value, 'External link');
  if (!value || value.length > 2048) throw new Error('Link must be 1–2048 characters.');
  if (thumbnail && (!/^\/[a-zA-Z0-9._/-]+$/.test(thumbnail) || thumbnail.includes('..') || thumbnail.startsWith('//'))) {
    throw new Error('Thumbnail must be a local image path.');
  }
  if (thumbnailAlt.length > 150) throw new Error('Thumbnail description is too long.');
  if (healthUrl) validateHttpUrl(healthUrl, 'Health URL');
  if (healthUrl.length > 2048) throw new Error('Health URL is too long.');
  return { title, description, link: { type, value }, thumbnail, thumbnailAlt, access: input.access, healthUrl };
}

function createProjectDirectoryStore({ dataDir = process.env.PROJECT_DIRECTORY_DATA_DIR || path.join(__dirname, '../data/project-directory') } = {}) {
  const filePath = path.join(dataDir, 'projects.json');
  const imageDir = path.join(dataDir, 'images');
  let writeChain = Promise.resolve();

  async function read() {
    try {
      const projects = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (!Array.isArray(projects)) throw new Error('Project directory file must contain an array.');
      return projects;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(dataDir, { recursive: true });
      const seed = await fs.readFile(seedPath, 'utf8');
      try { await fs.writeFile(filePath, seed, { flag: 'wx' }); } catch (writeError) {
        if (writeError.code !== 'EEXIST') throw writeError;
      }
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    }
  }

  function update(change) {
    const operation = writeChain.then(async () => {
      const projects = await read();
      const result = change(projects);
      const tempPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tempPath, `${JSON.stringify(projects, null, 2)}\n`);
        await fs.rename(tempPath, filePath);
      } finally {
        await fs.rm(tempPath, { force: true }).catch(() => {});
      }
      return result;
    });
    writeChain = operation.catch(() => {});
    return operation;
  }

  return { read, update, imageDir };
}

module.exports = { createProjectDirectoryStore, validateProject };
