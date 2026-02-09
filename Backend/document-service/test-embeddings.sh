#!/bin/bash

# Complete Test Script for Document Upload and Embedding System
# This script tests the entire flow: upload, verify, and query

set -e  # Exit on error

echo "=========================================="
echo "Document Upload & Embedding Test Script"
echo "=========================================="
echo ""

# Configuration
BASE_URL="http://localhost:5002"
AUTH_TOKEN="${1:-YOUR_TOKEN_HERE}"
FILE_ID="${2:-c8fa942d-9ffc-48bf-88da-0e84d34b3602}"

if [ "$AUTH_TOKEN" = "YOUR_TOKEN_HERE" ]; then
    echo "❌ Error: Please provide your auth token as the first argument"
    echo "Usage: ./test-embeddings.sh YOUR_AUTH_TOKEN [FILE_ID]"
    exit 1
fi

echo "📋 Configuration:"
echo "   Base URL: $BASE_URL"
echo "   File ID: $FILE_ID"
echo ""

# Function to make API calls
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    
    if [ -z "$data" ]; then
        curl -s -X $method "$BASE_URL$endpoint" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -H "Content-Type: application/json"
    else
        curl -s -X $method "$BASE_URL$endpoint" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

# Test 1: Verify Current Status
echo "=========================================="
echo "Test 1: Verify Current File Status"
echo "=========================================="
echo ""

VERIFY_RESPONSE=$(api_call GET "/api/documents/verify/$FILE_ID")
echo "$VERIFY_RESPONSE" | jq '.'

CHUNKS_TOTAL=$(echo "$VERIFY_RESPONSE" | jq -r '.chunks.total // 0')
EMBEDDINGS_TOTAL=$(echo "$VERIFY_RESPONSE" | jq -r '.embeddings.total // 0')
COVERAGE=$(echo "$VERIFY_RESPONSE" | jq -r '.embeddings.coverage_percentage // 0')
ALL_CHECKS=$(echo "$VERIFY_RESPONSE" | jq -r '.verification.all_checks_passed // false')

echo ""
echo "📊 Current Status:"
echo "   Chunks: $CHUNKS_TOTAL"
echo "   Embeddings: $EMBEDDINGS_TOTAL"
echo "   Coverage: $COVERAGE%"
echo "   All Checks Passed: $ALL_CHECKS"
echo ""

# Test 2: Reprocess if needed
if [ "$EMBEDDINGS_TOTAL" = "0" ] && [ "$CHUNKS_TOTAL" != "0" ]; then
    echo "=========================================="
    echo "Test 2: Reprocess Embeddings"
    echo "=========================================="
    echo ""
    echo "⚠️  File has chunks but no embeddings. Reprocessing..."
    echo ""
    
    REPROCESS_RESPONSE=$(api_call POST "/api/documents/reprocess-embeddings/$FILE_ID")
    echo "$REPROCESS_RESPONSE" | jq '.'
    
    SUCCESS=$(echo "$REPROCESS_RESPONSE" | jq -r '.success // false')
    
    if [ "$SUCCESS" = "true" ]; then
        echo ""
        echo "✅ Reprocessing completed successfully!"
        
        BEFORE_EMBEDDINGS=$(echo "$REPROCESS_RESPONSE" | jq -r '.before.embeddings')
        AFTER_EMBEDDINGS=$(echo "$REPROCESS_RESPONSE" | jq -r '.after.embeddings')
        AFTER_COVERAGE=$(echo "$REPROCESS_RESPONSE" | jq -r '.after.coverage')
        
        echo "   Before: $BEFORE_EMBEDDINGS embeddings"
        echo "   After: $AFTER_EMBEDDINGS embeddings"
        echo "   Coverage: $AFTER_COVERAGE%"
    else
        echo ""
        echo "❌ Reprocessing failed!"
        ERROR=$(echo "$REPROCESS_RESPONSE" | jq -r '.error // "Unknown error"')
        echo "   Error: $ERROR"
        exit 1
    fi
    echo ""
elif [ "$ALL_CHECKS" = "true" ]; then
    echo "=========================================="
    echo "Test 2: Reprocess Embeddings"
    echo "=========================================="
    echo ""
    echo "✅ File already has complete embeddings. Skipping reprocess."
    echo ""
else
    echo "=========================================="
    echo "Test 2: Reprocess Embeddings"
    echo "=========================================="
    echo ""
    echo "⚠️  File has no chunks. Please upload the file first."
    echo ""
    exit 1
fi

# Test 3: Verify After Reprocess
echo "=========================================="
echo "Test 3: Verify After Reprocessing"
echo "=========================================="
echo ""

VERIFY_AFTER=$(api_call GET "/api/documents/verify/$FILE_ID")
echo "$VERIFY_AFTER" | jq '.'

CHUNKS_AFTER=$(echo "$VERIFY_AFTER" | jq -r '.chunks.total // 0')
EMBEDDINGS_AFTER=$(echo "$VERIFY_AFTER" | jq -r '.embeddings.total // 0')
COVERAGE_AFTER=$(echo "$VERIFY_AFTER" | jq -r '.embeddings.coverage_percentage // 0')
ALL_CHECKS_AFTER=$(echo "$VERIFY_AFTER" | jq -r '.verification.all_checks_passed // false')

echo ""
echo "📊 Final Status:"
echo "   Chunks: $CHUNKS_AFTER"
echo "   Embeddings: $EMBEDDINGS_AFTER"
echo "   Coverage: $COVERAGE_AFTER%"
echo "   All Checks Passed: $ALL_CHECKS_AFTER"
echo ""

# Test 4: Check Embedding Dimensions
echo "=========================================="
echo "Test 4: Check Embedding Dimensions"
echo "=========================================="
echo ""

SAMPLE_EMBEDDINGS=$(echo "$VERIFY_AFTER" | jq -r '.embeddings.sample')
FIRST_DIMENSION=$(echo "$SAMPLE_EMBEDDINGS" | jq -r '.[0].embedding_dimension // "N/A"')

echo "📏 Embedding Dimension: $FIRST_DIMENSION"

if [ "$FIRST_DIMENSION" = "768" ]; then
    echo "✅ Correct dimension (768 - optimized for RAG)"
elif [ "$FIRST_DIMENSION" = "3072" ]; then
    echo "⚠️  Using full dimension (3072 - works but uses more storage)"
else
    echo "❌ Unexpected dimension: $FIRST_DIMENSION"
fi
echo ""

# Final Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo ""

if [ "$ALL_CHECKS_AFTER" = "true" ] && [ "$FIRST_DIMENSION" = "768" ]; then
    echo "✅ ALL TESTS PASSED!"
    echo ""
    echo "Your file is ready for querying:"
    echo "   - Chunks: $CHUNKS_AFTER ✅"
    echo "   - Embeddings: $EMBEDDINGS_AFTER ✅"
    echo "   - Coverage: $COVERAGE_AFTER% ✅"
    echo "   - Dimension: $FIRST_DIMENSION ✅"
    echo ""
    echo "You can now query this file in the intelligent folder chat!"
    exit 0
elif [ "$ALL_CHECKS_AFTER" = "true" ]; then
    echo "✅ TESTS PASSED (with warnings)"
    echo ""
    echo "Your file is ready, but using non-optimal embedding dimension."
    echo "   - Chunks: $CHUNKS_AFTER ✅"
    echo "   - Embeddings: $EMBEDDINGS_AFTER ✅"
    echo "   - Coverage: $COVERAGE_AFTER% ✅"
    echo "   - Dimension: $FIRST_DIMENSION ⚠️"
    echo ""
    echo "Consider re-uploading the file to use 768-dimension embeddings."
    exit 0
else
    echo "❌ TESTS FAILED"
    echo ""
    echo "Status:"
    echo "   - Chunks: $CHUNKS_AFTER"
    echo "   - Embeddings: $EMBEDDINGS_AFTER"
    echo "   - Coverage: $COVERAGE_AFTER%"
    echo "   - All Checks: $ALL_CHECKS_AFTER"
    echo ""
    echo "Please check the logs for errors."
    exit 1
fi
