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


const getCourts = async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM courts ORDER BY id ASC`);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching courts:', error.message);
    res.status(500).json({ error: 'Failed to fetch courts: ' + error.message });
  }
};

const getCourtsByLevel = async (req, res) => {
  const { level } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM courts WHERE LOWER(court_level) = LOWER($1) ORDER BY id ASC`,
      [level]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No courts found for this level' });
    }

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching courts by level:', error.message);
    res.status(500).json({ error: 'Failed to fetch courts: ' + error.message });
  }
};

const getCourtById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`SELECT * FROM courts WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Court not found' });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching court by ID:', error.message);
    res.status(500).json({ error: 'Failed to fetch court: ' + error.message });
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
    const result = await pool.query(
      `INSERT INTO case_drafts (user_id, draft_data, last_step, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET 
         draft_data = EXCLUDED.draft_data,
         last_step = EXCLUDED.last_step,
         updated_at = NOW()
       RETURNING *`,
      [userId, draftData, lastStep]
    );

    res.status(200).json({ message: 'Draft saved successfully', draft: result.rows[0] });
  } catch (error) {
    console.error('Error saving draft:', error.message);
    res.status(500).json({ error: 'Failed to save draft: ' + error.message });
  }
};

const getCaseDraft = async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM case_drafts WHERE user_id = $1`,
      [userId]
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
    await pool.query(`DELETE FROM case_drafts WHERE user_id = $1`, [userId]);
    res.status(200).json({ message: 'Draft deleted successfully' });
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
  getCourts,
  getCourtById,
  getCourtsByLevel,
  getJudgesByBench,
  saveCaseDraft,
  getCaseDraft,
  deleteCaseDraft,
  getUserProfessionalProfileContext,
};
