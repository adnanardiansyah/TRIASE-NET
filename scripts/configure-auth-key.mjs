import { readFile, appendFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const path=new URL('../.env',import.meta.url);const source=await readFile(path,'utf8');
if(!/^AUTH_ENCRYPTION_KEY_BASE64=.+$/m.test(source)){await appendFile(path,`\nAUTH_ENCRYPTION_KEY_BASE64=${randomBytes(32).toString('base64')}\n`);}
process.stdout.write('Konfigurasi kunci autentikator tersedia; nilai tidak ditampilkan.\n');
