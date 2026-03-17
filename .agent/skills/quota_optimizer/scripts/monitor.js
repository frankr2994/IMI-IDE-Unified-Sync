import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const igFolder = path.join(projectRoot, '.agent');

const getFolderSize = (dir) => {
  let totalSize = 0;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file === 'node_modules' || file === '.git') continue;
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        totalSize += getFolderSize(filePath);
      } else {
        totalSize += stat.size;
      }
    }
  } catch (e) {}
  return totalSize;
};

const currentSizeInKB = Math.round(getFolderSize(projectRoot) / 1024);
const contextLimit = 128 * 1024; // 128MB as a safe "token heavy" mark
const usagePercent = Math.min(100, (currentSizeInKB / contextLimit) * 100);

console.log(`=== IMI QUOTA MONITOR ===`);
console.log(`Current Project Size: ${currentSizeInKB}KB`);
console.log(`Context Saturation: ${usagePercent.toFixed(2)}%`);

if (usagePercent > 80) {
  console.log(`[!] CRITICAL: You are running out of 'Antigravity' tokens.`);
  console.log(`[Action] Move current task to GOOGLE JULES (Cloud Async).`);
} else {
  console.log(`[+] OK: Context is within comfortable Antigravity limits.`);
}
