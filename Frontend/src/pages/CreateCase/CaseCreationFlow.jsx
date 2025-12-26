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

  useEffect(() => {
    const init = async () => {
      if (!actualUserId || !Number.isInteger(actualUserId)) {
        setIsLoading(false);
        return;
      }
      try {
        const draft = await loadDraft();
        if (draft && draft.draft_data) {
          if (skipDraftPrompt) {
            let draftData = draft.draft_data;
            
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
      let draftData = draft.draft_data;
      
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