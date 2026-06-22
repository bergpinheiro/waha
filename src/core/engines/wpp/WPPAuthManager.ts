import { IWPPAuthManager } from '@waha/core/engines/wpp/IWPPAuthManager';
import { WAHASessionStatus } from '@waha/structures/enums.dto';
import { sleep } from '@waha/utils/promiseTimeout';
import { SinglePeriodicJobRunner } from '@waha/utils/SinglePeriodicJobRunner';
import * as fs from 'fs-extra';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { Logger } from 'pino';

import { Zipper } from '../webjs/RemoteAuth';
import { WPPStore } from './WPPStore';

// Only these dirs need to be backed up from the Chromium profile
const REQUIRED_DIRS = ['Default', 'IndexedDB', 'Local Storage'];
const INITIAL_DELAY_MS = 60_000;

export class WPPAuthManager implements IWPPAuthManager {
  private backupRunner: SinglePeriodicJobRunner | null = null;

  constructor(
    private readonly store: WPPStore,
    private readonly sessionName: string,
    private readonly userDataDir: string,
    private readonly zipper: Zipper,
    private readonly logger: Logger,
    private readonly getStatus: () => WAHASessionStatus,
    private readonly backupIntervalMs: number = INITIAL_DELAY_MS,
  ) {}

  async beforeStart(): Promise<void> {
    const sessionExists = await this.store.sessionExists(this.sessionName);
    if (!sessionExists) {
      this.logger.info('No remote WPP session found, starting fresh');
      await this.removePathSilently(this.userDataDir);
      return;
    }

    this.logger.info('Remote WPP session found, restoring...');
    const data = await this.store.load(this.sessionName);
    if (!data) {
      this.logger.warn('Remote WPP session data is empty, starting fresh');
      return;
    }

    const zipPath = this.getZipPath();
    await fsp.mkdir(path.dirname(zipPath), { recursive: true });
    await fsp.writeFile(zipPath, data);

    await this.removePathSilently(this.userDataDir);
    await this.zipper.uncompress(zipPath, this.userDataDir);
    await this.removePathSilently(zipPath);

    await this.removeSingletonFiles(this.userDataDir);
    await sleep(2_000);
    this.logger.info('Remote WPP session restored successfully');
  }

  async afterConnected(): Promise<void> {
    if (this.backupRunner) {
      // Already running from a previous WORKING transition
      return;
    }

    this.backupRunner = new SinglePeriodicJobRunner(
      'WPP Auth Backup',
      this.backupIntervalMs,
      this.logger,
    );
    this.backupRunner.start(() => this.saveSnapshot());
  }

  async saveSnapshot(): Promise<void> {
    if (this.getStatus() !== WAHASessionStatus.WORKING) {
      this.logger.debug('Skipping WPP snapshot - session not WORKING');
      return;
    }

    this.logger.debug('Saving WPP session snapshot...');
    const tempDir = this.getTempDir();
    const zipPath = this.getZipPath();

    try {
      await fs.copy(this.userDataDir, tempDir);
      // await this.deleteMetadata(tempDir);

      await this.zipper.compress(tempDir, zipPath);

      const data = await fsp.readFile(zipPath);
      await this.store.save(this.sessionName, data);
      this.logger.info('WPP session snapshot saved');
    } finally {
      await this.removePathSilently(tempDir);
      await this.removePathSilently(zipPath);
    }
  }

  async stop(): Promise<void> {
    this.backupRunner?.stop();
    this.backupRunner = null;
  }

  private async deleteMetadata(tempDir: string): Promise<void> {
    const dirsToScan = [tempDir, path.join(tempDir, 'Default')];
    for (const dir of dirsToScan) {
      const exists = await fs.pathExists(dir);
      if (!exists) {
        continue;
      }
      const entries = await fsp.readdir(dir);
      for (const entry of entries) {
        if (REQUIRED_DIRS.includes(entry)) {
          continue;
        }
        await this.removePathSilently(path.join(dir, entry));
      }
    }
  }

  private async removeSingletonFiles(dir: string): Promise<void> {
    const exists = await fs.pathExists(dir);
    if (!exists) {
      return;
    }
    const files = await fsp.readdir(dir);
    for (const file of files) {
      if (!file.startsWith('Singleton')) {
        continue;
      }
      await this.removePathSilently(path.join(dir, file));
    }
  }

  private async removePathSilently(targetPath: string): Promise<void> {
    try {
      await fsp.rm(targetPath, { recursive: true, force: true, maxRetries: 4 });
    } catch (err) {
      this.logger.error(err, `Failed to remove: ${targetPath}`);
    }
  }

  private getTempDir(): string {
    return `/tmp/wpp_temp_${this.sessionName}`;
  }

  private getZipPath(): string {
    return `/tmp/wpp_session_${this.sessionName}.zip`;
  }
}
