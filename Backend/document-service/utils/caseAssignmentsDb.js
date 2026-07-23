const pool = require('../config/db');

const SUPPORTED_SQL_TYPES = new Set(['uuid', 'integer', 'bigint']);

function logCaseAssignmentsSchema(event, payload = {}) {
  console.log(`[CaseAssignments][Schema] ${event}`, payload);
}

async function getColumnType(tableName, columnName) {
  const result = await pool.query(
    `
      SELECT data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName]
  );

  if (!result.rows.length) {
    throw new Error(`Column public.${tableName}.${columnName} not found`);
  }

  const row = result.rows[0];
  const sqlType = row.data_type === 'uuid'
    ? 'uuid'
    : row.data_type === 'integer'
      ? 'integer'
      : row.data_type === 'bigint'
        ? 'bigint'
        : row.udt_name;

  if (!SUPPORTED_SQL_TYPES.has(sqlType)) {
    throw new Error(`Unsupported SQL type for public.${tableName}.${columnName}: ${sqlType}`);
  }

  return sqlType;
}

async function tryGetColumnType(tableName, columnName) {
  try {
    const sqlType = await getColumnType(tableName, columnName);
    return { sqlType, tableName, columnName };
  } catch (error) {
    if (String(error.message || '').includes(`public.${tableName}.${columnName} not found`)) {
      return null;
    }
    throw error;
  }
}

async function resolveUserIdType() {
  const candidates = [
    ['cases', 'user_id'],
    ['user_files', 'user_id'],
    ['folder_chats', 'user_id'],
    ['user_usage', 'user_id'],
    ['users', 'id'],
  ];

  for (const [tableName, columnName] of candidates) {
    const match = await tryGetColumnType(tableName, columnName);
    if (match) {
      return match;
    }
  }

  throw new Error(
    'Unable to infer user ID type from local tables. Tried cases.user_id, user_files.user_id, folder_chats.user_id, user_usage.user_id, users.id'
  );
}

async function getCaseAssignmentsMeta() {
  const caseIdColumn = await tryGetColumnType('cases', 'id');
  if (!caseIdColumn) {
    throw new Error('Unable to infer case ID type because public.cases.id was not found');
  }

  const userIdColumn = await resolveUserIdType();

  return {
    caseIdSqlType: caseIdColumn.sqlType,
    caseIdSource: `${caseIdColumn.tableName}.${caseIdColumn.columnName}`,
    userIdSqlType: userIdColumn.sqlType,
    userIdSource: `${userIdColumn.tableName}.${userIdColumn.columnName}`,
  };
}

async function getExistingCaseAssignmentsTypes() {
  try {
    const caseIdColumn = await tryGetColumnType('case_assignments', 'case_id');
    const userIdColumn = await tryGetColumnType('case_assignments', 'user_id');
    if (!caseIdColumn && !userIdColumn) {
      return null;
    }
    return {
      caseIdSqlType: caseIdColumn?.sqlType || null,
      userIdSqlType: userIdColumn?.sqlType || null,
    };
  } catch (error) {
    if (String(error.message || '').includes('case_assignments.case_id not found')) {
      return null;
    }
    if (String(error.message || '').includes('public.case_assignments.case_id not found')) {
      return null;
    }
    throw error;
  }
}

async function ensureCompatibleCaseAssignmentsTable(meta) {
  const existingTypes = await getExistingCaseAssignmentsTypes();
  const isCompatible = existingTypes
    && existingTypes.caseIdSqlType === meta.caseIdSqlType
    && existingTypes.userIdSqlType === meta.userIdSqlType;

  if (!existingTypes || isCompatible) {
    return { existingTypes, recreated: false };
  }

  const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM case_assignments');
  const rowCount = countResult.rows[0]?.count || 0;

  logCaseAssignmentsSchema('Type mismatch detected', {
    existingCaseIdType: existingTypes.caseIdSqlType,
    existingUserIdType: existingTypes.userIdSqlType,
    expectedCaseIdType: meta.caseIdSqlType,
    expectedUserIdType: meta.userIdSqlType,
    rowCount,
  });

  if (rowCount > 0) {
    throw new Error(
      `case_assignments type mismatch: existingCaseId=${existingTypes.caseIdSqlType}, existingUserId=${existingTypes.userIdSqlType}, expectedCaseId=${meta.caseIdSqlType}, expectedUserId=${meta.userIdSqlType}, rowCount=${rowCount}`
    );
  }

  await pool.query('DROP TABLE IF EXISTS case_assignments');
  logCaseAssignmentsSchema('Dropped empty incompatible table', {
    existingCaseIdType: existingTypes.caseIdSqlType,
    existingUserIdType: existingTypes.userIdSqlType,
    expectedCaseIdType: meta.caseIdSqlType,
    expectedUserIdType: meta.userIdSqlType,
  });

  return { existingTypes, recreated: true };
}

async function initializeCaseAssignmentsSchema(options = {}) {
  const { throwOnError = false, context = {} } = options;

  try {
    const meta = await getCaseAssignmentsMeta();
    const compatibility = await ensureCompatibleCaseAssignmentsTable(meta);

    logCaseAssignmentsSchema('Initializing', {
      ...context,
      caseIdSqlType: meta.caseIdSqlType,
      caseIdSource: meta.caseIdSource,
      userIdSqlType: meta.userIdSqlType,
      userIdSource: meta.userIdSource,
      existingTypes: compatibility.existingTypes,
      recreated: compatibility.recreated,
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS case_assignments (
        id SERIAL PRIMARY KEY,
        case_id ${meta.caseIdSqlType} NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        user_id ${meta.userIdSqlType} NOT NULL,
        assigned_by ${meta.userIdSqlType},
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(case_id, user_id)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_case_assignments_user_id
      ON case_assignments(user_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_case_assignments_case_id
      ON case_assignments(case_id);
    `);

    logCaseAssignmentsSchema('Schema initialized successfully', {
      ...context,
      caseIdSqlType: meta.caseIdSqlType,
      caseIdSource: meta.caseIdSource,
      userIdSqlType: meta.userIdSqlType,
      userIdSource: meta.userIdSource,
    });

    return meta;
  } catch (error) {
    console.error('[CaseAssignments][Schema] Initialization failed:', {
      ...context,
      message: error.message,
      code: error.code,
      detail: error.detail,
      stack: error.stack,
    });

    if (throwOnError) {
      throw error;
    }

    return null;
  }
}

module.exports = {
  getCaseAssignmentsMeta,
  initializeCaseAssignmentsSchema,
};
