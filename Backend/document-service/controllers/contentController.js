const pool = require('../config/db'); // PostgreSQL connection
const UserProfileService = require('../services/userProfileService');


const getCaseTypes = async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM case_types ORDER BY id ASC`);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching case types:', error.message);
    res.status(500).json({ error: 'Failed to fetch case types: ' + error.message });
  }
};



const getSubTypesByCaseType = async (req, res) => {
  const { caseTypeId } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM sub_types WHERE case_type_id = $1 ORDER BY id ASC`,
      [caseTypeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No sub-types found for this case type' });
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching sub-types:', error.message);
    res.status(500).json({ error: 'Failed to fetch sub-types: ' + error.message });
  }
};


// const getCourts = async (req, res) => {
//   try {
//     const result = await pool.query(`SELECT * FROM courts ORDER BY id ASC`);
//     res.status(200).json(result.rows);
//   } catch (error) {
//     console.error('Error fetching courts:', error.message);
//     res.status(500).json({ error: 'Failed to fetch courts: ' + error.message });
//   }
// };

// const getCourtsByLevel = async (req, res) => {
//   const { level } = req.params;

//   try {
//     const result = await pool.query(
//       `SELECT * FROM courts WHERE LOWER(court_level) = LOWER($1) ORDER BY id ASC`,
//       [level]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ message: 'No courts found for this level' });
//     }

//     res.status(200).json(result.rows);
//   } catch (error) {
//     console.error('Error fetching courts by level:', error.message);
//     res.status(500).json({ error: 'Failed to fetch courts: ' + error.message });
//   }
// };

// const getCourtById = async (req, res) => {
//   const { id } = req.params;

//   try {
//     const result = await pool.query(`SELECT * FROM courts WHERE id = $1`, [id]);
//     if (result.rows.length === 0) {
//       return res.status(404).json({ message: 'Court not found' });
//     }
//     res.status(200).json(result.rows[0]);
//   } catch (error) {
//     console.error('Error fetching court by ID:', error.message);
//     res.status(500).json({ error: 'Failed to fetch court: ' + error.message });
//   }
// };

const getAllJurisdictions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT j.*, COUNT(DISTINCT c.id) as court_count
       FROM jurisdictions j
       LEFT JOIN courts c ON j.id = c.jurisdiction_id
       GROUP BY j.id
       ORDER BY j.id ASC`
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching jurisdictions:', error.message);
    res.status(500).json({ error: 'Failed to fetch jurisdictions: ' + error.message });
  }
};
// Get courts by jurisdiction
const getCourtsByJurisdiction = async (req, res) => {
  const { jurisdictionId } = req.params;

  try {
    const result = await pool.query(
      `SELECT c.*, COUNT(b.id) as bench_count
       FROM courts c
       LEFT JOIN benches b ON c.id = b.court_id
       WHERE c.jurisdiction_id = $1
       GROUP BY c.id
       ORDER BY c.court_name ASC`,
      [jurisdictionId]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching courts:', error.message);
    res.status(500).json({ error: 'Failed to fetch courts: ' + error.message });
  }
};

const getBenchesByCourt = async (req, res) => {
  const { courtId } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM benches 
       WHERE court_id = $1 
       ORDER BY is_principal DESC, bench_name ASC`,
      [courtId]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching benches:', error.message);
    res.status(500).json({ error: 'Failed to fetch benches: ' + error.message });
  }
};



const getJudgesByBench = async (req, res) => {
  const { courtId, benchName } = req.query;

  try {
    const result = await pool.query(
      `SELECT * FROM judges 
       WHERE court_id = $1 
       AND LOWER(bench_name) = LOWER($2)
       ORDER BY name ASC`,
      [courtId, benchName]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No judges found for this bench' });
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching judges:', error.message);
    res.status(500).json({ error: 'Failed to fetch judges: ' + error.message });
  }
};


const saveCaseDraft = async (req, res) => {
  const { userId, draftData, lastStep } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  try {
    let userFileId = userId;
    
    // Check if userId is a UUID (for user_files.id) or integer (for users.id)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isInteger = /^\d+$/.test(String(userId));
    
    // If userId is an integer, we need to find a user file/folder
    // Since case_drafts.user_id references user_files(id), we need a file/folder UUID
    if (isInteger) {
      // Try to find any existing file or folder for this user (prefer folders, then files)
      const fileResult = await pool.query(
        `SELECT id FROM user_files 
         WHERE user_id = $1 
         ORDER BY is_folder DESC, created_at ASC 
         LIMIT 1`,
        [parseInt(userId)]
      );
      
      if (fileResult.rows.length > 0) {
        userFileId = fileResult.rows[0].id;
      } else {
        // If no file/folder exists, we can't create a draft without a user_files entry
        // Return error suggesting the frontend should send a file/folder UUID
        return res.status(400).json({ 
          error: 'No user file or folder found. Please upload a file or create a folder first.' 
        });
      }
    } else if (!uuidRegex.test(String(userId))) {
      return res.status(400).json({ 
        error: 'Invalid userId format. Expected UUID format (e.g., 123e4567-e89b-12d3-a456-426614174000) or integer user ID' 
      });
    }

    // Let PostgreSQL generate UUID for id via DEFAULT gen_random_uuid()
    // Use ON CONFLICT to update if draft already exists for this user
    const result = await pool.query(
      `INSERT INTO case_drafts (user_id, draft_data, last_step, updated_at)
       VALUES ($1::uuid, $2, $3, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET 
         draft_data = EXCLUDED.draft_data,
         last_step = EXCLUDED.last_step,
         updated_at = NOW()
       RETURNING *`,
      [userFileId, draftData, lastStep]
    );

    res.status(200).json({ 
      message: 'Draft saved successfully', 
      draft: result.rows[0] 
    });
  } catch (error) {
    console.error('Error saving draft:', error.message);
    res.status(500).json({ error: 'Failed to save draft: ' + error.message });
  }
};

const getCaseDraft = async (req, res) => {
  const { userId } = req.params;

  try {
    let userFileId = userId;
    
    // Check if userId is a UUID (for user_files.id) or integer (for users.id)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isInteger = /^\d+$/.test(String(userId));
    
    // If userId is an integer, find any user file/folder to get the UUID
    if (isInteger) {
      const fileResult = await pool.query(
        `SELECT id FROM user_files 
         WHERE user_id = $1 
         ORDER BY is_folder DESC, created_at ASC 
         LIMIT 1`,
        [parseInt(userId)]
      );
      
      if (fileResult.rows.length > 0) {
        userFileId = fileResult.rows[0].id;
      } else {
        // No file/folder found, return 404 (no draft can exist without a user_files entry)
        return res.status(404).json({ message: 'No draft found' });
      }
    } else if (!uuidRegex.test(String(userId))) {
      return res.status(400).json({ 
        error: 'Invalid userId format. Expected UUID format (e.g., 123e4567-e89b-12d3-a456-426614174000) or integer user ID' 
      });
    }

    const result = await pool.query(
      `SELECT * FROM case_drafts WHERE user_id = $1::uuid`,
      [userFileId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No draft found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching draft:', error.message);
    res.status(500).json({ error: 'Failed to fetch draft: ' + error.message });
  }
};

const deleteCaseDraft = async (req, res) => {
  const { userId } = req.params;

  try {
    let userFileId = userId;
    
    // Check if userId is a UUID (for user_files.id) or integer (for users.id)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isInteger = /^\d+$/.test(String(userId));
    
    // If userId is an integer, find any user file/folder to get the UUID
    if (isInteger) {
      const fileResult = await pool.query(
        `SELECT id FROM user_files 
         WHERE user_id = $1 
         ORDER BY is_folder DESC, created_at ASC 
         LIMIT 1`,
        [parseInt(userId)]
      );
      
      if (fileResult.rows.length > 0) {
        userFileId = fileResult.rows[0].id;
      } else {
        // No file/folder found, but still try to delete (might not exist anyway)
        // Return success since the goal is to delete
        return res.status(200).json({ message: 'Draft deleted successfully (no draft found)' });
      }
    } else if (!uuidRegex.test(String(userId))) {
      return res.status(400).json({ 
        error: 'Invalid userId format. Expected UUID format (e.g., 123e4567-e89b-12d3-a456-426614174000) or integer user ID' 
      });
    }

    const result = await pool.query(
      `DELETE FROM case_drafts WHERE user_id = $1::uuid`,
      [userFileId]
    );

    res.status(200).json({ 
      message: 'Draft deleted successfully',
      deleted: result.rowCount > 0
    });
  } catch (error) {
    console.error('Error deleting draft:', error.message);
    res.status(500).json({ error: 'Failed to delete draft: ' + error.message });
  }
};


const getUserProfessionalProfileContext = async (req, res) => {
  const userId = req.user?.id || req.userId;
  const authorizationHeader = req.headers.authorization;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: User ID not found' });
  }

  if (!authorizationHeader) {
    return res.status(401).json({ error: 'Unauthorized: Authorization header missing' });
  }

  try {
    const profile = await UserProfileService.getProfile(userId, authorizationHeader);
    const context = await UserProfileService.getProfileContext(userId, authorizationHeader);

    res.status(200).json({
      success: true,
      profile: profile || null,
      context: context || null,
      hasProfile: !!profile,
      isProfileCompleted: profile?.is_profile_completed || false,
    });
  } catch (error) {
    console.error('Error fetching user professional profile:', error.message);
    res.status(500).json({ error: 'Failed to fetch user professional profile: ' + error.message });
  }
};

module.exports = {
  getCaseTypes,
  getSubTypesByCaseType,
  // getCourts,
  // getCourtById,
  // getCourtsByLevel,
  getAllJurisdictions,
  getCourtsByJurisdiction,
  getBenchesByCourt,  
  getJudgesByBench,
  saveCaseDraft,
  getCaseDraft,
  deleteCaseDraft,
  getUserProfessionalProfileContext,
};
