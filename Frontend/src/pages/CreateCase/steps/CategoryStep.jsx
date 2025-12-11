// import React from 'react';
// import { Tag, CheckCircle, Scale, Gavel, Briefcase } from 'lucide-react';

// const CategoryStep = ({ caseData, setCaseData }) => {
//   const caseTypes = [
//     { id: 'civil', label: 'Civil', icon: Scale },
//     { id: 'criminal', label: 'Criminal', icon: Gavel },
//     { id: 'commercial', label: 'Commercial', icon: Briefcase }
//   ];

//   return (
//     <div>
//       {/* Header */}
//       <div className="flex items-start mb-6">
//         <Tag className="w-6 h-6 mr-3 text-gray-700 mt-1" />
//         <div>
//           <h3 className="text-xl font-semibold text-gray-900">Categorize The Case</h3>
//           <p className="text-sm text-gray-600 mt-1">
//             Select type and complexity for accurate AI suggestions.
//           </p>
//         </div>
//       </div>

//       {/* Form Fields */}
//       <div className="space-y-6">
//         {/* Case Type Selection */}
//         <div className="grid grid-cols-3 gap-4">
//           {caseTypes.map((type) => {
//             const IconComponent = type.icon;
//             return (
//               <button
//                 key={type.id}
//                 onClick={() => setCaseData({ ...caseData, category: type.label })}
//                 className={`p-4 border-2 rounded-lg text-center transition-all ${
//                   caseData.category === type.label
//                     ? 'border-[#9CDFE1] bg-gray-50 shadow-sm'
//                     : 'border-gray-200 hover:border-[#9CDFE1]'
//                 }`}
//               >
//                 <IconComponent className="w-8 h-8 mx-auto mb-2 text-gray-600" />
//                 <span className="text-sm font-medium text-gray-700">{type.label}</span>
//               </button>
//             );
//           })}
//         </div>

//         {/* Primary and Sub Category */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Primary Category <span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.primaryCategory}
//               onChange={(e) => setCaseData({ ...caseData, primaryCategory: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] placeholder-gray-400 outline-none"
//             >
//               <option value="">Select primary category...</option>
//               <option value="Property Dispute">Property Dispute</option>
//               <option value="Contract Law">Contract Law</option>
//               <option value="Family Law">Family Law</option>
//               <option value="Criminal Law">Criminal Law</option>
//               <option value="Corporate Law">Corporate Law</option>
//             </select>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Sub-Category <span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.subCategory}
//               onChange={(e) => setCaseData({ ...caseData, subCategory: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] placeholder-gray-400 outline-none disabled:bg-gray-100 disabled:text-gray-400"
//               disabled={!caseData.primaryCategory}
//             >
//               <option value="">Select sub-category...</option>
//               <option value="Land Dispute">Land Dispute</option>
//               <option value="Breach of Contract">Breach of Contract</option>
//               <option value="Divorce">Divorce</option>
//               <option value="Theft">Theft</option>
//               <option value="Fraud">Fraud</option>
//             </select>
//             {!caseData.primaryCategory && (
//               <p className="text-xs text-gray-500 mt-1">
//                 Available after selecting primary category
//               </p>
//             )}
//           </div>
//         </div>

//         {/* Case Complexity and Monetary Value */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Case Complexity <span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.complexity}
//               onChange={(e) => setCaseData({ ...caseData, complexity: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] placeholder-gray-400 outline-none"
//             >
//               <option value="">Select complexity...</option>
//               <option value="Simple">Simple</option>
//               <option value="Moderate">Moderate</option>
//               <option value="Complex">Complex</option>
//               <option value="Highly Complex">Highly Complex</option>
//             </select>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">Monetary Value</label>
//             <div className="relative">
//               <span className="absolute left-3 top-2 text-gray-500">₹</span>
//               <input
//                 type="text"
//                 placeholder="0.00"
//                 value={caseData.monetaryValue}
//                 onChange={(e) => setCaseData({ ...caseData, monetaryValue: e.target.value })}
//                 className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//               />
//             </div>
//             <p className="text-xs text-gray-500 mt-1">Enter amount if applicable</p>
//           </div>
//         </div>

//         {/* Priority Level */}
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-3">
//             Priority Level <span className="text-red-500">*</span>
//           </label>
//           <div className="grid grid-cols-3 gap-4">
//             {['High', 'Medium', 'Low'].map((level) => (
//               <label
//                 key={level}
//                 className={`flex items-center justify-center p-4 border-2 rounded-lg cursor-pointer transition-all ${
//                   caseData.priorityLevel === level
//                     ? 'border-[#9CDFE1] bg-gray-50'
//                     : 'border-gray-200 hover:border-[#9CDFE1]'
//                 }`}
//               >
//                 <input
//                   type="radio"
//                   name="priority"
//                   value={level}
//                   checked={caseData.priorityLevel === level}
//                   onChange={(e) => setCaseData({ ...caseData, priorityLevel: e.target.value })}
//                   className="mr-3 w-4 h-4 text-[#9CDFE1] focus:ring-[#9CDFE1]"
//                 />
//                 <span className="text-sm font-medium text-gray-700">{level}</span>
//               </label>
//             ))}
//           </div>
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

// export default CategoryStep;


import React, { useState, useEffect } from 'react';
import { Tag, Scale, Gavel, Briefcase } from 'lucide-react';

const CategoryStep = ({ caseData, setCaseData }) => {
  const [caseTypes, setCaseTypes] = useState([]);
  const [subTypes, setSubTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const API_BASE_URL = 'https://gateway-service-120280829617.asia-south1.run.app/api/content';

  // Fetch case types on mount
  useEffect(() => {
    fetchCaseTypes();
  }, []);

  // Fetch sub-types when primary category changes
  useEffect(() => {
    if (caseData.primaryCategory) {
      fetchSubTypes(caseData.primaryCategory);
    } else {
      setSubTypes([]);
    }
  }, [caseData.primaryCategory]);

  const fetchCaseTypes = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE_URL}/case-types`);
      if (!response.ok) throw new Error('Failed to fetch case types');
      const data = await response.json();
      setCaseTypes(data);
    } catch (error) {
      console.error('Error fetching case types:', error);
      setError('Failed to load case types');
    } finally {
      setLoading(false);
    }
  };

  const fetchSubTypes = async (caseTypeId) => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE_URL}/case-types/${caseTypeId}/sub-types`);
      if (!response.ok) throw new Error('Failed to fetch sub-types');
      const data = await response.json();
      setSubTypes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching sub-types:', error);
      setSubTypes([]);
      setError('Failed to load sub-types');
    } finally {
      setLoading(false);
    }
  };

  const getCaseTypeIcon = (typeName) => {
    const lowerName = typeName?.toLowerCase() || '';
    if (lowerName.includes('civil')) return Scale;
    if (lowerName.includes('criminal')) return Gavel;
    if (lowerName.includes('commercial')) return Briefcase;
    return Tag;
  };

  const handleCategorySelect = (type) => {
    setCaseData({ 
      ...caseData, 
      category: type.name,
      primaryCategory: type.id,
      subCategory: '' // Reset sub-category when category changes
    });
  };

  const handlePrimaryCategoryChange = (e) => {
    const selectedTypeId = e.target.value;
    const selectedType = caseTypes.find(t => t.id.toString() === selectedTypeId);
    setCaseData({ 
      ...caseData, 
      primaryCategory: selectedTypeId,
      category: selectedType?.name || '',
      subCategory: '' // Reset sub-category
    });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start mb-6">
        <Tag className="w-6 h-6 mr-3 text-gray-700 mt-1" />
        <div>
          <h3 className="text-xl font-semibold text-gray-900">Categorize The Case</h3>
          <p className="text-sm text-gray-600 mt-1">
            Select type and complexity for accurate AI suggestions.
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Form Fields */}
      <div className="space-y-6">
        {/* Case Type Selection - Visual Cards */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Case Category <span className="text-red-500">*</span>
          </label>
          {loading && caseTypes.length === 0 ? (
            <div className="text-center py-8 text-gray-500">Loading case types...</div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {caseTypes.map((type) => {
                const IconComponent = getCaseTypeIcon(type.name);
                return (
                  <button
                    key={type.id}
                    onClick={() => handleCategorySelect(type)}
                    className={`p-4 border-2 rounded-lg text-center transition-all ${
                      caseData.category === type.name
                        ? 'border-[#9CDFE1] bg-gray-50 shadow-sm'
                        : 'border-gray-200 hover:border-[#9CDFE1]'
                    }`}
                    type="button"
                    disabled={loading}
                  >
                    <IconComponent className="w-8 h-8 mx-auto mb-2 text-gray-600" />
                    <span className="text-sm font-medium text-gray-700">{type.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Primary and Sub Category */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Primary Category <span className="text-red-500">*</span>
            </label>
            <select
              value={caseData.primaryCategory || ''}
              onChange={handlePrimaryCategoryChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] placeholder-gray-400 outline-none disabled:bg-gray-100"
              disabled={loading}
            >
              <option value="">Select primary category...</option>
              {caseTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sub-Category <span className="text-red-500">*</span>
            </label>
            <select
              value={caseData.subCategory || ''}
              onChange={(e) => setCaseData({ ...caseData, subCategory: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] placeholder-gray-400 outline-none disabled:bg-gray-100 disabled:text-gray-400"
              disabled={!caseData.primaryCategory || loading}
            >
              <option value="">Select sub-category...</option>
              {subTypes.map((subType) => (
                <option key={subType.id} value={subType.id}>
                  {subType.name}
                </option>
              ))}
            </select>
            {!caseData.primaryCategory ? (
              <p className="text-xs text-gray-500 mt-1">
                Available after selecting primary category
              </p>
            ) : loading ? (
              <p className="text-xs text-gray-500 mt-1">Loading sub-categories...</p>
            ) : null}
          </div>
        </div>

        {/* Case Complexity and Monetary Value */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Case Complexity <span className="text-red-500">*</span>
            </label>
            <select
              value={caseData.complexity || ''}
              onChange={(e) => setCaseData({ ...caseData, complexity: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] placeholder-gray-400 outline-none"
            >
              <option value="">Select complexity...</option>
              <option value="Simple">Simple</option>
              <option value="Moderate">Moderate</option>
              <option value="Complex">Complex</option>
              <option value="Highly Complex">Highly Complex</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Monetary Value</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">₹</span>
              <input
                type="text"
                placeholder="0.00"
                value={caseData.monetaryValue || ''}
                onChange={(e) => setCaseData({ ...caseData, monetaryValue: e.target.value })}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">Enter amount if applicable</p>
          </div>
        </div>

        {/* Priority Level */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Priority Level <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-3 gap-4">
            {['High', 'Medium', 'Low'].map((level) => (
              <label
                key={level}
                className={`flex items-center justify-center p-4 border-2 rounded-lg cursor-pointer transition-all ${
                  caseData.priorityLevel === level
                    ? 'border-[#9CDFE1] bg-gray-50'
                    : 'border-gray-200 hover:border-[#9CDFE1]'
                }`}
              >
                <input
                  type="radio"
                  name="priority"
                  value={level}
                  checked={caseData.priorityLevel === level}
                  onChange={(e) => setCaseData({ ...caseData, priorityLevel: e.target.value })}
                  className="mr-3 w-4 h-4 text-[#9CDFE1] focus:ring-[#9CDFE1]"
                />
                <span className="text-sm font-medium text-gray-700">{level}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CategoryStep;