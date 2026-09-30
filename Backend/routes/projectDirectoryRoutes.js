const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const { validateProject } = require('../services/projectDirectoryStore');

const accessRank = { public: 0, regular: 0, mod: 1, moderator: 1, admin: 2 };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'jpg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

function createProjectDirectoryRoutes({ store, health, verifyToken, authenticateMiddleware, authorizeMiddleware } = {}) {
  const router = express.Router();
  const auth = authenticateMiddleware && authorizeMiddleware ? null : require('../auth/authMiddleware');
  const adminOnly = [authenticateMiddleware || auth.authenticate, authorizeMiddleware || auth.authorizeRole('admin')];
  const verify = verifyToken || ((token) => require('../auth/firebase-admin').auth().verifyIdToken(token));

  async function removeUnusedThumbnail(thumbnail) {
    const name = thumbnail?.match(/^\/api\/project-directory\/images\/([a-f0-9-]+\.(?:png|jpg|webp))$/)?.[1];
    if (!name) return;
    if ((await store.read()).some((project) => project.thumbnail === thumbnail)) return;
    await fs.rm(path.join(store.imageDir, name), { force: true });
  }

  router.get('/images/:name', async (req, res) => {
    if (!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(req.params.name)) return res.sendStatus(404);
    return res.sendFile(path.join(store.imageDir, req.params.name), (error) => {
      if (error && !res.headersSent) res.sendStatus(error.code === 'ENOENT' ? 404 : 500);
    });
  });

  router.get('/', async (req, res) => {
    try {
      let role = 'public';
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (token) role = (await verify(token)).role || 'regular';
      const projects = await store.read();
      res.set('Cache-Control', 'no-store');
      res.json(projects.filter((project) => accessRank[project.access] <= (accessRank[role] ?? 0))
        .map((project) => ({ ...project, health: health.get(project) })));
    } catch (error) {
      res.status(error.code === 'auth/argument-error' || error.code?.startsWith('auth/') ? 401 : 500)
        .json({ error: error.code?.startsWith('auth/') ? 'Invalid or expired token.' : 'Failed to load project directory.' });
    }
  });

  router.get('/manage', ...adminOnly, async (_req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json((await store.read()).map((project) => ({ ...project, health: health.get(project) })));
    } catch { res.status(500).json({ error: 'Failed to load project directory.' }); }
  });

  router.post('/', ...adminOnly, async (req, res) => {
    try {
      const data = validateProject(req.body);
      const project = { id: randomUUID(), ...data };
      await store.update((projects) => { projects.push(project); });
      health.invalidate(project.id);
      res.status(201).json(project);
    } catch (error) { res.status(400).json({ error: error.message }); }
  });

  router.put('/order', ...adminOnly, async (req, res) => {
    try {
      const ids = req.body.ids;
      if (!Array.isArray(ids)) throw new Error('Order must be an array of project IDs.');
      await store.update((projects) => {
        if (ids.length !== projects.length || new Set(ids).size !== ids.length || ids.some((id) => !projects.some((project) => project.id === id))) {
          throw new Error('Order must contain every project exactly once.');
        }
        const byId = new Map(projects.map((project) => [project.id, project]));
        projects.splice(0, projects.length, ...ids.map((id) => byId.get(id)));
      });
      res.sendStatus(204);
    } catch (error) { res.status(400).json({ error: error.message }); }
  });

  router.put('/:id', ...adminOnly, async (req, res) => {
    try {
      const data = validateProject(req.body);
      const updated = await store.update((projects) => {
        const index = projects.findIndex((item) => item.id === req.params.id);
        if (index < 0) return null;
        const oldThumbnail = projects[index].thumbnail;
        projects[index] = { id: req.params.id, ...data };
        return { project: projects[index], oldThumbnail };
      });
      if (!updated) return res.sendStatus(404);
      if (updated.oldThumbnail !== updated.project.thumbnail) {
        await removeUnusedThumbnail(updated.oldThumbnail).catch((error) => console.error('Project thumbnail cleanup failed:', error));
      }
      health.invalidate(updated.project.id);
      return res.json(updated.project);
    } catch (error) { return res.status(400).json({ error: error.message }); }
  });

  router.delete('/:id', ...adminOnly, async (req, res) => {
    try {
      const removed = await store.update((projects) => {
        const index = projects.findIndex((item) => item.id === req.params.id);
        return index < 0 ? null : projects.splice(index, 1)[0];
      });
      if (!removed) return res.sendStatus(404);
      await removeUnusedThumbnail(removed.thumbnail).catch((error) => console.error('Project thumbnail cleanup failed:', error));
      health.invalidate(removed.id);
      return res.sendStatus(204);
    } catch { return res.status(500).json({ error: 'Failed to delete project.' }); }
  });

  router.post('/images', ...adminOnly, (req, res) => {
    upload.single('image')(req, res, async (error) => {
      if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Image must be 2 MB or smaller.' : 'Invalid image upload.' });
      const extension = req.file && imageType(req.file.buffer);
      if (!extension) return res.status(400).json({ error: 'Upload a PNG, JPEG, or WebP image.' });
      try {
        await fs.mkdir(store.imageDir, { recursive: true });
        const filename = `${randomUUID()}.${extension}`;
        await fs.writeFile(path.join(store.imageDir, filename), req.file.buffer, { flag: 'wx' });
        return res.status(201).json({ path: `/api/project-directory/images/${filename}` });
      } catch { return res.status(500).json({ error: 'Failed to store image.' }); }
    });
  });

  return router;
}

module.exports = { createProjectDirectoryRoutes };
