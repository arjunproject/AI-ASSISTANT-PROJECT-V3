import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import QRCode from 'qrcode';

import type { AppConfig } from '../config/app-config.js';
import type { Logger } from '../core/logger.js';

export interface QrOpenResult {
  opened: boolean;
  paintPid: number | null;
}

export interface QrManager {
  generate(qrValue: string): Promise<QrOpenResult>;
  clear(): Promise<void>;
  dispose(): Promise<void>;
}

export interface QrManagerDependencies {
  openQrInPaint?: (filePath: string, paintCommand: string) => Promise<QrOpenResult>;
}

export function createQrManager(
  config: AppConfig,
  logger: Logger,
  dependencies: QrManagerDependencies = {},
): QrManager {
  const openQrInPaint = dependencies.openQrInPaint ?? defaultOpenQrInPaint;
  let paintProcess: ChildProcess | null = null;

  return {
    async generate(qrValue) {
      await mkdir(dirname(config.whatsappQrFilePath), { recursive: true });
      await QRCode.toFile(config.whatsappQrFilePath, qrValue, {
        errorCorrectionLevel: 'M',
        margin: 2,
        type: 'png',
        width: 420,
      });

      logger.info('whatsapp.qr.generated', {
        qrFilePath: config.whatsappQrFilePath,
      });

      try {
        if (paintProcess && paintProcess.exitCode === null) {
          paintProcess.kill();
        }
      } catch {
        paintProcess = null;
      }

      const result = await openQrInPaint(config.whatsappQrFilePath, config.paintCommand);
      if (result.opened) {
        logger.info('whatsapp.qr.opened_in_paint', {
          qrFilePath: config.whatsappQrFilePath,
          paintPid: result.paintPid,
        });
      }

      return result;
    },
    async clear() {
      try {
        if (paintProcess && paintProcess.exitCode === null) {
          paintProcess.kill();
        }
      } catch {
        paintProcess = null;
      }

      await rm(config.whatsappQrFilePath, { force: true });
    },
    async dispose() {
      await this.clear();
    },
  };

  async function defaultOpenQrInPaint(filePath: string, paintCommand: string): Promise<QrOpenResult> {
    const child = spawn(paintCommand, [filePath], {
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    paintProcess = child;
    return {
      opened: true,
      paintPid: child.pid ?? null,
    };
  }
}
