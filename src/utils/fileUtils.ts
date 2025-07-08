import * as fs from 'fs-extra';
import * as path from 'path';

export async function findPackageJson(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = startDir;
  
  while (currentDir !== path.dirname(currentDir)) {
    const packageJsonPath = path.join(currentDir, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      return packageJsonPath;
    }
    currentDir = path.dirname(currentDir);
  }
  
  return null;
}

export async function isProjectRoot(dir: string): Promise<boolean> {
  const packageJsonPath = path.join(dir, 'package.json');
  return fs.pathExists(packageJsonPath);
}

export function getRelativePath(from: string, to: string): string {
  const relativePath = path.relative(from, to);
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_');
}

export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  await fs.ensureDir(dirPath);
}

export function isTextFile(filePath: string): boolean {
  const textExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.md', '.json', '.yml', '.yaml', '.txt'];
  const ext = path.extname(filePath).toLowerCase();
  return textExtensions.includes(ext);
}

export async function getFileSize(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}

export async function getFileLineCount(filePath: string): Promise<number> {
  const content = await fs.readFile(filePath, 'utf8');
  return content.split('\n').length;
}

export function createTimestampedBackupName(originalPath: string): string {
  const ext = path.extname(originalPath);
  const name = path.basename(originalPath, ext);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${name}-${timestamp}${ext}.backup`;
}