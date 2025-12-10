import React from 'react';
import { CheckCircle, Scale, Upload, FolderPlus, Tag } from 'lucide-react';

const SuccessModal = ({ isOpen, caseData, onClose, onViewCase, onCreateAnother }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl p-8 max-h-[90vh] overflow-y-auto">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Case Created Successfully!</h2>
          <p className="text-gray-600">
            Your case has been created and saved to your dashboard. {caseData.caseNumber || 'CRL/567/2025'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            You're all set to start managing your case with NexIntel AI.
          </p>
        </div>

        <div className="bg-gray-50 p-6 rounded-lg mb-6">
          <div className="flex items-center mb-4">
            <Scale className="w-6 h-6 mr-2 text-gray-600" />
            <h3 className="font-semibold">Case Summary</h3>
          </div>
          <p className="text-sm text-gray-600 mb-4">Key details for your newly created case</p>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Case Title</span>
              <p className="font-medium">{caseData.caseTitle || 'Raj Kumar Singh vs State'}</p>
            </div>
            <div>
              <span className="text-gray-600">Case Number</span>
              <p className="font-medium">{caseData.caseNumber || 'CRL/567/2025'}</p>
            </div>
            <div>
              <span className="text-gray-600">Court</span>
              <p className="font-medium">{caseData.courtName || 'Delhi High Court'}</p>
            </div>
            <div>
              <span className="text-gray-600">Filing Date</span>
              <p className="font-medium">{caseData.filingDate || '02-Jun-2025'}</p>
            </div>
            <div>
              <span className="text-gray-600">Status</span>
              <p className="font-medium text-green-600">● Active</p>
            </div>
            <div>
              <span className="text-gray-600">Case Type</span>
              <p className="font-medium">{caseData.category || caseData.caseType || 'Criminal'}</p>
            </div>
          </div>
        </div>

        <div className="flex justify-center space-x-4 mb-6">
          <button
            onClick={onViewCase}
            className="px-6 py-3 bg-[#EF4444] text-white rounded-md hover:bg-[#DC2626] flex items-center"
          >
            <Scale className="w-5 h-5 mr-2" />
            Go to Case Details
          </button>
          <button
            onClick={onCreateAnother}
            className="px-6 py-3 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            + Create Another Case
          </button>
        </div>

        <div className="border-t pt-6">
          <h4 className="font-semibold text-center mb-4">What's Next?</h4>
          <p className="text-sm text-gray-600 text-center mb-4">
            Start managing your case efficiently with our AI-powered tools
          </p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <Upload className="w-6 h-6 text-gray-600" />
              </div>
              <p className="text-sm font-medium">Upload Documents</p>
            </div>
            <div>
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <FolderPlus className="w-6 h-6 text-gray-600" />
              </div>
              <p className="text-sm font-medium">Schedule Events</p>
            </div>
            <div>
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                <Tag className="w-6 h-6 text-gray-600" />
              </div>
              <p className="text-sm font-medium">AI Analysis</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuccessModal;