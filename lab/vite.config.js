import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const labDir = import.meta.dirname;
const repoDir = path.resolve(labDir, '..');
const outDir = path.join(labDir, 'out');

const SAVEABLE = /\.(jpe?g|png|json)$/i;

// POST /__save?path=<relative file> writes the request body under lab/out/, so the pages can save what they capture.
const save = {
  name: 'lab-save',
  configureServer(server) {
    server.middlewares.use('/__save', (req, res) => {
      const relative = new URL(req.url, 'http://lab').searchParams.get('path') ?? '';
      const file = path.resolve(outDir, relative);
      if (req.method !== 'POST' || !file.startsWith(outDir + path.sep) || !SAVEABLE.test(file)) {
        res.statusCode = 400;
        res.end('bad request');
        return;
      }
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        try {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, Buffer.concat(chunks));
          res.end('ok');
        } catch (error) {
          res.statusCode = 500;
          res.end(error.message);
        }
      });
    });
  },
};

export default defineConfig({
  root: labDir,
  publicDir: path.join(repoDir, 'demo', 'public'),
  plugins: [save],
  // TalkingHead loads its lip-sync modules relative to itself; prebundling breaks those paths.
  optimizeDeps: { exclude: ['talkinghead'] },
  // No hot reload: a reload in the middle of a capture run loses it. Reload by hand.
  server: { port: 5174, strictPort: true, hmr: false, fs: { allow: [repoDir] } },
});
