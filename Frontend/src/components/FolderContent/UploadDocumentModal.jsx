import React, { useState, useRef } from 'react';
import { toast } from 'react-toastify';
import GoogleDrivePicker from '../GoogleDrivePicker';

const UploadDocumentModal = ({ isOpen, onClose, onUpload, folderName }) => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    const oversizedFiles = files.filter(file => file.size > MAX_FILE_SIZE);
    
    if (oversizedFiles.length > 0) {
      const errorMessage = 'File size limit exceeded. You can upload only up to 100 MB.';
      setError(errorMessage);
      toast.error(errorMessage, {
        autoClose: 5000
      });
      setSelectedFiles([]);
      e.target.value = '';
      return;
    }
    
    setSelectedFiles(files);
    setError('');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    const MAX_FILE_SIZE = 100 * 1024 * 1024;
    const oversizedFiles = files.filter(file => file.size > MAX_FILE_SIZE);
    
    if (oversizedFiles.length > 0) {
      const errorMessage = 'File size limit exceeded. You can upload only up to 100 MB.';
      setError(errorMessage);
      toast.error(errorMessage, {
        autoClose: 5000
      });
      setSelectedFiles([]);
      return;
    }
    
    setSelectedFiles(files);
    setError('');
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      setError('Please select at least one file to upload.');
      return;
    }
    setError('');
    onUpload(selectedFiles);
    setSelectedFiles([]);
    onClose();
  };

  const handleGoogleDriveUpload = (documents) => {
    // Google Drive files have been downloaded and uploaded to the server
    // Trigger the same callback as local upload
    if (onUpload) {
      // Convert document format to match expected format
      const uploadedFiles = documents.filter(doc => doc.status !== 'failed');
      if (uploadedFiles.length > 0) {
        onUpload(uploadedFiles, true); // true indicates files are already uploaded
      }
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg border border-gray-700">
        <h3 className="text-xl font-semibold text-white mb-4">Upload Documents</h3>
        
        {/* Upload Source Options */}
        <div className="mb-4">
          <p className="text-sm text-gray-400 mb-3">Choose upload source:</p>
          <div className="flex gap-3 justify-center mb-4">
            <button
              type="button"
              onClick={() => fileInputRef.current.click()}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md flex items-center gap-2 transition-colors duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Local Files
            </button>
            <GoogleDrivePicker
              folderName={folderName}
              onUploadComplete={handleGoogleDriveUpload}
              buttonText="Google Drive"
              multiselect={true}
            />
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div
            className="border-2 border-dashed border-gray-600 rounded-lg p-6 text-center cursor-pointer hover:border-blue-500 transition-colors duration-200 mb-4"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current.click()}
          >
            <input
              type="file"
              multiple
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <p className="mt-2 text-sm text-gray-400">
              Drag and drop files here, or <span className="font-medium text-blue-400">click to browse</span>
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Maximum file size: 100 MB
            </p>
            {selectedFiles.length > 0 && (
              <div className="mt-3 text-sm text-gray-300">
                Selected: {selectedFiles.map(file => file.name).join(', ')}
              </div>
            )}
          </div>
          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-white rounded-md transition-colors duration-200" 
              style={{ backgroundColor: '#1AA49B' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={selectedFiles.length === 0}
              className={`px-4 py-2 text-white rounded-md transition-colors duration-200 ${
                selectedFiles.length === 0 ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              style={{ backgroundColor: '#21C1B6' }}
            >
              Upload Local Files
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UploadDocumentModal;