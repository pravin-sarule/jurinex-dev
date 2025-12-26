import React, { useState, useEffect } from 'react';
import { Scale, Building2, Users, Tag, FolderPlus, CheckCircle, AlertCircle, RotateCcw, Clock, Save, LogOut } from 'lucide-react';
import OverviewStep from './steps/OverviewStep';
import JurisdictionStep from './steps/JurisdictionStep';
import PartiesStep from './steps/PartiesStep';
import CategoryStep from './steps/CategoryStep';
import DatesStep from './steps/DatesStep';
import ReviewStep from './steps/ReviewStep';
import { useAutoSave } from '../../hooks/useAutoSave';

const CaseCreationFlow = ({ onComplete, onCancel, userId = null }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
  const [caseData, setCaseData] = useState({
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
    courtLevel: 'High Court',
    benchDivision: '',
    jurisdiction: 'Delhi',
    state: 'Delhi',
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

  const { saveStatus, lastSaveTime, actualUserId, tokenError, manualSave, loadDraft, deleteDraft } = useAutoSave(
    caseData, 
    currentStep, 
    userId,
    true
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
      
      if (tokenError) {
        console.error('❌ Token error:', tokenError);
        setIsLoading(false);
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
          console.log('📭 No draft found, enabling auto-save');
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

    if (actualUserId && Number.isInteger(actualUserId) && actualUserId > 0 && !tokenError) {
      loadExistingDraft();
    } else if (tokenError) {
      setIsLoading(false);
    } else {
      console.log('⏹️ Waiting for valid user ID...');
    }
  }, [actualUserId, tokenError, loadDraft]);

  const handleLoadDraft = async () => {
    console.log('📥 Loading draft data...');
    try {
      const draft = await loadDraft();
      if (draft && draft.draft_data) {
        setCaseData(draft.draft_data);
        setCurrentStep(draft.last_step || 1);
        console.log('✅ Draft loaded successfully');
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

  const handleManualSave = async () => {
    console.log('👆 Manual save button clicked');
    const result = await manualSave();
    console.log('💾 Manual save result:', result);
  };

  const steps = [
    { number: 1, name: 'Overview', icon: Scale },
    { number: 2, name: 'Jurisdiction', icon: Building2 },
    { number: 3, name: 'Parties', icon: Users },
    { number: 4, name: 'Category', icon: Tag },
    { number: 5, name: 'Dates', icon: FolderPlus },
    { number: 6, name: 'Review', icon: CheckCircle }
  ];

  const handleNext = async () => {
    if (currentStep < 6) {
      setCurrentStep(currentStep + 1);
    } else if (onComplete) {
      try {
        if (actualUserId && Number.isInteger(actualUserId) && actualUserId > 0 && !tokenError) {
          await deleteDraft();
          console.log('✅ Draft deleted after case completion');
        }
      } catch (error) {
        console.error('❌ Error deleting draft:', error);
      }
      onComplete(caseData);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleCancel = async () => {
    if (actualUserId && draftLoaded && Number.isInteger(actualUserId) && actualUserId > 0 && !tokenError) {
      try {
        await manualSave();
        console.log('💾 Progress saved before canceling');
      } catch (error) {
        console.error('❌ Error saving before cancel:', error);
      }
    }
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
      courtLevel: 'High Court',
      benchDivision: '',
      jurisdiction: 'Delhi',
      state: 'Delhi',
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

  const getAutoSaveIcon = () => {
    switch (saveStatus) {
      case 'saving':
        return <RotateCcw className="w-4 h-4 mr-1 animate-spin" />;
      case 'saved':
        return <CheckCircle className="w-4 h-4 mr-1" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 mr-1" />;
      default:
        return <Clock className="w-4 h-4 mr-1" />;
    }
  };

  const getAutoSaveText = () => {
    if (tokenError) {
      return 'Session expired';
    }
    
    switch (saveStatus) {
      case 'saving':
        return 'Saving...';
      case 'saved':
        return lastSaveTime 
          ? `Auto-saved at ${lastSaveTime.toLocaleTimeString()}` 
          : 'Auto-saved';
      case 'error':
        return 'Save failed - Retrying...';
      default:
        return 'Auto-save enabled';
    }
  };

  const getAutoSaveColor = () => {
    if (tokenError) {
      return 'text-red-600';
    }
    
    switch (saveStatus) {
      case 'saving':
        return 'text-blue-600';
      case 'saved':
        return 'text-[#21C1B6]';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-500';
    }
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
            <button
              onClick={handleCancel}
              className="text-gray-500 hover:text-gray-700 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>

          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <React.Fragment key={step.number}>
                <div className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                      currentStep >= step.number
                        ? 'bg-[#21C1B6] text-white'
                        : 'bg-gray-200 text-gray-400'
                    }`}
                  >
                    <step.icon className="w-5 h-5" />
                  </div>
                  <span
                    className={`text-xs mt-2 ${
                      currentStep >= step.number
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
                      currentStep > step.number ? 'bg-[#21C1B6]' : 'bg-gray-200'
                    }`}
                  />
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
                onClick={handleManualSave}
                disabled={!!tokenError}
                className="inline-flex items-center px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Test manual save"
              >
                <Save className="w-3 h-3 mr-1" />
                Force Save
              </button>
            </div>
            
            <div className="flex space-x-2">
              {currentStep > 1 && (
                <button
                  onClick={handleBack}
                  className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition-colors"
                >
                  Back
                </button>
              )}
              {currentStep < 6 && (
                <button
                  onClick={handleNext}
                  className="px-4 py-1.5 border border-[#21C1B6] text-[#21C1B6] rounded-sm text-sm hover:bg-[#E6F8F7] transition-colors"
                >
                  Skip
                </button>
              )}
              <button
                onClick={handleNext}
                className="px-4 py-1.5 bg-[#21C1B6] text-white rounded-sm text-sm font-medium hover:bg-[#1AA89E] transition-colors flex items-center"
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