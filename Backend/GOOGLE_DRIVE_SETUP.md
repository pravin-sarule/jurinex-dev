# Google Drive Integration Setup Guide

This guide explains how to set up the Google Drive integration for document uploads.

## Prerequisites

1. A Google Cloud Console project (e.g., 'jurinexai')
2. OAuth 2.0 credentials configured with the Google Drive API enabled
3. PostgreSQL database with the users table

## Step 1: Google Cloud Console Configuration

### Enable Google Drive API
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project ('jurinexai')
3. Navigate to **APIs & Services > Library**
4. Search for "Google Drive API" and enable it
5. Search for "Google Picker API" and enable it

### Create OAuth 2.0 Credentials
1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Select **Web application**
4. Add authorized redirect URIs:
   - `http://localhost:5173/auth/google/drive/callback` (development)
   - `https://yourdomain.com/auth/google/drive/callback` (production)
5. Copy the **Client ID** and **Client Secret**

### Create API Key
1. Click **Create Credentials > API Key**
2. Restrict the key to:
   - **HTTP referrers** (websites)
   - Add your frontend URLs
   - Enable only **Google Drive API** and **Google Picker API**

## Step 2: Environment Variables

### Auth Service (.env)
```env
# Google OAuth credentials
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_DRIVE_REDIRECT_URI=http://localhost:5173/auth/google/drive/callback

# Frontend URL for generating redirect URIs
FRONTEND_URL=http://localhost:5173
```

### Document Service (.env)
```env
# Google OAuth credentials (same as auth service)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

### Frontend (.env)
```env
# Google API Key for Picker
VITE_GOOGLE_API_KEY=your-api-key

# Gateway URL
VITE_APP_GATEWAY_URL=http://localhost:5000
```

## Step 3: Database Migration

Run the following SQL migration to add required columns to the users table:

```sql
-- Run this in your PostgreSQL database
ALTER TABLE users
ADD COLUMN IF NOT EXISTS google_drive_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS google_drive_token_expiry TIMESTAMPTZ;
```

Or use the migration file:
```bash
psql -d your_database -f Backend/authservice/src/models/migrations/add_google_drive_columns.sql
```

## Step 4: Install Dependencies

### Auth Service
```bash
cd Backend/authservice
npm install googleapis
```

### Document Service
```bash
cd Backend/document-service
npm install googleapis google-auth-library
```

## Step 5: Test the Integration

1. Start all services (auth, document, gateway)
2. Log in to the frontend
3. Navigate to a folder/documents page
4. Click the "Drive" button
5. If not connected, you'll be redirected to Google OAuth
6. After authorization, the Google Picker will open
7. Select files to upload
8. Files will be downloaded from Google Drive and uploaded to your storage

## API Endpoints

### Auth Service (via Gateway: /auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/google/drive` | Initiate OAuth flow (returns authUrl) |
| POST | `/auth/google/drive/callback` | Exchange code for tokens |
| GET | `/auth/google/drive/status` | Check connection status |
| GET | `/auth/google/drive/token` | Get fresh access token |
| DELETE | `/auth/google/drive` | Disconnect Google Drive |

### Document Service (via Gateway: /docs)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/docs/google-drive/download` | Download single file |
| POST | `/docs/google-drive/download-multiple` | Download multiple files |
| GET | `/docs/google-drive/info/:fileId` | Get file metadata |

## Troubleshooting

### "redirect_uri_mismatch" Error
- Ensure the redirect URI in Google Cloud Console matches exactly
- Check both HTTP/HTTPS and trailing slashes

### "invalid_grant" Error
- The refresh token has expired or been revoked
- User needs to disconnect and reconnect Google Drive

### "User not authenticated" Error
- Ensure the JWT token is being sent in the Authorization header
- Check that the auth middleware is working correctly

### Files Not Downloading
- Check that the Google Drive API is enabled
- Verify the OAuth scopes include `drive.readonly` or `drive.file`
- Check server logs for detailed error messages

## Security Notes

1. **Never commit credentials** to version control
2. **Restrict API keys** to specific domains and APIs
3. **Use HTTPS** in production
4. **Validate file types** and sizes on upload
5. **Store refresh tokens** encrypted in production




