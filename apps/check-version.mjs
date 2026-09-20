import { readBuildInfo } from './build-info.mjs';
const info = readBuildInfo();
console.log(`Product build: v${info.version} (${info.sha})${info.released ? '' : ' [unreleased]'}`);
