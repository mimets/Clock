import fs from 'fs';
import pngToIco from 'png-to-ico';

const buf = await pngToIco('icon.png');
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.ico', buf);
console.log('build/icon.ico created', buf.length, 'bytes');
