#!/usr/bin/env node

/**
 * Script to generate Devanagari VFS file for pdfmake
 * 
 * This script:
 * 1. Checks if TTF font files exist
 * 2. Generates VFS file using pdfmake-font-generator
 * 3. Verifies the generated VFS file
 * 
 * Usage:
 *   node scripts/generate-devanagari-vfs.js
 * 
 * Or use npm script:
 *   npm run build:fonts
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FONT_DIR = path.join(__dirname, '../src/fonts/ttf');
const VFS_DIR = path.join(__dirname, '../src/fonts/vfs');
const VFS_FILE = path.join(VFS_DIR, 'devanagari_vfs.js');

const REQUIRED_FONTS = [
  'NotoSansDevanagari-Regular.ttf',
  'NotoSansDevanagari-Bold.ttf'
];

console.log('🔤 Devanagari VFS Generator\n');

// Check if font directory exists
if (!fs.existsSync(FONT_DIR)) {
  console.error(`❌ Font directory not found: ${FONT_DIR}`);
  console.log('💡 Creating font directory...');
  fs.mkdirSync(FONT_DIR, { recursive: true });
  console.log('⚠️  Please add NotoSansDevanagari font files to:', FONT_DIR);
  console.log('   Download from: https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari');
  process.exit(1);
}

// Check if required fonts exist
console.log('📋 Checking for required font files...');
const missingFonts = [];
const existingFonts = [];

REQUIRED_FONTS.forEach(font => {
  const fontPath = path.join(FONT_DIR, font);
  if (fs.existsSync(fontPath)) {
    const stats = fs.statSync(fontPath);
    console.log(`  ✓ ${font} (${(stats.size / 1024).toFixed(2)} KB)`);
    existingFonts.push(font);
  } else {
    console.log(`  ✗ ${font} (missing)`);
    missingFonts.push(font);
  }
});

if (missingFonts.length > 0) {
  console.error('\n❌ Missing required font files:');
  missingFonts.forEach(font => console.error(`   - ${font}`));
  console.log('\n💡 To download Noto Sans Devanagari fonts:');
  console.log('   1. Visit: https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari');
  console.log('   2. Download Regular and Bold variants');
  console.log('   3. Place them in:', FONT_DIR);
  process.exit(1);
}

// Ensure VFS directory exists
if (!fs.existsSync(VFS_DIR)) {
  console.log('\n📁 Creating VFS directory...');
  fs.mkdirSync(VFS_DIR, { recursive: true });
}

// Generate VFS file using pdfmake-font-generator
console.log('\n🔄 Generating VFS file...');
try {
  const generatorPath = path.join(__dirname, '../node_modules/.bin/pdfmake-font-generator');
  
  // Check if generator exists
  if (!fs.existsSync(generatorPath)) {
    console.error('❌ pdfmake-font-generator not found!');
    console.log('💡 Install it with: npm install pdfmake-font-generator');
    process.exit(1);
  }

  // Run the generator
  const command = `"${generatorPath}" --in="${FONT_DIR}" --out="${VFS_DIR}"`;
  console.log(`   Running: ${command}`);
  
  execSync(command, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  
  console.log('✓ VFS generation completed');
} catch (error) {
  console.error('❌ Error generating VFS file:', error.message);
  process.exit(1);
}

// Verify generated VFS file
console.log('\n🔍 Verifying generated VFS file...');
if (fs.existsSync(VFS_FILE)) {
  const stats = fs.statSync(VFS_FILE);
  console.log(`  ✓ VFS file exists: ${VFS_FILE} (${(stats.size / 1024).toFixed(2)} KB)`);
  
  // Check file content
  const content = fs.readFileSync(VFS_FILE, 'utf8');
  
  // Verify structure
  if (content.includes('export const pdfMake') || content.includes('export default')) {
    console.log('  ✓ Valid export structure found');
  } else {
    console.warn('  ⚠️  Unexpected export structure');
  }
  
  // Check for font keys
  REQUIRED_FONTS.forEach(font => {
    if (content.includes(font)) {
      console.log(`  ✓ Contains ${font}`);
    } else {
      console.warn(`  ⚠️  Missing ${font} in VFS`);
    }
  });
  
  console.log('\n✅ Devanagari VFS file generated successfully!');
  console.log(`   Location: ${VFS_FILE}`);
  console.log('\n💡 Next steps:');
  console.log('   1. Restart your development server');
  console.log('   2. Test PDF generation with Marathi text');
  console.log('   3. If issues persist, check browser console for errors');
} else {
  console.error(`❌ VFS file not found: ${VFS_FILE}`);
  console.log('💡 Check the output directory and generator logs');
  process.exit(1);
}

