import React, { useState, useRef, useEffect } from 'react';
import { Upload, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import documentApi from '../../../services/documentApi';
import { toast } from 'react-toastify';
import {
  matchCaseType,
  matchCourtName,
  matchJurisdiction,
  matchSubType,
  matchPriorityLevel,
  matchCourtLevel
} from '../../../utils/fieldMatcher.js';

const UploadStep = ({ caseData, setCaseData, onComplete }) => {
  const [selectedFiles, setSelectedFiles] = useState(caseData.uploadedFiles || []);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null); // 'uploading', 'processing', 'extracting', 'success', 'error'
  const [uploadMessage, setUploadMessage] = useState('');
  const [processingProgress, setProcessingProgress] = useState(0); // 0-100
  const fileInputRef = useRef(null);
  
  // Dropdown options for matching
  const [caseTypes, setCaseTypes] = useState([]);
  const [courts, setCourts] = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [subTypes, setSubTypes] = useState([]);
  
  const API_BASE_URL = "https://document-service-120280829617.asia-south1.run.app/api/content";
  
  // Fetch dropdown options on component mount
  useEffect(() => {
    fetchDropdownOptions();
  }, []);
  
  const fetchDropdownOptions = async () => {
    try {
      // Fetch case types
      const caseTypesRes = await fetch(`${API_BASE_URL}/case-types`);
      if (caseTypesRes.ok) {
        const caseTypesData = await caseTypesRes.json();
        setCaseTypes(Array.isArray(caseTypesData) ? caseTypesData : []);
      }
      
      // Fetch jurisdictions
      const jurisdictionsRes = await fetch(`${API_BASE_URL}/jurisdictions`);
      if (jurisdictionsRes.ok) {
        const jurisdictionsData = await jurisdictionsRes.json();
        setJurisdictions(Array.isArray(jurisdictionsData) ? jurisdictionsData : []);
      }
      
      // Note: Courts and subTypes will be fetched after matching caseType/jurisdiction
    } catch (error) {
      console.error('Error fetching dropdown options:', error);
    }
  };
  
  const fetchCourtsByJurisdiction = async (jurisdictionId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/jurisdictions/${jurisdictionId}/courts`);
      if (response.ok) {
        const data = await response.json();
        setCourts(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching courts:', error);
    }
  };
  
  const fetchSubTypes = async (caseTypeId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/case-types/${caseTypeId}/sub-types`);
      if (response.ok) {
        const data = await response.json();
        setSubTypes(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching subTypes:', error);
    }
  };

  // Handle file selection
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    const newFiles = [...selectedFiles, ...files];
    setSelectedFiles(newFiles);
    setCaseData({
      ...caseData,
      uploadedFiles: newFiles,
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
    const newFiles = [...selectedFiles, ...files];
    setSelectedFiles(newFiles);
    setCaseData({
      ...caseData,
      uploadedFiles: newFiles,
    });
  };

  const handleUploadAndExtract = async () => {
    if (selectedFiles.length === 0) {
      toast.error('Please select at least one file to upload');
      return;
    }

    setIsUploading(true);
    setProcessingProgress(0);
    setUploadStatus('uploading');
    setUploadMessage('Uploading files...');

    try {
      // Step 1: Upload files (10% progress)
      setUploadStatus('uploading');
      setUploadMessage('Uploading files to server...');
      setProcessingProgress(10);
      
      const uploadResult = await documentApi.uploadDocumentsForProcessing(selectedFiles);
      
      if (!uploadResult.success || !uploadResult.folderName) {
        throw new Error(uploadResult.message || 'Failed to upload documents');
      }

      setProcessingProgress(20);
      const folderName = uploadResult.folderName;
      const uploadedFiles = uploadResult.uploadedFiles || [];

      // Step 2: Wait for processing to complete (20-90% progress)
      setUploadStatus('processing');
      setUploadMessage('Processing documents... Please wait...');
      
      let allProcessed = false;
      let attempts = 0;
      let consecutiveErrors = 0;
      let maxAttempts = 300; // 5 minutes max (300 * 2s = 600 seconds) - increased for large files
      const pollInterval = 2000; // 2 seconds - increased to reduce API calls
      const maxConsecutiveErrors = 10; // Allow up to 10 consecutive errors before failing
      const extendedTimeoutAttempts = 120; // Additional 4 minutes if files are still processing

      while (!allProcessed && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        attempts++;
        
        try {
          const statusResult = await documentApi.getFolderProcessingStatus(folderName);
          consecutiveErrors = 0; // Reset error counter on success
          const filesInFolder = statusResult.documents || [];
          const totalFiles = uploadedFiles.length;
          
          // If no documents found yet, continue waiting (files might still be uploading)
          if (filesInFolder.length === 0 && attempts < 20) {
            console.log(`[UploadStep] Waiting for files to appear in folder... (attempt ${attempts})`);
            continue;
          }
          
          const processedCount = filesInFolder.filter(f => f.status === 'processed').length;
          const failedCount = filesInFolder.filter(f => f.status === 'error').length;
          const processingCount = filesInFolder.filter(f => 
            f.status === 'processing' || f.status === 'queued' || f.status === 'embedding_pending'
          ).length;
          
          // Calculate progress: 20% (upload) + 70% (processing) based on completion
          const processingProgressPercent = totalFiles > 0 && filesInFolder.length > 0
            ? Math.round((processedCount / totalFiles) * 70)
            : 0;
          setProcessingProgress(20 + processingProgressPercent);
          
          // Update status message with more detail
          if (processingCount > 0) {
            setUploadMessage(`Processing documents... ${processedCount}/${totalFiles} completed, ${processingCount} in progress (${Math.round(20 + processingProgressPercent)}%)`);
          } else {
            setUploadMessage(`Processing documents... ${processedCount}/${totalFiles} completed (${Math.round(20 + processingProgressPercent)}%)`);
          }
          
          allProcessed = processedCount === totalFiles && processedCount > 0 && totalFiles > 0;
          
          // If all files are either processed or failed, we can proceed
          if (processedCount + failedCount === totalFiles && totalFiles > 0) {
            if (processedCount > 0) {
              // At least some files processed, proceed with extraction
              console.log(`[UploadStep] ${processedCount} files processed, ${failedCount} failed. Proceeding with extraction...`);
              break;
            }
          }
          
          // Check timeout only if we're not making progress
          if (attempts >= maxAttempts) {
            if (processedCount > 0) {
              // Some files processed, proceed with extraction
              console.warn(`[UploadStep] Processing timeout after ${maxAttempts} attempts, but ${processedCount} files are processed. Proceeding with extraction...`);
              break;
            } else if (processingCount > 0 && attempts < maxAttempts + extendedTimeoutAttempts) {
              // Files are still processing, extend timeout and continue waiting
              if (attempts === maxAttempts) {
                console.log(`[UploadStep] Initial timeout reached but ${processingCount} files still processing. Extending timeout by ${extendedTimeoutAttempts} more attempts...`);
                maxAttempts += extendedTimeoutAttempts;
              }
              // Continue waiting
            } else {
              throw new Error(`File processing timed out after ${attempts} attempts. Please try again or check if files are still processing.`);
            }
          }
        } catch (statusError) {
          consecutiveErrors++;
          console.error(`[UploadStep] Error getting processing status (attempt ${attempts}, consecutive errors: ${consecutiveErrors}):`, statusError);
          
          // If too many consecutive errors, fail
          if (consecutiveErrors >= maxConsecutiveErrors) {
            throw new Error(`Failed to get processing status after ${consecutiveErrors} consecutive errors: ${statusError.message}`);
          }
          
          // For network errors, continue retrying with exponential backoff
          const backoffDelay = Math.min(5000, 1000 * Math.pow(2, consecutiveErrors - 1));
          console.log(`[UploadStep] Retrying after ${backoffDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        }
      }

      if (!allProcessed && attempts >= maxAttempts && uploadedFiles.length > 0) {
        // Check one more time
        const finalStatus = await documentApi.getFolderProcessingStatus(folderName);
        const finalFiles = finalStatus.documents || [];
        const finalProcessed = finalFiles.filter(f => f.status === 'processed').length;
        if (finalProcessed === 0) {
          throw new Error('No files were processed successfully. Please try again.');
        }
      }

      setProcessingProgress(90);
      
      // Step 3: Extract fields only after 100% processing (90-100% progress)
      setUploadStatus('extracting');
      setUploadMessage('Extracting case information from processed documents...');
      
      const extractResult = await documentApi.extractCaseFieldsFromFolder(folderName);
      
      if (!extractResult.success) {
        throw new Error(extractResult.message || 'Failed to extract case fields');
      }
      
      setProcessingProgress(100);

      // Step 4: Auto-fill form with extracted data (only populate, don't create case)
      const extracted = extractResult.extractedData || {};
      
      // Match extracted values with dropdown options
      let matchedCaseType = null;
      let matchedCourtName = null;
      let matchedJurisdiction = null;
      let matchedSubType = null;
      let fetchedCourts = [];
      let fetchedSubTypes = [];
      
      // AUTO-FILL LOGIC - Respects strict dependency order:
      // Chain 1: Adjudicating Authority (Jurisdiction) → Court → Bench → Case Prefix/Number/Year
      // Chain 2: Case Type → Sub-Type → Case Nature
      
      // Chain 1: Step 1 - Match Adjudicating Authority (Jurisdiction) first
      if (extracted.jurisdiction && !caseData.jurisdictionId && !caseData.jurisdiction) {
        matchedJurisdiction = matchJurisdiction(extracted.jurisdiction, jurisdictions);
        if (matchedJurisdiction) {
          console.log(`✅ Matched jurisdiction (Adjudicating Authority): "${extracted.jurisdiction}" → "${matchedJurisdiction.label}" (score: ${matchedJurisdiction.score.toFixed(2)})`);
          // Fetch courts for matched jurisdiction (dependency chain)
          await fetchCourtsByJurisdiction(matchedJurisdiction.value);
          await new Promise(resolve => setTimeout(resolve, 100));
          try {
            const courtsRes = await fetch(`${API_BASE_URL}/jurisdictions/${matchedJurisdiction.value}/courts`);
            if (courtsRes.ok) {
              fetchedCourts = await courtsRes.json();
              setCourts(Array.isArray(fetchedCourts) ? fetchedCourts : []);
            }
          } catch (err) {
            console.error('Error fetching courts:', err);
          }
        }
      }
      
      // Chain 1: Step 2 - Match Court (only if jurisdiction matched)
      const courtsToUse = fetchedCourts.length > 0 ? fetchedCourts : courts;
      if (matchedJurisdiction && extracted.courtName && !caseData.courtId && !caseData.courtName && courtsToUse.length > 0) {
        matchedCourtName = matchCourtName(extracted.courtName, courtsToUse);
        if (matchedCourtName) {
          console.log(`✅ Matched courtName: "${extracted.courtName}" → "${matchedCourtName.label}" (score: ${matchedCourtName.score.toFixed(2)})`);
          // Note: Bench matching would happen here if we have bench data extracted, but typically
          // we only extract court name, so bench selection remains manual
        }
      }
      
      // Chain 2: Step 1 - Match Case Type
      if (extracted.caseType && !caseData.caseTypeId && !caseData.caseType) {
        matchedCaseType = matchCaseType(extracted.caseType, caseTypes);
        if (matchedCaseType) {
          console.log(`✅ Matched caseType: "${extracted.caseType}" → "${matchedCaseType.label}" (score: ${matchedCaseType.score.toFixed(2)})`);
          // Fetch subTypes for matched caseType (dependency chain)
          await fetchSubTypes(matchedCaseType.value);
          await new Promise(resolve => setTimeout(resolve, 100));
          try {
            const subTypesRes = await fetch(`${API_BASE_URL}/case-types/${matchedCaseType.value}/sub-types`);
            if (subTypesRes.ok) {
              fetchedSubTypes = await subTypesRes.json();
              setSubTypes(Array.isArray(fetchedSubTypes) ? fetchedSubTypes : []);
            }
          } catch (err) {
            console.error('Error fetching subTypes:', err);
          }
        }
      }
      
      // Chain 2: Step 2 - Match Sub-Type (only if caseType matched)
      const subTypesToUse = fetchedSubTypes.length > 0 ? fetchedSubTypes : subTypes;
      if (matchedCaseType && extracted.subType && !caseData.subTypeId && !caseData.subType && subTypesToUse.length > 0) {
        matchedSubType = matchSubType(extracted.subType, subTypesToUse);
        if (matchedSubType) {
          console.log(`✅ Matched subType: "${extracted.subType}" → "${matchedSubType.label}" (score: ${matchedSubType.score.toFixed(2)})`);
        }
      }
      
      // Match priorityLevel
      const matchedPriority = extracted.priorityLevel ? matchPriorityLevel(extracted.priorityLevel) : null;
      
      // Match courtLevel
      const matchedCourtLevel = extracted.courtLevel ? matchCourtLevel(extracted.courtLevel) : null;
      
      // Track which fields were auto-filled for highlighting
      const autoFilledFields = new Set();
      
      // Generate case title from petitioners vs respondents if not provided or if extracted caseTitle is empty
      let generatedCaseTitle = extracted.caseTitle || '';
      
      // If no case title in extracted data, generate from petitioners vs respondents
      if (!generatedCaseTitle && extracted.petitioners && extracted.respondents) {
        const petitionerNames = Array.isArray(extracted.petitioners) && extracted.petitioners.length > 0
          ? extracted.petitioners.map(p => typeof p === 'string' ? p : (p.fullName || '')).filter(Boolean)
          : (typeof extracted.petitioners === 'string' ? [extracted.petitioners] : []);
        
        const respondentNames = Array.isArray(extracted.respondents) && extracted.respondents.length > 0
          ? extracted.respondents.map(r => typeof r === 'string' ? r : (r.fullName || '')).filter(Boolean)
          : (typeof extracted.respondents === 'string' ? [extracted.respondents] : []);

        if (petitionerNames.length > 0 && respondentNames.length > 0) {
          const petitionerPart = petitionerNames.length === 1
            ? petitionerNames[0]
            : `${petitionerNames[0]} & ${petitionerNames.length - 1} Other${petitionerNames.length - 1 > 1 ? 's' : ''}`;
          
          const respondentPart = respondentNames.length === 1
            ? respondentNames[0]
            : `${respondentNames[0]} & ${respondentNames.length - 1} Other${respondentNames.length - 1 > 1 ? 's' : ''}`;
          
          generatedCaseTitle = `${petitionerPart} vs ${respondentPart}`;
        } else if (petitionerNames.length > 0) {
          generatedCaseTitle = `${petitionerNames[0]} vs Unknown`;
        } else if (respondentNames.length > 0) {
          generatedCaseTitle = `Unknown vs ${respondentNames[0]}`;
        }
      }

      // Map extracted data to caseData format with matched dropdown values
      // Only fill fields that are empty or missing, allowing user to edit later
      const updatedCaseData = {
        ...caseData,
        // Only fill if current value is empty - track auto-filled fields
        caseTitle: (() => {
          const value = caseData.caseTitle || generatedCaseTitle || '';
          if (!caseData.caseTitle && generatedCaseTitle) autoFilledFields.add('caseTitle');
          return value;
        })(),
        caseNumber: (() => {
          const value = caseData.caseNumber || extracted.caseNumber || '';
          if (!caseData.caseNumber && extracted.caseNumber) autoFilledFields.add('caseNumber');
          return value;
        })(),
        casePrefix: (() => {
          const value = caseData.casePrefix || extracted.casePrefix || '';
          if (!caseData.casePrefix && extracted.casePrefix) autoFilledFields.add('casePrefix');
          return value;
        })(),
        caseYear: (() => {
          const value = caseData.caseYear || extracted.caseYear || '';
          if (!caseData.caseYear && extracted.caseYear) autoFilledFields.add('caseYear');
          return value;
        })(),
        // Use matched dropdown values
        caseType: (() => {
          // Only fill if empty (don't overwrite manually edited values)
          const value = caseData.caseType || (matchedCaseType ? matchedCaseType.label : extracted.caseType || '');
          if (!caseData.caseType && matchedCaseType) autoFilledFields.add('caseType');
          return value;
        })(),
        caseTypeId: caseData.caseTypeId || (matchedCaseType ? matchedCaseType.value.toString() : ''),
        caseNature: (() => {
          const value = caseData.caseNature || extracted.caseNature || '';
          if (!caseData.caseNature && extracted.caseNature) autoFilledFields.add('caseNature');
          return value;
        })(),
        subType: (() => {
          // Only auto-fill subType if caseType was matched (dependency chain)
          const value = caseData.subType || (matchedCaseType && matchedSubType ? matchedSubType.label : (matchedCaseType && extracted.subType ? extracted.subType : ''));
          if (!caseData.subType && matchedCaseType && (matchedSubType || extracted.subType)) autoFilledFields.add('subType');
          return value;
        })(),
        subTypeId: caseData.subTypeId || (matchedCaseType && matchedSubType ? matchedSubType.value.toString() : ''),
        courtName: (() => {
          // Only auto-fill courtName if jurisdiction was matched (dependency chain)
          const value = caseData.courtName || (matchedJurisdiction && matchedCourtName ? matchedCourtName.label : (matchedJurisdiction && extracted.courtName ? extracted.courtName : ''));
          if (!caseData.courtName && matchedJurisdiction && (matchedCourtName || extracted.courtName)) autoFilledFields.add('courtName');
          return value;
        })(),
        courtId: (() => {
          // Only auto-fill courtId if jurisdiction was matched (dependency chain)
          const value = caseData.courtId || (matchedJurisdiction && matchedCourtName ? matchedCourtName.value.toString() : '');
          if (!caseData.courtId && matchedJurisdiction && matchedCourtName) autoFilledFields.add('courtId');
          return value;
        })(),
        courtLevel: (() => {
          const value = caseData.courtLevel || matchedCourtLevel || extracted.courtLevel || '';
          if (!caseData.courtLevel && (matchedCourtLevel || extracted.courtLevel)) autoFilledFields.add('courtLevel');
          return value;
        })(),
        benchDivision: (() => {
          const value = caseData.benchDivision || extracted.benchDivision || '';
          if (!caseData.benchDivision && extracted.benchDivision) autoFilledFields.add('benchDivision');
          return value;
        })(),
        // Use matched jurisdiction (treat as same as Adjudicating Authority)
        jurisdiction: (() => {
          const value = caseData.jurisdiction || (matchedJurisdiction ? matchedJurisdiction.label : extracted.jurisdiction || '');
          if (!caseData.jurisdiction && (matchedJurisdiction || extracted.jurisdiction)) autoFilledFields.add('jurisdiction');
          return value;
        })(),
        jurisdictionName: caseData.jurisdictionName || (matchedJurisdiction ? matchedJurisdiction.label : extracted.jurisdiction || ''),
        jurisdictionId: (() => {
          const value = caseData.jurisdictionId || (matchedJurisdiction ? matchedJurisdiction.value.toString() : '');
          if (!caseData.jurisdictionId && matchedJurisdiction) autoFilledFields.add('jurisdictionId');
          return value;
        })(),
        state: (() => {
          const value = caseData.state || extracted.state || '';
          if (!caseData.state && extracted.state) autoFilledFields.add('state');
          return value;
        })(),
        filingDate: (() => {
          const value = caseData.filingDate || extracted.filingDate || '';
          if (!caseData.filingDate && extracted.filingDate) autoFilledFields.add('filingDate');
          return value;
        })(),
        judges: (() => {
          const value = caseData.judges && caseData.judges.length > 0 ? caseData.judges : (extracted.judges || []);
          if ((!caseData.judges || caseData.judges.length === 0) && extracted.judges && extracted.judges.length > 0) autoFilledFields.add('judges');
          return value;
        })(),
        courtRoom: (() => {
          const value = caseData.courtRoom || extracted.courtRoom || '';
          if (!caseData.courtRoom && extracted.courtRoom) autoFilledFields.add('courtRoom');
          return value;
        })(),
        // Handle petitioners - merge or replace based on existing data
        // If extracted petitioners is a string, convert to array format
        petitioners: (caseData.petitioners && caseData.petitioners.length > 0 && caseData.petitioners[0].fullName) 
          ? caseData.petitioners 
          : (extracted.petitioners 
              ? (Array.isArray(extracted.petitioners) && extracted.petitioners.length > 0
                  ? extracted.petitioners.map(p => typeof p === 'string' 
                    ? { fullName: p, role: '', advocateName: '', barRegistration: '', contact: '' }
                    : { fullName: p.fullName || '', role: p.role || '', advocateName: p.advocateName || '', barRegistration: p.barRegistration || '', contact: p.contact || '' })
                  : typeof extracted.petitioners === 'string'
                    ? [{ fullName: extracted.petitioners, role: '', advocateName: '', barRegistration: '', contact: '' }]
                    : [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }])
              : [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }]),
        // Handle respondents - merge or replace based on existing data
        // If extracted respondents is a string, convert to array format
        respondents: (caseData.respondents && caseData.respondents.length > 0 && caseData.respondents[0].fullName)
          ? caseData.respondents
          : (extracted.respondents
              ? (Array.isArray(extracted.respondents) && extracted.respondents.length > 0
                  ? extracted.respondents.map(r => typeof r === 'string'
                    ? { fullName: r, role: '', advocateName: '', barRegistration: '', contact: '' }
                    : { fullName: r.fullName || '', role: r.role || '', advocateName: r.advocateName || '', barRegistration: r.barRegistration || '', contact: r.contact || '' })
                  : typeof extracted.respondents === 'string'
                    ? [{ fullName: extracted.respondents, role: '', advocateName: '', barRegistration: '', contact: '' }]
                    : [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }])
              : [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }]),
        categoryType: caseData.categoryType || extracted.categoryType || '',
        primaryCategory: caseData.primaryCategory || extracted.primaryCategory || '',
        subCategory: caseData.subCategory || extracted.subCategory || '',
        complexity: caseData.complexity || extracted.complexity || '',
        // Parse monetary value - extract numeric value only (remove currency symbols, commas)
        monetaryValue: caseData.monetaryValue || (extracted.monetaryValue ? 
          String(extracted.monetaryValue).replace(/[₹,]/g, '').replace(/\s+/g, '').trim() : ''),
        priorityLevel: caseData.priorityLevel || matchedPriority || extracted.priorityLevel || 'Medium',
        currentStatus: caseData.currentStatus || extracted.currentStatus || '',
        nextHearingDate: caseData.nextHearingDate || extracted.nextHearingDate || '',
        documentType: caseData.documentType || extracted.documentType || '',
        filedBy: caseData.filedBy || extracted.filedBy || '',
        uploadedFiles: uploadedFiles,
        tempFolderName: folderName, // Store temp folder name for later use
        autoFilledFields: Array.from(autoFilledFields), // Store auto-filled fields for highlighting
      };

      // Update caseData - this ONLY fills fields, DOES NOT create the case
      // IMPORTANT: Case creation only happens when user clicks "Create Case" button in ReviewStep
      // This endpoint only extracts and returns data for auto-filling the form
      setCaseData(updatedCaseData);
      
      setUploadStatus('success');
      setUploadMessage('Documents processed successfully! Form fields have been auto-filled. You can edit any field in the subsequent steps.');
      toast.success('Documents uploaded and form fields auto-filled successfully! You can edit any field before submitting.');
      
    } catch (error) {
      console.error('Error uploading and extracting:', error);
      setUploadStatus('error');
      setUploadMessage(error.message || 'Failed to upload and process documents');
      toast.error(error.message || 'Failed to upload and process documents');
    } finally {
      setIsUploading(false);
    }
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const removeFile = (index) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(newFiles);
    setCaseData({
      ...caseData,
      uploadedFiles: newFiles,
    });
  };

  return (
    <div>
      {/* Header */}
      <h2 className="text-xl font-semibold text-gray-800 mb-6">Upload Documents</h2>

      {/* Upload Area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleBrowseClick}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
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
        {/* Upload Icon in a square box */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 border-2 border-gray-700 rounded flex items-center justify-center">
            <Upload className="h-8 w-8 text-gray-700" />
          </div>
        </div>
        <p className="text-sm text-gray-700 mb-1">
          Drag and drop files here, or{' '}
          <span className="text-[#9CDFE1] font-medium cursor-pointer hover:underline">click to browse</span>
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Supported formats: PDF, DOC, DOCX, TXT, PNG, JPG, JPEG, TIFF
        </p>
        {selectedFiles.length > 0 && (
          <div className="mt-6 text-left">
            <p className="text-sm font-medium text-gray-700 mb-3">
              Selected files ({selectedFiles.length}):
            </p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {selectedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between bg-gray-50 p-2 rounded border border-gray-200"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 truncate">{file.name}</p>
                    <p className="text-xs text-gray-500">
                      {(file.size / 1024).toFixed(2)} KB
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(index);
                    }}
                    disabled={isUploading}
                    className="ml-2 text-red-500 hover:text-red-700 text-sm px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={`Remove ${file.name}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Upload Button */}
      {selectedFiles.length > 0 && !isUploading && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={handleUploadAndExtract}
            className="px-6 py-2.5 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition-colors font-medium flex items-center"
          >
            <Upload className="w-5 h-5 mr-2" />
            Upload & Extract Information
          </button>
        </div>
      )}

      {/* Upload Status with Progress Bar */}
      {isUploading && (
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center mb-3">
            <Loader2 className="w-5 h-5 mr-3 text-blue-600 animate-spin" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900">{uploadMessage}</p>
              <p className="text-xs text-blue-700 mt-1">
                {uploadStatus === 'uploading' && 'Please wait while files are being uploaded...'}
                {uploadStatus === 'processing' && 'Documents are being processed. This may take a few minutes...'}
                {uploadStatus === 'extracting' && 'Extracting case information from processed documents...'}
              </p>
            </div>
            <span className="text-sm font-semibold text-blue-900">{processingProgress}%</span>
          </div>
          {/* Progress Bar */}
          <div className="w-full bg-blue-200 rounded-full h-2.5">
            <div
              className="bg-[#21C1B6] h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${processingProgress}%` }}
            ></div>
          </div>
        </div>
      )}

      {uploadStatus === 'success' && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-start">
            <CheckCircle className="w-5 h-5 mr-3 text-green-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-900">{uploadMessage}</p>
              <p className="text-xs text-green-700 mt-1">
                Please review and edit the auto-filled fields in the following steps to ensure accuracy.
              </p>
            </div>
          </div>
        </div>
      )}

      {uploadStatus === 'error' && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center">
            <AlertCircle className="w-5 h-5 mr-3 text-red-600" />
            <p className="text-sm font-medium text-red-900">{uploadMessage}</p>
          </div>
        </div>
      )}

      {/* Info Note */}
      <div className="mt-4">
        <p className="text-sm text-gray-600 italic">
          <span className="font-medium">Note:</span> Upload the document here to automatically populate all form fields. If you prefer to enter the details manually, you may skip this step.
        </p>
      </div>

      {/* Footer note */}
      <div className="mt-6">
        <p className="text-sm text-gray-700">
          All fields marked with * are required
        </p>
      </div>
    </div>
  );
};

export default UploadStep;

