// import React, { useState } from 'react';
// import { FolderPlus, CheckCircle, Sparkles } from 'lucide-react';

// const DatesStep = ({ caseData, setCaseData }) => {
//   const [autoRemind, setAutoRemind] = useState(false);

//   return (
//     <div>
//       {/* Header */}
//       <div className="flex items-start mb-6">
//         <FolderPlus className="w-6 h-6 mr-3 text-gray-700 mt-1" />
//         <div>
//           <h3 className="text-xl font-semibold text-gray-900">Important Dates & Status</h3>
//           <p className="text-sm text-gray-600 mt-1">Track case milestones and deadlines.</p>
//         </div>
//       </div>

//       {/* Fields */}
//       <div className="space-y-6">
//         {/* Dates */}
//         <div className="grid grid-cols-2 gap-4">
//           {[
//             { label: 'Registration Date', key: 'registrationDate', required: true },
//             { label: 'First Hearing Date', key: 'firstHearingDate', required: true },
//           ].map(({ label, key, required }) => (
//             <div key={key}>
//               <label className="block text-sm font-medium text-gray-700 mb-2">
//                 {label} {required && <span className="text-red-500">*</span>}
//               </label>
//               <input
//                 type="date"
//                 value={caseData[key] || ''}
//                 onChange={(e) => setCaseData({ ...caseData, [key]: e.target.value })}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//               />
//             </div>
//           ))}
//         </div>

//         {/* Expected Disposal + Status */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">Expected Disposal Date</label>
//             <input
//               type="date"
//               value={caseData.expectedDisposalDate || ''}
//               onChange={(e) => setCaseData({ ...caseData, expectedDisposalDate: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             />
//             <p className="text-xs text-gray-500 mt-1">Optional - Estimated timeline</p>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Current Case Status <span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.currentStatus || ''}
//               onChange={(e) => setCaseData({ ...caseData, currentStatus: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             >
//               <option value="">Select current status...</option>
//               <option value="Filed">Filed</option>
//               <option value="Pending">Pending</option>
//               <option value="Under Hearing">Under Hearing</option>
//               <option value="Awaiting Judgment">Awaiting Judgment</option>
//               <option value="Disposed">Disposed</option>
//               <option value="Closed">Closed</option>
//             </select>
//           </div>
//         </div>

//         {/* Auto Remind */}
//         <div className="flex items-start">
//           <input
//             type="checkbox"
//             id="autoRemind"
//             checked={autoRemind}
//             onChange={(e) => setAutoRemind(e.target.checked)}
//             className="mt-1 w-4 h-4 text-[#9CDFE1] border-gray-300 rounded focus:ring-[#9CDFE1]"
//           />
//           <label htmlFor="autoRemind" className="ml-3">
//             <div className="text-sm font-medium text-gray-700">Auto-remind me about hearings</div>
//             <p className="text-xs text-gray-500">
//               Get notifications 24 hours before scheduled hearings
//             </p>
//           </label>
//         </div>

//         {/* Auto-saved */}
//         {/* <div className="flex items-center text-sm text-green-600 mt-4">
//           <CheckCircle className="w-4 h-4 mr-1" />
//           <span>Auto-saved</span>
//         </div> */}
//       </div>
//     </div>
//   );
// };

// export default DatesStep;


// import React, { useState } from 'react';
// import { Scale, Building2, Users, Tag, FolderPlus, CheckCircle, FolderOpen, Loader2, Upload, Calendar, Sparkles } from 'lucide-react';

// // DatesStep Component
// const DatesStep = ({ caseData, setCaseData }) => {
//   const [autoRemind, setAutoRemind] = useState(false);

//   return (
//     <div>
//       {/* Header */}
//       <div className="flex items-start mb-6">
//         <FolderPlus className="w-6 h-6 mr-3 text-gray-700 mt-1" />
//         <div>
//           <h3 className="text-xl font-semibold text-gray-900">Important Dates & Status</h3>
//           <p className="text-sm text-gray-600 mt-1">Track case milestones and deadlines.</p>
//         </div>
//       </div>

//       {/* Fields */}
//       <div className="space-y-6">
//         {/* Dates */}
//         <div className="grid grid-cols-2 gap-4">
//           {[
//             { label: 'Registration Date', key: 'registrationDate', required: true },
//             { label: 'First Hearing Date', key: 'firstHearingDate', required: true },
//           ].map(({ label, key, required }) => (
//             <div key={key}>
//               <label className="block text-sm font-medium text-gray-700 mb-2">
//                 {label} {required && <span className="text-red-500">*</span>}
//               </label>
//               <input
//                 type="date"
//                 value={caseData[key] || ''}
//                 onChange={(e) => setCaseData({ ...caseData, [key]: e.target.value })}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//               />
//             </div>
//           ))}
//         </div>

//         {/* Expected Disposal + Status */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">Expected Disposal Date</label>
//             <input
//               type="date"
//               value={caseData.expectedDisposalDate || ''}
//               onChange={(e) => setCaseData({ ...caseData, expectedDisposalDate: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             />
//             <p className="text-xs text-gray-500 mt-1">Optional - Estimated timeline</p>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Current Case Status <span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.currentStatus || ''}
//               onChange={(e) => setCaseData({ ...caseData, currentStatus: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             >
//               <option value="">Select current status...</option>
//               <option value="Filed">Filed</option>
//               <option value="Pending">Pending</option>
//               <option value="Under Hearing">Under Hearing</option>
//               <option value="Awaiting Judgment">Awaiting Judgment</option>
//               <option value="Disposed">Disposed</option>
//               <option value="Closed">Closed</option>
//             </select>
//           </div>
//         </div>

//         {/* Auto Remind */}
//         <div className="flex items-start">
//           <input
//             type="checkbox"
//             id="autoRemind"
//             checked={autoRemind}
//             onChange={(e) => setAutoRemind(e.target.checked)}
//             className="mt-1 w-4 h-4 text-[#9CDFE1] border-gray-300 rounded focus:ring-[#9CDFE1]"
//           />
//           <label htmlFor="autoRemind" className="ml-3">
//             <div className="text-sm font-medium text-gray-700">Auto-remind me about hearings</div>
//             <p className="text-xs text-gray-500">
//               Get notifications 24 hours before scheduled hearings
//             </p>
//           </label>
//         </div>
//       </div>
//     </div>
//   );
// };
// export default DatesStep;

import React, { useState } from 'react';
import { FolderPlus, Calendar } from 'lucide-react';

const DatesStep = ({ caseData, setCaseData }) => {
  const [autoRemind, setAutoRemind] = useState(false);

  // Format date to Indian dd/mm/yyyy
  const formatDateToIndian = (isoDate) => {
    if (!isoDate) return '';
    const [year, month, day] = isoDate.split('-');
    return `${day}/${month}/${year}`;
  };

  const handleDateChange = (key, value) => {
    const formatted = formatDateToIndian(value);
    setCaseData({
      ...caseData,
      [key]: value,
      [`${key}Display`]: formatted,
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start mb-6">
        <FolderPlus className="w-6 h-6 mr-3 text-gray-700 mt-1" />
        <div>
          <h3 className="text-xl font-semibold text-gray-900">
            Important Dates & Status
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Track case milestones and deadlines.
          </p>
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-6">
        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Registration Date', key: 'registrationDate', required: true },
            { label: 'First Hearing Date', key: 'firstHearingDate', required: true },
          ].map(({ label, key, required }) => (
            <div key={key} className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {label} {required && <span className="text-red-500">*</span>}
              </label>

              {/* Visible Display Input */}
              <div className="relative">
                <input
                  type="text"
                  value={caseData[`${key}Display`] || ''}
                  placeholder="dd/mm/yyyy"
                  readOnly
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
                             placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] 
                             focus:border-[#9CDFE1] outline-none pr-10 bg-white pointer-events-none"
                />
                {/* Calendar Icon */}
                <div className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none">
                  <Calendar className="w-5 h-5" />
                </div>

                {/* Actual Date Input - Positioned on top */}
                <input
                  id={`${key}-picker`}
                  type="date"
                  value={caseData[key] || ''}
                  onChange={(e) => handleDateChange(key, e.target.value)}
                  className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                  style={{ colorScheme: 'light' }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Expected Disposal Date + Status */}
        <div className="grid grid-cols-2 gap-4">
          {/* Expected Disposal Date */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Expected Disposal Date
            </label>
            <div className="relative">
              <input
                type="text"
                value={caseData.expectedDisposalDateDisplay || ''}
                placeholder="dd/mm/yyyy"
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
                           placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] 
                           focus:border-[#9CDFE1] outline-none pr-10 bg-white pointer-events-none"
              />
              <div className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none">
                <Calendar className="w-5 h-5" />
              </div>
              <input
                id="expectedDisposalDate-picker"
                type="date"
                value={caseData.expectedDisposalDate || ''}
                onChange={(e) => handleDateChange('expectedDisposalDate', e.target.value)}
                className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
                style={{ colorScheme: 'light' }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Optional - Estimated timeline
            </p>
          </div>

          {/* Status Dropdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Current Case Status <span className="text-red-500">*</span>
            </label>
            <select
              value={caseData.currentStatus || ''}
              onChange={(e) =>
                setCaseData({ ...caseData, currentStatus: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
                         focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
            >
              <option value="">Select current status...</option>
              <option value="Filed">Filed</option>
              <option value="Pending">Pending</option>
              <option value="Under Hearing">Under Hearing</option>
              <option value="Awaiting Judgment">Awaiting Judgment</option>
              <option value="Disposed">Disposed</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
        </div>

        {/* Auto Remind */}
        <div className="flex items-start">
          <input
            type="checkbox"
            id="autoRemind"
            checked={autoRemind}
            onChange={(e) => setAutoRemind(e.target.checked)}
            className="mt-1 w-4 h-4 text-[#9CDFE1] border-gray-300 rounded focus:ring-[#9CDFE1]"
          />
          <label htmlFor="autoRemind" className="ml-3">
            <div className="text-sm font-medium text-gray-700">
              Auto-remind me about hearings
            </div>
            <p className="text-xs text-gray-500">
              Get notifications 24 hours before scheduled hearings
            </p>
          </label>
        </div>
      </div>
    </div>
  );
};

export default DatesStep;
