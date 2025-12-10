/**
 * System check utilities
 * Helps diagnose JWT token issues
 */

/**
 * Check if system clock is synchronized (within 5 minutes of actual time)
 * This is critical for JWT token generation
 */
async function checkSystemClock() {
  try {
    // Get current system time
    const systemTime = Date.now();
    
    // Try to get time from a reliable source (using a simple HTTP request)
    const https = require('https');
    const http = require('http');
    
    return new Promise((resolve) => {
      const options = {
        hostname: 'worldtimeapi.org',
        path: '/api/timezone/UTC',
        method: 'GET',
        timeout: 5000
      };
      
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const timeData = JSON.parse(data);
            const serverTime = new Date(timeData.utc_datetime).getTime();
            const timeDiff = Math.abs(serverTime - systemTime);
            const timeDiffMinutes = timeDiff / (1000 * 60);
            
            console.log(`🕐 System Clock Check:`);
            console.log(`   System Time: ${new Date(systemTime).toISOString()}`);
            console.log(`   Server Time: ${timeData.utc_datetime}`);
            console.log(`   Time Difference: ${timeDiffMinutes.toFixed(2)} minutes`);
            
            if (timeDiffMinutes > 5) {
              console.warn(`⚠️ WARNING: System clock is out of sync by ${timeDiffMinutes.toFixed(2)} minutes!`);
              console.warn(`   This can cause JWT token errors. Please sync your system clock.`);
              resolve({
                synchronized: false,
                differenceMinutes: timeDiffMinutes,
                message: `Clock is out of sync by ${timeDiffMinutes.toFixed(2)} minutes`
              });
            } else {
              console.log(`✅ System clock is synchronized (within acceptable range)`);
              resolve({
                synchronized: true,
                differenceMinutes: timeDiffMinutes,
                message: 'Clock is synchronized'
              });
            }
          } catch (error) {
            console.warn(`⚠️ Could not verify system clock: ${error.message}`);
            resolve({
              synchronized: null,
              differenceMinutes: null,
              message: 'Could not verify clock sync'
            });
          }
        });
      });
      
      req.on('error', (error) => {
        console.warn(`⚠️ Could not check system clock: ${error.message}`);
        resolve({
          synchronized: null,
          differenceMinutes: null,
          message: 'Could not check clock sync'
        });
      });
      
      req.on('timeout', () => {
        req.destroy();
        console.warn(`⚠️ Clock check timed out`);
        resolve({
          synchronized: null,
          differenceMinutes: null,
          message: 'Clock check timed out'
        });
      });
      
      req.end();
    });
  } catch (error) {
    console.warn(`⚠️ Error checking system clock: ${error.message}`);
    return {
      synchronized: null,
      differenceMinutes: null,
      message: 'Error checking clock'
    };
  }
}

/**
 * Validate GCS credentials structure
 */
function validateCredentials(credentials) {
  const requiredFields = ['project_id', 'private_key', 'client_email', 'type'];
  const missingFields = requiredFields.filter(field => !credentials[field]);
  
  if (missingFields.length > 0) {
    return {
      valid: false,
      message: `Missing required fields: ${missingFields.join(', ')}`
    };
  }
  
  // Check if private_key looks valid (should start with -----BEGIN PRIVATE KEY-----)
  if (!credentials.private_key.includes('BEGIN PRIVATE KEY')) {
    return {
      valid: false,
      message: 'Invalid private_key format'
    };
  }
  
  return {
    valid: true,
    message: 'Credentials structure is valid'
  };
}

module.exports = {
  checkSystemClock,
  validateCredentials,
};



