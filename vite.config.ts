import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const SAMPLES = join(__dirname, 'samples');
const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.json': 'application/json' };

/**
 * Serves local test footage from ./samples at /samples while developing.
 * Kept out of public/ so match video never ends up in a build.
 */
function localSamples(): Plugin {
  return {
    name: 'local-samples',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/samples', (req, res, next) => {
        const file = normalize(join(SAMPLES, decodeURIComponent((req.url ?? '').split('?')[0])));
        if (!file.startsWith(SAMPLES + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        const size = statSync(file).size;
        const type = TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream';
        // Video seeking needs range requests.
        const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
        if (range) {
          const start = Number(range[1] || 0);
          const end = range[2] ? Number(range[2]) : size - 1;
          res.writeHead(206, {
            'Content-Type': type,
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Cache-Control': 'no-store',
          });
          createReadStream(file, { start, end }).pipe(res);
        } else {
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
          createReadStream(file).pipe(res);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localSamples()],
  // host: true lets an iPad or phone on the same Wi-Fi open the dev server.
  server: { host: true, port: 5173 },
});
