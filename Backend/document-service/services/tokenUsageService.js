const pool = require('../config/db');
const axios = require('axios');
const moment = require('moment-timezone');
const { v4: uuidv4 } = require('uuid');

const TIMEZONE = 'Asia/Calcutta'; // IST
const DEFAULT_TOKEN_RENEWAL_INTERVAL_HOURS = 0; // disabled

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
