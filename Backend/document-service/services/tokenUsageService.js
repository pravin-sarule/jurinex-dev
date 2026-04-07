const pool = require('../config/db');
const axios = require('axios');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid');

const TIMEZONE = 'Asia/Calcutta'; // IST
const DEFAULT_TOKEN_RENEWAL_INTERVAL_HOURS = 0; // disabled
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5003';

const FREE_TIER_PRODUCT_LABEL = 'India Kanoon free tier';
const FREE_TIER_DAILY_TOKEN_LIMIT = 999999999;
const FREE_TIER_MAX_FILE_SIZE_MB = 10000;
const FREE_TIER_MAX_FILE_SIZE_BYTES = FREE_TIER_MAX_FILE_SIZE_MB * 1024 * 1024;
const FREE_TIER_MAX_EYEBALL_USES_PER_DAY = 999999;
const FREE_TIER_FORCED_MODEL = null; // No forced model

function isFirmPlan(userPlan) {
  return true; // Everyone is firm (unlimited)
}

function isFreePlan(userPlan) {
  return false; // No one is on free tier restrictions
}

class TokenUsageService {

    static async checkFirmUserTokenCap(userId, requestedResources = {}) {
        const requestedTokens = Math.max(0, Number(requestedResources?.tokens || 0));
        console.log('🔒 [TokenUsageService] Firm cap check request received', {
            userId,
            requestedTokens,
            requestedResources,
        });

        if (!userId || requestedTokens <= 0) {
            console.log('🔒 [TokenUsageService] Firm cap check skipped', {
                userId,
                requestedTokens,
                reason: 'missing_user_or_zero_request',
            });
            return {
                allowed: true,
                enforced: false,
                message: 'No firm token-cap check required',
            };
        }

        try {
            const response = await axios.post(
                `${PAYMENT_SERVICE_URL}/api/user-resources/internal/firm-token-caps/check`,
                {
                    userId,
                    requestedTokens,
                },
                {
                    timeout: 5000,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            const capData = response.data?.data || {
                allowed: true,
                enforced: false,
                message: 'Firm token-cap service returned no data',
            };

            console.log('🔒 [TokenUsageService] Firm cap check response received', {
                userId,
                requestedTokens,
                status: response.status,
                allowed: capData.allowed,
                enforced: capData.enforced,
                reason: capData.reason,
                monthlyTokenLimit: capData.monthlyTokenLimit,
                currentMonthTokensUsed: capData.currentMonthTokensUsed,
                remainingThisMonth: capData.remainingThisMonth,
                projectedUsage: capData.projectedUsage,
            });

            return capData;
        } catch (error) {
            console.error('❌ [TokenUsageService] Error checking firm-user token cap:', {
                userId,
                requestedTokens,
                message: error.message,
                code: error.code,
                stack: error.stack,
            });
            if (error.response) {
                console.error('❌ [TokenUsageService] Firm cap response status:', error.response.status);
                console.error('❌ [TokenUsageService] Firm cap response data:', error.response.data);
            }
            return {
                allowed: true,
                enforced: false,
                message: 'Firm token-cap check unavailable, continuing with unlimited access',
            };
        }
    }

    static async getUserUsageAndPlan(userId, authorizationHeader, options = {}) {
        const UNLIMITED_PLAN = {
            id: null,
            name: 'Unlimited',
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

        const syntheticUsage = {
            id: null,
            user_id: userId,
            plan_id: null,
            tokens_used: 0,
            documents_used: 0,
            ai_analysis_used: 0,
            storage_used_gb: 0,
            carry_over_tokens: 0,
            period_start: new Date().toISOString(),
            period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            last_token_grant: null
        };

        const nowUTC = moment.utc();
        const nowIST = nowUTC.clone().tz(TIMEZONE);
        const periodStart = nowIST.clone().startOf('month').utc();
        const periodEnd = nowIST.clone().endOf('month').utc();

        return { usage: syntheticUsage, plan: UNLIMITED_PLAN, periodStart, periodEnd };
    }

    static async enforceLimits(userId, userUsage, userPlan, requestedResources = {}) {
        console.log('🔒 [TokenUsageService] Limit enforcement started', {
            userId,
            requestedResources,
        });
        const firmCapCheck = await this.checkFirmUserTokenCap(userId, requestedResources);
        console.log('🔒 [TokenUsageService] Limit enforcement cap result', {
            userId,
            requestedTokens: requestedResources?.tokens || 0,
            allowed: firmCapCheck.allowed,
            enforced: firmCapCheck.enforced,
            reason: firmCapCheck.reason,
            monthlyTokenLimit: firmCapCheck.monthlyTokenLimit,
            currentMonthTokensUsed: firmCapCheck.currentMonthTokensUsed,
            remainingThisMonth: firmCapCheck.remainingThisMonth,
        });

        if (firmCapCheck.enforced && !firmCapCheck.allowed) {
            const remaining = Number.isFinite(firmCapCheck.remainingThisMonth)
                ? firmCapCheck.remainingThisMonth
                : 0;
            const currentMonthTokensUsed = Number.isFinite(firmCapCheck.currentMonthTokensUsed)
                ? firmCapCheck.currentMonthTokensUsed
                : 0;
            const monthlyTokenLimit = Number.isFinite(firmCapCheck.monthlyTokenLimit)
                ? firmCapCheck.monthlyTokenLimit
                : 0;

            const message = 'Your token quota has been exceeded. Please talk to your firm admin to extend your tokens or update your token quota.';
            const details = `Current month usage: ${currentMonthTokensUsed}/${monthlyTokenLimit} tokens. Remaining tokens: ${remaining}.`;

            console.warn('⛔ [TokenUsageService] Limit enforcement blocked request', {
                userId,
                requestedTokens: requestedResources?.tokens || 0,
                currentMonthTokensUsed,
                monthlyTokenLimit,
                remaining,
            });

            return {
                allowed: false,
                message,
                details,
                remainingTokens: remaining,
                capStatus: firmCapCheck,
            };
        }

        console.log('✅ [TokenUsageService] Limit enforcement passed', {
            userId,
            requestedTokens: requestedResources?.tokens || 0,
            message: 'Unlimited document service access',
        });
        return {
            allowed: true,
            message: 'Unlimited document service access',
            remainingTokens: 999999999
        };
    }

    static async incrementUsage(userId, requestedResources = {}) {
        return {
            success: true,
            message: 'Usage tracking disabled for document service'
        };
    }

    static async resetTokens(userId) {
        return {
            success: true,
            message: 'Token resets disabled for document service'
        };
    }

    static async updateLastGrant(userId, exhaustionTimestamp) {
        return {
            success: true,
            message: 'Last-grant tracking disabled for document service'
        };
    }

    static isFreePlan(userPlan) {
        return false;
    }

    static checkFreeTierFileSize(fileSizeBytes, userPlan) {
        return {
            allowed: true,
            message: 'Unlimited document service upload size'
        };
    }

    static async checkFreeTierDailyTokenLimit(userId, userPlan, requestedTokens = 0) {
        return {
            allowed: true,
            message: 'Unlimited daily tokens for document service',
            dailyLimit: null,
            used: 0,
            remaining: null
        };
    }

    static async checkFreeTierEyeballLimit(userId, userPlan) {
        return {
            allowed: true,
            message: 'Unlimited Gemini Eyeball usage for document service',
            used: 0,
            limit: null,
            remaining: null
        };
    }

    static async checkFreeTierControllerAccessLimit(userId, userPlan, controllerName) {
        return {
            allowed: true,
            message: `${controllerName} has unlimited access in document service`,
            used: 0,
            limit: null,
            remaining: null
        };
    }

    static getFreeTierForcedModel() {
        return null;
    }
}

module.exports = TokenUsageService;
