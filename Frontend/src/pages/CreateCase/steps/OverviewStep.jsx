// import React from 'react';
// import { Scale, CheckCircle } from 'lucide-react';

// const OverviewStep = ({ caseData, setCaseData }) => {
//   return (
//     <div>
//       {/* Header */}
//       <div className="flex items-start mb-6">
//         <Scale className="w-6 h-6 mr-3 text-gray-700 mt-1" />
//         <div>
//           <h3 className="text-xl font-semibold text-gray-900">Create New Case</h3>
//           <p className="text-sm text-gray-600 mt-1">Let's start with the basic details for your case.</p>
//         </div>
//       </div>

//       {/* Form Fields */}
//       <div className="space-y-6">
//         {/* Case Title */}
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Case Title / Name<span className="text-red-500">*</span>
//           </label>
//           <input
//             type="text"
//             placeholder="Enter case title or name"
//             value={caseData.caseTitle}
//             onChange={(e) => setCaseData({ ...caseData, caseTitle: e.target.value })}
//             className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//           />
//         </div>

//         {/* Case Type and Sub-Type */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Case Type<span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.caseType}
//               onChange={(e) => setCaseData({ ...caseData, caseType: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             >
//               <option value="">Select case type...</option>
//               <option value="Civil">Civil</option>
//               <option value="Criminal">Criminal</option>
//               <option value="Commercial">Commercial</option>
//             </select>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">Sub-Type</label>
//             <select
//               value={caseData.subType}
//               onChange={(e) => setCaseData({ ...caseData, subType: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none disabled:bg-gray-100 disabled:text-gray-400"
//               disabled={!caseData.caseType}
//             >
//               <option value="">Select sub-type...</option>
//               <option value="Property Dispute">Property Dispute</option>
//               <option value="Contract Breach">Contract Breach</option>
//               <option value="Fraud">Fraud</option>
//               <option value="Theft">Theft</option>
//             </select>
//             {!caseData.caseType && (
//               <p className="text-xs text-gray-500 mt-1">Available after selecting case type</p>
//             )}
//           </div>
//         </div>

//         {/* Case Number and Court Name */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">Case Number</label>
//             <input
//               type="text"
//               placeholder="Enter case number (if available)"
//               value={caseData.caseNumber}
//               onChange={(e) => setCaseData({ ...caseData, caseNumber: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             />
//             <p className="text-xs text-gray-500 mt-1">Optional for new filings</p>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Court Name<span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.courtName}
//               onChange={(e) => setCaseData({ ...caseData, courtName: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             >
//               <option value="">Select court...</option>
//               <option value="Delhi High Court">Delhi High Court</option>
//               <option value="Supreme Court">Supreme Court</option>
//               <option value="District Court">District Court</option>
//               <option value="Mumbai High Court">Mumbai High Court</option>
//               <option value="Kolkata High Court">Kolkata High Court</option>
//             </select>
//           </div>
//         </div>

//         {/* Filing Date */}
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">Filing Date</label>
//           <input
//             type="date"
//             value={caseData.filingDate}
//             onChange={(e) => setCaseData({ ...caseData, filingDate: e.target.value })}
//             className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//           />
//         </div>


//       </div>

//       {/* Footer note */}
//       <div className="mt-6 pt-4 border-t border-gray-200">
//         <p className="text-sm text-gray-500">All fields marked with * are required</p>
//       </div>
//     </div>
//   );
// };

// export default OverviewStep;

// import React, { useState, useEffect } from 'react';
// import { Scale } from 'lucide-react';

// const OverviewStep = ({ caseData, setCaseData }) => {
//   const [caseTypes, setCaseTypes] = useState([]);
//   const [subTypes, setSubTypes] = useState([]);
//   const [courts, setCourts] = useState([]);
//   const [loading, setLoading] = useState(false);

//   const API_BASE_URL = 'https://document-service-120280829617.asia-south1.run.app/api/content';

//   // Fetch case types on component mount
//   useEffect(() => {
//     fetchCaseTypes();
//     fetchCourts();
//   }, []);

//   // Fetch sub-types when case type changes
//   useEffect(() => {
//     if (caseData.caseType) {
//       fetchSubTypes(caseData.caseType);
//     } else {
//       setSubTypes([]);
//       setCaseData({ ...caseData, subType: '' });
//     }
//   }, [caseData.caseType]);

//   const fetchCaseTypes = async () => {
//     try {
//       setLoading(true);
//       const response = await fetch(`${API_BASE_URL}/case-types`);
//       const data = await response.json();
//       setCaseTypes(data);
//     } catch (error) {
//       console.error('Error fetching case types:', error);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const fetchSubTypes = async (caseTypeId) => {
//     try {
//       setLoading(true);
//       const response = await fetch(`${API_BASE_URL}/case-types/${caseTypeId}/sub-types`);
//       const data = await response.json();
//       setSubTypes(data);
//     } catch (error) {
//       console.error('Error fetching sub-types:', error);
//       setSubTypes([]);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const fetchCourts = async () => {
//     try {
//       const response = await fetch(`${API_BASE_URL}/courts`);
//       const data = await response.json();
//       setCourts(data);
//     } catch (error) {
//       console.error('Error fetching courts:', error);
//     }
//   };

//   return (
//     <div>
//       {/* Header */}
//       <div className="flex items-start mb-6">
//         <Scale className="w-6 h-6 mr-3 text-gray-700 mt-1" />
//         <div>
//           <h3 className="text-xl font-semibold text-gray-900">Create New Case</h3>
//           <p className="text-sm text-gray-600 mt-1">Let's start with the basic details for your case.</p>
//         </div>
//       </div>

//       {/* Form Fields */}
//       <div className="space-y-6">
//         {/* Case Title */}
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Case Title / Name<span className="text-red-500">*</span>
//           </label>
//           <input
//             type="text"
//             placeholder="Enter case title or name"
//             value={caseData.caseTitle}
//             onChange={(e) => setCaseData({ ...caseData, caseTitle: e.target.value })}
//             className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//           />
//         </div>

//         {/* Case Type and Sub-Type */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Case Type<span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.caseType}
//               onChange={(e) => setCaseData({ ...caseData, caseType: e.target.value, subType: '' })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//               disabled={loading}
//             >
//               <option value="">Select case type...</option>
//               {caseTypes.map((type) => (
//                 <option key={type.id} value={type.id}>
//                   {type.name}
//                 </option>
//               ))}
//             </select>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">Sub-Type</label>
//             <select
//               value={caseData.subType}
//               onChange={(e) => setCaseData({ ...caseData, subType: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none disabled:bg-gray-100 disabled:text-gray-400"
//               disabled={!caseData.caseType || loading}
//             >
//               <option value="">Select sub-type...</option>
//               {subTypes.map((subType) => (
//                 <option key={subType.id} value={subType.id}>
//                   {subType.name}
//                 </option>
//               ))}
//             </select>
//             {!caseData.caseType && (
//               <p className="text-xs text-gray-500 mt-1">Available after selecting case type</p>
//             )}
//           </div>
//         </div>

//         {/* Case Number and Court Name */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">Case Number</label>
//             <input
//               type="text"
//               placeholder="Enter case number (if available)"
//               value={caseData.caseNumber}
//               onChange={(e) => setCaseData({ ...caseData, caseNumber: e.target.value })}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             />
//             <p className="text-xs text-gray-500 mt-1">Optional for new filings</p>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Court Name<span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.courtName}
//               onChange={(e) => {
//                 const selectedCourt = courts.find(c => c.id.toString() === e.target.value);
//                 setCaseData({ 
//                   ...caseData, 
//                   courtName: e.target.value,
//                   courtLevel: selectedCourt?.court_level || '',
//                   jurisdiction: selectedCourt?.jurisdiction || '',
//                   state: selectedCourt?.state || ''
//                 });
//               }}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             >
//               <option value="">Select court...</option>
//               {courts.map((court) => (
//                 <option key={court.id} value={court.id}>
//                   {court.name}
//                 </option>
//               ))}
//             </select>
//           </div>
//         </div>

//         {/* Filing Date */}
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">Filing Date</label>
//           <input
//             type="date"
//             value={caseData.filingDate}
//             onChange={(e) => setCaseData({ ...caseData, filingDate: e.target.value })}
//             className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//           />
//         </div>
//       </div>

//       {/* Footer note */}
//       <div className="mt-6 pt-4 border-t border-gray-200">
//         <p className="text-sm text-gray-500">All fields marked with * are required</p>
//       </div>
//     </div>
//   );
// };

// export default OverviewStep;


import React, { useState, useEffect } from "react";
import { Scale, Calendar } from "lucide-react";

const OverviewStep = ({ caseData, setCaseData }) => {
  const [caseTypes, setCaseTypes] = useState([]);
  const [subTypes, setSubTypes] = useState([]);
  const [courts, setCourts] = useState([]);
  const [loading, setLoading] = useState(false);
  const hasConvertedCaseType = React.useRef(false);
  const hasConvertedCourt = React.useRef(false);

  const API_BASE_URL = "https://document-service-120280829617.asia-south1.run.app/api/content";

  useEffect(() => {
    fetchCaseTypes();
    fetchCourts();
  }, []);

  // Handle backward compatibility: convert IDs to names if old draft loaded
  useEffect(() => {
    if (!hasConvertedCaseType.current && caseTypes.length > 0 && caseData.caseType && !isNaN(caseData.caseType)) {
      // caseType contains an ID (old draft format), convert to name
      console.log('🔄 Converting case type ID to name:', caseData.caseType);
      const selectedType = caseTypes.find(t => t.id.toString() === caseData.caseType.toString());
      if (selectedType) {
        console.log('✅ Found case type:', selectedType.name);
        hasConvertedCaseType.current = true;
        setCaseData({
          ...caseData,
          caseType: selectedType.name,
          caseTypeId: selectedType.id.toString()
        });
      } else {
        console.log('❌ Case type not found for ID:', caseData.caseType);
      }
    }
  }, [caseTypes, caseData, setCaseData]);

  useEffect(() => {
    if (!hasConvertedCourt.current && courts.length > 0 && caseData.courtName && !isNaN(caseData.courtName)) {
      // courtName contains an ID (old draft format), convert to name
      console.log('🔄 Converting court ID to name:', caseData.courtName);
      const selectedCourt = courts.find(c => c.id.toString() === caseData.courtName.toString());
      if (selectedCourt) {
        console.log('✅ Found court:', selectedCourt.name);
        hasConvertedCourt.current = true;
        setCaseData({
          ...caseData,
          courtName: selectedCourt.name,
          courtId: selectedCourt.id.toString(),
          courtLevel: selectedCourt.court_level || '',
          jurisdiction: selectedCourt.jurisdiction || '',
          state: selectedCourt.state || ''
        });
      } else {
        console.log('❌ Court not found for ID:', caseData.courtName);
      }
    }
  }, [courts, caseData, setCaseData]);

  useEffect(() => {
    const typeId = caseData.caseTypeId || caseData.caseType;
    if (typeId) {
      fetchSubTypes(typeId);
    } else {
      setSubTypes([]);
      setCaseData({ ...caseData, subType: "", subTypeId: "" });
    }
  }, [caseData.caseTypeId, caseData.caseType]);

  const fetchCaseTypes = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/case-types`);
      const data = await response.json();
      setCaseTypes(data);
    } catch (error) {
      console.error("Error fetching case types:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSubTypes = async (caseTypeId) => {
    try {
      setLoading(true);
      const response = await fetch(
        `${API_BASE_URL}/case-types/${caseTypeId}/sub-types`
      );
      const data = await response.json();
      setSubTypes(data);
      
      // Handle backward compatibility for subType
      if (caseData.subType && !isNaN(caseData.subType) && data.length > 0) {
        const selectedSubType = data.find(st => st.id.toString() === caseData.subType.toString());
        if (selectedSubType) {
          setCaseData({
            ...caseData,
            subType: selectedSubType.name,
            subTypeId: selectedSubType.id.toString()
          });
        }
      }
    } catch (error) {
      console.error("Error fetching sub-types:", error);
      setSubTypes([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchCourts = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/courts`);
      const data = await response.json();
      setCourts(data);
    } catch (error) {
      console.error("Error fetching courts:", error);
    }
  };

  const handleDateChange = (e) => {
    const isoDate = e.target.value;
    if (isoDate) {
      const [year, month, day] = isoDate.split("-");
      const formatted = `${day}/${month}/${year}`;
      setCaseData({
        ...caseData,
        filingDate: isoDate,
        displayFilingDate: formatted,
      });
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start mb-6">
        <Scale className="w-6 h-6 mr-3 text-gray-700 mt-1" />
        <div>
          <h3 className="text-xl font-semibold text-gray-900">Create New Case</h3>
          <p className="text-sm text-gray-600 mt-1">
            Let's start with the basic details for your case.
          </p>
        </div>
      </div>

      {/* Form Fields */}
      <div className="space-y-6">
        {/* Case Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Case Title / Name<span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            placeholder="Enter case title or name"
            value={caseData.caseTitle}
            onChange={(e) =>
              setCaseData({ ...caseData, caseTitle: e.target.value })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
            placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
          />
        </div>

        {/* Case Type and Sub-Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Case Type<span className="text-red-500">*</span>
            </label>
            <select
              value={caseData.caseTypeId || caseData.caseType}
              onChange={(e) => {
                const selectedType = caseTypes.find(
                  (t) => t.id.toString() === e.target.value
                );
                setCaseData({ 
                  ...caseData, 
                  caseType: selectedType?.name || "",
                  caseTypeId: e.target.value,
                  subType: "",
                  subTypeId: ""
                });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
              placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
              disabled={loading}
            >
              <option value="">Select case type...</option>
              {caseTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sub-Type
            </label>
            <select
              value={caseData.subTypeId || caseData.subType}
              onChange={(e) => {
                const selectedSubType = subTypes.find(
                  (st) => st.id.toString() === e.target.value
                );
                setCaseData({ 
                  ...caseData, 
                  subType: selectedSubType?.name || "",
                  subTypeId: e.target.value
                });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
              placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none 
              disabled:bg-gray-100 disabled:text-gray-400"
              disabled={(!caseData.caseType && !caseData.caseTypeId) || loading}
            >
              <option value="">Select sub-type...</option>
              {subTypes.map((subType) => (
                <option key={subType.id} value={subType.id}>
                  {subType.name}
                </option>
              ))}
            </select>
            {!caseData.caseType && !caseData.caseTypeId && (
              <p className="text-xs text-gray-500 mt-1">
                Available after selecting case type
              </p>
            )}
          </div>
        </div>

        {/* Case Number and Court Name */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Case Number
            </label>
            <input
              type="text"
              placeholder="Enter case number (if available)"
              value={caseData.caseNumber}
              onChange={(e) =>
                setCaseData({ ...caseData, caseNumber: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
              placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">Optional for new filings</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Court Name<span className="text-red-500">*</span>
            </label>
            <select
              value={caseData.courtId || caseData.courtName}
              onChange={(e) => {
                const selectedCourt = courts.find(
                  (c) => c.id.toString() === e.target.value
                );
                setCaseData({
                  ...caseData,
                  courtName: selectedCourt?.name || "",
                  courtId: e.target.value,
                  courtLevel: selectedCourt?.court_level || "",
                  jurisdiction: selectedCourt?.jurisdiction || "",
                  state: selectedCourt?.state || "",
                });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
              placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
            >
              <option value="">Select court...</option>
              {courts.map((court) => (
                <option key={court.id} value={court.id}>
                  {court.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Filing Date with calendar icon and Indian format */}
        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filing Date
          </label>

          {/* visible display box */}
          <div className="relative">
            <input
              type="text"
              value={caseData.displayFilingDate || ""}
              placeholder="dd/mm/yyyy"
              readOnly
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 
              placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none pr-10 bg-white pointer-events-none"
            />
            {/* Calendar Icon */}
            <div className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none">
              <Calendar className="w-5 h-5" />
            </div>
            {/* Actual Date Input - Positioned on top */}
            <input
              id="filing-date-picker"
              type="date"
              value={caseData.filingDate || ""}
              onChange={handleDateChange}
              className="absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer"
              style={{ colorScheme: 'light' }}
            />
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

export default OverviewStep;
