// Run this script with: node scripts/generate-icons.js
// Requires: npm install canvas

const fs = require('fs');
const path = require('path');

// Simple PNG generator using raw bytes (no dependencies)
function createSimplePNG(size, outputPath) {
  const { createCanvas } = require('canvas');
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Purple background with rounded corners effect
  ctx.fillStyle = '#8b5cf6';
  ctx.fillRect(0, 0, size, size);

  // Draw heart emoji
  ctx.font = `${size * 0.55}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('💕', size / 2, size / 2);

  // Save to file
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
  console.log(`Created: ${outputPath}`);
}

const iconsDir = path.join(__dirname, '..', 'public', 'icons');

// Ensure directory exists
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

try {
  createSimplePNG(192, path.join(iconsDir, 'icon-192.png'));
  createSimplePNG(512, path.join(iconsDir, 'icon-512.png'));
  createSimplePNG(180, path.join(iconsDir, 'apple-touch-icon.png'));
  console.log('All icons generated successfully!');
} catch (e) {
  console.log('Canvas not installed. Run: npm install canvas');
  console.log('Or manually create icons at public/icons/');
}
