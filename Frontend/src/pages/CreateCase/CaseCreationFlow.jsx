

// import React, { useState } from 'react';
// import { Scale, Building2, Users, Tag, FolderPlus, Upload, CheckCircle } from 'lucide-react';
// import OverviewStep from './steps/OverviewStep';
// import JurisdictionStep from './steps/JurisdictionStep';
// import PartiesStep from './steps/PartiesStep';
// import CategoryStep from './steps/CategoryStep';
// import DatesStep from './steps/DatesStep';
// // import DocumentsStep from './steps/DocumentsStep';
// import ReviewStep from './steps/ReviewStep';

// // const CaseCreationFlow = ({ onComplete, onCancel }) => {
// //   const [currentStep, setCurrentStep] = useState(1);
// //   const [caseData, setCaseData] = useState({
// //     caseTitle: '',
// //     caseType: '',
// //     subType: '',
// //     caseNumber: '',
// //     courtName: '',
// //     filingDate: '',
// //     category: '',
// //     primaryCategory: '',
// //     subCategory: '',
// //     complexity: '',
// //     monetaryValue: '',
// //     priorityLevel: 'Medium',
// //     courtLevel: 'High Court',
// //     benchDivision: '',
// //     jurisdiction: 'Delhi',
// //     state: 'Delhi',
// //     judges: [],
// //     courtRoom: '',
// //     petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
// //     respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
// //     nextHearingDate: '',
// //     deadlineDate: '',
// //     servedDate: '',
// //     lastUpdated: '',
// //     uploadedFiles: []
// //   });

// //   const steps = [
// //     { number: 1, name: 'Overview', icon: Scale },
// //     { number: 2, name: 'Jurisdiction', icon: Building2 },
// //     { number: 3, name: 'Parties', icon: Users },
// //     { number: 4, name: 'Category', icon: Tag },
// //     { number: 5, name: 'Dates', icon: FolderPlus },
// //     // { number: 6, name: 'Documents', icon: Upload },
// //     { number: 7, name: 'Review', icon: CheckCircle }
// //   ];

// //   const handleNext = () => {
// //     if (currentStep < 7) {
// //       setCurrentStep(currentStep + 1);
// //     } else {
// //       onComplete(caseData);
// //     }
// //   };

// //   const handleBack = () => {
// //     if (currentStep > 1) {
// //       setCurrentStep(currentStep - 1);
// //     }
// //   };

// //   return (
// //     <div className="min-h-screen bg-[#FDFCFB]">
// //       {/* Header Section */}
// //       <div className="bg-white border-b shadow-sm sticky top-0 z-10">
// //         <div className="max-w-6xl mx-auto px-8 py-6">
// //           <div className="flex items-center justify-between mb-6">
// //             <h1 className="text-2xl font-bold text-gray-800">Create New Case</h1>
// //             <button
// //               onClick={onCancel}
// //               className="text-gray-500 hover:text-gray-700 text-sm transition-colors"
// //             >
// //               Cancel
// //             </button>
// //           </div>

// //           {/* Step Bar (kept as-is) */}
// //           <div className="flex items-center justify-between">
// //             {steps.map((step, index) => (
// //               <React.Fragment key={step.number}>
// //                 <div className="flex flex-col items-center">
// //                   <div
// //                     className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
// //                       currentStep >= step.number
// //                         ? 'bg-[#21C1B6] text-white'
// //                         : 'bg-gray-200 text-gray-400'
// //                     }`}
// //                   >
// //                     <step.icon className="w-5 h-5" />
// //                   </div>
// //                   <span
// //                     className={`text-xs mt-2 ${
// //                       currentStep >= step.number
// //                         ? 'text-gray-700 font-medium'
// //                         : 'text-gray-400'
// //                     }`}
// //                   >
// //                     {step.name}
// //                   </span>
// //                 </div>
// //                 {index < steps.length - 1 && (
// //                   <div
// //                     className={`flex-1 h-1 mx-2 transition-all ${
// //                       currentStep > step.number ? 'bg-[#21C1B6]' : 'bg-gray-200'
// //                     }`}
// //                   />
// //                 )}
// //               </React.Fragment>
// //             ))}
// //           </div>
// //         </div>
// //       </div>

// //       {/* Step Content */}
// //       <div className="max-w-4xl mx-auto px-8 py-8">
// //         <div className="bg-white rounded-lg shadow-sm p-8 min-h-[500px]">
// //           {currentStep === 1 && <OverviewStep caseData={caseData} setCaseData={setCaseData} />}
// //           {currentStep === 2 && <JurisdictionStep caseData={caseData} setCaseData={setCaseData} />}
// //           {currentStep === 3 && <PartiesStep caseData={caseData} setCaseData={setCaseData} />}
// //           {currentStep === 4 && <CategoryStep caseData={caseData} setCaseData={setCaseData} />}
// //           {currentStep === 5 && <DatesStep caseData={caseData} setCaseData={setCaseData} />}
// //           {/* {currentStep === 6 && <DocumentsStep caseData={caseData} setCaseData={setCaseData} />} */}
// //           {currentStep === 7 && <ReviewStep caseData={caseData} />}
// //         </div>

// //         {/* Bottom Buttons */}
// //         <div className="mt-6 flex justify-between items-center">
// //           <div className="text-sm text-gray-500">
// //             <span className="inline-flex items-center text-[#21C1B6]">
// //               <CheckCircle className="w-4 h-4 mr-1" />
// //               Auto-saved
// //             </span>
// //           </div>
// //           <div className="flex space-x-2">
// //             {currentStep > 1 && (
// //               <button
// //                 onClick={handleBack}
// //                 className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition-colors"
// //               >
// //                 Back
// //               </button>
// //             )}
// //             {currentStep < 7 && (
// //               <button
// //                 onClick={handleNext}
// //                 className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition-colors"
// //               >
// //                 Skip
// //               </button>
// //             )}
// //             <button
// //               onClick={handleNext}
// //               className="px-4 py-1.5 bg-[#21C1B6] text-white rounded-sm text-sm font-medium hover:bg-[#1AA89E] transition-colors flex items-center"
// //             >
// //               {currentStep === 7 ? 'Create Case' : 'Continue'}
// //               <span className="ml-1">→</span>
// //             </button>
// //           </div>
// //         </div>
// //       </div>
// //     </div>
// //   );
// // };

// // Main Component
// const CaseCreationFlow = () => {
//   const [currentStep, setCurrentStep] = useState(1);
//   const [caseData, setCaseData] = useState({
//     caseTitle: '',
//     caseType: '',
//     subType: '',
//     caseNumber: '',
//     courtName: '',
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
//     courtRoom: '',
//     petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//     respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//     currentStatus: '',
//     uploadedFiles: []
//   });

//   // FIXED: Changed step 7 to step 6
//   const steps = [
//     { number: 1, name: 'Overview', icon: Scale },
//     { number: 2, name: 'Jurisdiction', icon: Building2 },
//     { number: 3, name: 'Parties', icon: Users },
//     { number: 4, name: 'Category', icon: Tag },
//     { number: 5, name: 'Dates', icon: FolderPlus },
//     { number: 6, name: 'Review', icon: CheckCircle }
//   ];

//   const handleNext = () => {
//     if (currentStep < 6) {
//       setCurrentStep(currentStep + 1);
//     }
//   };

//   const handleBack = () => {
//     if (currentStep > 1) {
//       setCurrentStep(currentStep - 1);
//     }
//   };

//   return (
//     <div className="min-h-screen bg-[#FDFCFB]">
//       {/* Header Section */}
//       <div className="bg-white border-b shadow-sm sticky top-0 z-10">
//         <div className="max-w-6xl mx-auto px-8 py-6">
//           <div className="flex items-center justify-between mb-6">
//             <h1 className="text-2xl font-bold text-gray-800">Create New Case</h1>
//             <button
//               onClick={() => alert('Cancel')}
//               className="text-gray-500 hover:text-gray-700 text-sm transition-colors"
//             >
//               Cancel
//             </button>
//           </div>

//           {/* Step Bar */}
//           <div className="flex items-center justify-between">
//             {steps.map((step, index) => (
//               <React.Fragment key={step.number}>
//                 <div className="flex flex-col items-center">
//                   <div
//                     className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
//                       currentStep >= step.number
//                         ? 'bg-[#21C1B6] text-white'
//                         : 'bg-gray-200 text-gray-400'
//                     }`}
//                   >
//                     <step.icon className="w-5 h-5" />
//                   </div>
//                   <span
//                     className={`text-xs mt-2 ${
//                       currentStep >= step.number
//                         ? 'text-gray-700 font-medium'
//                         : 'text-gray-400'
//                     }`}
//                   >
//                     {step.name}
//                   </span>
//                 </div>
//                 {index < steps.length - 1 && (
//                   <div
//                     className={`flex-1 h-1 mx-2 transition-all ${
//                       currentStep > step.number ? 'bg-[#21C1B6]' : 'bg-gray-200'
//                     }`}
//                   />
//                 )}
//               </React.Fragment>
//             ))}
//           </div>
//         </div>
//       </div>

//       {/* Step Content */}
//       <div className="max-w-4xl mx-auto px-8 py-8">
//         <div className="bg-white rounded-lg shadow-sm p-8 min-h-[500px]">
//           {currentStep === 1 && <OverviewStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 2 && <JurisdictionStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 3 && <PartiesStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 4 && <CategoryStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 5 && <DatesStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 6 && <ReviewStep caseData={caseData} onBack={handleBack} />}
//         </div>

//         {/* Bottom Buttons - Only show for steps 1-5 */}
//         {currentStep < 6 && (
//           <div className="mt-6 flex justify-between items-center">
//             <div className="text-sm text-gray-500">
//               <span className="inline-flex items-center text-[#21C1B6]">
//                 <CheckCircle className="w-4 h-4 mr-1" />
//                 Auto-saved
//               </span>
//             </div>
//             <div className="flex space-x-2">
//               {currentStep > 1 && (
//                 <button
//                   onClick={handleBack}
//                   className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition-colors"
//                 >
//                   Back
//                 </button>
//               )}
//               <button
//                 onClick={handleNext}
//                 className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition-colors"
//               >
//                 Skip
//               </button>
//               <button
//                 onClick={handleNext}
//                 className="px-4 py-1.5 bg-[#21C1B6] text-white rounded-sm text-sm font-medium hover:bg-[#1AA89E] transition-colors flex items-center"
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


// import React, { useState } from 'react';
// import { Scale, Building2, Users, Tag, FolderPlus, Upload, CheckCircle } from 'lucide-react';
// import OverviewStep from './steps/OverviewStep';
// import JurisdictionStep from './steps/JurisdictionStep';
// import PartiesStep from './steps/PartiesStep';
// import CategoryStep from './steps/CategoryStep';
// import DatesStep from './steps/DatesStep';
// import ReviewStep from './steps/ReviewStep';

// const CaseCreationFlow = ({ onComplete, onCancel }) => {
//   const [currentStep, setCurrentStep] = useState(1);
//   const [caseData, setCaseData] = useState({
//     caseTitle: '',
//     caseType: '',
//     subType: '',
//     caseNumber: '',
//     courtName: '',
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
//     courtRoom: '',
//     petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//     respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//     nextHearingDate: '',
//     deadlineDate: '',
//     servedDate: '',
//     lastUpdated: '',
//     currentStatus: '',
//     uploadedFiles: []
//   });

//   const steps = [
//     { number: 1, name: 'Overview', icon: Scale },
//     { number: 2, name: 'Jurisdiction', icon: Building2 },
//     { number: 3, name: 'Parties', icon: Users },
//     { number: 4, name: 'Category', icon: Tag },
//     { number: 5, name: 'Dates', icon: FolderPlus },
//     { number: 6, name: 'Review', icon: CheckCircle }
//   ];

//   const handleNext = () => {
//     if (currentStep < 6) {
//       setCurrentStep(currentStep + 1);
//     } else if (onComplete) {
//       onComplete(caseData);
//     }
//   };

//   const handleBack = () => {
//     if (currentStep > 1) {
//       setCurrentStep(currentStep - 1);
//     }
//   };

//   const handleResetToFirstStep = () => {
//     // Reset all case data
//     setCaseData({
//       caseTitle: '',
//       caseType: '',
//       subType: '',
//       caseNumber: '',
//       courtName: '',
//       filingDate: '',
//       category: '',
//       primaryCategory: '',
//       subCategory: '',
//       complexity: '',
//       monetaryValue: '',
//       priorityLevel: 'Medium',
//       courtLevel: 'High Court',
//       benchDivision: '',
//       jurisdiction: 'Delhi',
//       state: 'Delhi',
//       judges: [],
//       courtRoom: '',
//       petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//       respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//       nextHearingDate: '',
//       deadlineDate: '',
//       servedDate: '',
//       lastUpdated: '',
//       currentStatus: '',
//       uploadedFiles: []
//     });
//     // Go back to first step
//     setCurrentStep(1);
//   };

//   return (
//     <div className="min-h-screen bg-[#FDFCFB]">
//       {/* Header Section */}
//       <div className="bg-white border-b shadow-sm sticky top-0 z-10">
//         <div className="max-w-6xl mx-auto px-8 py-6">
//           <div className="flex items-center justify-between mb-6">
//             <h1 className="text-2xl font-bold text-gray-800">Create New Case</h1>
//             <button
//               onClick={onCancel}
//               className="text-gray-500 hover:text-gray-700 text-sm transition-colors"
//             >
//               Cancel
//             </button>
//           </div>

//           {/* Step Bar */}
//           <div className="flex items-center justify-between">
//             {steps.map((step, index) => (
//               <React.Fragment key={step.number}>
//                 <div className="flex flex-col items-center">
//                   <div
//                     className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
//                       currentStep >= step.number
//                         ? 'bg-[#21C1B6] text-white'
//                         : 'bg-gray-200 text-gray-400'
//                     }`}
//                   >
//                     <step.icon className="w-5 h-5" />
//                   </div>
//                   <span
//                     className={`text-xs mt-2 ${
//                       currentStep >= step.number
//                         ? 'text-gray-700 font-medium'
//                         : 'text-gray-400'
//                     }`}
//                   >
//                     {step.name}
//                   </span>
//                 </div>
//                 {index < steps.length - 1 && (
//                   <div
//                     className={`flex-1 h-1 mx-2 transition-all ${
//                       currentStep > step.number ? 'bg-[#21C1B6]' : 'bg-gray-200'
//                     }`}
//                   />
//                 )}
//               </React.Fragment>
//             ))}
//           </div>
//         </div>
//       </div>

//       {/* Step Content */}
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
//             />
//           )}
//         </div>

//         {/* Bottom Buttons - Only show for steps 1-5 */}
//         {currentStep < 6 && (
//           <div className="mt-6 flex justify-between items-center">
//             <div className="text-sm text-gray-500">
//               <span className="inline-flex items-center text-[#21C1B6]">
//                 <CheckCircle className="w-4 h-4 mr-1" />
//                 Auto-saved
//               </span>
//             </div>
//             <div className="flex space-x-2">
//               {currentStep > 1 && (
//                 <button
//                   onClick={handleBack}
//                   className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition-colors"
//                 >
//                   Back
//                 </button>
//               )}
//               {currentStep < 6 && (
//                 <button
//                   onClick={handleNext}
//                   className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition-colors"
//                 >
//                   Skip
//                 </button>
//               )}
//               <button
//                 onClick={handleNext}
//                 className="px-4 py-1.5 bg-[#21C1B6] text-white rounded-sm text-sm font-medium hover:bg-[#1AA89E] transition-colors flex items-center"
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


// import React, { useState, useEffect } from 'react';
// import { Scale, Building2, Users, Tag, FolderPlus, CheckCircle, AlertCircle, RotateCcw, Clock, Save } from 'lucide-react';
// import OverviewStep from './steps/OverviewStep';
// import JurisdictionStep from './steps/JurisdictionStep';
// import PartiesStep from './steps/PartiesStep';
// import CategoryStep from './steps/CategoryStep';
// import DatesStep from './steps/DatesStep';
// import ReviewStep from './steps/ReviewStep';
// import { useAutoSave } from '../../hooks/useAutoSave';

// const CaseCreationFlow = ({ onComplete, onCancel, userId = null }) => {
//   const [currentStep, setCurrentStep] = useState(1);
//   const [isLoading, setIsLoading] = useState(true);
//   const [draftLoaded, setDraftLoaded] = useState(false);
//   const [showDraftPrompt, setShowDraftPrompt] = useState(false);
//   const [caseData, setCaseData] = useState({
//     caseTitle: '',
//     caseType: '',
//     subType: '',
//     caseNumber: '',
//     courtName: '',
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
//     courtRoom: '',
//     petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//     respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//     nextHearingDate: '',
//     deadlineDate: '',
//     servedDate: '',
//     lastUpdated: '',
//     currentStatus: '',
//     uploadedFiles: []
//   });

//   // The hook now automatically generates/retrieves an integer user ID
//   const { saveStatus, lastSaveTime, actualUserId, manualSave, loadDraft, deleteDraft } = useAutoSave(
//     caseData, 
//     currentStep, 
//     userId, // Can be null, hook will generate integer ID
//     true // Force enable
//   );

//   // Debug logging for component state
//   useEffect(() => {
//     console.log('🎯 CaseCreationFlow State:', {
//       providedUserId: userId,
//       actualUserId,
//       userIdType: typeof actualUserId,
//       isValidInteger: Number.isInteger(actualUserId) && actualUserId > 0,
//       draftLoaded,
//       currentStep,
//       saveStatus,
//       hasData: Object.values(caseData).some(val => val && val !== '')
//     });
//   }, [userId, actualUserId, draftLoaded, currentStep, saveStatus, caseData]);

//   // Load existing draft on component mount
//   useEffect(() => {
//     const loadExistingDraft = async () => {
//       console.log('🔄 Loading existing draft for user ID:', actualUserId);
      
//       // Validate user ID before proceeding
//       if (!Number.isInteger(actualUserId) || actualUserId <= 0) {
//         console.error('❌ Invalid user ID:', actualUserId);
//         setIsLoading(false);
//         setDraftLoaded(true);
//         return;
//       }
      
//       try {
//         setIsLoading(true);
//         const draft = await loadDraft();
//         if (draft && draft.draft_data) {
//           console.log('✅ Draft found, showing prompt');
//           setShowDraftPrompt(true);
//         } else {
//           console.log('📭 No draft found, enabling auto-save');
//           setDraftLoaded(true);
//         }
//       } catch (error) {
//         console.error('❌ Error loading draft:', error);
//         setDraftLoaded(true);
//       } finally {
//         setIsLoading(false);
//       }
//     };

//     if (actualUserId && Number.isInteger(actualUserId) && actualUserId > 0) {
//       loadExistingDraft();
//     } else {
//       console.log('⏹️ Waiting for valid user ID...');
//     }
//   }, [actualUserId, loadDraft]);

//   const handleLoadDraft = async () => {
//     console.log('📥 Loading draft data...');
//     try {
//       const draft = await loadDraft();
//       if (draft && draft.draft_data) {
//         setCaseData(draft.draft_data);
//         setCurrentStep(draft.last_step || 1);
//         console.log('✅ Draft loaded successfully');
//       }
//     } catch (error) {
//       console.error('❌ Error loading draft:', error);
//     }
//     setShowDraftPrompt(false);
//     setDraftLoaded(true);
//   };

//   const handleStartFresh = async () => {
//     console.log('🆕 Starting fresh, deleting existing draft');
//     try {
//       if (actualUserId && Number.isInteger(actualUserId) && actualUserId > 0) {
//         await deleteDraft();
//         console.log('✅ Existing draft deleted');
//       }
//     } catch (error) {
//       console.error('❌ Error deleting draft:', error);
//     }
//     setShowDraftPrompt(false);
//     setDraftLoaded(true);
//   };

//   // Manual save test function
//   const handleManualSave = async () => {
//     console.log('👆 Manual save button clicked');
//     const result = await manualSave();
//     console.log('💾 Manual save result:', result);
//   };

//   const steps = [
//     { number: 1, name: 'Overview', icon: Scale },
//     { number: 2, name: 'Jurisdiction', icon: Building2 },
//     { number: 3, name: 'Parties', icon: Users },
//     { number: 4, name: 'Category', icon: Tag },
//     { number: 5, name: 'Dates', icon: FolderPlus },
//     { number: 6, name: 'Review', icon: CheckCircle }
//   ];

//   const handleNext = async () => {
//     if (currentStep < 6) {
//       setCurrentStep(currentStep + 1);
//     } else if (onComplete) {
//       try {
//         if (actualUserId && Number.isInteger(actualUserId) && actualUserId > 0) {
//           await deleteDraft();
//           console.log('✅ Draft deleted after case completion');
//         }
//       } catch (error) {
//         console.error('❌ Error deleting draft:', error);
//       }
//       onComplete(caseData);
//     }
//   };

//   const handleBack = () => {
//     if (currentStep > 1) {
//       setCurrentStep(currentStep - 1);
//     }
//   };

//   const handleCancel = async () => {
//     if (actualUserId && draftLoaded && Number.isInteger(actualUserId) && actualUserId > 0) {
//       try {
//         await manualSave();
//         console.log('💾 Progress saved before canceling');
//       } catch (error) {
//         console.error('❌ Error saving before cancel:', error);
//       }
//     }
//     if (onCancel) {
//       onCancel();
//     }
//   };

//   const handleResetToFirstStep = () => {
//     setCaseData({
//       caseTitle: '',
//       caseType: '',
//       subType: '',
//       caseNumber: '',
//       courtName: '',
//       filingDate: '',
//       category: '',
//       primaryCategory: '',
//       subCategory: '',
//       complexity: '',
//       monetaryValue: '',
//       priorityLevel: 'Medium',
//       courtLevel: 'High Court',
//       benchDivision: '',
//       jurisdiction: 'Delhi',
//       state: 'Delhi',
//       judges: [],
//       courtRoom: '',
//       petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//       respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
//       nextHearingDate: '',
//       deadlineDate: '',
//       servedDate: '',
//       lastUpdated: '',
//       currentStatus: '',
//       uploadedFiles: []
//     });
//     setCurrentStep(1);
//   };

//   const getAutoSaveIcon = () => {
//     switch (saveStatus) {
//       case 'saving':
//         return <RotateCcw className="w-4 h-4 mr-1 animate-spin" />;
//       case 'saved':
//         return <CheckCircle className="w-4 h-4 mr-1" />;
//       case 'error':
//         return <AlertCircle className="w-4 h-4 mr-1" />;
//       default:
//         return <Clock className="w-4 h-4 mr-1" />;
//     }
//   };

//   const getAutoSaveText = () => {
//     switch (saveStatus) {
//       case 'saving':
//         return 'Saving...';
//       case 'saved':
//         return lastSaveTime 
//           ? `Auto-saved at ${lastSaveTime.toLocaleTimeString()}` 
//           : 'Auto-saved';
//       case 'error':
//         return 'Save failed - Retrying...';
//       default:
//         return 'Auto-save enabled';
//     }
//   };

//   const getAutoSaveColor = () => {
//     switch (saveStatus) {
//       case 'saving':
//         return 'text-blue-600';
//       case 'saved':
//         return 'text-[#21C1B6]';
//       case 'error':
//         return 'text-red-600';
//       default:
//         return 'text-gray-500';
//     }
//   };

//   // Show loading state for invalid user ID
//   if (!actualUserId || !Number.isInteger(actualUserId) || actualUserId <= 0) {
//     return (
//       <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
//         <div className="flex flex-col items-center">
//           <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
//           <p className="text-gray-600">Invalid User ID</p>
//           <p className="text-sm text-gray-500 mt-1">
//             User ID: {actualUserId} (Type: {typeof actualUserId})
//           </p>
//         </div>
//       </div>
//     );
//   }

//   // Loading state
//   if (isLoading) {
//     return (
//       <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
//         <div className="flex flex-col items-center">
//           <RotateCcw className="w-8 h-8 animate-spin text-[#21C1B6] mb-2" />
//           <p className="text-gray-600">Loading case form...</p>
//           <p className="text-sm text-gray-500 mt-1">User ID: {actualUserId}</p>
//         </div>
//       </div>
//     );
//   }

//   // Draft prompt modal
//   if (showDraftPrompt) {
//     return (
//       <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
//         <div className="bg-white rounded-lg shadow-lg p-8 max-w-md mx-4">
//           <div className="text-center">
//             <div className="w-16 h-16 bg-[#21C1B6] bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-4">
//               <Scale className="w-8 h-8 text-[#21C1B6]" />
//             </div>
//             <h2 className="text-xl font-bold text-gray-800 mb-2">Resume Case Creation?</h2>
//             <p className="text-gray-600 mb-6">
//               We found an incomplete case draft. Would you like to continue where you left off or start fresh?
//             </p>
//             <div className="flex space-x-3">
//               <button
//                 onClick={handleStartFresh}
//                 className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
//               >
//                 Start Fresh
//               </button>
//               <button
//                 onClick={handleLoadDraft}
//                 className="flex-1 px-4 py-2 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition-colors"
//               >
//                 Resume Draft
//               </button>
//             </div>
//           </div>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="min-h-screen bg-[#FDFCFB]">
//       {/* Header Section */}
//       <div className="bg-white border-b shadow-sm sticky top-0 z-10">
//         <div className="max-w-6xl mx-auto px-8 py-6">
//           <div className="flex items-center justify-between mb-6">
//             <div>
//               <h1 className="text-2xl font-bold text-gray-800">Create New Case</h1>
//               <p className="text-sm text-gray-500">
//                 User ID: <span className="font-mono bg-gray-100 px-1 rounded">{actualUserId}</span> | Step: {currentStep}
//               </p>
//             </div>
//             <button
//               onClick={handleCancel}
//               className="text-gray-500 hover:text-gray-700 text-sm transition-colors"
//             >
//               Cancel
//             </button>
//           </div>

//           {/* Step Bar */}
//           <div className="flex items-center justify-between">
//             {steps.map((step, index) => (
//               <React.Fragment key={step.number}>
//                 <div className="flex flex-col items-center">
//                   <div
//                     className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
//                       currentStep >= step.number
//                         ? 'bg-[#21C1B6] text-white'
//                         : 'bg-gray-200 text-gray-400'
//                     }`}
//                   >
//                     <step.icon className="w-5 h-5" />
//                   </div>
//                   <span
//                     className={`text-xs mt-2 ${
//                       currentStep >= step.number
//                         ? 'text-gray-700 font-medium'
//                         : 'text-gray-400'
//                     }`}
//                   >
//                     {step.name}
//                   </span>
//                 </div>
//                 {index < steps.length - 1 && (
//                   <div
//                     className={`flex-1 h-1 mx-2 transition-all ${
//                       currentStep > step.number ? 'bg-[#21C1B6]' : 'bg-gray-200'
//                     }`}
//                   />
//                 )}
//               </React.Fragment>
//             ))}
//           </div>
//         </div>
//       </div>

//       {/* Step Content */}
//       <div className="max-w-4xl mx-auto px-8 py-8">
//         <div className="bg-white rounded-lg shadow-sm p-8 min-h-[500px]">
//           {currentStep === 1 && <OverviewStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 2 && <JurisdictionStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 3 && <PartiesStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 4 && <CategoryStep caseData={caseData} setCaseData={setCaseData} />}
//           {currentStep === 5 && <DatesStep caseData={caseData} setCaseData={setCaseData} />}
//           {/* {currentStep === 6 && (
//             <ReviewStep 
//               caseData={caseData} 
//               onBack={handleBack}
//               onResetToFirstStep={handleResetToFirstStep}
//             />
//           )} */}

         
// {currentStep === 6 && (
//   <ReviewStep 
//     caseData={caseData} 
//     onBack={handleBack}
//     onResetToFirstStep={handleResetToFirstStep}
//     onComplete={async () => {
//       await deleteDraft();
//       console.log("Draft permanently deleted from database");
//     }}
//   />
// )}
//         </div>

//         {/* Bottom Buttons - Only show for steps 1-5 */}
//         {currentStep < 6 && (
//           <div className="mt-6 flex justify-between items-center">
//             <div className="flex items-center space-x-4">
//               {/* Auto-save status */}
//               <span className={`inline-flex items-center text-sm ${getAutoSaveColor()}`}>
//                 {getAutoSaveIcon()}
//                 {getAutoSaveText()}
//               </span>
              
//               {/* Manual save button for testing */}
//               <button
//                 onClick={handleManualSave}
//                 className="inline-flex items-center px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
//                 title="Test manual save"
//               >
//                 <Save className="w-3 h-3 mr-1" />
//                 Force Save
//               </button>
//             </div>
            
//             <div className="flex space-x-2">
//               {currentStep > 1 && (
//                 <button
//                   onClick={handleBack}
//                   className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition-colors"
//                 >
//                   Back
//                 </button>
//               )}
//               {currentStep < 6 && (
//                 <button
//                   onClick={handleNext}
//                   className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition-colors"
//                 >
//                   Skip
//                 </button>
//               )}
//               <button
//                 onClick={handleNext}
//                 className="px-4 py-1.5 bg-[#21C1B6] text-white rounded-sm text-sm font-medium hover:bg-[#1AA89E] transition-colors flex items-center"
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


// components/CaseCreationFlow.jsx
import React, { useState, useEffect } from 'react';
import {
  Scale, Building2, Users, Tag, FolderPlus, CheckCircle,
  AlertCircle, RotateCcw, Clock, Save
} from 'lucide-react';

import OverviewStep from './steps/OverviewStep';
import JurisdictionStep from './steps/JurisdictionStep';
import PartiesStep from './steps/PartiesStep';
import CategoryStep from './steps/CategoryStep';
import DatesStep from './steps/DatesStep';
import ReviewStep from './steps/ReviewStep';
import { useAutoSave } from '../../hooks/useAutoSave';

const CaseCreationFlow = ({ onComplete, onCancel, userId = null, skipDraftPrompt = false }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);

  const [caseData, setCaseData] = useState({
    caseTitle: '',
    caseType: '',
    caseTypeId: '',
    subType: '',
    subTypeId: '',
    caseNumber: '',
    courtName: '',
    courtId: '',
    filingDate: '',
    category: '',
    primaryCategory: '',
    subCategory: '',
    complexity: '',
    monetaryValue: '',
    priorityLevel: 'Medium',
    courtLevel: 'High Court',
    benchDivision: '',
    jurisdiction: 'Delhi',
    state: 'Delhi',
    judges: [],
    courtRoomNo: '',
    petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
    respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
    nextHearingDate: '',
    deadlineDate: '',
    servedDate: '',
    lastUpdated: '',
    currentStatus: 'Active',
    uploadedFiles: []
  });

  const {
    saveStatus,
    lastSaveTime,
    actualUserId,
    manualSave,
    loadDraft,
    deleteDraft,
    resetAutoSave
  } = useAutoSave(caseData, currentStep, userId, true);

  // Load draft on mount
  useEffect(() => {
    const init = async () => {
      if (!actualUserId || !Number.isInteger(actualUserId)) {
        setIsLoading(false);
        return;
      }
      try {
        const draft = await loadDraft();
        if (draft && draft.draft_data) {
          // If skipDraftPrompt is true, directly load the draft without showing popup
          if (skipDraftPrompt) {
            let draftData = draft.draft_data;
            
            // Backward compatibility: If draft has IDs instead of names, flag them
            if (draftData.caseType && !isNaN(draftData.caseType)) {
              console.log('⚠️ Old draft detected with case type ID:', draftData.caseType);
              draftData = { ...draftData, caseTypeId: draftData.caseType };
            }
            if (draftData.courtName && !isNaN(draftData.courtName)) {
              console.log('⚠️ Old draft detected with court ID:', draftData.courtName);
              draftData = { ...draftData, courtId: draftData.courtName };
            }
            if (draftData.subType && !isNaN(draftData.subType)) {
              console.log('⚠️ Old draft detected with sub-type ID:', draftData.subType);
              draftData = { ...draftData, subTypeId: draftData.subType };
            }
            
            setCaseData(draftData);
            setCurrentStep(draft.last_step || 1);
            
            // Reset auto-save to treat loaded draft as baseline
            if (resetAutoSave) {
              resetAutoSave(draftData);
            }
            
            console.log('✅ Draft loaded directly (skipped popup)');
          } else {
            setShowDraftPrompt(true);
          }
        }
      } catch (err) {
        console.error("Failed to load draft:", err);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, [actualUserId, loadDraft, skipDraftPrompt]);

  const handleLoadDraft = async () => {
    const draft = await loadDraft();
    if (draft) {
      // Load draft data
      let draftData = draft.draft_data;
      
      // Backward compatibility: If draft has IDs instead of names, convert them
      // This ensures old drafts display correctly
      if (draftData.caseType && !isNaN(draftData.caseType)) {
        console.log('⚠️ Old draft detected with case type ID:', draftData.caseType);
        draftData = { ...draftData, caseTypeId: draftData.caseType };
      }
      if (draftData.courtName && !isNaN(draftData.courtName)) {
        console.log('⚠️ Old draft detected with court ID:', draftData.courtName);
        draftData = { ...draftData, courtId: draftData.courtName };
      }
      if (draftData.subType && !isNaN(draftData.subType)) {
        console.log('⚠️ Old draft detected with sub-type ID:', draftData.subType);
        draftData = { ...draftData, subTypeId: draftData.subType };
      }
      
      setCaseData(draftData);
      setCurrentStep(draft.last_step || 1);
      
      // Reset auto-save to treat loaded draft as baseline
      if (resetAutoSave) {
        resetAutoSave(draftData);
      }
    }
    setShowDraftPrompt(false);
  };

  const handleStartFresh = async () => {
    await deleteDraft();
    setShowDraftPrompt(false);
  };

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const handleNext = () => {
    if (currentStep < 6) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleResetToFirstStep = () => {
    setCaseData({
      caseTitle: '', caseType: '', caseTypeId: '', subType: '', subTypeId: '', caseNumber: '',
      courtName: '', courtId: '', filingDate: '', category: '', primaryCategory: '',
      subCategory: '', complexity: '', monetaryValue: '', priorityLevel: 'Medium',
      courtLevel: 'High Court', benchDivision: '', jurisdiction: 'Delhi',
      state: 'Delhi', judges: [], courtRoomNo: '',
      petitioners: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
      respondents: [{ fullName: '', role: '', advocateName: '', barRegistration: '', contact: '' }],
      nextHearingDate: '', deadlineDate: '', servedDate: '', currentStatus: 'Active', uploadedFiles: []
    });
    setCurrentStep(1);
  };

  const handleCaseCreated = async () => {
    await deleteDraft();
    console.log("Case created successfully → Draft deleted from database");
  };

  const steps = [
    { number: 1, name: 'Overview', icon: Scale },
    { number: 2, name: 'Jurisdiction', icon: Building2 },
    { number: 3, name: 'Parties', icon: Users },
    { number: 4, name: 'Category', icon: Tag },
    { number: 5, name: 'Dates', icon: FolderPlus },
    { number: 6, name: 'Review', icon: CheckCircle }
  ];

  const getAutoSaveIcon = () => {
    switch (saveStatus) {
      case 'saving': return <RotateCcw className="w-4 h-4 mr-1 animate-spin" />;
      case 'saved': return <CheckCircle className="w-4 h-4 mr-1" />;
      case 'error': return <AlertCircle className="w-4 h-4 mr-1" />;
      default: return <Clock className="w-4 h-4 mr-1" />;
    }
  };

  const getAutoSaveText = () => {
    switch (saveStatus) {
      case 'saving': return 'Saving...';
      case 'saved': return lastSaveTime ? `Saved at ${lastSaveTime.toLocaleTimeString()}` : 'Saved';
      case 'error': return 'Save failed';
      default: return 'Auto-save enabled';
    }
  };

  const getAutoSaveColor = () => {
    return saveStatus === 'saved' ? 'text-[#21C1B6]' :
           saveStatus === 'error' ? 'text-red-600' :
           saveStatus === 'saving' ? 'text-blue-600' : 'text-gray-500';
  };

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="text-center">
          <RotateCcw className="w-8 h-8 animate-spin text-[#21C1B6] mb-3" />
          <p className="text-gray-600">Loading your case form...</p>
        </div>
      </div>
    );
  }

  // Draft Resume Prompt
  if (showDraftPrompt) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-[#21C1B6] bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Scale className="w-10 h-10 text-[#21C1B6]" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Resume Previous Draft?</h2>
          <p className="text-gray-600 mb-8">
            We found an incomplete case draft. Would you like to continue from where you left off?
          </p>
          <div className="flex gap-4">
            <button
              onClick={handleStartFresh}
              className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition"
            >
              Start Fresh
            </button>
            <button
              onClick={handleLoadDraft}
              className="flex-1 px-6 py-3 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition"
            >
              Resume Draft
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFCFB]">
      {/* Header */}
      <div className="bg-white border-b shadow-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Create New Case</h1>
              <p className="text-sm text-gray-500">
                Step {currentStep} of 6
              </p>
            </div>
            <button onClick={onCancel} className="text-gray-500 hover:text-gray-700 text-sm">
              Cancel
            </button>
          </div>

          {/* Progress Bar */}
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <React.Fragment key={step.number}>
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    currentStep >= step.number ? 'bg-[#21C1B6] text-white' : 'bg-gray-200 text-gray-400'
                  }`}>
                    <step.icon className="w-5 h-5" />
                  </div>
                  <span className={`text-xs mt-2 ${currentStep >= step.number ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
                    {step.name}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div className={`flex-1 h-1 mx-2 transition-all ${currentStep > step.number ? 'bg-[#21C1B6]' : 'bg-gray-200'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="bg-white rounded-lg shadow-sm p-8 min-h-[500px]">
          {currentStep === 1 && <OverviewStep caseData={caseData} setCaseData={setCaseData} />}
          {currentStep === 2 && <JurisdictionStep caseData={caseData} setCaseData={setCaseData} />}
          {currentStep === 3 && <PartiesStep caseData={caseData} setCaseData={setCaseData} />}
          {currentStep === 4 && <CategoryStep caseData={caseData} setCaseData={setCaseData} />}
          {currentStep === 5 && <DatesStep caseData={caseData} setCaseData={setCaseData} />}
          {currentStep === 6 && (
            <ReviewStep
              caseData={caseData}
              onBack={handleBack}
              onResetToFirstStep={handleResetToFirstStep}
              onComplete={handleCaseCreated}
            />
          )}
        </div>

        {/* Bottom Navigation */}
        {currentStep < 6 && (
          <div className="mt-6 flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <span className={`inline-flex items-center text-sm ${getAutoSaveColor()}`}>
                {getAutoSaveIcon()}
                {getAutoSaveText()}
              </span>
              <button
                onClick={manualSave}
                className="inline-flex items-center px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition"
              >
                <Save className="w-3 h-3 mr-1" />
                Force Save
              </button>
            </div>

            <div className="flex space-x-2">
              {currentStep > 1 && (
                <button
                  onClick={handleBack}
                  className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition"
                >
                  Back
                </button>
              )}
              {currentStep < 6 && (
                <button
                  onClick={handleNext}
                  className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition"
                >
                  Skip
                </button>
              )}
              <button
                onClick={handleNext}
                className="px-4 py-1.5 bg-[#21C1B6] text-white rounded-sm text-sm font-medium hover:bg-[#1AA89E] transition flex items-center"
              >
                Continue
                <span className="ml-1">→</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CaseCreationFlow;