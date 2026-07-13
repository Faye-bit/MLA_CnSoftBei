/**
 * optimize-avatars.mjs
 *
 * 从 SVG 壳文件中提取嵌入的 base64 PNG 图片，缩放到适合前端显示的尺寸，
 * 输出为优化后的 PNG 到 public/avatars/ 目录。
 *
 * 使用 macOS 自带的 sips 工具进行缩放，零额外依赖。
 *
 * 用法：node scripts/optimize-avatars.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ---- 配置 ---- */

/** 前端 public 目录路径 */
const PUBLIC_DIR = join(__dirname, '..', 'public');
/** 优化后图片输出目录 */
const OUTPUT_DIR = join(PUBLIC_DIR, 'avatars');
/** 缩放最大尺寸（像素） */
const MAX_SIZE = 256;

/**
 * 源文件配置
 * src:  相对于 public/ 的路径
 * out:  输出文件名
 */
const SOURCES = [
  // 智能体头像（12个）
  { src: 'Agents/CaiFeng.svg',    out: 'caifeng.png' },
  { src: 'Agents/DaiMa.svg',      out: 'daima.png' },
  { src: 'Agents/DongHua.svg',    out: 'donghua.png' },
  { src: 'Agents/HuoRan.svg',     out: 'huoran.png' },
  { src: 'Agents/JianZheng.svg',  out: 'jianzheng.png' },
  { src: 'Agents/LiGang.svg',     out: 'ligang.png' },
  { src: 'Agents/TuSi.svg',       out: 'tusi.png' },
  { src: 'Agents/XiangNan.svg',   out: 'xiangnan.png' },
  { src: 'Agents/XiZheng.svg',    out: 'xizheng.png' },
  { src: 'Agents/YueDu.svg',      out: 'yuedu.png' },
  { src: 'Agents/YuZhi.svg',      out: 'yuzhi.png' },
  { src: 'Agents/ZhangYi.svg',    out: 'zhangyi.png' },

  // 品牌图片
  { src: 'brand/Agent形象.svg',                   out: 'brand-ai.png' },
  { src: 'brand/字母标Logo.svg',                  out: 'brand-logo.png' },
  { src: 'brand/字母标Logo(2-1比例).svg',         out: 'brand-logo-wide.png' },
];

/* ---- 工具函数 ---- */

/**
 * 从 SVG 文件中提取 base64 编码的 PNG 数据
 * 所有文件都是由 Pixelmator Pro 生成的 SVG 壳子，内部仅有一个
 * <image xlink:href="data:image/png;base64, ..."/> 标签
 */
function extractBase64(svgPath) {
  const content = readFileSync(svgPath, 'utf-8');
  const match = content.match(/xlink:href="data:image\/png;base64,\s*([^"]+)"/);
  if (!match) {
    throw new Error(`未找到 base64 图片数据: ${svgPath}`);
  }
  // 去除 base64 字符串中的空白字符
  return match[1].replace(/\s/g, '');
}

/**
 * 将 base64 数据解码为临时 PNG，使用 sips 缩放，输出到目标路径
 * @param {string} base64Data - 纯 base64 字符串（不含 data URI 前缀）
 * @param {string} outputPath - 输出文件路径
 * @param {number} maxSize - 最大尺寸（像素）
 */
function optimizePng(base64Data, outputPath, maxSize) {
  const tempFile = join(tmpdir(), `mla-avatar-${randomUUID()}.png`);

  try {
    // 解码 base64 → 写入临时 PNG 文件
    const buffer = Buffer.from(base64Data, 'base64');
    writeFileSync(tempFile, buffer);

    const rawKB = (buffer.length / 1024).toFixed(1);
    console.log(`  原始 PNG: ${rawKB} KB`);

    // 使用 macOS sips 缩放到指定尺寸
    execSync(`sips --resampleHeightWidthMax ${maxSize} "${tempFile}"`, {
      stdio: 'pipe',
    });

    // 读取缩放后的图片，写入最终输出
    const optimizedBuffer = readFileSync(tempFile);
    writeFileSync(outputPath, optimizedBuffer);

    const finalKB = (optimizedBuffer.length / 1024).toFixed(1);
    console.log(`  优化后: ${finalKB} KB (最大 ${maxSize}px)`);

    return optimizedBuffer.length;
  } finally {
    // 清理临时文件
    try { unlinkSync(tempFile); } catch { /* 忽略清理错误 */ }
  }
}

/**
 * 格式化文件大小为可读字符串
 */
function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/* ---- 主流程 ---- */

console.log('🎨 开始优化头像图片...\n');

// 确保输出目录存在
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`📁 创建目录: ${OUTPUT_DIR}\n`);
}

let totalOriginal = 0;
let totalOptimized = 0;
let successCount = 0;
let failCount = 0;

for (const { src, out } of SOURCES) {
  const svgPath = join(PUBLIC_DIR, src);
  const outPath = join(OUTPUT_DIR, out);

  if (!existsSync(svgPath)) {
    console.log(`⚠️  跳过（文件不存在）: ${src}`);
    continue;
  }

  const originalSize = statSync(svgPath).size;
  console.log(`📦 ${src} → avatars/${out} (${formatSize(originalSize)})`);

  try {
    const base64Data = extractBase64(svgPath);
    const optimizedSize = optimizePng(base64Data, outPath, MAX_SIZE);

    totalOriginal += originalSize;
    totalOptimized += optimizedSize;
    successCount++;

    const reduction = ((1 - optimizedSize / originalSize) * 100).toFixed(1);
    console.log(`  ✅ 完成 (缩减 ${reduction}%)\n`);
  } catch (err) {
    console.error(`  ❌ 错误: ${err.message}\n`);
    failCount++;
  }
}

console.log('━'.repeat(50));
console.log(`📊 成功: ${successCount}/${SOURCES.length}, 失败: ${failCount}`);
console.log(`📊 总大小: ${formatSize(totalOriginal)} → ${formatSize(totalOptimized)}`);
if (totalOriginal > 0) {
  const totalReduction = ((1 - totalOptimized / totalOriginal) * 100).toFixed(1);
  console.log(`📊 总缩减: ${totalReduction}%`);
}
console.log('✨ 优化完成！');
