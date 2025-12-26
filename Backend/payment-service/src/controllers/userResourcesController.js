const pool = require('../config/db');
const axios = require('axios'); // Import axios for HTTP requests
const TokenUsageService = require('../services/tokenUsageService');
const TokenUsageSyncService = require('../services/tokenUsageSyncService');

const DOCUMENT_SERVICE_URL = process.env.API_GATEWAY_URL || 'http://localhost:5000';

exports.getPlanAndResourceDetails = async (req, res) => {
    console.log("DEBUG: getPlanAndResourceDetails - Controller entered.");
    try {
        const userId = req.user.id;
        console.log(`DEBUG: getPlanAndResourceDetails - User ID: ${userId}`);
        if (!userId) {
            console.log("DEBUG: getPlanAndResourceDetails - Unauthorized: No user ID.");
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const { service } = req.query;

        const subscriptionQuery = `
            SELECT
                sp.id AS plan_id,
                sp.name AS plan_name,
                sp.description,
                sp.price,
                sp.currency,
                sp.interval,
                sp.type,
                sp.token_limit,
                sp.carry_over_limit,
                sp.document_limit,
                sp.ai_analysis_limit,
                sp.template_access,
                sp.storage_limit_gb,
                sp.drafting_type,
                sp.limits,
                us.start_date,
                us.end_date,
                us.status AS subscription_status
            FROM user_subscriptions us
            JOIN subscription_plans sp ON us.plan_id = sp.id
            WHERE us.user_id = $1
            ORDER BY us.start_date DESC
            LIMIT 1;
        `;
        const subscriptionResult = await pool.query(subscriptionQuery, [userId]);
        const activePlan = subscriptionResult.rows[0] || null;

        const allPlansResult = await pool.query(`SELECT * FROM subscription_plans ORDER BY price ASC;`);
        const allPlanConfigurations = allPlansResult.rows;

        const latestPaymentQuery = `
            SELECT
                id,
                amount,
                currency,
                status,
                payment_method,
                razorpay_payment_id,
                razorpay_order_id,
                subscription_id,
                TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS payment_date
            FROM payments
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 1;
        `;
        const latestPaymentResult = await pool.query(latestPaymentQuery, [userId]);
        const latestPayment = latestPaymentResult.rows[0] || null;

        if (!activePlan) {
            return res.status(200).json({
                activePlan: null,
                resourceUtilization: {
                    tokens: { remaining: 0, limit: 0, total_used: 0, percentage_used: 0, status: 'no_plan' },
                    queries: { remaining: 0, limit: 0, total_used: 0, percentage_used: 0, status: 'no_plan' },
                    documents: { used: 0, limit: 0, percentage_used: 0, status: 'no_plan' },
                    storage: { used_gb: 0, limit_gb: 0, percentage_used: 0, status: 'no_plan', note: "No active subscription found." }
                },
                allPlanConfigurations: allPlanConfigurations.map(plan => ({ ...plan, is_active_plan: false })),
                latestPayment
            });
        }

        const apiGatewayUrl = process.env.API_GATEWAY_URL || "http://localhost:5000";
        const authorizationHeader = req.headers.authorization;

        let userUsageFromDocumentService = null;
        let userPlanFromDocumentService = null;
        let timeLeftUntilReset = null;

        try {
            const documentServiceResponse = await axios.get(`${apiGatewayUrl}/files/user-usage-and-plan/${userId}`, {
                headers: { Authorization: authorizationHeader },
                timeout: 10000 // 10 seconds
            });

            if (documentServiceResponse.status === 200 && documentServiceResponse.data.success) {
                userUsageFromDocumentService = documentServiceResponse.data.data.usage;
                userPlanFromDocumentService = documentServiceResponse.data.data.plan;
                timeLeftUntilReset = documentServiceResponse.data.data.timeLeft;
            } else {
                console.error('❌ Document Service returned an error:', documentServiceResponse.data);
            }
        } catch (err) {
            console.error('❌ Error fetching user usage and plan from Document Service:', err.message);
        }

        const effectivePlan = userPlanFromDocumentService || activePlan;
        
        // Calculate total tokens and cost from llm_usage_logs (source of truth)
        let totalTokensFromLogs = 0;
        let totalCostFromLogs = 0;
        try {
            const llmUsageQuery = `
                SELECT 
                    COALESCE(SUM(total_tokens), 0) as total_tokens,
                    COALESCE(SUM(total_cost), 0) as total_cost
                FROM public.llm_usage_logs
                WHERE user_id = $1
            `;
            const llmUsageResult = await pool.query(llmUsageQuery, [userId]);
            if (llmUsageResult.rows && llmUsageResult.rows.length > 0) {
                totalTokensFromLogs = parseInt(llmUsageResult.rows[0].total_tokens) || 0;
                totalCostFromLogs = parseFloat(llmUsageResult.rows[0].total_cost) || 0;
            }
        } catch (err) {
            console.error('❌ Error fetching total tokens from llm_usage_logs:', err.message);
            // Fallback to document service if llm_usage_logs query fails
            totalTokensFromLogs = userUsageFromDocumentService ? userUsageFromDocumentService.tokens_used : 0;
        }
        
        // Use tokens from llm_usage_logs (source of truth) instead of user_usage
        const totalTokensUsed = totalTokensFromLogs;
        const currentTokenBalance = effectivePlan ? (effectivePlan.token_limit + (userUsageFromDocumentService?.carry_over_tokens || 0) - totalTokensUsed) : 0;
        const currentDocumentCount = userUsageFromDocumentService ? userUsageFromDocumentService.documents_used : 0;
        const currentAiAnalysisUsed = userUsageFromDocumentService ? userUsageFromDocumentService.ai_analysis_used : 0;
        const totalStorageUsedGB = userUsageFromDocumentService ? userUsageFromDocumentService.storage_used_gb : 0;

        const planStorageLimitGB = effectivePlan.storage_limit_gb || 0;
        const planTokenLimit = effectivePlan.token_limit || 0;
        const planAiAnalysisLimit = effectivePlan.ai_analysis_limit || 0;
        const planDocumentLimit = effectivePlan.document_limit || 0;

        const calculateUtilization = (used, limit) => {
            if (limit === 0) return { used, limit, percentage_used: 0, status: 'unlimited' };
            const percentage = ((used / limit) * 100).toFixed(0);
            const status = used >= limit ? 'exceeded' : 'within_limit';
            return { used, limit, percentage_used: percentage, status };
        };

        const resourceUtilization = {
            tokens: {
                ...calculateUtilization(totalTokensUsed, planTokenLimit),
                cost: totalCostFromLogs, // Include total cost from llm_usage_logs
                total_tokens: totalTokensUsed // Include total tokens for reference
            },
            queries: calculateUtilization(currentAiAnalysisUsed, planAiAnalysisLimit),
            documents: calculateUtilization(currentDocumentCount, planDocumentLimit),
            storage: {
                used_gb: totalStorageUsedGB,
                limit_gb: planStorageLimitGB,
                percentage_used: planStorageLimitGB > 0 ? ((totalStorageUsedGB / planStorageLimitGB) * 100).toFixed(0) : 0,
                status: planStorageLimitGB > 0 && totalStorageUsedGB >= planStorageLimitGB ? 'exceeded' : 'within_limit',
                note: planStorageLimitGB === 0 ? "No storage limit defined for this plan." : undefined
            },
            timeLeftUntilReset: timeLeftUntilReset ? `${Math.floor(timeLeftUntilReset / 3600)}h ${Math.floor((timeLeftUntilReset % 3600) / 60)}m ${timeLeftUntilReset % 60}s` : 'N/A'
        };
        

        const allPlanConfigurationsWithActiveFlag = allPlanConfigurations.map(plan => ({
            ...plan,
            is_active_plan: activePlan && plan.id === activePlan.plan_id
        }));

        res.status(200).json({
            activePlan,
            resourceUtilization,
            allPlanConfigurations: allPlanConfigurationsWithActiveFlag,
            latestPayment
        });

    } catch (error) {
        console.error('❌ Error fetching plan and resource details:', error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
};

exports.getUserTransactions = async (req, res) => {
    try {
        const userId = req.user.id;
        console.log(`DEBUG: getUserTransactions - User ID: ${userId}`);
        if (!userId) {
            console.log("DEBUG: getUserTransactions - Unauthorized: No user ID.");
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const tokenLogsQuery = `
            SELECT
                id,
                tokens_used,
                action_description,
                used_at AS transaction_date,
                'token_usage' AS type
            FROM
                token_usage_logs
            WHERE
                user_id = $1
            ORDER BY
                used_at DESC;
        `;
        const tokenLogsResult = await pool.query(tokenLogsQuery, [userId]);

        const paymentsQuery = `
            SELECT
                id,
                amount,
                currency,
                status,
                payment_method,
                TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS transaction_date,
                'payment' AS type,
                razorpay_payment_id,
                razorpay_order_id,
                razorpay_signature,
                TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS payment_date,
                subscription_id
            FROM
                payments
            WHERE
                user_id = $1
            ORDER BY
                created_at DESC;
        `;
        const paymentsResult = await pool.query(paymentsQuery, [userId]);

        const RAZORPAY_INVOICE_BASE_URL = process.env.RAZORPAY_INVOICE_BASE_URL || 'https://dashboard.razorpay.com/app/payments/';
        const paymentsWithInvoiceLinks = paymentsResult.rows.map(payment => ({
            ...payment,
            invoice_link: payment.razorpay_payment_id ? `${RAZORPAY_INVOICE_BASE_URL}${payment.razorpay_payment_id}` : null
        }));

        const allTransactions = [...tokenLogsResult.rows, ...paymentsWithInvoiceLinks];
        allTransactions.sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));

        res.status(200).json({
            transactions: allTransactions
        });

    } catch (error) {
        console.error('❌ Error fetching user transactions:', error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
};

exports.getUserResourceUtilization = async (req, res) => {
    try {
        const userId = req.user.id;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const apiGatewayUrl = process.env.API_GATEWAY_URL || "http://localhost:5000";
        const authorizationHeader = req.headers.authorization;

        let userUsageFromDocumentService = null;
        let userPlanFromDocumentService = null;
        let timeLeftUntilReset = null;

        try {
            const documentServiceResponse = await axios.get(`${apiGatewayUrl}/files/user-usage-and-plan/${userId}`, {
                headers: { Authorization: authorizationHeader },
                timeout: 10000 // 10 seconds
            });

            if (documentServiceResponse.status === 200 && documentServiceResponse.data.success) {
                userUsageFromDocumentService = documentServiceResponse.data.data.usage;
                userPlanFromDocumentService = documentServiceResponse.data.data.plan;
                timeLeftUntilReset = documentServiceResponse.data.data.timeLeft;
            } else {
                console.error('❌ Document Service returned an error:', documentServiceResponse.data);
            }
        } catch (err) {
            console.error('❌ Error fetching user usage and plan from Document Service:', err.message);
        }

        let activePlanFromPaymentService = null;
        if (!userPlanFromDocumentService) {
            const subscriptionQuery = `
                SELECT
                    sp.*,
                    us.start_date,
                    us.end_date,
                    us.status AS subscription_status
                FROM user_subscriptions us
                JOIN subscription_plans sp ON us.plan_id = sp.id
                WHERE us.user_id = $1 AND us.status = 'active'
                ORDER BY us.start_date DESC
                LIMIT 1;
            `;
            const subscriptionResult = await pool.query(subscriptionQuery, [userId]);
            activePlanFromPaymentService = subscriptionResult.rows[0] || null;
        }
        const effectivePlan = userPlanFromDocumentService || activePlanFromPaymentService;
        
        // Calculate total tokens and cost from llm_usage_logs (source of truth)
        let totalTokensFromLogs = 0;
        let totalCostFromLogs = 0;
        try {
            const llmUsageQuery = `
                SELECT 
                    COALESCE(SUM(total_tokens), 0) as total_tokens,
                    COALESCE(SUM(total_cost), 0) as total_cost
                FROM public.llm_usage_logs
                WHERE user_id = $1
            `;
            const llmUsageResult = await pool.query(llmUsageQuery, [userId]);
            if (llmUsageResult.rows && llmUsageResult.rows.length > 0) {
                totalTokensFromLogs = parseInt(llmUsageResult.rows[0].total_tokens) || 0;
                totalCostFromLogs = parseFloat(llmUsageResult.rows[0].total_cost) || 0;
            }
        } catch (err) {
            console.error('❌ Error fetching total tokens from llm_usage_logs:', err.message);
            // Fallback to document service if llm_usage_logs query fails
            totalTokensFromLogs = userUsageFromDocumentService ? userUsageFromDocumentService.tokens_used : 0;
        }
        
        // Use tokens from llm_usage_logs (source of truth) instead of user_usage
        const totalTokensUsed = totalTokensFromLogs;
        const currentTokenBalance = effectivePlan ? (effectivePlan.token_limit + (userUsageFromDocumentService?.carry_over_tokens || 0) - totalTokensUsed) : 0;
        const currentDocumentCount = userUsageFromDocumentService ? userUsageFromDocumentService.documents_used : 0;
        const currentAiAnalysisUsed = userUsageFromDocumentService ? userUsageFromDocumentService.ai_analysis_used : 0;
        const totalStorageUsedGB = userUsageFromDocumentService ? userUsageFromDocumentService.storage_used_gb : 0;

        if (!effectivePlan) {
            return res.status(404).json({ message: 'No active subscription found for this user.' });
        }

        const {
            plan_name,
            token_limit,
            ai_analysis_limit,
            document_limit,
            template_access,
            end_date,
            storage_limit_gb
        } = effectivePlan;

        const planStorageLimitGB = storage_limit_gb || 0;

        const calculateUtilization = (used, limit) => {
            if (limit === 0) return { used, limit, percentage_used: 0, status: 'unlimited' };
            const percentage = ((used / limit) * 100).toFixed(0);
            const status = used >= limit ? 'exceeded' : 'within_limit';
            return { used, limit, percentage_used: percentage, status };
        };

        res.status(200).json({
            planDetails: {
                plan_name,
                token_limit,
                ai_analysis_limit,
                document_limit,
                template_access,
                expiration_date: end_date
            },
            resourceUtilization: {
                tokens: {
                    ...calculateUtilization(totalTokensUsed, token_limit),
                    cost: totalCostFromLogs, // Include total cost from llm_usage_logs
                    total_tokens: totalTokensUsed // Include total tokens for reference
                },
                documents: calculateUtilization(currentDocumentCount, document_limit),
                queries: calculateUtilization(currentAiAnalysisUsed, ai_analysis_limit),
                storage: {
                    used_gb: totalStorageUsedGB,
                    limit_gb: planStorageLimitGB,
                    percentage_used: planStorageLimitGB > 0 ? ((totalStorageUsedGB / planStorageLimitGB) * 100).toFixed(0) : 0,
                    status: planStorageLimitGB > 0 && totalStorageUsedGB >= planStorageLimitGB ? 'exceeded' : 'within_limit',
                    note: planStorageLimitGB === 0 ? "No storage limit defined for this plan." : undefined
                },
                timeLeftUntilReset: timeLeftUntilReset ? `${Math.floor(timeLeftUntilReset / 3600)}h ${Math.floor((timeLeftUntilReset % 3600) / 60)}m ${timeLeftUntilReset % 60}s` : 'N/A'
            }
        });

    } catch (error) {
        console.error('❌ Error fetching user resource utilization:', error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
};

exports.getUserPlanById = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) {
            return res.status(400).json({ message: 'User ID is required.' });
        }

        const subscriptionQuery = `
            SELECT
                sp.*,
                us.start_date,
                us.end_date,
                us.status AS subscription_status
            FROM user_subscriptions us
            JOIN subscription_plans sp ON us.plan_id = sp.id
            WHERE us.user_id = $1 AND us.status = 'active'
            ORDER BY us.start_date DESC
            LIMIT 1;
        `;
        const subscriptionResult = await pool.query(subscriptionQuery, [userId]);
        const activePlan = subscriptionResult.rows[0] || null;

        if (!activePlan) {
            return res.status(404).json({ success: false, message: 'No active plan found for this user.' });
        }

        res.status(200).json({ success: true, data: activePlan });

    } catch (error) {
        console.error(`❌ Error fetching user plan for user ${req.params.userId}:`, error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
};
