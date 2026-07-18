const fs = require('fs');
const path = require('path');

function getJpegSize(filePath) {
    const buffer = fs.readFileSync(filePath);
    let i = 0;
    if (buffer[i] !== 0xFF || buffer[i + 1] !== 0xD8) {
        throw new Error('Not a valid JPEG');
    }
    i += 2;
    while (i < buffer.length) {
        while (buffer[i] !== 0xFF) {
            i++;
            if (i >= buffer.length) throw new Error('Invalid JPEG');
        }
        while (buffer[i] === 0xFF) {
            i++;
        }
        const marker = buffer[i];
        i++;
        if (marker === 0xD9 || marker === 0xDA) { // EOI or SOS
            break;
        }
        const length = buffer.readUInt16BE(i);
        if (marker >= 0xC0 && marker <= 0xC3) { // SOF0, SOF1, SOF2, SOF3
            const height = buffer.readUInt16BE(i + 3);
            const width = buffer.readUInt16BE(i + 5);
            return { width, height };
        }
        i += length;
    }
    throw new Error('SOF not found');
}

try {
    const size = getJpegSize(path.join(__dirname, 'frontend', 'assets', 'donar card NEW (1) (1).jpg'));
    console.log(`IMAGE_SIZE: Width=${size.width}, Height=${size.height}`);
} catch (e) {
    console.error('Error reading JPEG size:', e.message);
}
