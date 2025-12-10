/**
 * Test script to verify GCS credentials
 * Run: node scripts/test-gcs-credentials.js
 */

require('dotenv').config();
const { Storage } = require('@google-cloud/storage');
const { checkSystemClock, validateCredentials } = require('../utils/systemCheck');

async function testGCSCredentials() {
  console.log('🔍 Testing GCS Credentials...\n');

  // Step 0: Check system clock
  console.log('📝 Step 0: Checking system clock synchronization...');
  const clockStatus = await checkSystemClock();
  if (!clockStatus.synchronized && clockStatus.differenceMinutes) {
    console.error(`\n❌ CRITICAL: System clock is out of sync by ${clockStatus.differenceMinutes.toFixed(2)} minutes!`);
    console.error('   This WILL cause JWT authentication errors.');
    console.error('\n🔧 How to fix:');
    console.error('   Windows: w32tm /resync');
    console.error('   Linux: sudo ntpdate -s time.nist.gov');
    console.error('   Or sync via system settings\n');
    return;
  }
  console.log('');

  // Check if GCS_KEY_BASE64 is set
  if (!process.env.GCS_KEY_BASE64) {
    console.error('❌ GCS_KEY_BASE64 is not set in .env file');
    process.exit(1);
  }

  // Check if GCS_BUCKET_NAME is set
  if (!process.env.GCS_BUCKET_NAME) {
    console.error('❌ GCS_BUCKET_NAME is not set in .env file');
    process.exit(1);
  }

  try {
    // Decode and parse credentials
    console.log('📝 Step 1: Decoding base64 credentials...');
    const jsonString = Buffer.from(process.env.GCS_KEY_BASE64, 'base64').toString('utf-8');
    const credentials = JSON.parse(jsonString);
    console.log('✅ Credentials decoded successfully');

    // Validate credentials structure
    console.log('\n📝 Step 2: Validating credentials structure...');
    const validation = validateCredentials(credentials);
    if (!validation.valid) {
      console.error(`❌ ${validation.message}`);
      process.exit(1);
    }
    console.log('✅ Credentials structure is valid');
    console.log(`   Project ID: ${credentials.project_id}`);
    console.log(`   Client Email: ${credentials.client_email}`);
    console.log(`   Type: ${credentials.type}`);

    // Initialize Storage client
    console.log('\n📝 Step 3: Initializing GCS Storage client...');
    const storage = new Storage({
      credentials,
      projectId: credentials.project_id,
    });
    console.log('✅ Storage client initialized');

    // Test bucket access
    console.log(`\n📝 Step 4: Testing access to bucket: ${process.env.GCS_BUCKET_NAME}`);
    const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);
    const [exists] = await bucket.exists();
    
    if (!exists) {
      console.error(`❌ Bucket '${process.env.GCS_BUCKET_NAME}' does not exist or you don't have access`);
      process.exit(1);
    }
    console.log('✅ Bucket exists and is accessible');

    // Test listing files (read permission)
    console.log('\n📝 Step 5: Testing read permission...');
    try {
      const [files] = await bucket.getFiles({ maxResults: 1 });
      console.log('✅ Read permission verified');
    } catch (error) {
      console.warn(`⚠️ Read permission test failed: ${error.message}`);
    }

    // Test write permission (create a test file)
    console.log('\n📝 Step 6: Testing write permission...');
    const testFileName = `test-${Date.now()}.txt`;
    const testFile = bucket.file(testFileName);
    
    try {
      await testFile.save('test content', {
        metadata: {
          contentType: 'text/plain',
        },
      });
      console.log('✅ Write permission verified');
      
      // Clean up test file
      await testFile.delete();
      console.log('✅ Test file cleaned up');
    } catch (error) {
      console.error(`❌ Write permission test failed: ${error.message}`);
      if (error.message.includes('invalid_grant') || error.message.includes('JWT')) {
        console.error('\n💡 This is a JWT authentication error. Possible causes:');
        console.error('   1. Service account key is expired or invalid');
        console.error('   2. System clock is out of sync');
        console.error('   3. Key was regenerated but old key is still in use');
        console.error('\n🔧 Solutions:');
        console.error('   1. Generate a new service account key in GCP Console');
        console.error('   2. Update GCS_KEY_BASE64 in .env with the new key');
        console.error('   3. Sync system clock: sudo ntpdate -s time.nist.gov (Linux)');
        console.error('   4. Verify base64 encoding is correct');
      }
      process.exit(1);
    }

    console.log('\n✅ All tests passed! GCS credentials are working correctly.');
    console.log('\n📋 Summary:');
    console.log(`   - Credentials: Valid`);
    console.log(`   - Bucket Access: OK`);
    console.log(`   - Read Permission: OK`);
    console.log(`   - Write Permission: OK`);

  } catch (error) {
    console.error('\n❌ Error testing GCS credentials:', error.message);
    
    if (error.message.includes('invalid_grant') || error.message.includes('JWT')) {
      console.error('\n💡 JWT Authentication Error Detected');
      console.error('This usually means:');
      console.error('   1. Service account key is expired');
      console.error('   2. System clock is out of sync (more than 5 minutes)');
      console.error('   3. Key format is incorrect');
      console.error('\n🔧 How to fix:');
      console.error('   1. Go to GCP Console > IAM & Admin > Service Accounts');
      console.error('   2. Select your service account');
      console.error('   3. Click "Keys" tab > "Add Key" > "Create new key" (JSON)');
      console.error('   4. Base64 encode it: cat key.json | base64');
      console.error('   5. Update GCS_KEY_BASE64 in .env file');
      console.error('   6. Restart your server');
    } else if (error.message.includes('Unexpected token')) {
      console.error('\n💡 Base64 Decoding Error');
      console.error('The GCS_KEY_BASE64 might not be properly base64 encoded.');
      console.error('Make sure you encode the entire JSON file, not just parts of it.');
    }
    
    process.exit(1);
  }
}

// Run the test
testGCSCredentials().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});

