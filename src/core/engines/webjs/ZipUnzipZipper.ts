import { Zipper } from '@waha/core/engines/webjs/RemoteAuth';
import { execFile as execFileOrigin } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFile = promisify(execFileOrigin);

export class ZipUnzipZipper implements Zipper {
  async compress(dirPath: string, archivePath: string): Promise<void> {
    // resolve archivePath to full path
    const archiveFullPath = path.resolve(archivePath);
    const dirFullPath = path.resolve(dirPath);
    const opts = {
      cwd: dirFullPath,
    };
    await execFile('zip', ['-rq1', archiveFullPath, '.'], opts);
    return;
  }

  async uncompress(archivePath: string, dirPath: string): Promise<void> {
    const archiveFullPath = path.resolve(archivePath);
    const dirFullPath = path.resolve(dirPath);
    // upsert path, create if not exist
    fs.mkdirSync(dirFullPath, { recursive: true });

    await execFile('unzip', ['-q', archiveFullPath, '-d', dirFullPath]);
    return;
  }
}
