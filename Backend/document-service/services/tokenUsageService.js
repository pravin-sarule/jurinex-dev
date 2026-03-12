const pool = require('../config/db');
const axios = require('axios');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid');

const TIMEZONE = 'Asia/Calcutta'; // IST
const DEFAULT_TOKEN_RENEWAL_INTERVAL_HOURS = 9.5; // fallback cooldown

const FREE_TIER_PRODUCT_LABEL = 'India Kanoon free tier';
const FREE_TIER_DAILY_TOKEN_LIMIT = 100000; // 100,000 tokens total (in + out) per day
const FREE_TIER_MAX_FILE_SIZE_MB = 10; // 10 MB file size limit
const FREE_TIER_MAX_FILE_SIZE_BYTES = FREE_TIER_MAX_FILE_SIZE_MB * 1024 * 1024;
const FREE_TIER_MAX_EYEBALL_USES_PER_DAY = 1; // Only 1 Gemini Eyeball use per day (first prompt)
const FREE_TIER_FORCED_MODEL = 'gemini-2.5-flash'; // Force gemini-2.5-flash for free users

function isFirmPlan(userPlan) {
  if (!userPlan) return false;
  const planType = (userPlan.type || '').toLowerCase();
  return planType === 'firm';
}

function isFreePlan(userPlan) {
  if (!userPlan) return false;
  if (isFirmPlan(userPlan)) return false; // Firm admins/users are not on free tier
  if (userPlan.price === 0 || userPlan.price === null) {
    return true;
  }
  
  const planName = (userPlan.name || '').toLowerCase();
  if (planName.includes('free') || planName === 'free') {
    return true;
  }
  
  const planType = (userPlan.type || '').toLowerCase();
  if (planType === 'free') {
    return true;
  }
  
  return false;
}

class TokenUsageService {

    static async getUserUsageAndPlan(userId, authorizationHeader, options = {}) {
        const accountType = (options.accountType && String(options.accountType).trim())
            ? String(options.accountType).toUpperCase()
            : '';

        const FIRM_PLAN = {
            id: null,
            name: 'Firm Plan',
            type: 'firm',
            price: null,
            currency: 'INR',
            interval: 'month',
            token_limit: 999999999,
            carry_over_limit: 0,
            document_limit: 999999,
            ai_analysis_limit: 999999,
            storage_limit_gb: 100,
            token_renew_interval_hours: 24
        };

        let client;
        try {
            client = await pool.connect();

            const usageRes = await client.query(
                'SELECT * FROM user_usage WHERE user_id = $1',
                [userId]
            );
            let userUsage = usageRes.rows[0];

            let userPlan;
            if (accountType === 'FIRM_ADMIN' || accountType === 'FIRM_USER') {
                userPlan = FIRM_PLAN;
            } else {
                const gatewayUrl = process.env.API_GATEWAY_URL || 'http://localhost:5000';
                try {
                    const planResp = await axios.get(
                        `${gatewayUrl}/user-resources/user-plan/${userId}`,
                        { headers: { Authorization: authorizationHeader } }
                    );
                    userPlan = planResp.data?.data;

                    if (!userPlan) {
                        throw new Error(`User plan not found for user ${userId}`);
                    }
                } catch (err) {
                    if (err.response?.status === 404) {
                        console.warn(`⚠️ No active plan found for user ${userId}, using default free plan`);
                        userPlan = {
                            id: null,
                            name: 'Free',
                            type: 'free',
                            price: 0,
                            currency: 'INR',
                            interval: 'month',
                            token_limit: 0,
                            carry_over_limit: 0,
                            document_limit: 0,
                            ai_analysis_limit: 0,
                            storage_limit_gb: 1,
                            token_renew_interval_hours: 24
                        };
                    } else {
                        throw new Error(`Failed to retrieve user plan: ${err.response?.status} ${err.message}`);
                    }
                }
            }

            const intervalMap = { 'day': 'daily', 'week': 'weekly', 'month': 'monthly', 'year': 'yearly' };
            const planInterval = intervalMap[userPlan.interval] || 'monthly';

            const nowUTC = moment.utc();
            const nowIST = nowUTC.clone().tz(TIMEZONE);
            let periodStart, periodEnd;

            switch (planInterval) {
                case 'daily':
                    periodStart = nowIST.clone().startOf('day').utc();
                    periodEnd = nowIST.clone().endOf('day').utc();
                    break;
                case 'weekly':
                    periodStart = nowIST.clone().startOf('isoWeek').utc();
                    periodEnd = nowIST.clone().endOf('isoWeek').utc();
                    break;
                case 'monthly':
                    periodStart = nowIST.clone().startOf('month').utc();
                    periodEnd = nowIST.clone().endOf('month').utc();
                    break;
                case 'yearly':
                    periodStart = nowIST.clone().startOf('year').utc();
                    periodEnd = nowIST.clone().endOf('year').utc();
                    break;
                default:
                    periodStart = nowIST.clone().startOf('month').utc();
                    periodEnd = nowIST.clone().endOf('month').utc();
            }

            if (!userUsage) {
                // Ensure we provide a non-null primary key for user_usage.id, since the column is NOT NULL
                const usageId = uuidv4();

                await client.query(
                    `INSERT INTO user_usage (
                        id, user_id, plan_id, tokens_used, documents_used, ai_analysis_used,
                        storage_used_gb, carry_over_tokens, period_start, period_end, last_token_grant
                    ) VALUES ($1,$2,$3,0,0,0,0,0,$4,$5,NULL)`,
                    [usageId, userId, userPlan.id, periodStart.toISOString(), periodEnd.toISOString()]
                );

                userUsage = {
                    id: usageId,
                    user_id: userId,
                    plan_id: userPlan.id,
                    tokens_used: 0,
                    documents_used: 0,
                    ai_analysis_used: 0,
                    storage_used_gb: 0,
                    carry_over_tokens: 0,
                    period_start: periodStart.toISOString(),
                    period_end: periodEnd.toISOString(),
                    last_token_grant: null
                };
            }

            return { usage: userUsage, plan: userPlan, periodStart, periodEnd };

        } catch (err) {
            console.error('❌ getUserUsageAndPlan Error:', err.message);
            throw err;
        } finally {
            if (client) client.release();
        }
    }

    static async enforceLimits(userId, userUsage, userPlan, requestedResources = {}) {
        if (isFirmPlan(userPlan)) {
            return {
                allowed: true,
                message: 'Firm plan - no limits',
                remainingTokens: 999999999
            };
        }

        const nowUTC = moment.utc();
        const nowIST = nowUTC.clone().tz(TIMEZONE);

        const totalTokens = userPlan.token_limit + (userUsage.carry_over_tokens || 0);
        const usedTokens = userUsage.tokens_used || 0;
        const availableTokens = totalTokens - usedTokens;
        const requestedTokens = requestedResources.tokens || 0;

        const tokenRenewInterval = userPlan.token_renew_interval_hours || DEFAULT_TOKEN_RENEWAL_INTERVAL_HOURS;

        if (userUsage.last_token_grant) {
            const lastGrantUTC = moment.utc(userUsage.last_token_grant);
            const nextRenewUTC = lastGrantUTC.clone().add(tokenRenewInterval, 'hours');

            if (nowUTC.isSameOrAfter(nextRenewUTC)) {
                await this.resetTokens(userId);
                const refreshedUsageRes = await pool.query('SELECT * FROM user_usage WHERE user_id = $1', [userId]);
                const refreshedUsage = refreshedUsageRes.rows[0];
                const refreshedAvailableTokens = userPlan.token_limit + (refreshedUsage.carry_over_tokens || 0) - refreshedUsage.tokens_used;

                if (requestedTokens > refreshedAvailableTokens) {
                    const exhaustionMsg = isFreePlan(userPlan)
                        ? `${FREE_TIER_PRODUCT_LABEL} limit exhausted. `
                        : '';
                    return {
                        allowed: false,
                        message: `${exhaustionMsg}Tokens just renewed, but you still don't have enough for this action.`,
                        remainingTokens: refreshedAvailableTokens
                    };
                }

                return {
                    allowed: true,
                    message: `Tokens renewed at ${nowIST.format('DD-MM-YYYY hh:mm A')} IST`
                };
            } else {
                const remaining = moment.duration(nextRenewUTC.diff(nowUTC));
                const exhaustionMsg = isFreePlan(userPlan)
                    ? `${FREE_TIER_PRODUCT_LABEL} limit reached. `
                    : '';
                return {
                    allowed: false,
                    message: `${exhaustionMsg}Tokens exhausted. Wait ${Math.floor(remaining.asHours())}h ${remaining.minutes()}m ${remaining.seconds()}s for renewal at ${nextRenewUTC.clone().tz(TIMEZONE).format('DD-MM-YYYY hh:mm A')} IST`,
                    nextRenewalTime: nextRenewUTC.clone().tz(TIMEZONE).format('DD-MM-YYYY hh:mm A'),
                    remainingTime: {
                        hours: Math.floor(remaining.asHours()),
                        minutes: remaining.minutes(),
                        seconds: remaining.seconds()
                    }
                };
            }
        }

        if (requestedTokens > availableTokens) {
            const exhaustionUTC = nowUTC.toISOString();
            await this.updateLastGrant(userId, exhaustionUTC);

            const nextRenewUTC = nowUTC.clone().add(tokenRenewInterval, 'hours');
            const exhaustionMsg = isFreePlan(userPlan)
                ? `${FREE_TIER_PRODUCT_LABEL} limit exhausted. `
                : '';
            return {
                allowed: false,
                message: `${exhaustionMsg}Tokens exhausted! Next renewal at ${nextRenewUTC.clone().tz(TIMEZONE).format('DD-MM-YYYY hh:mm A')} IST`,
                nextRenewalTime: nextRenewUTC.clone().tz(TIMEZONE).format('DD-MM-YYYY hh:mm A'),
                remainingTokens: 0
            };
        }

        return {
            allowed: true,
            message: `Tokens available: ${availableTokens - requestedTokens}`,
            remainingTokens: availableTokens - requestedTokens
        };
    }

    static async incrementUsage(userId, requestedResources = {}) {
        const client = await pool.connect();
        try {
            const { tokens = 0, documents = 0, ai_analysis = 0, storage_gb = 0 } = requestedResources;
            if (tokens < 0 || documents < 0 || ai_analysis < 0 || storage_gb < 0) {
                throw new Error("Requested resources must be positive.");
            }

            await client.query(
                `UPDATE user_usage SET
                    tokens_used = tokens_used + $1,
                    documents_used = documents_used + $2,
                    ai_analysis_used = ai_analysis_used + $3,
                    storage_used_gb = storage_used_gb + $4,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $5`,
                [tokens, documents, ai_analysis, storage_gb, userId]
            );
        } finally {
            client.release();
        }
    }

    static async resetTokens(userId) {
        const client = await pool.connect();
        try {
            await client.query(
                `UPDATE user_usage SET
                    tokens_used = 0,
                    last_token_grant = NULL,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $1`,
                [userId]
            );
        } finally {
            client.release();
        }
    }

    static async updateLastGrant(userId, exhaustionTimestamp) {
        const client = await pool.connect();
        try {
            await client.query(
                `UPDATE user_usage SET
                    last_token_grant = $1,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $2`,
                [exhaustionTimestamp, userId]
            );
        } finally {
            client.release();
        }
    }

    static isFreePlan(userPlan) {
        return isFreePlan(userPlan);
    }

    static checkFreeTierFileSize(fileSizeBytes, userPlan) {
        if (!isFreePlan(userPlan)) {
            return { allowed: true, message: "Paid plan - no file size restriction" };
        }

        const fileSize = typeof fileSizeBytes === 'string' ? parseInt(fileSizeBytes, 10) : Number(fileSizeBytes);
        
        if (isNaN(fileSize) || fileSize <= 0) {
            return {
                allowed: false,
                message: `Invalid file size. Please provide a valid file size.`
            };
        }

        if (fileSize > FREE_TIER_MAX_FILE_SIZE_BYTES) {
            const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
            const fileSizeGB = (fileSize / (1024 * 1024 * 1024)).toFixed(2);
            
            let sizeDisplay = fileSizeMB;
            if (parseFloat(fileSizeMB) >= 1024) {
                sizeDisplay = `${fileSizeGB} GB (${fileSizeMB} MB)`;
            } else {
                sizeDisplay = `${fileSizeMB} MB`;
            }
            
            return {
                allowed: false,
                message: `🚫 ${FREE_TIER_PRODUCT_LABEL} file size limit exceeded\n\n${FREE_TIER_PRODUCT_LABEL} allows uploading files up to ${FREE_TIER_MAX_FILE_SIZE_MB} MB only.\n\nYour file size: ${sizeDisplay}\nMaximum allowed: ${FREE_TIER_MAX_FILE_SIZE_MB} MB\n\nPlease either:\n• Reduce your file size to ${FREE_TIER_MAX_FILE_SIZE_MB} MB or less\n• Upgrade to a paid plan to upload larger files\n\nUpgrade now to enjoy unlimited file sizes and more features!`,
                shortMessage: `${FREE_TIER_PRODUCT_LABEL} limit: Maximum file size is ${FREE_TIER_MAX_FILE_SIZE_MB} MB. Your file is ${sizeDisplay}.`,
                fileSizeMB: fileSizeMB,
                fileSizeGB: fileSizeGB,
                maxSizeMB: FREE_TIER_MAX_FILE_SIZE_MB,
                upgradeRequired: true
            };
        }

        return { allowed: true, message: "File size within free tier limit" };
    }

    static async checkFreeTierDailyTokenLimit(userId, userPlan, requestedTokens = 0) {
        if (!isFreePlan(userPlan)) {
            return { allowed: true, message: "Paid plan - no daily token restriction" };
        }

        const nowIST = moment().tz(TIMEZONE);
        const todayStart = nowIST.clone().startOf('day').utc().toISOString();
        const todayEnd = nowIST.clone().endOf('day').utc().toISOString();

        const client = await pool.connect();
        try {
            const usageQuery = `
                SELECT COALESCE(SUM(tokens_used), 0) as daily_tokens_used
                FROM user_usage
                WHERE user_id = $1
                  AND updated_at >= $2
                  AND updated_at <= $3
            `;
            const usageResult = await client.query(usageQuery, [userId, todayStart, todayEnd]);
            const dailyTokensUsed = parseInt(usageResult.rows[0]?.daily_tokens_used || 0);

            const totalDailyUsage = dailyTokensUsed + requestedTokens;

            if (totalDailyUsage > FREE_TIER_DAILY_TOKEN_LIMIT) {
                const remaining = FREE_TIER_DAILY_TOKEN_LIMIT - dailyTokensUsed;
                return {
                    allowed: false,
                    message: `${FREE_TIER_PRODUCT_LABEL} daily limit reached. Daily limit: ${FREE_TIER_DAILY_TOKEN_LIMIT.toLocaleString()} tokens. Used: ${dailyTokensUsed.toLocaleString()}. Remaining: ${remaining.toLocaleString()}. Limit resets at midnight IST.`,
                    dailyLimit: FREE_TIER_DAILY_TOKEN_LIMIT,
                    used: dailyTokensUsed,
                    remaining: remaining
                };
            }

            return {
                allowed: true,
                message: `Free tier: ${(FREE_TIER_DAILY_TOKEN_LIMIT - totalDailyUsage).toLocaleString()} tokens remaining today`,
                dailyLimit: FREE_TIER_DAILY_TOKEN_LIMIT,
                used: dailyTokensUsed,
                remaining: FREE_TIER_DAILY_TOKEN_LIMIT - totalDailyUsage
            };
        } finally {
            client.release();
        }
    }

    static async checkFreeTierEyeballLimit(userId, userPlan) {
        if (!isFreePlan(userPlan)) {
            return { allowed: true, message: "Paid plan - no Eyeball restriction" };
        }

        const nowIST = moment().tz(TIMEZONE);
        const todayStart = nowIST.clone().startOf('day').utc().toISOString();
        const todayEnd = nowIST.clone().endOf('day').utc().toISOString();

        const client = await pool.connect();
        try {
            const eyeballQuery = `
                SELECT COUNT(*) as eyeball_count
                FROM folder_chats
                WHERE user_id = $1
                  AND created_at >= $2
                  AND created_at <= $3
                  AND method = 'gemini_eyeball'
            `;
            const eyeballResult = await client.query(eyeballQuery, [userId, todayStart, todayEnd]);
            const eyeballCount = parseInt(eyeballResult.rows[0]?.eyeball_count || 0);

            if (eyeballCount >= FREE_TIER_MAX_EYEBALL_USES_PER_DAY) {
                return {
                    allowed: false,
                    message: `${FREE_TIER_PRODUCT_LABEL} limit: Only ${FREE_TIER_MAX_EYEBALL_USES_PER_DAY} Gemini Eyeball use(s) allowed per day (first prompt only). You've used ${eyeballCount} today. Subsequent chats must use RAG retrieval. Limit resets at midnight IST. Please upgrade to use Gemini Eyeball unlimited.`,
                    used: eyeballCount,
                    limit: FREE_TIER_MAX_EYEBALL_USES_PER_DAY
                };
            }

            return {
                allowed: true,
                message: `Free tier: ${FREE_TIER_MAX_EYEBALL_USES_PER_DAY - eyeballCount} Gemini Eyeball use(s) remaining today`,
                used: eyeballCount,
                limit: FREE_TIER_MAX_EYEBALL_USES_PER_DAY,
                remaining: FREE_TIER_MAX_EYEBALL_USES_PER_DAY - eyeballCount
            };
        } finally {
            client.release();
        }
    }

    static async checkFreeTierControllerAccessLimit(userId, userPlan, controllerName) {
        if (!isFreePlan(userPlan)) {
            return { allowed: true, message: "Paid plan - no controller access restriction" };
        }

        const nowIST = moment().tz(TIMEZONE);
        const todayStart = nowIST.clone().startOf('day').utc().toISOString();
        const todayEnd = nowIST.clone().endOf('day').utc().toISOString();

        const client = await pool.connect();
        try {
            const accessQuery = `
                SELECT COUNT(*) as access_count
                FROM folder_chats
                WHERE user_id = $1
                  AND created_at >= $2
                  AND created_at <= $3
            `;
            const accessResult = await client.query(accessQuery, [userId, todayStart, todayEnd]);
            const accessCount = parseInt(accessResult.rows[0]?.access_count || 0);

            if (accessCount >= 1) {
                return {
                    allowed: false,
                    message: `${FREE_TIER_PRODUCT_LABEL} limit: ${controllerName} can only be accessed once per day. You've already used it today. Please upgrade to access unlimited times. Limit resets at midnight IST.`,
                    used: accessCount,
                    limit: 1
                };
            }

            return {
                allowed: true,
                message: `Free tier: ${controllerName} access allowed (1 per day)`,
                used: accessCount,
                limit: 1,
                remaining: 1 - accessCount
            };
        } finally {
            client.release();
        }
    }

    static getFreeTierForcedModel() {
        return FREE_TIER_FORCED_MODEL;
    }
}

module.exports = TokenUsageService;
