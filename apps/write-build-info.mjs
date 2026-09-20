import fs from 'node:fs';
import { readBuildInfo } from './build-info.mjs';
const target = new URL('./local-server/dist/build-info.js', import.meta.url);
// This replaces tsc's own emit, whose source reads Git at run time. Writing beside a moved emit
// would leave an orphan while the served module kept reading Git, so require the file to be there.
if (!fs.existsSync(target)) throw Error('apps/local-server/dist/build-info.js is missing; tsc did not emit where the frozen build identity belongs.');
fs.writeFileSync(target, `export const buildInfo = ${JSON.stringify(readBuildInfo())};\n`);
