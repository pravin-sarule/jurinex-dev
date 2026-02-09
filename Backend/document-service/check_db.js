const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: "postgresql://db_user:Nexintelai_43@35.200.202.69:5432/Document_DB"
});

async function checkDb() {
    try {
        console.log('--- Database Check (Mismatch Check) ---');

        const files = await pool.query('SELECT id, originalname, status, processing_progress FROM user_files WHERE is_folder = false ORDER BY created_at DESC');

        console.log(`Checking ${files.rows.length} files...`);

        for (const file of files.rows) {
            const chunks = await pool.query('SELECT COUNT(*) FROM file_chunks WHERE file_id = $1', [file.id]);
            const vectors = await pool.query('SELECT COUNT(*) FROM chunk_vectors WHERE file_id = $1', [file.id]);
            const chunkCount = parseInt(chunks.rows[0].count);
            const vectorCount = parseInt(vectors.rows[0].count);

            if (chunkCount !== vectorCount) {
                console.log(`❌ MISMATCH: ${file.originalname} (${file.id.substring(0, 8)})`);
                console.log(`   Chunks: ${chunkCount}, Vectors: ${vectorCount}`);
                console.log(`   Status: ${file.status} (${file.processing_progress}%)`);
            } else if (chunkCount > 0) {
                // console.log(`✅ OK: ${file.originalname} (${chunkCount} chunks/vectors)`);
            }
        }

        const totalChunks = await pool.query('SELECT COUNT(*) FROM file_chunks');
        const totalVectors = await pool.query('SELECT COUNT(*) FROM chunk_vectors');
        console.log('\nTotals:');
        console.log(`  Total Chunks: ${totalChunks.rows[0].count}`);
        console.log(`  Total Vectors: ${totalVectors.rows[0].count}`);

    } catch (err) {
        console.error('Error checking DB:', err);
    } finally {
        await pool.end();
    }
}

checkDb();
