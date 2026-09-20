import fs from 'node:fs';
import { readBuildInfo } from './build-info.mjs';
fs.writeFileSync(new URL('./local-server/dist/build-info.js', import.meta.url), `export const buildInfo = ${JSON.stringify(readBuildInfo())};\n`);
