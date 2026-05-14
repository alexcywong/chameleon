import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
console.log('__dirname:', __dirname);
console.log('fp:', path.join(__dirname, '../src/data/words.json'));
import fs from 'fs';
console.log('exists:', fs.existsSync(path.join(__dirname, '../src/data/words.json')));
