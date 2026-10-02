import { config } from './config.js';
import { createApp } from './app.js';
import { ensureAdmin } from '../scripts/ensure-admin.js';

ensureAdmin();
const server = createApp();
server.listen(config.port, () => {
  console.log(`APWEN API listening on http://localhost:${config.port}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
