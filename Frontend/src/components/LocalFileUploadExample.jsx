import React, { useState } from 'react';
import { toast } from 'react-toastify';
import LocalFileUpload from './LocalFileUpload';

/**
 * Example usage of LocalFileUpload component
 * 
 * This demonstrates how to use the LocalFileUpload component
 * in your application.
 */
const LocalFileUploadExample = () => {
  const [uploadedDrafts, setUploadedDrafts] = useState([]);

  const handleUploadSuccess = (draft, editorUrl) => {
    console.log('Upload successful:', draft);
    console.log('Editor URL:', editorUrl);
    
    // Add to list of uploaded drafts
    setUploadedDrafts(prev => [...prev, draft]);
    
    toast.success(`File "${draft.title}" uploaded successfully!`, {
      autoClose: 3000
    });
  };

  const handleUploadError = (error) => {
    console.error('Upload error:', error);
    // Error is already shown via toast in the component
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Upload Document</h2>
      <p className="text-gray-600 mb-6">
        Upload a file from your local computer. It will be uploaded to GCS,
        converted to Google Docs, and saved to the database.
      </p>

      <LocalFileUpload
        onUploadSuccess={handleUploadSuccess}
        onUploadError={handleUploadError}
        maxFileSize={100 * 1024 * 1024} // 100MB
        showEditorButton={true}
      />

      {/* List of uploaded drafts */}
      {uploadedDrafts.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-3">Uploaded Documents</h3>
          <div className="space-y-2">
            {uploadedDrafts.map((draft) => (
              <div
                key={draft.id}
                className="p-4 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between"
              >
                <div>
                  <p className="font-medium text-gray-900">{draft.title}</p>
                  <p className="text-sm text-gray-500">
                    ID: {draft.id} | Google File ID: {draft.google_file_id}
                  </p>
                  {draft.last_synced_at && (
                    <p className="text-xs text-gray-400">
                      Last synced: {new Date(draft.last_synced_at).toLocaleString()}
                    </p>
                  )}
                </div>
                <a
                  href={`https://docs.google.com/document/d/${draft.google_file_id}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm transition-colors"
                >
                  Open in Google Docs
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default LocalFileUploadExample;


