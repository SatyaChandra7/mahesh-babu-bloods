const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('--- [BUILD] Compiling Tailwind CSS ---');
try {
    execSync('npx tailwindcss -i frontend/input.css -o frontend/style.min.css --minify', { stdio: 'inherit' });
} catch (e) {
    console.error('Tailwind build error:', e.message);
}

const rootDir = path.resolve(__dirname);
const publicDir = path.join(rootDir, 'public');

if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) return;
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        for (const child of fs.readdirSync(src)) {
            copyRecursive(path.join(src, child), path.join(dest, child));
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

console.log('--- [BUILD] Packaging public directory for Vercel CDN ---');

// 1. Copy frontend assets to public
copyRecursive(path.join(rootDir, 'frontend'), publicDir);

// 2. Copy admin-frontend to public/admin-frontend
copyRecursive(path.join(rootDir, 'admin-frontend'), path.join(publicDir, 'admin-frontend'));

// 3. Copy admin.html to public/admin.html and public/admin/index.html
const adminHtmlSrc = path.join(rootDir, 'admin-frontend', 'admin.html');
if (fs.existsSync(adminHtmlSrc)) {
    fs.copyFileSync(adminHtmlSrc, path.join(publicDir, 'admin.html'));
    const adminSubdir = path.join(publicDir, 'admin');
    if (!fs.existsSync(adminSubdir)) fs.mkdirSync(adminSubdir, { recursive: true });
    fs.copyFileSync(adminHtmlSrc, path.join(adminSubdir, 'index.html'));
}

console.log('--- [BUILD] Unified build complete! ---');
