const db = require('../config/db');

async function createJob(job) {
  const query = `
    INSERT INTO processing_jobs (
      job_id,
      file_id,
      type,
      gcs_input_uri,
      gcs_output_uri_prefix,
      document_ai_operation_name,
      status,
      secret_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *;
  `;

  const values = [
    job.job_id,                     // UUID
    job.file_id,                    // File UUID
    job.type,                       // e.g., "batch" or "inline"
    job.gcs_input_uri,              // gs:// input folder
    job.gcs_output_uri_prefix,      // gs:// output folder
    job.document_ai_operation_name, // operationName from Document AI
    job.status || 'queued',         // Default status
    job.secret_id || null           // ✅ Link to secret_manager.id (optional)
  ];

  const { rows } = await db.query(query, values);
  return rows[0];
}

async function updateJobStatus(jobId, status, errorMessage = null) {
  const query = `
    UPDATE processing_jobs
    SET status = $2,
        error_message = $3,
        updated_at = NOW()
    WHERE job_id = $1
    RETURNING *;
  `;
  const { rows } = await db.query(query, [jobId, status, errorMessage]);
  return rows[0];
}

async function getJobByFileId(fileId) {
  const query = `
    SELECT *
    FROM processing_jobs
    WHERE file_id = $1
    ORDER BY created_at DESC
    LIMIT 1;
  `;
  const { rows } = await db.query(query, [fileId]);
  return rows[0];
}

async function updateJob(jobId, updates) {
  const fields = Object.keys(updates);
  if (fields.length === 0) return null;

  const values = Object.values(updates);
  const setClause = fields.map((field, i) => `${field} = $${i + 2}`).join(', ');

  const query = `
    UPDATE processing_jobs
    SET ${setClause}, updated_at = NOW()
    WHERE job_id = $1
    RETURNING *;
  `;

  const { rows } = await db.query(query, [jobId, ...values]);
  return rows[0];
}

async function linkSecretToJob(fileId, secretId) {
  const query = `
    UPDATE processing_jobs
    SET secret_id = $2, updated_at = NOW()
    WHERE file_id = $1
    ORDER BY created_at DESC
    LIMIT 1
    RETURNING *;
  `;
  const { rows } = await db.query(query, [fileId, secretId]);
  return rows[0];
}

module.exports = {
  createJob,
  updateJobStatus,
  getJobByFileId,
  updateJob,
  linkSecretToJob,
};
