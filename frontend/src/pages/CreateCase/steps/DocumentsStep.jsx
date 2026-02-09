import React, { useState, useRef } from 'react';
import { Upload, Calendar } from 'lucide-react';

const DocumentsStep = ({ caseData, setCaseData }) => {
  const [documentType, setDocumentType] = useState(caseData.documentType || '');
  const [filedByPlaintiff, setFiledByPlaintiff] = useState(caseData.filedByPlaintiff || false);
  const [filedByDefendant, setFiledByDefendant] = useState(caseData.filedByDefendant || false);
  const [documentDate, setDocumentDate] = useState(caseData.documentDate || '');
  const [displayDocumentDate, setDisplayDocumentDate] = useState(caseData.displayDocumentDate || '');
  const [autoRemind, setAutoRemind] = useState(caseData.autoRemind || false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Format date to Indian dd/mm/yyyy
  const formatDateToIndian = (isoDate) => {
    if (!isoDate) return '';
    const [year, month, day] = isoDate.split('-');
    return `${day}/${month}/${year}`;
  };

  // Handle document type change
  const handleDocumentTypeChange = (e) => {
    const value = e.target.value;
    setDocumentType(value);
    setCaseData({ ...caseData, documentType: value });
  };

  // Handle filed by checkboxes
  const handleFiledByChange = (type, checked) => {
    if (type === 'plaintiff') {
      setFiledByPlaintiff(checked);
      setCaseData({ ...caseData, filedByPlaintiff: checked });
    } else if (type === 'defendant') {
      setFiledByDefendant(checked);
      setCaseData({ ...caseData, filedByDefendant: checked });
    }
  };

  // Handle document date change
  const handleDocumentDateChange = (e) => {
    const isoDate = e.target.value;
    const formatted = formatDateToIndian(isoDate);
    setDocumentDate(isoDate);
    setDisplayDocumentDate(formatted);
    setCaseData({
      ...caseData,
      documentDate: isoDate,
      displayDocumentDate: formatted,
    });
  };

  // Handle auto-remind checkbox
  const handleAutoRemindChange = (e) => {
    const checked = e.target.checked;
    setAutoRemind(checked);
    setCaseData({ ...caseData, autoRemind: checked });
  };

  // Handle file selection
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setSelectedFiles(files);
    // Update caseData with files
    setCaseData({
      ...caseData,
      uploadedFiles: [...(caseData.uploadedFiles || []), ...files],
    });
  };

  // Handle drag and drop
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    setSelectedFiles(files);
    setCaseData({
      ...caseData,
      uploadedFiles: [...(caseData.uploadedFiles || []), ...files],
    });
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start mb-6">
        <Upload className="w-6 h-6 mr-3 text-gray-700 mt-1" />
        <div>
          <h3 className="text-xl font-semibold text-gray-900">
            Upload & Manage Documents
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Add documents related to your case with relevant metadata.
          </p>
        </div>
      </div>

      {/* Form Fields */}
      <div className="space-y-6">
        {/* Document Type - TEXT INPUT FIELD */}
        <div>
          <label
            htmlFor="documentType"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Document Type <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="documentType"
            value={documentType}
            onChange={handleDocumentTypeChange}
            placeholder="e.g., Affidavit, Evidence, Agreement, Notice"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
                       placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] 
                       focus:border-[#9CDFE1] outline-none"
            required
            aria-required="true"
            aria-label="Document Type"
          />
        </div>

        {/* Filed by whom - Checkboxes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filed by whom
          </label>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={filedByPlaintiff}
                onChange={(e) => handleFiledByChange('plaintiff', e.target.checked)}
                className="w-4 h-4 text-[#9CDFE1] border-gray-300 rounded focus:ring-[#9CDFE1]"
                aria-label="Filed by Plaintiff"
              />
              <span className="ml-2 text-sm text-gray-700">Plaintiff</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={filedByDefendant}
                onChange={(e) => handleFiledByChange('defendant', e.target.checked)}
                className="w-4 h-4 text-[#9CDFE1] border-gray-300 rounded focus:ring-[#9CDFE1]"
                aria-label="Filed by Defendant"
              />
              <span className="ml-2 text-sm text-gray-700">Defendant</span>
            </label>
          </div>
        </div>

        {/* Document Date - Date input field */}
        <div className="relative">
          <label
            htmlFor="documentDate"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Document Date
          </label>
          <div className="relative">
            <input
              type="text"
              value={displayDocumentDate}
              placeholder="dd/mm/yyyy"
              readOnly
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
                         placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] 
                         focus:border-[#9CDFE1] outline-none pr-10 bg-white pointer-events-none"
              aria-label="Document Date"
            />
            {/* Calendar Icon */}
            <div className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none">
              <Calendar className="w-5 h-5" />
            </div>
            {/* Actual Date Input - Positioned on top */}
            <input
              id="documentDate"
              type="date"
              value={documentDate}
              onChange={handleDocumentDateChange}
              className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
              style={{ colorScheme: 'light' }}
              aria-label="Document Date Picker"
            />
          </div>
        </div>

        {/* Auto-remind me about hearings - Checkbox with helper text */}
        <div className="flex items-start">
          <input
            type="checkbox"
            id="autoRemind"
            checked={autoRemind}
            onChange={handleAutoRemindChange}
            className="mt-1 w-4 h-4 text-[#9CDFE1] border-gray-300 rounded focus:ring-[#9CDFE1]"
            aria-label="Auto-remind me about hearings"
          />
          <label htmlFor="autoRemind" className="ml-3">
            <div className="text-sm font-medium text-gray-700">
              Auto-remind me about hearings
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Get notifications 24 hours before scheduled hearings
            </p>
          </label>
        </div>

        {/* Upload Documents - Drag & drop / Browse */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Upload Documents
          </label>
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleBrowseClick}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-[#9CDFE1] bg-[#E6F8F7]'
                : 'border-gray-300 hover:border-[#9CDFE1] hover:bg-gray-50'
            }`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleBrowseClick();
              }
            }}
            aria-label="Upload Documents"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.tiff"
              aria-label="File Input"
            />
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-3" />
            <p className="text-sm text-gray-600 mb-1">
              Drag and drop files here, or{' '}
              <span className="text-[#9CDFE1] font-medium">click to browse</span>
            </p>
            <p className="text-xs text-gray-500">
              Supported formats: PDF, DOC, DOCX, TXT, PNG, JPG, JPEG, TIFF
            </p>
            {selectedFiles.length > 0 && (
              <div className="mt-4 text-sm text-gray-700">
                <p className="font-medium mb-2">
                  Selected files ({selectedFiles.length}):
                </p>
                <ul className="list-disc list-inside space-y-1 text-left max-h-32 overflow-y-auto">
                  {selectedFiles.map((file, index) => (
                    <li key={index} className="text-xs">
                      {file.name} ({(file.size / 1024).toFixed(2)} KB)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer note */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <p className="text-sm text-gray-500">
          All fields marked with * are required
        </p>
      </div>
    </div>
  );
};

export default DocumentsStep;
