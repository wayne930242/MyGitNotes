import { createWebApp } from './app/create-web-app.js';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');
createWebApp(root);
