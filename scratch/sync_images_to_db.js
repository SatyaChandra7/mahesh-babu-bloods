const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config({ path: path.join(__dirname, '..', 'backend', '.env') });

const dbUrl = process.env.DATABASE_URL;
let sequelize;

if (dbUrl) {
    console.log('Connecting to PostgreSQL database:', dbUrl.replace(/:[^:@]+@/, ':****@'));
    sequelize = new Sequelize(dbUrl, {
        dialect: 'postgres',
        dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
        logging: false
    });
} else {
    const sqlitePath = path.join(__dirname, '..', 'backend', 'database.sqlite');
    console.log('Connecting to SQLite database:', sqlitePath);
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: sqlitePath,
        logging: false
    });
}

const GalleryImage = sequelize.define('GalleryImage', {
    filename: { type: DataTypes.STRING, allowNull: false, unique: true },
    imageData: { type: DataTypes.TEXT, allowNull: false },
    mimeType: { type: DataTypes.STRING, defaultValue: 'image/jpeg' },
    uploadedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

async function main() {
    try {
        await sequelize.authenticate();
        console.log('✅ Database connected successfully.');
        await sequelize.sync({ alter: false });

        const galleryFolder = path.join(__dirname, '..', 'frontend', 'assets', 'our work');
        if (!fs.existsSync(galleryFolder)) {
            console.error('❌ Gallery folder not found at:', galleryFolder);
            process.exit(1);
        }

        const files = fs.readdirSync(galleryFolder).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        console.log(`Found ${files.length} images in folder "our work". Starting database upload...`);

        let inserted = 0;
        let skipped = 0;

        for (const file of files) {
            const filePath = path.join(galleryFolder, file);
            const ext = path.extname(file).toLowerCase().replace('.', '');
            const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

            const fileBuffer = fs.readFileSync(filePath);
            const base64Data = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;

            const [record, created] = await GalleryImage.findOrCreate({
                where: { filename: file },
                defaults: {
                    filename: file,
                    imageData: base64Data,
                    mimeType: mimeType
                }
            });

            if (created) {
                inserted++;
                console.log(`[${inserted}/${files.length}] Uploaded image to database: ${file}`);
            } else {
                skipped++;
            }
        }

        const totalInDb = await GalleryImage.count();
        console.log(`\n🎉 Upload completed successfully!`);
        console.log(`- New images inserted into database: ${inserted}`);
        console.log(`- Images already present in database: ${skipped}`);
        console.log(`- Total records in GalleryImage table: ${totalInDb}`);

        process.exit(0);
    } catch (err) {
        console.error('❌ Error uploading images to database:', err);
        process.exit(1);
    }
}

main();
