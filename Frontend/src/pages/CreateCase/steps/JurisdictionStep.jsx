// import React, { useState } from 'react';
// import { Building2, CheckCircle, X } from 'lucide-react';

// const JurisdictionStep = ({ caseData, setCaseData }) => {
//   const [judges, setJudges] = useState(caseData.judges || []);

//   const addJudge = (judgeName) => {
//     if (judgeName && !judges.includes(judgeName)) {
//       const newJudges = [...judges, judgeName];
//       setJudges(newJudges);
//       setCaseData({ ...caseData, judges: newJudges });
//     }
//   };

//   const removeJudge = (judgeToRemove) => {
//     const newJudges = judges.filter((judge) => judge !== judgeToRemove);
//     setJudges(newJudges);
//     setCaseData({ ...caseData, judges: newJudges });
//   };

//   const handleJudgeSelect = (e) => {
//     const selectedJudge = e.target.value;
//     if (selectedJudge) {
//       addJudge(selectedJudge);
//       e.target.value = ''; // Reset select
//     }
//   };

//   return (
//     <div>
//       {/* Header */}
//       <div className="flex items-start mb-6">
//         <Building2 className="w-6 h-6 mr-3 text-gray-700 mt-1" />
//         <div>
//           <h3 className="text-xl font-semibold text-gray-900">
//             Court & Jurisdiction Details
//           </h3>
//           <p className="text-sm text-gray-600 mt-1">
//             Tell us where this case will be heard.
//           </p>
//         </div>
//       </div>

//       {/* Form Fields */}
//       <div className="space-y-6">
//         {/* Court Level and Bench/Division */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Court Level <span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.courtLevel}
//               onChange={(e) =>
//                 setCaseData({ ...caseData, courtLevel: e.target.value })
//               }
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             >
//               <option value="">Select court level</option>
//               <option value="High Court">High Court</option>
//               <option value="Supreme Court">Supreme Court</option>
//               <option value="District Court">District Court</option>
//               <option value="Magistrate Court">Magistrate Court</option>
//             </select>
//             <p className="text-xs text-gray-500 mt-1">
//               Auto-filled based on case type
//             </p>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Bench / Division <span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.benchDivision}
//               onChange={(e) =>
//                 setCaseData({ ...caseData, benchDivision: e.target.value })
//               }
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//             >
//               <option value="">Select bench or division...</option>
//               <option value="Civil Division">Civil Division</option>
//               <option value="Criminal Division">Criminal Division</option>
//               <option value="Constitutional Bench">
//                 Constitutional Bench
//               </option>
//               <option value="Single Bench">Single Bench</option>
//               <option value="Division Bench">Division Bench</option>
//             </select>
//           </div>
//         </div>

//         {/* Jurisdiction and State */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Jurisdiction
//             </label>
//             <input
//               type="text"
//               value={caseData.jurisdiction}
//               onChange={(e) =>
//                 setCaseData({ ...caseData, jurisdiction: e.target.value })
//               }
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] bg-gray-100 outline-none"
//               placeholder="Delhi"
//               disabled
//             />
//             <p className="text-xs text-gray-500 mt-1">
//               Auto-filled based on selected court
//             </p>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               State
//             </label>
//             <input
//               type="text"
//               value={caseData.state}
//               onChange={(e) =>
//                 setCaseData({ ...caseData, state: e.target.value })
//               }
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] bg-gray-100 outline-none"
//               placeholder="Delhi"
//               disabled
//             />
//             <p className="text-xs text-gray-500 mt-1">Auto-filled</p>
//           </div>
//         </div>

//         {/* Judge(s) Name */}
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Judge(s) Name
//           </label>
//           <select
//             onChange={handleJudgeSelect}
//             className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//           >
//             <option value="">Select presiding judge(s)...</option>
//             <option value="Justice Rajesh Kumar">Justice Rajesh Kumar</option>
//             <option value="Justice Priya Sharma">Justice Priya Sharma</option>
//             <option value="Justice Amit Verma">Justice Amit Verma</option>
//             <option value="Justice Sanjay Mehta">Justice Sanjay Mehta</option>
//             <option value="Justice Kavita Singh">Justice Kavita Singh</option>
//           </select>

//           {/* Selected Judges Tags */}
//           {judges.length > 0 && (
//             <div className="flex flex-wrap gap-2 mt-3">
//               {judges.map((judge, index) => (
//                 <span
//                   key={index}
//                   className="inline-flex items-center px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full"
//                 >
//                   {judge}
//                   <button
//                     onClick={() => removeJudge(judge)}
//                     className="ml-2 text-gray-500 hover:text-gray-700"
//                   >
//                     <X className="w-3 h-3" />
//                   </button>
//                 </span>
//               ))}
//             </div>
//           )}
//         </div>

//         {/* Court Room No. */}
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Court Room No. (Optional)
//           </label>
//           <input
//             type="text"
//             placeholder="Enter court room number"
//             value={caseData.courtRoom}
//             onChange={(e) =>
//               setCaseData({ ...caseData, courtRoom: e.target.value })
//             }
//             className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//           />
//         </div>

//         {/* Auto-saved indicator */}
//         {/* <div className="flex items-center text-sm text-green-600 mt-4">
//           <CheckCircle className="w-4 h-4 mr-1" />
//           <span>Auto-saved</span>
//         </div> */}
//       </div>
//     </div>
//   );
// };

// export default JurisdictionStep;

// import React, { useState, useEffect } from 'react';
// import { Building2, X } from 'lucide-react';

// const JurisdictionStep = ({ caseData, setCaseData }) => {
//   const [judges, setJudges] = useState(caseData.judges || []);
//   const [availableJudges, setAvailableJudges] = useState([]);
//   const [courts, setCourts] = useState([]);
//   const [selectedCourtData, setSelectedCourtData] = useState(null);
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState(null);

//   const API_BASE_URL = 'https://gateway-service-120280829617.asia-south1.run.app/api/content';

//   // Fetch courts on mount
//   useEffect(() => {
//     fetchCourts();
//   }, []);

//   // Fetch court details when court is selected
//   useEffect(() => {
//     if (caseData.courtName) {
//       fetchCourtDetails(caseData.courtName);
//     }
//   }, [caseData.courtName]);

//   // Fetch judges when court and bench are selected
//   useEffect(() => {
//     if (caseData.courtName && caseData.benchDivision) {
//       fetchJudges(caseData.courtName, caseData.benchDivision);
//     } else {
//       setAvailableJudges([]);
//     }
//   }, [caseData.courtName, caseData.benchDivision]);

//   const fetchCourts = async () => {
//     try {
//       setError(null);
//       const response = await fetch(`${API_BASE_URL}/courts`);
//       if (!response.ok) throw new Error('Failed to fetch courts');
//       const data = await response.json();
//       setCourts(data);
//     } catch (error) {
//       console.error('Error fetching courts:', error);
//       setError('Failed to load courts');
//     }
//   };

//   const fetchCourtDetails = async (courtId) => {
//     try {
//       setLoading(true);
//       setError(null);
//       const response = await fetch(`${API_BASE_URL}/courts/${courtId}`);
//       if (!response.ok) throw new Error('Failed to fetch court details');
//       const data = await response.json();
//       setSelectedCourtData(data);
      
//       // Auto-fill court level, jurisdiction, and state
//       setCaseData({
//         ...caseData,
//         courtLevel: data.court_level || '',
//         jurisdiction: data.jurisdiction || '',
//         state: data.state || ''
//       });
//     } catch (error) {
//       console.error('Error fetching court details:', error);
//       setError('Failed to load court details');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const fetchJudges = async (courtId, benchName) => {
//     try {
//       setLoading(true);
//       setError(null);
//       const response = await fetch(
//         `${API_BASE_URL}/judges?courtId=${courtId}&benchName=${encodeURIComponent(benchName)}`
//       );
      
//       if (!response.ok) {
//         if (response.status === 404) {
//           setAvailableJudges([]);
//           return;
//         }
//         throw new Error('Failed to fetch judges');
//       }
      
//       const data = await response.json();
//       setAvailableJudges(Array.isArray(data) ? data : []);
//     } catch (error) {
//       console.error('Error fetching judges:', error);
//       setAvailableJudges([]);
//       setError('Failed to load judges');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const addJudge = (judgeName) => {
//     if (judgeName && !judges.includes(judgeName)) {
//       const newJudges = [...judges, judgeName];
//       setJudges(newJudges);
//       setCaseData({ ...caseData, judges: newJudges });
//     }
//   };

//   const removeJudge = (judgeToRemove) => {
//     const newJudges = judges.filter((judge) => judge !== judgeToRemove);
//     setJudges(newJudges);
//     setCaseData({ ...caseData, judges: newJudges });
//   };

//   const handleJudgeSelect = (e) => {
//     const selectedJudge = e.target.value;
//     if (selectedJudge) {
//       addJudge(selectedJudge);
//       e.target.value = '';
//     }
//   };

//   return (
//     <div>
//       {/* Header */}
//       <div className="flex items-start mb-6">
//         <Building2 className="w-6 h-6 mr-3 text-gray-700 mt-1" />
//         <div>
//           <h3 className="text-xl font-semibold text-gray-900">
//             Court & Jurisdiction Details
//           </h3>
//           <p className="text-sm text-gray-600 mt-1">
//             Tell us where this case will be heard.
//           </p>
//         </div>
//       </div>

//       {/* Error Message */}
//       {error && (
//         <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
//           <p className="text-sm text-red-600">{error}</p>
//         </div>
//       )}

//       {/* Form Fields */}
//       <div className="space-y-6">
//         {/* Court Level and Bench/Division */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Court Level <span className="text-red-500">*</span>
//             </label>
//             <input
//               type="text"
//               value={caseData.courtLevel || ''}
//               placeholder="Auto-filled"
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-gray-100 outline-none"
//               disabled
//             />
//             <p className="text-xs text-gray-500 mt-1">
//               Auto-filled based on selected court
//             </p>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Bench / Division <span className="text-red-500">*</span>
//             </label>
//             <select
//               value={caseData.benchDivision || ''}
//               onChange={(e) =>
//                 setCaseData({ ...caseData, benchDivision: e.target.value })
//               }
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none disabled:bg-gray-100"
//               disabled={!caseData.courtName}
//             >
//               <option value="">Select bench or division...</option>
//               <option value="Civil Division">Civil Division</option>
//               <option value="Criminal Division">Criminal Division</option>
//               <option value="Constitutional Bench">Constitutional Bench</option>
//               <option value="Single Bench">Single Bench</option>
//               <option value="Division Bench">Division Bench</option>
//               <option value="Principal Bench">Principal Bench</option>
//             </select>
//             {!caseData.courtName && (
//               <p className="text-xs text-gray-500 mt-1">
//                 Available after selecting court in Overview step
//               </p>
//             )}
//           </div>
//         </div>

//         {/* Jurisdiction and State */}
//         <div className="grid grid-cols-2 gap-4">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Jurisdiction
//             </label>
//             <input
//               type="text"
//               value={caseData.jurisdiction || ''}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-gray-100 outline-none"
//               placeholder="Auto-filled"
//               disabled
//             />
//             <p className="text-xs text-gray-500 mt-1">
//               Auto-filled based on selected court
//             </p>
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               State
//             </label>
//             <input
//               type="text"
//               value={caseData.state || ''}
//               className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-gray-100 outline-none"
//               placeholder="Auto-filled"
//               disabled
//             />
//             <p className="text-xs text-gray-500 mt-1">Auto-filled</p>
//           </div>
//         </div>

//         {/* Judge(s) Name */}
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Judge(s) Name
//           </label>
//           <select
//             onChange={handleJudgeSelect}
//             className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none disabled:bg-gray-100"
//             disabled={!caseData.benchDivision || loading}
//             value=""
//           >
//             <option value="">
//               {loading 
//                 ? 'Loading judges...' 
//                 : !caseData.courtName
//                 ? 'Select court first...'
//                 : !caseData.benchDivision 
//                 ? 'Select bench first...'
//                 : availableJudges.length === 0
//                 ? 'No judges available for this bench'
//                 : 'Select presiding judge(s)...'}
//             </option>
//             {availableJudges.map((judge) => (
//               <option key={judge.id} value={judge.name}>
//                 {judge.name}
//               </option>
//             ))}
//           </select>

//           {/* Selected Judges Tags */}
//           {judges.length > 0 && (
//             <div className="flex flex-wrap gap-2 mt-3">
//               {judges.map((judge, index) => (
//                 <span
//                   key={index}
//                   className="inline-flex items-center px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full"
//                 >
//                   {judge}
//                   <button
//                     onClick={() => removeJudge(judge)}
//                     className="ml-2 text-gray-500 hover:text-gray-700"
//                     type="button"
//                   >
//                     <X className="w-3 h-3" />
//                   </button>
//                 </span>
//               ))}
//             </div>
//           )}
//         </div>

//         {/* Court Room No. */}
//         <div>
//           <label className="block text-sm font-medium text-gray-700 mb-2">
//             Court Room No. (Optional)
//           </label>
//           <input
//             type="text"
//             placeholder="Enter court room number"
//             value={caseData.courtRoom || ''}
//             onChange={(e) =>
//               setCaseData({ ...caseData, courtRoom: e.target.value })
//             }
//             className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
//           />
//         </div>
//       </div>
//     </div>
//   );
// };

// export default JurisdictionStep;


import React, { useState, useEffect } from 'react';
import { Building2, X, Plus } from 'lucide-react';

const JurisdictionStep = ({ caseData, setCaseData }) => {
  const [judges, setJudges] = useState(caseData.judges || []);
  const [newJudgeName, setNewJudgeName] = useState('');
  const [courts, setCourts] = useState([]);
  const [selectedCourtData, setSelectedCourtData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const API_BASE_URL = 'https://gateway-service-120280829617.asia-south1.run.app/api/content';

  // Sync local judges state with caseData.judges when it changes (e.g., from draft load)
  useEffect(() => {
    if (caseData.judges && Array.isArray(caseData.judges)) {
      setJudges(caseData.judges);
    }
  }, [caseData.judges]);

  // Fetch courts on mount
  useEffect(() => {
    fetchCourts();
  }, []);

  // Fetch court details when court is selected
  useEffect(() => {
    const courtId = caseData.courtId || caseData.courtName;
    if (courtId) {
      fetchCourtDetails(courtId);
    }
  }, [caseData.courtId, caseData.courtName]);

  const fetchCourts = async () => {
    try {
      setError(null);
      const response = await fetch(`${API_BASE_URL}/courts`);
      if (!response.ok) throw new Error('Failed to fetch courts');
      const data = await response.json();
      setCourts(data);
    } catch (error) {
      console.error('Error fetching courts:', error);
      setError('Failed to load courts');
    }
  };

  const fetchCourtDetails = async (courtId) => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE_URL}/courts/${courtId}`);
      if (!response.ok) throw new Error('Failed to fetch court details');
      const data = await response.json();
      setSelectedCourtData(data);
      
      // Auto-fill court level, jurisdiction, and state
      setCaseData({
        ...caseData,
        courtLevel: data.court_level || '',
        jurisdiction: data.jurisdiction || '',
        state: data.state || ''
      });
    } catch (error) {
      console.error('Error fetching court details:', error);
      setError('Failed to load court details');
    } finally {
      setLoading(false);
    }
  };

  const addJudge = () => {
    const trimmedName = newJudgeName.trim();
    if (!trimmedName) return;

    // Check if input contains comma - multiple judges
    if (trimmedName.includes(',')) {
      const judgeNames = trimmedName
        .split(',')
        .map(name => name.trim())
        .filter(name => name && !judges.includes(name));
      
      if (judgeNames.length > 0) {
        const newJudges = [...judges, ...judgeNames];
        setJudges(newJudges);
        setCaseData({ ...caseData, judges: newJudges });
      }
    } else {
      // Single judge
      if (!judges.includes(trimmedName)) {
        const newJudges = [...judges, trimmedName];
        setJudges(newJudges);
        setCaseData({ ...caseData, judges: newJudges });
      }
    }
    setNewJudgeName('');
  };

  const removeJudge = (judgeToRemove) => {
    const newJudges = judges.filter((judge) => judge !== judgeToRemove);
    setJudges(newJudges);
    setCaseData({ ...caseData, judges: newJudges });
  };

  const handleJudgeKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addJudge();
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start mb-6">
        <Building2 className="w-6 h-6 mr-3 text-gray-700 mt-1" />
        <div>
          <h3 className="text-xl font-semibold text-gray-900">
            Court & Jurisdiction Details
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Tell us where this case will be heard.
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
        {/* Court Level and Bench/Division */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Court Level <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={caseData.courtLevel || ''}
              placeholder="Auto-filled"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-gray-100 outline-none"
              disabled
            />
            <p className="text-xs text-gray-500 mt-1">
              Auto-filled based on selected court
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Bench / Division <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="Enter bench or division name"
              value={caseData.benchDivision || ''}
              onChange={(e) =>
                setCaseData({ ...caseData, benchDivision: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              e.g., Civil Division, Principal Bench
            </p>
          </div>
        </div>

        {/* Jurisdiction and State */}
        <div className="grid grid-cols-2 gap-4">


          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              State
            </label>
            <input
              type="text"
              value={caseData.state || ''}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-gray-100 outline-none"
              placeholder="Auto-filled"
              disabled
            />
            <p className="text-xs text-gray-500 mt-1">Auto-filled</p>
          </div>

            <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Jurisdiction
            </label>
            <input
              type="text"
              value={caseData.jurisdiction || ''}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-gray-100 outline-none"
              placeholder="Auto-filled"
              disabled
            />
            <p className="text-xs text-gray-500 mt-1">
              Auto-filled based on selected court
            </p>
          </div>
        </div>

        {/* Judge(s) Name - Manual Entry */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Judge(s) Name
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter judge name(s) - separate multiple with commas"
              value={newJudgeName}
              onChange={(e) => setNewJudgeName(e.target.value)}
              onKeyPress={handleJudgeKeyPress}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
            />
            <button
              type="button"
              onClick={addJudge}
              disabled={!newJudgeName.trim()}
              className="px-4 py-2 bg-[#9CDFE1] text-white rounded-md text-sm font-medium hover:bg-[#8DCFE0] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center"
            >
              <Plus className="w-4 h-4 mr-1" />
              Add
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Add single judge or multiple judges separated by commas (e.g., Justice A, Justice B)
          </p>

          {/* Selected Judges Tags */}
          {judges.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {judges.map((judge, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full"
                >
                  {judge}
                  <button
                    onClick={() => removeJudge(judge)}
                    className="ml-2 text-gray-500 hover:text-gray-700"
                    type="button"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Court Room No. */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Court Room No. (Optional)
          </label>
          <input
            type="text"
            placeholder="Enter court room number"
            value={caseData.courtRoom || ''}
            onChange={(e) =>
              setCaseData({ ...caseData, courtRoom: e.target.value })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 placeholder-gray-400 focus:ring-1 focus:ring-[#9CDFE1] focus:border-[#9CDFE1] outline-none"
          />
        </div>
      </div>
    </div>
  );
};

export default JurisdictionStep;