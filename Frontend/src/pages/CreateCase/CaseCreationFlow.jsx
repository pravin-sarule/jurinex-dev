// import React, { useState, useEffect } from 'react';
// import {
//   Scale, Building2, Users, Tag, FolderPlus, CheckCircle,
//   AlertCircle, RotateCcw, Clock, Save
// } from 'lucide-react';

// import OverviewStep from './steps/OverviewStep';
// import JurisdictionStep from './steps/JurisdictionStep';
// import PartiesStep from './steps/PartiesStep';
// import CategoryStep from './steps/CategoryStep';
// import DatesStep from './steps/DatesStep';
// import ReviewStep from './steps/ReviewStep';
// import { useAutoSave } from '../../hooks/useAutoSave';

// const CaseCreationFlow = ({ onComplete, onCancel, userId = null, skipDraftPrompt = false }) => {
//   const [currentStep, setCurrentStep] = useState(1);
//   const [isLoading, setIsLoading] = useState(true);
//   const [showDraftPrompt, setShowDraftPrompt] = useState(false);

//   const [caseData, setCaseData] = useState({
//     caseTitle: '',
//     caseType: '',
//     caseTypeId: '',
//     subType: '',
//     subTypeId: '',
//     caseNumber: '',
//     courtName: '',
//     courtId: '',
//     filingDate: '',
//     category: '',
//     primaryCategory: '',
//     subCategory: '',
//     complexity: '',
//     monetaryValue: '',
//     priorityLevel: 'Medium',
//     courtLevel: 'High Court',
//     benchDivision: '',
//     jurisdiction: 'Delhi',
//     state: 'Delhi',
//     judges: [],
//     courtRoomNo: '',
//     petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//     respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//     nextHearingDate: '',
//     deadlineDate: '',
//     servedDate: '',
//     lastUpdated: '',
//     currentStatus: 'Active',
//     uploadedFiles: []
//   });

//   const {
//     saveStatus,
//     lastSaveTime,
//     actualUserId,
//     manualSave,
//     loadDraft,
//     deleteDraft,
//     resetAutoSave
//   } = useAutoSave(caseData, currentStep, userId, true);

//   useEffect(() => {
//     const init = async () => {
//       if (!actualUserId || !Number.isInteger(actualUserId)) {
//         setIsLoading(false);
//         return;
//       }
//       try {
//         const draft = await loadDraft();
//         if (draft && draft.draft_data) {
//           if (skipDraftPrompt) {
//             let draftData = draft.draft_data;
            
//             if (draftData.caseType && !isNaN(draftData.caseType)) {
//               console.log('⚠️ Old draft detected with case type ID:', draftData.caseType);
//               draftData = { ...draftData, caseTypeId: draftData.caseType };
//             }
//             if (draftData.courtName && !isNaN(draftData.courtName)) {
//               console.log('⚠️ Old draft detected with court ID:', draftData.courtName);
//               draftData = { ...draftData, courtId: draftData.courtName };
//             }
//             if (draftData.subType && !isNaN(draftData.subType)) {
//               console.log('⚠️ Old draft detected with sub-type ID:', draftData.subType);
//               draftData = { ...draftData, subTypeId: draftData.subType };
//             }
            
//             setCaseData(draftData);
//             setCurrentStep(draft.last_step || 1);
            
//             if (resetAutoSave) {
//               resetAutoSave(draftData);
//             }
            
//             console.log('✅ Draft loaded directly (skipped popup)');
//           } else {
//             setShowDraftPrompt(true);
//           }
//         }
//       } catch (err) {
//         console.error("Failed to load draft:", err);
//       } finally {
//         setIsLoading(false);
//       }
//     };
//     init();
//   }, [actualUserId, loadDraft, skipDraftPrompt]);

//   const handleLoadDraft = async () => {
//     const draft = await loadDraft();
//     if (draft) {
//       let draftData = draft.draft_data;
      
//       if (draftData.caseType && !isNaN(draftData.caseType)) {
//         console.log('⚠️ Old draft detected with case type ID:', draftData.caseType);
//         draftData = { ...draftData, caseTypeId: draftData.caseType };
//       }
//       if (draftData.courtName && !isNaN(draftData.courtName)) {
//         console.log('⚠️ Old draft detected with court ID:', draftData.courtName);
//         draftData = { ...draftData, courtId: draftData.courtName };
//       }
//       if (draftData.subType && !isNaN(draftData.subType)) {
//         console.log('⚠️ Old draft detected with sub-type ID:', draftData.subType);
//         draftData = { ...draftData, subTypeId: draftData.subType };
//       }
      
//       setCaseData(draftData);
//       setCurrentStep(draft.last_step || 1);
      
//       if (resetAutoSave) {
//         resetAutoSave(draftData);
//       }
//     }
//     setShowDraftPrompt(false);
//   };

//   const handleStartFresh = async () => {
//     await deleteDraft();
//     setShowDraftPrompt(false);
//   };

//   const handleBack = () => {
//     if (currentStep > 1) setCurrentStep(currentStep - 1);
//   };

//   const handleNext = () => {
//     if (currentStep < 6) {
//       setCurrentStep(currentStep + 1);
//     }
//   };

//   const handleResetToFirstStep = () => {
//     setCaseData({
//       caseTitle: '', caseType: '', caseTypeId: '', subType: '', subTypeId: '', caseNumber: '',
//       courtName: '', courtId: '', filingDate: '', category: '', primaryCategory: '',
//       subCategory: '', complexity: '', monetaryValue: '', priorityLevel: 'Medium',
//       courtLevel: 'High Court', benchDivision: '', jurisdiction: 'Delhi',
//       state: 'Delhi', judges: [], courtRoomNo: '',
//       petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//       respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//       nextHearingDate: '', deadlineDate: '', servedDate: '', currentStatus: 'Active', uploadedFiles: []
//     });
//     setCurrentStep(1);
//   };

//   const handleCaseCreated = async () => {
//     await deleteDraft();
//     console.log("Case created successfully → Draft deleted from database");
//   };

//   const steps = [
//     { number: 1, name: 'Overview', icon: Scale },
//     { number: 2, name: 'Jurisdiction', icon: Building2 },
//     { number: 3, name: 'Parties', icon: Users },
//     { number: 4, name: 'Category', icon: Tag },
//     { number: 5, name: 'Dates', icon: FolderPlus },
//     { number: 6, name: 'Review', icon: CheckCircle }
//   ];

//   const getAutoSaveIcon = () => {
//     switch (saveStatus) {
//       case 'saving': return <RotateCcw className="w-4 h-4 mr-1 animate-spin" />;
//       case 'saved': return <CheckCircle className="w-4 h-4 mr-1" />;
//       case 'error': return <AlertCircle className="w-4 h-4 mr-1" />;
//       default: return <Clock className="w-4 h-4 mr-1" />;
//     }
//   };

//   const getAutoSaveText = () => {
//     switch (saveStatus) {
//       case 'saving': return 'Saving...';
//       case 'saved': return lastSaveTime ? `Saved at ${lastSaveTime.toLocaleTimeString()}` : 'Saved';
//       case 'error': return 'Save failed';
//       default: return 'Auto-save enabled';
//     }
//   };

//   const getAutoSaveColor = () => {
//     return saveStatus === 'saved' ? 'text-[#21C1B6]' :
//            saveStatus === 'error' ? 'text-red-600' :
//            saveStatus === 'saving' ? 'text-blue-600' : 'text-gray-500';
//   };

//   if (isLoading) {
//     return (
//       <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
//         <div className="text-center">
//           <RotateCcw className="w-8 h-8 animate-spin text-[#21C1B6] mb-3" />
//           <p className="text-gray-600">Loading your case form...</p>
//         </div>
//       </div>
//     );
//   }

//   if (showDraftPrompt) {
//     return (
//       <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center p-4">
//         <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
//           <div className="w-16 h-16 bg-[#21C1B6] bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-4">
//             <Scale className="w-10 h-10 text-[#21C1B6]" />
//           </div>
//           <h2 className="text-2xl font-bold text-gray-900 mb-3">Resume Previous Draft?</h2>
//           <p className="text-gray-600 mb-8">
//             We found an incomplete case draft. Would you like to continue from where you left off?
//           </p>
//           <div className="flex gap-4">
//             <button
//               onClick={handleStartFresh}
//               className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition"
//             >
//               Start Fresh
//             </button>
//             <button
//               onClick={handleLoadDraft}
//               className="flex-1 px-6 py-3 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition"
//             >
//               Resume Draft
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="min-h-screen bg-[#FDFCFB]">
//       <div className="bg-white border-b shadow-sm sticky top-0 z-10">
//         <div className="max-w-6xl mx-auto px-8 py-6">
//           <div className="flex items-center justify-between mb-6">
//             <div>
//               <h1 className="text-2xl font-bold text-gray-800">Create New Case</h1>
//               <p className="text-sm text-gray-500">
//                 Step {currentStep} of 6
//               </p>
//             </div>
//             <button onClick={onCancel} className="text-gray-500 hover:text-gray-700 text-sm">
//               Cancel
//             </button>
//           </div>

//           <div className="flex items-center justify-between">
//             {steps.map((step, index) => (
//               <React.Fragment key={step.number}>
//                 <div className="flex flex-col items-center">
//                   <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
//                     currentStep >= step.number ? 'bg-[#21C1B6] text-white' : 'bg-gray-200 text-gray-400'
//                   }`}>
//                     <step.icon className="w-5 h-5" />
//                   </div>
//                   <span className={`text-xs mt-2 ${currentStep >= step.number ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
//                     {step.name}
//                   </span>
//                 </div>
//                 {index < steps.length - 1 && (
//                   <div className={`flex-1 h-1 mx-2 transition-all ${currentStep > step.number ? 'bg-[#21C1B6]' : 'bg-gray-200'}`} />
//                 )}
//               </React.Fragment>
//             ))}
//           </div>
//         </div>
//       </div>

//       <div className="max-w-4xl mx-auto px-8 py-8">
//         <div className="bg-white rounded-lg shadow-sm p-8 min-h-[500px]">
//           {currentStep === 1 && <OverviewStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 2 && <JurisdictionStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 3 && <PartiesStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 4 && <CategoryStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 5 && <DatesStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 6 && (
//             <ReviewStep
//               caseData={caseData}
//               onBack={handleBack}
//               onResetToFirstStep={handleResetToFirstStep}
//               onComplete={handleCaseCreated}
//             />
//           )}
//         </div>

//         {currentStep < 6 && (
//           <div className="mt-6 flex justify-between items-center">
//             <div className="flex items-center space-x-4">
//               <span className={`inline-flex items-center text-sm ${getAutoSaveColor()}`}>
//                 {getAutoSaveIcon()}
//                 {getAutoSaveText()}
//               </span>
//               <button
//                 onClick={manualSave}
//                 className="inline-flex items-center px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition"
//               >
//                 <Save className="w-3 h-3 mr-1" />
//                 Force Save
//               </button>
//             </div>

//             <div className="flex space-x-2">
//               {currentStep > 1 && (
//                 <button
//                   onClick={handleBack}
//                   className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition"
//                 >
//                   Back
//                 </button>
//               )}
//               {currentStep < 6 && (
//                 <button
//                   onClick={handleNext}
//                   className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition"
//                 >
//                   Skip
//                 </button>
//               )}
//               <button
//                 onClick={handleNext}
//                 className="px-4 py-1.5 bg-[#21C1B6] text-white rounded-sm text-sm font-medium hover:bg-[#1AA89E] transition flex items-center"
//               >
//                 Continue
//                 <span className="ml-1">→</span>
//               </button>
//             </div>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default CaseCreationFlow;


import React, { useState, useEffect } from 'react';
import { Upload, Scale, Users, FolderPlus, CheckCircle, AlertCircle, RotateCcw, Clock, Save, LogOut } from 'lucide-react';
import InitialChoiceStep from './steps/InitialChoiceStep.jsx';
import UploadStep from './steps/UploadStep.jsx';
import OverviewStep from './steps/OverviewStep.jsx';
import PartiesStep from './steps/PartiesStep.jsx';
import DatesStep from './steps/DatesStep.jsx';
import ReviewStep from './steps/ReviewStep.jsx';
import { useAutoSave } from '../../hooks/useAutoSave';

const CaseCreationFlow = ({ onComplete, onCancel, userId = null }) => {
  const [creationMode, setCreationMode] = useState(null); // 'auto-fill' or 'manual'
  const [currentStep, setCurrentStep] = useState(0); // 0 = initial choice, 1+ = form steps
  const [isLoading, setIsLoading] = useState(true);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
  const [editingFromReview, setEditingFromReview] = useState(false); // Track if editing from Review page
  const [editingStep, setEditingStep] = useState(null); // Track which step is being edited
  const [caseData, setCaseData] = useState({
    caseTitle: '',
    caseType: '',
    subType: '',
    caseNumber: '',
    casePrefix: '',
    caseYear: '',
    caseNature: '',
    courtName: '',
    filingDate: '',
    category: '',
    primaryCategory: '',
    subCategory: '',
    complexity: '',
    monetaryValue: '',
    priorityLevel: 'Medium',
    courtLevel: '',
    benchDivision: '',
    jurisdiction: '',
    jurisdictionName: '',
    jurisdictionId: '',
    state: '',
    judges: [],
    courtRoom: '',
    petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
    respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
    nextHearingDate: '',
    deadlineDate: '',
    servedDate: '',
    lastUpdated: '',
    currentStatus: '',
    documentType: '',
    filedBy: '',
    uploadedFiles: [],
    autoFilledFields: [] // Track which fields were auto-filled for highlighting
  });

  // Enable auto-save only for manual case creation mode
  // Auto-fill mode: no drafts (files are uploaded and extracted immediately)
  // Manual mode: enable auto-save to save user progress
  const { saveStatus, lastSaveTime, actualUserId, tokenError, manualSave, loadDraft, deleteDraft, resetAutoSave } = useAutoSave(
    caseData, 
    currentStep, 
    userId,
    creationMode === 'manual' // Enable auto-save only for manual mode
  );

  useEffect(() => {
    console.log('🎯 CaseCreationFlow State:', {
      providedUserId: userId,
      actualUserId,
      userIdType: typeof actualUserId,
      isValidInteger: Number.isInteger(actualUserId) && actualUserId > 0,
      tokenError,
      draftLoaded,
      currentStep,
      saveStatus,
      hasData: Object.values(caseData).some(val => val && val !== '')
    });
  }, [userId, actualUserId, tokenError, draftLoaded, currentStep, saveStatus, caseData]);

  const handleTokenError = () => {
    localStorage.removeItem('token');
    
    
    console.log('🔄 Redirecting to login due to token error');
    alert('Your session has expired. Please log in again.');
    
    window.location.reload();
  };

  useEffect(() => {
    const loadExistingDraft = async () => {
      console.log('🔄 Loading existing draft for user ID:', actualUserId);
      
      // Only load drafts for manual mode (auto-fill mode doesn't use drafts)
      if (creationMode !== 'manual') {
        console.log('📭 Skipping draft load - not in manual mode');
        setDraftLoaded(true);
        setIsLoading(false);
        return;
      }
      
      if (tokenError) {
        console.error('❌ Token error:', tokenError);
        setIsLoading(false);
        setDraftLoaded(true);
        return;
      }
      
      if (!Number.isInteger(actualUserId) || actualUserId <= 0) {
        console.error('❌ Invalid user ID:', actualUserId);
        setIsLoading(false);
        setDraftLoaded(true);
        return;
      }
      
      try {
        setIsLoading(true);
        const draft = await loadDraft();
        if (draft && draft.draft_data) {
          console.log('✅ Draft found, showing prompt');
          setShowDraftPrompt(true);
        } else {
          console.log('📭 No draft found');
          setDraftLoaded(true);
        }
      } catch (error) {
        console.error('❌ Error loading draft:', error);
        
        if (error.message && error.message.includes('token')) {
          console.log('🚫 Token error detected in draft loading');
          return;
        }
        
        setDraftLoaded(true);
      } finally {
        setIsLoading(false);
      }
    };

    if (actualUserId && Number.isInteger(actualUserId) && actualUserId > 0 && !tokenError && creationMode === 'manual') {
      loadExistingDraft();
    } else if (creationMode !== 'manual') {
      // Not in manual mode, skip draft loading
      setDraftLoaded(true);
      setIsLoading(false);
    } else if (tokenError) {
      setIsLoading(false);
      setDraftLoaded(true);
    } else {
      console.log('⏹️ Waiting for valid user ID...');
    }
  }, [actualUserId, tokenError, loadDraft, creationMode]);

  const handleLoadDraft = async () => {
    console.log('📥 Loading draft data...');
    try {
      const draft = await loadDraft();
      if (draft && draft.draft_data) {
        let draftData = draft.draft_data;
        
        // Restore creationMode if it was saved in draft (for backward compatibility, default to 'manual')
        if (draftData.creationMode) {
          setCreationMode(draftData.creationMode);
        } else {
          // If no creationMode in draft, default to 'manual' (since drafts are only for manual mode)
          setCreationMode('manual');
        }
        
        // Remove creationMode from caseData if it exists (it's stored separately in state)
        const { creationMode: _, ...caseDataToSet } = draftData;
        
        // Reset auto-save baseline with loaded draft data
        if (resetAutoSave) {
          resetAutoSave(caseDataToSet);
        }
        
        // Restore the step where user left off (from database: last_step)
        // PostgreSQL returns snake_case, so it should be last_step
        const savedStep = draft.last_step || draft.lastStep;
        
        // Ensure step is valid (between 1 and 4 for manual mode)
        const validStep = savedStep && savedStep >= 1 && savedStep <= 4 ? savedStep : 1;
        
        console.log(`📋 Draft step info:`, {
          last_step: draft.last_step,
          lastStep: draft.lastStep,
          savedStep,
          validStep
        });
        
        // Set case data first
        setCaseData(caseDataToSet);
        
        // Then set the step to restore user's position
        setCurrentStep(validStep);
        console.log(`✅ Draft loaded successfully - Restored to step ${validStep} (saved step was ${savedStep})`);
      }
    } catch (error) {
      console.error('❌ Error loading draft:', error);
    }
    setShowDraftPrompt(false);
    setDraftLoaded(true);
  };

  const handleStartFresh = async () => {
    console.log('🆕 Starting fresh, deleting existing draft');
    try {
      if (actualUserId && Number.isInteger(actualUserId) && actualUserId > 0 && !tokenError) {
        await deleteDraft();
        console.log('✅ Existing draft deleted');
      }
    } catch (error) {
      console.error('❌ Error deleting draft:', error);
    }
    setShowDraftPrompt(false);
    setDraftLoaded(true);
  };

  // Manual save handler (only available in manual mode)
  const handleManualSave = async () => {
    if (creationMode !== 'manual') {
      console.log('Manual save is only available in manual mode');
      return;
    }
    
    const result = await manualSave();
    if (result.success) {
      console.log('✅ Manual save successful');
    } else {
      console.error('❌ Manual save failed:', result.error);
    }
  };

  const handleSelectAutoFill = () => {
    setCreationMode('auto-fill');
    setCurrentStep(1); // Go to upload step
  };

  const handleSelectManual = () => {
    setCreationMode('manual');
    setCurrentStep(1); // Go directly to Overview step (skip upload)
  };

  const handleUploadComplete = () => {
    // After upload and extraction in auto-fill mode, go directly to Review page
    if (creationMode === 'auto-fill') {
      setCurrentStep(5); // Review step in auto-fill mode
    } else {
      setCurrentStep(2); // Fallback to Overview step
    }
  };

  const steps = creationMode === 'auto-fill' 
    ? [
        { number: 1, name: 'Upload', icon: Upload },
        { number: 2, name: 'Overview', icon: Scale },
        { number: 3, name: 'Parties', icon: Users },
        { number: 4, name: 'Dates', icon: FolderPlus },
        { number: 5, name: 'Review', icon: CheckCircle }
      ]
    : [
        { number: 1, name: 'Overview', icon: Scale },
        { number: 2, name: 'Parties', icon: Users },
        { number: 3, name: 'Dates', icon: FolderPlus },
        { number: 4, name: 'Review', icon: CheckCircle }
      ];

  // Function to check if a step has missing required fields
  const getStepValidationStatus = () => {
    const stepStatus = {
      1: { hasMissingFields: false }, // Upload step - no required fields
      2: { hasMissingFields: false }, // Overview step
      3: { hasMissingFields: false }, // Parties step
      4: { hasMissingFields: false }, // Dates step
      5: { hasMissingFields: false }  // Review step - no required fields
    };

    // Step 2: Overview - Required: caseTitle, caseType, courtName
    if (!caseData.caseTitle || !caseData.caseTitle.trim() ||
        !caseData.caseType || !caseData.caseType.trim() ||
        !caseData.courtName || !caseData.courtName.trim()) {
      stepStatus[2].hasMissingFields = true;
    }

    // Step 3: Parties - Required: at least one petitioner or respondent with fullName and role
    const hasValidPetitioner = caseData.petitioners && 
      Array.isArray(caseData.petitioners) &&
      caseData.petitioners.some(p => p && p.fullName && p.fullName.trim() && p.role && p.role.trim());
    const hasValidRespondent = caseData.respondents && 
      Array.isArray(caseData.respondents) &&
      caseData.respondents.some(r => r && r.fullName && r.fullName.trim() && r.role && r.role.trim());
    
    if (!hasValidPetitioner && !hasValidRespondent) {
      stepStatus[3].hasMissingFields = true;
    }

    // Step 4: Dates - Check if documentType is required (based on your requirements)
    // If documentType is required and empty, mark as missing
    // For now, Dates step is mostly optional, but you can add requirements here

    return stepStatus;
  };

  const stepValidationStatus = getStepValidationStatus();

  const handleNext = async () => {
      // If editing from Review page, just return to Review (no draft saving)
        if (editingFromReview) {
          // Return to Review page without saving draft
          const reviewStep = creationMode === 'auto-fill' ? 5 : 4;
          setCurrentStep(reviewStep);
          setEditingFromReview(false);
          setEditingStep(null);
          return;
        }

    // Special case: In auto-fill mode, if on step 1 (Upload) after completion, go directly to Review
    if (creationMode === 'auto-fill' && currentStep === 1) {
      setCurrentStep(5); // Go directly to Review page
      return;
    }

    // Normal flow: continue to next step
    const maxStep = creationMode === 'auto-fill' ? 5 : 4;
    if (currentStep < maxStep) {
      setCurrentStep(currentStep + 1);
    } else if (onComplete) {
      // Delete any existing draft when completing the flow (case creation happens in ReviewStep)
      try {
        if (actualUserId && Number.isInteger(actualUserId) && actualUserId > 0 && !tokenError) {
          await deleteDraft();
          console.log('✅ Draft deleted');
        }
      } catch (error) {
        console.error('❌ Error deleting draft:', error);
      }
      onComplete(caseData);
    }
  };

  // Handle editing a specific step from Review page
  const handleEditFromReview = (stepNumber) => {
    setEditingFromReview(true);
    setEditingStep(stepNumber);
    setCurrentStep(stepNumber);
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    } else if (currentStep === 1 && creationMode) {
      // Go back to initial choice
      setCurrentStep(0);
      setCreationMode(null);
    }
  };

  const handleCancel = async () => {
    // No draft saving - just cancel
    if (onCancel) {
      onCancel();
    }
  };

  const handleResetToFirstStep = () => {
    setCaseData({
      caseTitle: '',
      caseType: '',
      subType: '',
      caseNumber: '',
      courtName: '',
      filingDate: '',
      category: '',
      primaryCategory: '',
      subCategory: '',
      complexity: '',
      monetaryValue: '',
      priorityLevel: 'Medium',
      courtLevel: '',
      benchDivision: '',
      jurisdiction: '',
      jurisdictionName: '',
      jurisdictionId: '',
      state: '',
      judges: [],
      courtRoom: '',
      petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
      respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
      nextHearingDate: '',
      deadlineDate: '',
      servedDate: '',
      lastUpdated: '',
      currentStatus: '',
      uploadedFiles: []
    });
    setCurrentStep(1);
  };

  // Auto-save UI helper functions (only show in manual mode)
  const getAutoSaveIcon = () => {
    if (creationMode !== 'manual') return null;
    if (saveStatus === 'saving') return <RotateCcw className="w-4 h-4 animate-spin" />;
    if (saveStatus === 'saved') return <CheckCircle className="w-4 h-4" />;
    if (saveStatus === 'error') return <AlertCircle className="w-4 h-4" />;
    return <Clock className="w-4 h-4" />;
  };

  const getAutoSaveText = () => {
    if (creationMode !== 'manual') return null;
    if (tokenError) return 'Session expired';
    if (saveStatus === 'saving') return 'Saving...';
    if (saveStatus === 'saved') {
      if (lastSaveTime) {
        const timeAgo = Math.floor((Date.now() - new Date(lastSaveTime).getTime()) / 1000);
        if (timeAgo < 60) return `Saved ${timeAgo}s ago`;
        if (timeAgo < 3600) return `Saved ${Math.floor(timeAgo / 60)}m ago`;
        return `Saved ${Math.floor(timeAgo / 3600)}h ago`;
      }
      return 'Saved';
    }
    if (saveStatus === 'error') return 'Save failed';
    return 'Draft will auto-save';
  };

  const getAutoSaveColor = () => {
    if (creationMode !== 'manual') return 'text-gray-400';
    if (tokenError) return 'text-red-600';
    if (saveStatus === 'saving') return 'text-blue-500';
    if (saveStatus === 'saved') return 'text-green-500';
    if (saveStatus === 'error') return 'text-red-500';
    return 'text-gray-400';
  };

  if (tokenError) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md mx-4">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Authentication Error</h2>
            <p className="text-gray-600 mb-6">{tokenError}</p>
            <button
              onClick={handleTokenError}
              className="flex items-center justify-center px-4 py-2 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition-colors w-full"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Login Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!actualUserId || !Number.isInteger(actualUserId) || actualUserId <= 0) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="flex flex-col items-center">
          <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
          <p className="text-gray-600">Invalid User Authentication</p>
          <p className="text-sm text-gray-500 mt-1">
            Please ensure you are logged in with a valid account.
          </p>
          <button
            onClick={handleTokenError}
            className="mt-4 px-4 py-2 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition-colors"
          >
            Login Again
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="flex flex-col items-center">
          <RotateCcw className="w-8 h-8 animate-spin text-[#21C1B6] mb-2" />
          <p className="text-gray-600">Loading case form...</p>
          <p className="text-sm text-gray-500 mt-1">User ID: {actualUserId}</p>
        </div>
      </div>
    );
  }

  if (showDraftPrompt) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md mx-4">
          <div className="text-center">
            <div className="w-16 h-16 bg-[#21C1B6] bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Scale className="w-8 h-8 text-[#21C1B6]" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Resume Case Creation?</h2>
            <p className="text-gray-600 mb-6">
              We found an incomplete case draft. Would you like to continue where you left off or start fresh?
            </p>
            <div className="flex space-x-3">
              <button
                onClick={handleStartFresh}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
              >
                Start Fresh
              </button>
              <button
                onClick={handleLoadDraft}
                className="flex-1 px-4 py-2 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition-colors"
              >
                Resume Draft
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#FDFCFB] flex flex-col overflow-hidden">
      <div className="bg-white border-b shadow-sm sticky top-0 z-10 flex-shrink-0">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Create New Case</h1>
              <p className="text-sm text-gray-500">
                {currentStep === 0 
                  ? 'Choose creation method'
                  : creationMode === 'auto-fill'
                  ? `Step ${currentStep} of ${steps.length}`
                  : `Step ${currentStep} of ${steps.length}`}
              </p>
            </div>
            <button
              onClick={handleCancel}
              className="text-gray-500 hover:text-gray-700 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>

          {currentStep > 0 && (
          <div className="flex items-center justify-between">
            {steps.map((step, index) => {
              const isCurrentStep = currentStep === step.number;
              const isCompletedStep = currentStep > step.number;
              
              return (
                <React.Fragment key={step.number}>
                  <div className="flex flex-col items-center">
                    <div className="relative">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                          isCompletedStep
                            ? 'bg-[#21C1B6] text-white'
                            : isCurrentStep
                            ? 'bg-[#21C1B6] text-white'
                            : 'bg-gray-200 text-gray-400'
                        }`}
                      >
                        <step.icon className="w-5 h-5" />
                      </div>
                    </div>
                    <span
                      className={`text-xs mt-2 ${
                        isCompletedStep || isCurrentStep
                          ? 'text-gray-700 font-medium'
                          : 'text-gray-400'
                      }`}
                    >
                      {step.name}
                    </span>
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className={`flex-1 h-1 mx-2 transition-all ${
                        isCompletedStep 
                          ? 'bg-[#21C1B6]'
                          : 'bg-gray-200'
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          <div className="bg-white rounded-lg shadow-sm p-8 min-h-[500px]">
            {/* Initial Choice Step */}
            {currentStep === 0 && (
              <InitialChoiceStep 
                onSelectAutoFill={handleSelectAutoFill}
                onSelectManual={handleSelectManual}
              />
            )}
            
            {/* Upload Step (only for auto-fill mode) */}
            {currentStep === 1 && creationMode === 'auto-fill' && (
              <UploadStep 
                caseData={caseData} 
                setCaseData={setCaseData}
                onComplete={handleUploadComplete}
              />
            )}
            
            {/* Form Steps */}
            {((currentStep === 1 && creationMode === 'manual') || 
              (currentStep === 2 && creationMode === 'auto-fill')) && (
              <OverviewStep caseData={caseData} setCaseData={setCaseData} />
            )}
            
            {((currentStep === 2 && creationMode === 'manual') || 
              (currentStep === 3 && creationMode === 'auto-fill')) && (
              <PartiesStep caseData={caseData} setCaseData={setCaseData} />
            )}
            
            {((currentStep === 3 && creationMode === 'manual') || 
              (currentStep === 4 && creationMode === 'auto-fill')) && (
              <DatesStep caseData={caseData} setCaseData={setCaseData} />
            )}
            
            {((currentStep === 4 && creationMode === 'manual') || 
              (currentStep === 5 && creationMode === 'auto-fill')) && (
              <ReviewStep 
                caseData={caseData} 
                onBack={handleBack}
                onResetToFirstStep={handleResetToFirstStep}
                onEditStep={handleEditFromReview}
                creationMode={creationMode}
              />
            )}
          </div>

          {/* Navigation buttons - different behavior for editing from Review vs normal flow */}
          {currentStep > 0 && ((creationMode === 'auto-fill' && currentStep < 5) || (creationMode === 'manual' && currentStep < 4)) && !editingFromReview && (
            <div className="mt-6 flex justify-between items-center">
              {/* Auto-save status and manual save button (only for manual mode) */}
              {creationMode === 'manual' && getAutoSaveIcon() && (
                <div className="flex items-center space-x-4">
                  <div className={`flex items-center space-x-2 text-sm ${getAutoSaveColor()}`}>
                    {getAutoSaveIcon()}
                    <span>{getAutoSaveText()}</span>
                  </div>
                  <button
                    onClick={handleManualSave}
                    disabled={saveStatus === 'saving'}
                    className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-sm text-sm hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
                  >
                    <Save className="w-4 h-4" />
                    <span>Save Draft</span>
                  </button>
                </div>
              )}
              <div className="flex space-x-2">
                {(currentStep > 1 || (currentStep === 1 && creationMode === 'manual')) && (
                  <button
                    onClick={handleBack}
                    className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition-colors"
                  >
                    Back
                  </button>
                )}
                {/* Show Skip button only for manual mode or auto-fill mode steps 2-4 (not step 1 after upload) */}
                {((creationMode === 'manual' && currentStep < 3) || (creationMode === 'auto-fill' && currentStep > 1 && currentStep < 4)) && (
                  <button
                    onClick={handleNext}
                    className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition-colors"
                  >
                    Skip
                  </button>
                )}
                {/* Show Next/Continue button - always show for manual mode, show for auto-fill mode step 1+ */}
                {(currentStep !== 1 || creationMode === 'manual' || (creationMode === 'auto-fill' && currentStep === 1)) ? (
                  <button
                    onClick={handleNext}
                    className="px-4 py-1.5 bg-[#21C1B6] text-white rounded-sm text-sm font-medium hover:bg-[#1AA89E] transition-colors flex items-center"
                  >
                    {creationMode === 'auto-fill' && currentStep === 1 ? 'Next' : 'Continue'}
                    <span className="ml-1">→</span>
                  </button>
                ) : null}
              </div>
            </div>
          )}
          
                  {/* Navigation buttons when editing from Review - show Save/Cancel */}
                  {editingFromReview && (currentStep === 2 || currentStep === 3 || currentStep === 4 || (creationMode === 'manual' && (currentStep === 1 || currentStep === 2 || currentStep === 3))) && (
                    <div className="mt-6 flex justify-between items-center">
                      {/* Auto-save status (only for manual mode) */}
                      {creationMode === 'manual' && getAutoSaveIcon() && (
                        <div className={`flex items-center space-x-2 text-sm ${getAutoSaveColor()}`}>
                          {getAutoSaveIcon()}
                          <span>{getAutoSaveText()}</span>
                        </div>
                      )}
                      <div className="flex space-x-2">
                <button
                  onClick={() => {
                    const reviewStep = creationMode === 'auto-fill' ? 5 : 4;
                    setCurrentStep(reviewStep);
                    setEditingFromReview(false);
                    setEditingStep(null);
                  }}
                  className="px-4 py-1.5 border border-gray-300 text-gray-700 rounded-sm text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNext}
                  className="px-4 py-1.5 bg-[#21C1B6] text-white rounded-sm text-sm font-medium hover:bg-[#1AA89E] transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CaseCreationFlow;