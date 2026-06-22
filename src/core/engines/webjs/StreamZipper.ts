import { Zipper } from '@waha/core/engines/webjs/RemoteAuth';

let AdmZip;
let archiver;
import * as fs from 'fs';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  AdmZip = require('adm-zip');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  archiver = require('archiver');
} catch {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  AdmZip = undefined;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  archiver = undefined;
}

export class StreamZipper implements Zipper {
  constructor() {
    if (!archiver && !AdmZip)
      throw new Error(
        'Optional Dependencies [archiver] are required to use RemoteAuth. Make sure to run npm install correctly and remove the --no-optional flag',
      );
  }

  compress(path: string, archivePath: string): Promise<void> {
    const archive = archiver('zip');
    const stream = fs.createWriteStream(archivePath);
    return new Promise((resolve, reject) => {
      archive
        .directory(path, false)
        .on('error', (err) => reject(err))
        .pipe(stream);

      stream.on('close', () => resolve(null));
      archive.finalize();
    });
  }

  async uncompress(archivePath: string, path: string): Promise<void> {
    const zip = new AdmZip(archivePath);
    await new Promise((resolve, reject) => {
      zip.extractAllToAsync(path, false, false, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(null);
        }
      });
    });
  }
}
