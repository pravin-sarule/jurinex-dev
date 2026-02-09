const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: "postgresql://db_user:Nexintelai_43@35.200.202.69:5432/Document_DB"
});

async function investigateFolders() {
    try {
        const userId = '3'; // Using user 3 from previous checks
        console.log(`Investigating folders for user ${userId}...`);

        const folders = await pool.query('SELECT id, originalname, folder_path FROM user_files WHERE user_id = $1 AND is_folder = true', [userId]);

        for (const folder of folders.rows) {
            console.log(`\n📁 Folder: ${folder.originalname} (id: ${folder.id})`);
            console.log(`   folder_path: ${folder.folder_path}`);

            const files = await pool.query('SELECT id, originalname, folder_path, status FROM user_files WHERE user_id = $1 AND is_folder = false AND (folder_path = $2 OR folder_path LIKE $3)', [userId, folder.originalname, `%${folder.originalname}%`]);
            console.log(`   Files found (${files.rows.length}):`);
            for (const file of files.rows) {
                console.log(`      - ${file.originalname} (path: ${file.folder_path}, status: ${file.status})`);
            }
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

investigateFolders();
