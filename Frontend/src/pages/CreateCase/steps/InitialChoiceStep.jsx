import React from 'react';
import { Upload, FileText, ArrowRight } from 'lucide-react';

const InitialChoiceStep = ({ onSelectAutoFill, onSelectManual }) => {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-semibold text-gray-800 mb-2">Create New Case</h2>
        <p className="text-gray-600">Choose how you'd like to create your case</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mt-8">
        {/* Auto-fill Option */}
        <div
          onClick={onSelectAutoFill}
          className="border-2 border-gray-200 rounded-lg p-8 cursor-pointer hover:border-[#21C1B6] hover:shadow-lg transition-all group"
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-[#E6F8F7] rounded-full flex items-center justify-center mb-4 group-hover:bg-[#21C1B6] transition-colors">
              <Upload className="w-8 h-8 text-[#21C1B6] group-hover:text-white transition-colors" />
            </div>
            <h3 className="text-xl font-semibold text-gray-800 mb-2">Auto-fill from Case File</h3>
            <p className="text-gray-600 text-sm mb-4">
              Upload your case document and we'll automatically extract and fill in all the case information.
            </p>
            <div className="flex items-center text-[#21C1B6] font-medium">
              <span>Choose this option</span>
              <ArrowRight className="w-4 h-4 ml-2" />
            </div>
          </div>
        </div>

        {/* Manual Fill Option */}
        <div
          onClick={onSelectManual}
          className="border-2 border-gray-200 rounded-lg p-8 cursor-pointer hover:border-[#21C1B6] hover:shadow-lg transition-all group"
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-[#E6F8F7] rounded-full flex items-center justify-center mb-4 group-hover:bg-[#21C1B6] transition-colors">
              <FileText className="w-8 h-8 text-[#21C1B6] group-hover:text-white transition-colors" />
            </div>
            <h3 className="text-xl font-semibold text-gray-800 mb-2">Manually Fill Fields</h3>
            <p className="text-gray-600 text-sm mb-4">
              Enter all case details manually step by step through the form.
            </p>
            <div className="flex items-center text-[#21C1B6] font-medium">
              <span>Choose this option</span>
              <ArrowRight className="w-4 h-4 ml-2" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InitialChoiceStep;

