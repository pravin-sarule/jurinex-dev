// import React from "react";
// import { useNavigate } from "react-router-dom";
// import {
//   CheckCircle,
//   FolderOpen,
//   Upload,
//   Calendar,
//   Sparkles,
// } from "lucide-react";

// const ReviewStep = ({ caseData }) => {
//   const navigate = useNavigate();
//   const caseNumber = `CRL/${Math.floor(Math.random() * 1000)}/2025`;

//   const handleGoToCaseDetails = () => {
//     navigate("/case-details"); // Navigate to Case Details Page
//   };

//   return (
//     <div className="p-6">
//       {/* Success Icon */}
//       <div className="flex justify-center mb-6">
//         <div className="w-16 h-16 bg-[#9CDFE1] rounded-full flex items-center justify-center">
//           <CheckCircle className="w-10 h-10 text-white" />
//         </div>
//       </div>

//       {/* Message */}
//       <div className="text-center mb-8">
//         <h2 className="text-2xl font-bold text-gray-900 mb-3">
//           Case Created Successfully!
//         </h2>
//         <p className="text-sm text-gray-600 mb-2">
//           Your case has been created and saved to your dashboard.{" "}
//           <strong>{caseNumber}</strong>
//         </p>
//         <p className="text-sm text-gray-600">
//           You're all set to start managing your case with NexIntel AI.
//         </p>
//       </div>

//       {/* Summary Card */}
//       <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
//         <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
//           <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
//           <div>
//             <h3 className="text-lg font-semibold text-gray-900">
//               Case Summary
//             </h3>
//             <p className="text-xs text-gray-500">
//               Key details for your newly created case
//             </p>
//           </div>
//         </div>

//         <div className="grid grid-cols-2 gap-6">
//           {/* Left Column */}
//           <div className="space-y-4">
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Title</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {caseData.caseTitle || "Rajesh Kumar Singh vs State"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Court</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {caseData.courtName ||
//                   caseData.courtLevel ||
//                   "Delhi High Court"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Status</p>
//               <p className="text-sm font-medium text-green-600 flex items-center">
//                 <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
//                 {caseData.currentStatus || "Active"}
//               </p>
//             </div>
//           </div>

//           {/* Right Column */}
//           <div className="space-y-4">
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Number</p>
//               <p className="text-sm font-medium text-gray-900">{caseNumber}</p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Filing Date</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {caseData.filingDate
//                   ? new Date(caseData.filingDate).toLocaleDateString("en-GB", {
//                       day: "2-digit",
//                       month: "short",
//                       year: "numeric",
//                     })
//                   : "15-Jan-2025"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Type</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {caseData.caseType || caseData.category || "Criminal"}
//               </p>
//             </div>
//           </div>
//         </div>
//       </div>

//       {/* Buttons */}
//       <div className="flex gap-3 mb-8">
//         <button
//           onClick={handleGoToCaseDetails}
//           className="flex-1 px-4 py-3 bg-[#9CDFE1] text-white rounded-md hover:bg-[#87D8DB] transition-colors flex items-center justify-center text-sm font-medium"
//         >
//           <FolderOpen className="w-4 h-4 mr-2" />
//           Go to Case Details
//         </button>
//         <button className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center text-sm font-medium">
//           <span className="mr-2 text-lg">+</span> Create Another Case
//         </button>
//       </div>

//       {/* Next Steps Section */}
//       <div className="bg-gray-50 rounded-lg p-6">
//         <h4 className="text-center text-base font-semibold text-gray-900 mb-2">
//           What’s Next?
//         </h4>
//         <p className="text-center text-sm text-gray-600 mb-6">
//           Start managing your case efficiently with our AI-powered tools.
//         </p>

//         <div className="grid grid-cols-3 gap-6">
//           {[
//             { icon: Upload, label: "Upload Documents" },
//             { icon: Calendar, label: "Schedule Events" },
//             { icon: Sparkles, label: "AI Analysis" },
//           ].map(({ icon: Icon, label }) => (
//             <div key={label} className="text-center">
//               <div className="flex justify-center mb-3">
//                 <div className="w-12 h-12 bg-white border border-gray-200 rounded-lg flex items-center justify-center shadow-sm">
//                   <Icon className="w-6 h-6 text-[#9CDFE1]" />
//                 </div>
//               </div>
//               <p className="text-sm font-medium text-gray-900">{label}</p>
//             </div>
//           ))}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default ReviewStep;



// import React, { useState } from "react";
// import { useNavigate } from "react-router-dom";
// import {
//   CheckCircle,
//   FolderOpen,
//   Upload,
//   Calendar,
//   Sparkles,
//   Loader2,
// } from "lucide-react";

// // const ReviewStep = ({ caseData, onBack }) => {
// //   const navigate = useNavigate();
// //   const [isCreating, setIsCreating] = useState(false);
// //   const [isCreated, setIsCreated] = useState(false);
// //   const [createdCase, setCreatedCase] = useState(null);
// //   const [error, setError] = useState(null);

// //   const handleCreateCase = async () => {
// //     setIsCreating(true);
// //     setError(null);

// //     try {
// //       // Try multiple possible token storage locations
// //       const token = 
// //         localStorage.getItem("authToken") ||
// //         localStorage.getItem("token") ||
// //         localStorage.getItem("access_token") ||
// //         localStorage.getItem("jwt") ||
// //         sessionStorage.getItem("authToken") ||
// //         sessionStorage.getItem("token");
      
// //       // Debug: Log all localStorage keys to help identify the correct token key
// //       console.log("Available localStorage keys:", Object.keys(localStorage));
// //       console.log("Token found:", token ? "Yes" : "No");
      
// //       if (!token) {
// //         throw new Error("Authentication token not found. Please login again.");
// //       }

// //       // Prepare the request body according to backend schema
// //       const requestBody = {
// //         case_title: caseData.caseTitle || "Untitled Case",
// //         case_number: caseData.caseNumber || null,
// //         filing_date: caseData.filingDate || new Date().toISOString(),
// //         case_type: caseData.caseType || caseData.category || "Criminal",
// //         sub_type: caseData.subType || null,
// //         court_name: caseData.courtName || "Delhi High Court",
// //         court_level: caseData.courtLevel || null,
// //         bench_division: caseData.benchDivision || null,
// //         jurisdiction: caseData.jurisdiction || null,
// //         state: caseData.state || null,
// //         judges: caseData.judges || null,
// //         court_room_no: caseData.courtRoomNo || null,
// //         petitioners: caseData.petitioners || null,
// //         respondents: caseData.respondents || null,
// //         category_type: caseData.categoryType || null,
// //         primary_category: caseData.primaryCategory || null,
// //         sub_category: caseData.subCategory || null,
// //         complexity: caseData.complexity || null,
// //         monetary_value: caseData.monetaryValue || null,
// //         priority_level: caseData.priorityLevel || null,
// //         status: caseData.currentStatus || "Active",
// //       };

// //       // Make API call
// //       const response = await fetch("http://localhost:5000/docs/create", {
// //         method: "POST",
// //         headers: {
// //           "Content-Type": "application/json",
// //           "Authorization": `Bearer ${token}`,
// //         },
// //         body: JSON.stringify(requestBody),
// //       });

// //       const data = await response.json();

// //       if (!response.ok) {
// //         throw new Error(data.error || `Server error: ${response.status}`);
// //       }

// //       // Success - update state
// //       setCreatedCase(data.case);
// //       setIsCreated(true);
      
// //       console.log("✅ Case created successfully:", data);
// //     } catch (err) {
// //       console.error("❌ Error creating case:", err);
// //       setError(err.message || "Failed to create case. Please try again.");
// //     } finally {
// //       setIsCreating(false);
// //     }
// //   };

// //   const handleGoToCaseDetails = () => {
// //     if (createdCase) {
// //       navigate(`/case-details/${createdCase.id}`, { state: { case: createdCase } });
// //     } else {
// //       navigate("/case-details");
// //     }
// //   };

// //   const handleCreateAnother = () => {
// //     setIsCreated(false);
// //     setCreatedCase(null);
// //     setError(null);
// //     if (onBack) {
// //       onBack(); // Go back to first step
// //     }
// //   };

// //   // Display case number from created case or generate placeholder
// //   const displayCaseNumber = createdCase?.case_number || 
// //     caseData.caseNumber || 
// //     `CRL/${Math.floor(Math.random() * 1000)}/2025`;

// //   // If not yet created, show review screen with create button
// //   if (!isCreated) {
// //     return (
// //       <div className="p-6">
// //         {/* Review Header */}
// //         <div className="text-center mb-8">
// //           <h2 className="text-2xl font-bold text-gray-900 mb-3">
// //             Review Case Details
// //           </h2>
// //           <p className="text-sm text-gray-600">
// //             Please review the case information before creating.
// //           </p>
// //         </div>

// //         {/* Error Message */}
// //         {error && (
// //           <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
// //             <p className="text-sm text-red-800">{error}</p>
// //           </div>
// //         )}

// //         {/* Summary Card */}
// //         <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
// //           <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
// //             <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
// //             <div>
// //               <h3 className="text-lg font-semibold text-gray-900">
// //                 Case Summary
// //               </h3>
// //               <p className="text-xs text-gray-500">
// //                 Key details for your case
// //               </p>
// //             </div>
// //           </div>

// //           <div className="grid grid-cols-2 gap-6">
// //             {/* Left Column */}
// //             <div className="space-y-4">
// //               <div>
// //                 <p className="text-xs text-gray-500 mb-1">Case Title</p>
// //                 <p className="text-sm font-medium text-gray-900">
// //                   {caseData.caseTitle || "Rajesh Kumar Singh vs State"}
// //                 </p>
// //               </div>
// //               <div>
// //                 <p className="text-xs text-gray-500 mb-1">Court</p>
// //                 <p className="text-sm font-medium text-gray-900">
// //                   {caseData.courtName ||
// //                     caseData.courtLevel ||
// //                     "Delhi High Court"}
// //                 </p>
// //               </div>
// //               <div>
// //                 <p className="text-xs text-gray-500 mb-1">Status</p>
// //                 <p className="text-sm font-medium text-green-600 flex items-center">
// //                   <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
// //                   {caseData.currentStatus || "Active"}
// //                 </p>
// //               </div>
// //             </div>

// //             {/* Right Column */}
// //             <div className="space-y-4">
// //               <div>
// //                 <p className="text-xs text-gray-500 mb-1">Case Number</p>
// //                 <p className="text-sm font-medium text-gray-900">
// //                   {caseData.caseNumber || "To be assigned"}
// //                 </p>
// //               </div>
// //               <div>
// //                 <p className="text-xs text-gray-500 mb-1">Filing Date</p>
// //                 <p className="text-sm font-medium text-gray-900">
// //                   {caseData.filingDate
// //                     ? new Date(caseData.filingDate).toLocaleDateString("en-GB", {
// //                         day: "2-digit",
// //                         month: "short",
// //                         year: "numeric",
// //                       })
// //                     : "15-Jan-2025"}
// //                 </p>
// //               </div>
// //               <div>
// //                 <p className="text-xs text-gray-500 mb-1">Case Type</p>
// //                 <p className="text-sm font-medium text-gray-900">
// //                   {caseData.caseType || caseData.category || "Criminal"}
// //                 </p>
// //               </div>
// //             </div>
// //           </div>
// //         </div>

// //         {/* Action Buttons */}
// //         <div className="flex gap-3">
// //           <button
// //             onClick={onBack}
// //             disabled={isCreating}
// //             className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
// //           >
// //             Back
// //           </button>
// //           <button
// //             onClick={handleCreateCase}
// //             disabled={isCreating}
// //             className="flex-1 px-4 py-3 bg-[#9CDFE1] text-white rounded-md hover:bg-[#87D8DB] transition-colors flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
// //           >
// //             {isCreating ? (
// //               <>
// //                 <Loader2 className="w-4 h-4 mr-2 animate-spin" />
// //                 Creating Case...
// //               </>
// //             ) : (
// //               <>
// //                 <CheckCircle className="w-4 h-4 mr-2" />
// //                 Create Case
// //               </>
// //             )}
// //           </button>
// //         </div>
// //       </div>
// //     );
// //   }

// //   // Success screen
// //   return (
// //     <div className="p-6">
// //       {/* Success Icon */}
// //       <div className="flex justify-center mb-6">
// //         <div className="w-16 h-16 bg-[#9CDFE1] rounded-full flex items-center justify-center">
// //           <CheckCircle className="w-10 h-10 text-white" />
// //         </div>
// //       </div>

// //       {/* Message */}
// //       <div className="text-center mb-8">
// //         <h2 className="text-2xl font-bold text-gray-900 mb-3">
// //           Case Created Successfully!
// //         </h2>
// //         <p className="text-sm text-gray-600 mb-2">
// //           Your case has been created and saved to your dashboard.{" "}
// //           <strong>{displayCaseNumber}</strong>
// //         </p>
// //         <p className="text-sm text-gray-600">
// //           You're all set to start managing your case with NexIntel AI.
// //         </p>
// //       </div>

// //       {/* Summary Card */}
// //       <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
// //         <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
// //           <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
// //           <div>
// //             <h3 className="text-lg font-semibold text-gray-900">
// //               Case Summary
// //             </h3>
// //             <p className="text-xs text-gray-500">
// //               Key details for your newly created case
// //             </p>
// //           </div>
// //         </div>

// //         <div className="grid grid-cols-2 gap-6">
// //           {/* Left Column */}
// //           <div className="space-y-4">
// //             <div>
// //               <p className="text-xs text-gray-500 mb-1">Case Title</p>
// //               <p className="text-sm font-medium text-gray-900">
// //                 {createdCase?.case_title || caseData.caseTitle || "Rajesh Kumar Singh vs State"}
// //               </p>
// //             </div>
// //             <div>
// //               <p className="text-xs text-gray-500 mb-1">Court</p>
// //               <p className="text-sm font-medium text-gray-900">
// //                 {createdCase?.court_name || caseData.courtName || "Delhi High Court"}
// //               </p>
// //             </div>
// //             <div>
// //               <p className="text-xs text-gray-500 mb-1">Status</p>
// //               <p className="text-sm font-medium text-green-600 flex items-center">
// //                 <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
// //                 {createdCase?.status || caseData.currentStatus || "Active"}
// //               </p>
// //             </div>
// //           </div>

// //           {/* Right Column */}
// //           <div className="space-y-4">
// //             <div>
// //               <p className="text-xs text-gray-500 mb-1">Case Number</p>
// //               <p className="text-sm font-medium text-gray-900">{displayCaseNumber}</p>
// //             </div>
// //             <div>
// //               <p className="text-xs text-gray-500 mb-1">Filing Date</p>
// //               <p className="text-sm font-medium text-gray-900">
// //                 {createdCase?.filing_date || caseData.filingDate
// //                   ? new Date(createdCase?.filing_date || caseData.filingDate).toLocaleDateString("en-GB", {
// //                       day: "2-digit",
// //                       month: "short",
// //                       year: "numeric",
// //                     })
// //                   : "15-Jan-2025"}
// //               </p>
// //             </div>
// //             <div>
// //               <p className="text-xs text-gray-500 mb-1">Case Type</p>
// //               <p className="text-sm font-medium text-gray-900">
// //                 {createdCase?.case_type || caseData.caseType || "Criminal"}
// //               </p>
// //             </div>
// //           </div>
// //         </div>
// //       </div>

// //       {/* Buttons */}
// //       <div className="flex gap-3 mb-8">
// //         <button
// //           onClick={handleGoToCaseDetails}
// //           className="flex-1 px-4 py-3 bg-[#9CDFE1] text-white rounded-md hover:bg-[#87D8DB] transition-colors flex items-center justify-center text-sm font-medium"
// //         >
// //           <FolderOpen className="w-4 h-4 mr-2" />
// //           Go to Case Details
// //         </button>
// //         <button
// //           onClick={handleCreateAnother}
// //           className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center text-sm font-medium"
// //         >
// //           <span className="mr-2 text-lg">+</span> Create Another Case
// //         </button>
// //       </div>

// //       {/* Next Steps Section */}
// //       <div className="bg-gray-50 rounded-lg p-6">
// //         <h4 className="text-center text-base font-semibold text-gray-900 mb-2">
// //           What's Next?
// //         </h4>
// //         <p className="text-center text-sm text-gray-600 mb-6">
// //           Start managing your case efficiently with our AI-powered tools.
// //         </p>

// //         <div className="grid grid-cols-3 gap-6">
// //           {[
// //             { icon: Upload, label: "Upload Documents" },
// //             { icon: Calendar, label: "Schedule Events" },
// //             { icon: Sparkles, label: "AI Analysis" },
// //           ].map(({ icon: Icon, label }) => (
// //             <div key={label} className="text-center">
// //               <div className="flex justify-center mb-3">
// //                 <div className="w-12 h-12 bg-white border border-gray-200 rounded-lg flex items-center justify-center shadow-sm">
// //                   <Icon className="w-6 h-6 text-[#9CDFE1]" />
// //                 </div>
// //               </div>
// //               <p className="text-sm font-medium text-gray-900">{label}</p>
// //             </div>
// //           ))}
// //         </div>
// //       </div>
// //     </div>
// //   );
// // };



// // ReviewStep Component (Updated)
// const ReviewStep = ({ caseData, onBack }) => {
//   const [isCreating, setIsCreating] = useState(false);
//   const [isCreated, setIsCreated] = useState(false);
//   const [createdCase, setCreatedCase] = useState(null);
//   const [error, setError] = useState(null);

//   const handleCreateCase = async () => {
//     setIsCreating(true);
//     setError(null);

//     try {
//       const token = 
//         localStorage.getItem("authToken") ||
//         localStorage.getItem("token") ||
//         localStorage.getItem("access_token") ||
//         localStorage.getItem("jwt") ||
//         sessionStorage.getItem("authToken") ||
//         sessionStorage.getItem("token");
      
//       console.log("Available localStorage keys:", Object.keys(localStorage));
//       console.log("Token found:", token ? "Yes" : "No");
      
//       if (!token) {
//         throw new Error("Authentication token not found. Please login again.");
//       }

//       const requestBody = {
//         case_title: caseData.caseTitle || "Untitled Case",
//         case_number: caseData.caseNumber || null,
//         filing_date: caseData.filingDate || new Date().toISOString(),
//         case_type: caseData.caseType || caseData.category || "Criminal",
//         sub_type: caseData.subType || null,
//         court_name: caseData.courtName || "Delhi High Court",
//         court_level: caseData.courtLevel || null,
//         bench_division: caseData.benchDivision || null,
//         jurisdiction: caseData.jurisdiction || null,
//         state: caseData.state || null,
//         judges: caseData.judges || null,
//         court_room_no: caseData.courtRoomNo || null,
//         petitioners: caseData.petitioners || null,
//         respondents: caseData.respondents || null,
//         category_type: caseData.categoryType || null,
//         primary_category: caseData.primaryCategory || null,
//         sub_category: caseData.subCategory || null,
//         complexity: caseData.complexity || null,
//         monetary_value: caseData.monetaryValue || null,
//         priority_level: caseData.priorityLevel || null,
//         status: caseData.currentStatus || "Active",
//       };

//       const response = await fetch("http://localhost:5000/docs/create", {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           "Authorization": `Bearer ${token}`,
//         },
//         body: JSON.stringify(requestBody),
//       });

//       const data = await response.json();

//       if (!response.ok) {
//         throw new Error(data.error || `Server error: ${response.status}`);
//       }

//       setCreatedCase(data.case);
//       setIsCreated(true);
      
//       console.log("✅ Case created successfully:", data);
//     } catch (err) {
//       console.error("❌ Error creating case:", err);
//       setError(err.message || "Failed to create case. Please try again.");
//     } finally {
//       setIsCreating(false);
//     }
//   };

//   const handleCreateAnother = () => {
//     setIsCreated(false);
//     setCreatedCase(null);
//     setError(null);
//     if (onBack) {
//       onBack();
//     }
//   };

//   const displayCaseNumber = createdCase?.case_number || 
//     caseData.caseNumber || 
//     `CRL/${Math.floor(Math.random() * 1000)}/2025`;

//   // Review screen (before creation)
//   if (!isCreated) {
//     return (
//       <div>
//         {/* Review Header */}
//         <div className="text-center mb-8">
//           <h2 className="text-2xl font-bold text-gray-900 mb-3">
//             Review Case Details
//           </h2>
//           <p className="text-sm text-gray-600">
//             Please review the case information before creating.
//           </p>
//         </div>

//         {/* Error Message */}
//         {error && (
//           <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
//             <p className="text-sm text-red-800">{error}</p>
//           </div>
//         )}

//         {/* Summary Card */}
//         <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
//           <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
//             <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
//             <div>
//               <h3 className="text-lg font-semibold text-gray-900">
//                 Case Summary
//               </h3>
//               <p className="text-xs text-gray-500">
//                 Key details for your case
//               </p>
//             </div>
//           </div>

//           <div className="grid grid-cols-2 gap-6">
//             {/* Left Column */}
//             <div className="space-y-4">
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Case Title</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.caseTitle || "Rajesh Kumar Singh vs State"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Court</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.courtName || caseData.courtLevel || "Delhi High Court"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Status</p>
//                 <p className="text-sm font-medium text-green-600 flex items-center">
//                   <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
//                   {caseData.currentStatus || "Active"}
//                 </p>
//               </div>
//             </div>

//             {/* Right Column */}
//             <div className="space-y-4">
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Case Number</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.caseNumber || "To be assigned"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Filing Date</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.filingDate
//                     ? new Date(caseData.filingDate).toLocaleDateString("en-GB", {
//                         day: "2-digit",
//                         month: "short",
//                         year: "numeric",
//                       })
//                     : "15-Jan-2025"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Case Type</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.caseType || caseData.category || "Criminal"}
//                 </p>
//               </div>
//             </div>
//           </div>

//           {/* Action Buttons inside card */}
//           <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
//             <button
//               onClick={onBack}
//               disabled={isCreating}
//               className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Back
//             </button>
//             <button
//               onClick={handleCreateCase}
//               disabled={isCreating}
//               className="flex-1 px-4 py-3 bg-[#9CDFE1] text-white rounded-md hover:bg-[#87D8DB] transition-colors flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               {isCreating ? (
//                 <>
//                   <Loader2 className="w-4 h-4 mr-2 animate-spin" />
//                   Creating Case...
//                 </>
//               ) : (
//                 <>
//                   <CheckCircle className="w-4 h-4 mr-2" />
//                   Create Case
//                 </>
//               )}
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   }

//   // Success screen
//   return (
//     <div>
//       {/* Success Icon */}
//       <div className="flex justify-center mb-6">
//         <div className="w-16 h-16 bg-[#9CDFE1] rounded-full flex items-center justify-center">
//           <CheckCircle className="w-10 h-10 text-white" />
//         </div>
//       </div>

//       {/* Message */}
//       <div className="text-center mb-8">
//         <h2 className="text-2xl font-bold text-gray-900 mb-3">
//           Case Created Successfully!
//         </h2>
//         <p className="text-sm text-gray-600 mb-2">
//           Your case has been created and saved to your dashboard.{" "}
//           <strong>{displayCaseNumber}</strong>
//         </p>
//         <p className="text-sm text-gray-600">
//           You're all set to start managing your case with NexIntel AI.
//         </p>
//       </div>

//       {/* Summary Card */}
//       <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6 shadow-sm">
//         <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
//           <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
//           <div>
//             <h3 className="text-lg font-semibold text-gray-900">
//               Case Summary
//             </h3>
//             <p className="text-xs text-gray-500">
//               Key details for your newly created case
//             </p>
//           </div>
//         </div>

//         <div className="grid grid-cols-2 gap-6">
//           {/* Left Column */}
//           <div className="space-y-4">
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Title</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.case_title || caseData.caseTitle || "Rajesh Kumar Singh vs State"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Court</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.court_name || caseData.courtName || "Delhi High Court"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Status</p>
//               <p className="text-sm font-medium text-green-600 flex items-center">
//                 <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
//                 {createdCase?.status || caseData.currentStatus || "Active"}
//               </p>
//             </div>
//           </div>

//           {/* Right Column */}
//           <div className="space-y-4">
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Number</p>
//               <p className="text-sm font-medium text-gray-900">{displayCaseNumber}</p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Filing Date</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.filing_date || caseData.filingDate
//                   ? new Date(createdCase?.filing_date || caseData.filingDate).toLocaleDateString("en-GB", {
//                       day: "2-digit",
//                       month: "short",
//                       year: "numeric",
//                     })
//                   : "15-Jan-2025"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Type</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.case_type || caseData.caseType || "Criminal"}
//               </p>
//             </div>
//           </div>
//         </div>

//         {/* Buttons inside success card */}
//         <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
//           <button
//             onClick={() => alert('Navigate to case details')}
//             className="flex-1 px-4 py-3 bg-[#9CDFE1] text-white rounded-md hover:bg-[#87D8DB] transition-colors flex items-center justify-center text-sm font-medium"
//           >
//             <FolderOpen className="w-4 h-4 mr-2" />
//             Go to Case Details
//           </button>
//           <button
//             onClick={handleCreateAnother}
//             className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center text-sm font-medium"
//           >
//             <span className="mr-2 text-lg">+</span> Create Another Case
//           </button>
//         </div>
//       </div>

//       {/* Next Steps Section */}
//       <div className="bg-gray-50 rounded-lg p-6">
//         <h4 className="text-center text-base font-semibold text-gray-900 mb-2">
//           What's Next?
//         </h4>
//         <p className="text-center text-sm text-gray-600 mb-6">
//           Start managing your case efficiently with our AI-powered tools.
//         </p>

//         <div className="grid grid-cols-3 gap-6">
//           {[
//             { icon: Upload, label: "Upload Documents" },
//             { icon: Calendar, label: "Schedule Events" },
//             { icon: Sparkles, label: "AI Analysis" },
//           ].map(({ icon: Icon, label }) => (
//             <div key={label} className="text-center">
//               <div className="flex justify-center mb-3">
//                 <div className="w-12 h-12 bg-white border border-gray-200 rounded-lg flex items-center justify-center shadow-sm">
//                   <Icon className="w-6 h-6 text-[#9CDFE1]" />
//                 </div>
//               </div>
//               <p className="text-sm font-medium text-gray-900">{label}</p>
//             </div>
//           ))}
//         </div>
//       </div>
//     </div>
//   );
// };


// export default ReviewStep;



// import React, { useState } from "react";
// import { useNavigate } from "react-router-dom";
// import {
//   CheckCircle,
//   FolderOpen,
//   Upload,
//   Calendar,
//   Sparkles,
//   Loader2,
// } from "lucide-react";

// const ReviewStep = ({ caseData, onBack, onResetToFirstStep }) => {
//   const navigate = useNavigate();
//   const [isCreating, setIsCreating] = useState(false);
//   const [isCreated, setIsCreated] = useState(false);
//   const [createdCase, setCreatedCase] = useState(null);
//   const [error, setError] = useState(null);

//   const handleCreateCase = async () => {
//     setIsCreating(true);
//     setError(null);

//     try {
//       const token = 
//         localStorage.getItem("authToken") ||
//         localStorage.getItem("token") ||
//         localStorage.getItem("access_token") ||
//         localStorage.getItem("jwt") ||
//         sessionStorage.getItem("authToken") ||
//         sessionStorage.getItem("token");
      
//       console.log("Available localStorage keys:", Object.keys(localStorage));
//       console.log("Token found:", token ? "Yes" : "No");
      
//       if (!token) {
//         throw new Error("Authentication token not found. Please login again.");
//       }

//       const requestBody = {
//         case_title: caseData.caseTitle || "Untitled Case",
//         case_number: caseData.caseNumber || null,
//         filing_date: caseData.filingDate || new Date().toISOString(),
//         case_type: caseData.caseType || caseData.category || "Criminal",
//         sub_type: caseData.subType || null,
//         court_name: caseData.courtName || "Delhi High Court",
//         court_level: caseData.courtLevel || null,
//         bench_division: caseData.benchDivision || null,
//         jurisdiction: caseData.jurisdiction || null,
//         state: caseData.state || null,
//         judges: caseData.judges || null,
//         court_room_no: caseData.courtRoomNo || null,
//         petitioners: caseData.petitioners || null,
//         respondents: caseData.respondents || null,
//         category_type: caseData.categoryType || null,
//         primary_category: caseData.primaryCategory || null,
//         sub_category: caseData.subCategory || null,
//         complexity: caseData.complexity || null,
//         monetary_value: caseData.monetaryValue || null,
//         priority_level: caseData.priorityLevel || null,
//         status: caseData.currentStatus || "Active",
//       };

//       const response = await fetch("http://localhost:5000/docs/create", {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           "Authorization": `Bearer ${token}`,
//         },
//         body: JSON.stringify(requestBody),
//       });

//       const data = await response.json();

//       if (!response.ok) {
//         throw new Error(data.error || `Server error: ${response.status}`);
//       }

//       setCreatedCase(data.case);
//       setIsCreated(true);
      
//       console.log("✅ Case created successfully:", data);
//     } catch (err) {
//       console.error("❌ Error creating case:", err);
//       setError(err.message || "Failed to create case. Please try again.");
//     } finally {
//       setIsCreating(false);
//     }
//   };

//   const handleGoToCaseDetails = () => {
//     if (createdCase && createdCase.id) {
//       // Navigate to CaseDetailView page
//       navigate(`/cases/${createdCase.id}`, { 
//         state: { case: createdCase } 
//       });
//     } else {
//       console.error('No case ID available for navigation');
//       alert('Case ID not available. Please try again.');
//     }
//   };

//   const handleCreateAnother = () => {
//     // Reset to first step (OverviewStep)
//     setIsCreated(false);
//     setCreatedCase(null);
//     setError(null);
    
//     // Call parent function to reset everything
//     if (onResetToFirstStep) {
//       onResetToFirstStep();
//     }
//   };

//   const displayCaseNumber = createdCase?.case_number || 
//     caseData.caseNumber || 
//     `CRL/${Math.floor(Math.random() * 1000)}/2025`;

//   // Review screen (before creation)
//   if (!isCreated) {
//     return (
//       <div>
//         {/* Review Header */}
//         <div className="text-center mb-8">
//           <h2 className="text-2xl font-bold text-gray-900 mb-3">
//             Review Case Details
//           </h2>
//           <p className="text-sm text-gray-600">
//             Please review the case information before creating.
//           </p>
//         </div>

//         {/* Error Message */}
//         {error && (
//           <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
//             <p className="text-sm text-red-800">{error}</p>
//           </div>
//         )}

//         {/* Summary Card */}
//         <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
//           <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
//             <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
//             <div>
//               <h3 className="text-lg font-semibold text-gray-900">
//                 Case Information
//               </h3>
//               <p className="text-xs text-gray-500">
//                 Key details for your case
//               </p>
//             </div>
//           </div>

//           <div className="grid grid-cols-2 gap-6">
//             {/* Left Column */}
//             <div className="space-y-4">
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Case Title</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.caseTitle || "Rajesh Kumar Singh vs State"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Court</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.courtName || caseData.courtLevel || "Delhi High Court"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Status</p>
//                 <p className="text-sm font-medium text-green-600 flex items-center">
//                   <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
//                   {caseData.currentStatus || "Active"}
//                 </p>
//               </div>
//             </div>

//             {/* Right Column */}
//             <div className="space-y-4">
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Case Number</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.caseNumber || "To be assigned"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Filing Date</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.filingDate
//                     ? new Date(caseData.filingDate).toLocaleDateString("en-GB", {
//                         day: "2-digit",
//                         month: "short",
//                         year: "numeric",
//                       })
//                     : "15-Jan-2025"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Case Type</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.caseType || caseData.category || "Criminal"}
//                 </p>
//               </div>
//             </div>
//           </div>

//           {/* Action Buttons inside card */}
//           <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
//             <button
//               onClick={onBack}
//               disabled={isCreating}
//               className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Back
//             </button>
//             <button
//               onClick={handleCreateCase}
//               disabled={isCreating}
//               className="flex-1 px-4 py-3 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition-colors flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               {isCreating ? (
//                 <>
//                   <Loader2 className="w-4 h-4 mr-2 animate-spin" />
//                   Creating Case...
//                 </>
//               ) : (
//                 <>
//                   <CheckCircle className="w-4 h-4 mr-2" />
//                   Create Case
//                 </>
//               )}
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   }

//   // Success screen
//   return (
//     <div>
//       {/* Success Icon */}
//       <div className="flex justify-center mb-6">
//         <div className="w-16 h-16 bg-[#9CDFE1] rounded-full flex items-center justify-center">
//           <CheckCircle className="w-10 h-10 text-white" />
//         </div>
//       </div>

//       {/* Message */}
//       <div className="text-center mb-8">
//         <h2 className="text-2xl font-bold text-gray-900 mb-3">
//           Case Created Successfully!
//         </h2>
//         <p className="text-sm text-gray-600 mb-2">
//           Your case has been created and saved to your dashboard.{" "}
//           <strong>{displayCaseNumber}</strong>
//         </p>
//         <p className="text-sm text-gray-600">
//           You're all set to start managing your case with JuriNex.
//         </p>
//       </div>

//       {/* Summary Card */}
//       <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
//         <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
//           <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
//           <div>
//             <h3 className="text-lg font-semibold text-gray-900">
//               Case Information
//             </h3>
//             <p className="text-xs text-gray-500">
//               Key details for your newly created case
//             </p>
//           </div>
//         </div>

//         <div className="grid grid-cols-2 gap-6">
//           {/* Left Column */}
//           <div className="space-y-4">
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Title</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.case_title || caseData.caseTitle || "Rajesh Kumar Singh vs State"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Court</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.court_name || caseData.courtName || "Delhi High Court"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Status</p>
//               <p className="text-sm font-medium text-green-600 flex items-center">
//                 <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
//                 {createdCase?.status || caseData.currentStatus || "Active"}
//               </p>
//             </div>
//           </div>

//           {/* Right Column */}
//           <div className="space-y-4">
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Number</p>
//               <p className="text-sm font-medium text-gray-900">{displayCaseNumber}</p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Filing Date</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.filing_date || caseData.filingDate
//                   ? new Date(createdCase?.filing_date || caseData.filingDate).toLocaleDateString("en-GB", {
//                       day: "2-digit",
//                       month: "short",
//                       year: "numeric",
//                     })
//                   : "15-Jan-2025"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Type</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.case_type || caseData.caseType || "Criminal"}
//               </p>
//             </div>
//           </div>
//         </div>

//         {/* Buttons inside success card */}
//         <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
//           <button
//             onClick={handleGoToCaseDetails}
//             className="flex-1 px-4 py-3 bg-[#9CDFE1] text-white rounded-md hover:bg-[#87D8DB] transition-colors flex items-center justify-center text-sm font-medium"
//           >
//             <FolderOpen className="w-4 h-4 mr-2" />
//             Go to Case Details
//           </button>
//           <button
//             onClick={handleCreateAnother}
//             className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center text-sm font-medium"
//           >
//             <span className="mr-2 text-lg">+</span> Create Another Case
//           </button>
//         </div>
//       </div>

//       {/* Next Steps Section */}
//       <div className="bg-gray-50 rounded-lg p-6 mt-6">
//         <h4 className="text-center text-base font-semibold text-gray-900 mb-2">
//           What's Next?
//         </h4>
//         <p className="text-center text-sm text-gray-600 mb-6">
//           Start managing your case efficiently with our AI-powered tools.
//         </p>

//         <div className="grid grid-cols-3 gap-6">
//           {[
//             { icon: Upload, label: "Upload Documents" },
//             { icon: Calendar, label: "Schedule Events" },
//             { icon: Sparkles, label: "AI Analysis" },
//           ].map(({ icon: Icon, label }) => (
//             <div key={label} className="text-center">
//               <div className="flex justify-center mb-3">
//                 <div className="w-12 h-12 bg-white border border-gray-200 rounded-lg flex items-center justify-center shadow-sm">
//                   <Icon className="w-6 h-6 text-[#9CDFE1]" />
//                 </div>
//               </div>
//               <p className="text-sm font-medium text-gray-900">{label}</p>
//             </div>
//           ))}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default ReviewStep;



// import React, { useState } from "react";
// import { useNavigate } from "react-router-dom";
// import {
//   CheckCircle,
//   FolderOpen,
//   Upload,
//   Calendar,
//   Sparkles,
//   Loader2,
// } from "lucide-react";

// const ReviewStep = ({ caseData, onBack, onResetToFirstStep, onComplete }) => {
//   const navigate = useNavigate();
//   const [isCreating, setIsCreating] = useState(false);
//   const [isCreated, setIsCreated] = useState(false);
//   const [createdCase, setCreatedCase] = useState(null);
//   const [error, setError] = useState(null);

//   const handleCreateCase = async () => {
//     setIsCreating(true);
//     setError(null);

//     try {
//       const token = 
//         localStorage.getItem("authToken") ||
//         localStorage.getItem("token") ||
//         localStorage.getItem("access_token") ||
//         localStorage.getItem("jwt") ||
//         sessionStorage.getItem("authToken") ||
//         sessionStorage.getItem("token");

//       if (!token) {
//         throw new Error("Authentication token not found. Please login again.");
//       }

//       const requestBody = {
//         case_title: caseData.caseTitle || "Untitled Case",
//         case_number: caseData.caseNumber || null,
//         filing_date: caseData.filingDate || new Date().toISOString(),
//         case_type: caseData.caseType || caseData.category || "Criminal",
//         sub_type: caseData.subType || null,
//         court_name: caseData.courtName || "Delhi High Court",
//         court_level: caseData.courtLevel || null,
//         bench_division: caseData.benchDivision || null,
//         jurisdiction: caseData.jurisdiction || null,
//         state: caseData.state || null,
//         judges: caseData.judges || null,
//         court_room_no: caseData.courtRoomNo || null,
//         petitioners: caseData.petitioners || null,
//         respondents: caseData.respondents || null,
//         category_type: caseData.categoryType || null,
//         primary_category: caseData.primaryCategory || null,
//         sub_category: caseData.subCategory || null,
//         complexity: caseData.complexity || null,
//         monetary_value: caseData.monetaryValue || null,
//         priority_level: caseData.priorityLevel || null,
//         status: caseData.currentStatus || "Active",
//       };

//       const response = await fetch("http://localhost:5000/docs/create", {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           "Authorization": `Bearer ${token}`,
//         },
//         body: JSON.stringify(requestBody),
//       });

//       const data = await response.json();

//       if (!response.ok) {
//         throw new Error(data.error || `Server error: ${response.status}`);
//       }

//       setCreatedCase(data.case);
//       setIsCreated(true);

//       // THIS LINE IS CRITICAL — Deletes draft permanently
//       if (onComplete) {
//         onComplete(data.case);
//       }

//       console.log("Case created successfully & draft will be deleted:", data.case);

//     } catch (err) {
//       console.error("Error creating case:", err);
//       setError(err.message || "Failed to create case. Please try again.");
//     } finally {
//       setIsCreating(false);
//     }
//   };

//   const handleGoToCaseDetails = () => {
//     if (createdCase && createdCase.id) {
//       navigate(`/cases/${createdCase.id}`, { state: { case: createdCase } });
//     }
//   };

//   const handleCreateAnother = () => {
//     setIsCreated(false);
//     setCreatedCase(null);
//     setError(null);
//     onResetToFirstStep();
//   };

//   const displayCaseNumber = createdCase?.case_number || 
//     caseData.caseNumber || 
//     `CRL/${Math.floor(Math.random() * 1000)}/2025`;

//   // Before Creation — Your Original Review UI
//   if (!isCreated) {
//     return (
//       <div>
//         <div className="text-center mb-8">
//           <h2 className="text-2xl font-bold text-gray-900 mb-3">
//             Review Case Details
//           </h2>
//           <p className="text-sm text-gray-600">
//             Please review the case information before creating.
//           </p>
//         </div>

//         {error && (
//           <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
//             <p className="text-sm text-red-800">{error}</p>
//           </div>
//         )}

//         <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
//           <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
//             <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
//             <div>
//               <h3 className="text-lg font-semibold text-gray-900">
//                 Case Information
//               </h3>
//               <p className="text-xs text-gray-500">
//                 Key details for your case
//               </p>
//             </div>
//           </div>

//           <div className="grid grid-cols-2 gap-6">
//             <div className="space-y-4">
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Case Title</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.caseTitle || "Rajesh Kumar Singh vs State"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Court</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.courtName || caseData.courtLevel || "Delhi High Court"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Status</p>
//                 <p className="text-sm font-medium text-green-600 flex items-center">
//                   <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
//                   {caseData.currentStatus || "Active"}
//                 </p>
//               </div>
//             </div>

//             <div className="space-y-4">
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Case Number</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.caseNumber || "To be assigned"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Filing Date</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.filingDate
//                     ? new Date(caseData.filingDate).toLocaleDateString("en-GB", {
//                         day: "2-digit",
//                         month: "short",
//                         year: "numeric",
//                       })
//                     : "15-Jan-2025"}
//                 </p>
//               </div>
//               <div>
//                 <p className="text-xs text-gray-500 mb-1">Case Type</p>
//                 <p className="text-sm font-medium text-gray-900">
//                   {caseData.caseType || caseData.category || "Criminal"}
//                 </p>
//               </div>
//             </div>
//           </div>

//           <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
//             <button
//               onClick={onBack}
//               disabled={isCreating}
//               className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               Back
//             </button>
//             <button
//               onClick={handleCreateCase}
//               disabled={isCreating}
//               className="flex-1 px-4 py-3 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition-colors flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
//             >
//               {isCreating ? (
//                 <>
//                   <Loader2 className="w-4 h-4 mr-2 animate-spin" />
//                   Creating Case...
//                 </>
//               ) : (
//                 <>
//                   <CheckCircle className="w-4 h-4 mr-2" />
//                   Create Case
//                 </>
//               )}
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   }

//   // Success Screen — Your Original Design 100% Preserved
//   return (
//     <div>
//       <div className="flex justify-center mb-6">
//         <div className="w-16 h-16 bg-[#9CDFE1] rounded-full flex items-center justify-center">
//           <CheckCircle className="w-10 h-10 text-white" />
//         </div>
//       </div>

//       <div className="text-center mb-8">
//         <h2 className="text-2xl font-bold text-gray-900 mb-3">
//           Case Created Successfully!
//         </h2>
//         <p className="text-sm text-gray-600 mb-2">
//           Your case has been created and saved to your dashboard.{" "}
//           <strong>{displayCaseNumber}</strong>
//         </p>
//         <p className="text-sm text-gray-600">
//           You're all set to start managing your case with JuriNex.
//         </p>
//       </div>

//       <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
//         <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
//           <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
//           <div>
//             <h3 className="text-lg font-semibold text-gray-900">
//               Case Information
//             </h3>
//             <p className="text-xs text-gray-500">
//               Key details for your newly created case
//             </p>
//           </div>
//         </div>

//         <div className="grid grid-cols-2 gap-6">
//           <div className="space-y-4">
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Title</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.case_title || caseData.caseTitle || "Rajesh Kumar Singh vs State"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Court</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.court_name || caseData.courtName || "Delhi High Court"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Status</p>
//               <p className="text-sm font-medium text-green-600 flex items-center">
//                 <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
//                 {createdCase?.status || caseData.currentStatus || "Active"}
//               </p>
//             </div>
//           </div>

//           <div className="space-y-4">
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Number</p>
//               <p className="text-sm font-medium text-gray-900">{displayCaseNumber}</p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Filing Date</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.filing_date || caseData.filingDate
//                   ? new Date(createdCase?.filing_date || caseData.filingDate).toLocaleDateString("en-GB", {
//                       day: "2-digit",
//                       month: "short",
//                       year: "numeric",
//                     })
//                   : "15-Jan-2025"}
//               </p>
//             </div>
//             <div>
//               <p className="text-xs text-gray-500 mb-1">Case Type</p>
//               <p className="text-sm font-medium text-gray-900">
//                 {createdCase?.case_type || caseData.caseType || "Criminal"}
//               </p>
//             </div>
//           </div>
//         </div>

//         <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
//           <button
//             onClick={handleGoToCaseDetails}
//             className="flex-1 px-4 py-3 bg-[#9CDFE1] text-white rounded-md hover:bg-[#87D8DB] transition-colors flex items-center justify-center text-sm font-medium"
//           >
//             <FolderOpen className="w-4 h-4 mr-2" />
//             Go to Case Details
//           </button>
//           <button
//             onClick={handleCreateAnother}
//             className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center text-sm font-medium"
//           >
//             <span className="mr-2 text-lg">+</span> Create Another Case
//           </button>
//         </div>
//       </div>

//       <div className="bg-gray-50 rounded-lg p-6 mt-6">
//         <h4 className="text-center text-base font-semibold text-gray-900 mb-2">
//           What's Next?
//         </h4>
//         <p className="text-center text-sm text-gray-600 mb-6">
//           Start managing your case efficiently with our AI-powered tools.
//         </p>

//         <div className="grid grid-cols-3 gap-6">
//           {[
//             { icon: Upload, label: "Upload Documents" },
//             { icon: Calendar, label: "Schedule Events" },
//             { icon: Sparkles, label: "AI Analysis" },
//           ].map(({ icon: Icon, label }) => (
//             <div key={label} className="text-center">
//               <div className="flex justify-center mb-3">
//                 <div className="w-12 h-12 bg-white border border-gray-200 rounded-lg flex items-center justify-center shadow-sm">
//                   <Icon className="w-6 h-6 text-[#9CDFE1]" />
//                 </div>
//               </div>
//               <p className="text-sm font-medium text-gray-900">{label}</p>
//             </div>
//           ))}
//         </div>
//       </div>
//     </div>
//   );
// };

// export default ReviewStep;


import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle,
  FolderOpen,
  Upload,
  Calendar,
  Sparkles,
  Loader2,
} from "lucide-react";

const ReviewStep = ({ caseData, onBack, onResetToFirstStep, onComplete }) => {
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const [isCreated, setIsCreated] = useState(false);
  const [createdCase, setCreatedCase] = useState(null);
  const [error, setError] = useState(null);

  const handleCreateCase = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const token = 
        localStorage.getItem("authToken") ||
        localStorage.getItem("token") ||
        localStorage.getItem("access_token") ||
        localStorage.getItem("jwt") ||
        sessionStorage.getItem("authToken") ||
        sessionStorage.getItem("token");

      if (!token) {
        throw new Error("Authentication token not found. Please login again.");
      }

      const requestBody = {
        case_title: caseData.caseTitle || "Untitled Case",
        case_number: caseData.caseNumber || null,
        filing_date: caseData.filingDate || new Date().toISOString(),
        case_type: caseData.caseType || caseData.category || "Criminal",
        sub_type: caseData.subType || null,
        court_name: caseData.courtName || "Delhi High Court",
        court_level: caseData.courtLevel || null,
        bench_division: caseData.benchDivision || null,
        jurisdiction: caseData.jurisdiction || null,
        state: caseData.state || null,
        judges: caseData.judges || null,
        court_room_no: caseData.courtRoomNo || null,
        petitioners: caseData.petitioners || null,
        respondents: caseData.respondents || null,
        category_type: caseData.categoryType || null,
        primary_category: caseData.primaryCategory || null,
        sub_category: caseData.subCategory || null,
        complexity: caseData.complexity || null,
        monetary_value: caseData.monetaryValue || null,
        priority_level: caseData.priorityLevel || null,
        status: caseData.currentStatus || "Active",
      };

      const response = await fetch("http://localhost:5000/docs/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server error: ${response.status}`);
      }

      setCreatedCase(data.case);
      setIsCreated(true);

      // THIS LINE IS CRITICAL — Deletes draft permanently
      if (onComplete) {
        onComplete(data.case);
      }

      console.log("Case created successfully & draft will be deleted:", data.case);

    } catch (err) {
      console.error("Error creating case:", err);
      setError(err.message || "Failed to create case. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleGoToCaseDetails = () => {
    if (createdCase && createdCase.id) {
      navigate(`/cases/${createdCase.id}`, { state: { case: createdCase } });
    }
  };

  const handleCreateAnother = () => {
    setIsCreated(false);
    setCreatedCase(null);
    setError(null);
    onResetToFirstStep();
  };

  const displayCaseNumber = createdCase?.case_number || 
    caseData.caseNumber || 
    `CRL/${Math.floor(Math.random() * 1000)}/2025`;

  // Before Creation — Your Original Review UI
  if (!isCreated) {
    return (
      <div>
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Review Case Details
          </h2>
          <p className="text-sm text-gray-600">
            Please review the case information before creating.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
          <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
            <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Case Information
              </h3>
              <p className="text-xs text-gray-500">
                Key details for your case
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Case Title</p>
                <p className="text-sm font-medium text-gray-900">
                  {caseData.caseTitle || "Rajesh Kumar Singh vs State"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Court</p>
                <p className="text-sm font-medium text-gray-900">
                  {caseData.courtName || caseData.courtLevel || "Delhi High Court"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Status</p>
                <p className="text-sm font-medium text-green-600 flex items-center">
                  <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                  {caseData.currentStatus || "Active"}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Case Number</p>
                <p className="text-sm font-medium text-gray-900">
                  {caseData.caseNumber || "To be assigned"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Filing Date</p>
                <p className="text-sm font-medium text-gray-900">
                  {caseData.filingDate
                    ? new Date(caseData.filingDate).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    : "15-Jan-2025"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Case Type</p>
                <p className="text-sm font-medium text-gray-900">
                  {caseData.caseType || caseData.category || "Criminal"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={onBack}
              disabled={isCreating}
              className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Back
            </button>
            <button
              onClick={handleCreateCase}
              disabled={isCreating}
              className="flex-1 px-4 py-3 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA89E] transition-colors flex items-center justify-center text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating Case...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Create Case
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Success Screen — Your Original Design 100% Preserved
  return (
    <div>
      <div className="flex justify-center mb-6">
        <div className="w-16 h-16 bg-[#9CDFE1] rounded-full flex items-center justify-center">
          <CheckCircle className="w-10 h-10 text-white" />
        </div>
      </div>

      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">
          Case Created Successfully!
        </h2>
        <p className="text-sm text-gray-600 mb-2">
          Your case has been created and saved to your dashboard.{" "}
          <strong>{displayCaseNumber}</strong>
        </p>
        <p className="text-sm text-gray-600">
          You're all set to start managing your case with JuriNex.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <div className="flex items-center mb-4 pb-4 border-b border-gray-200">
          <FolderOpen className="w-5 h-5 mr-2 text-[#9CDFE1]" />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Case Information
            </h3>
            <p className="text-xs text-gray-500">
              Key details for your newly created case
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Case Title</p>
              <p className="text-sm font-medium text-gray-900">
                {createdCase?.case_title || caseData.caseTitle || "Rajesh Kumar Singh vs State"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Court</p>
              <p className="text-sm font-medium text-gray-900">
                {createdCase?.court_name || caseData.courtName || "Delhi High Court"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Status</p>
              <p className="text-sm font-medium text-green-600 flex items-center">
                <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                {createdCase?.status || caseData.currentStatus || "Active"}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Case Number</p>
              <p className="text-sm font-medium text-gray-900">{displayCaseNumber}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Filing Date</p>
              <p className="text-sm font-medium text-gray-900">
                {createdCase?.filing_date || caseData.filingDate
                  ? new Date(createdCase?.filing_date || caseData.filingDate).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "15-Jan-2025"}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Case Type</p>
              <p className="text-sm font-medium text-gray-900">
                {createdCase?.case_type || caseData.caseType || "Criminal"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
          <button
            onClick={handleGoToCaseDetails}
            className="flex-1 px-4 py-3 bg-[#9CDFE1] text-white rounded-md hover:bg-[#87D8DB] transition-colors flex items-center justify-center text-sm font-medium"
          >
            <FolderOpen className="w-4 h-4 mr-2" />
            Go to Case Details
          </button>
          <button
            onClick={handleCreateAnother}
            className="flex-1 px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center text-sm font-medium"
          >
            <span className="mr-2 text-lg">+</span> Create Another Case
          </button>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-6 mt-6">
        <h4 className="text-center text-base font-semibold text-gray-900 mb-2">
          What's Next?
        </h4>
        <p className="text-center text-sm text-gray-600 mb-6">
          Start managing your case efficiently with our AI-powered tools.
        </p>

        <div className="grid grid-cols-3 gap-6">
          {[
            { icon: Upload, label: "Upload Documents" },
            { icon: Calendar, label: "Schedule Events" },
            { icon: Sparkles, label: "AI Analysis" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="text-center">
              <div className="flex justify-center mb-3">
                <div className="w-12 h-12 bg-white border border-gray-200 rounded-lg flex items-center justify-center shadow-sm">
                  <Icon className="w-6 h-6 text-[#9CDFE1]" />
                </div>
              </div>
              <p className="text-sm font-medium text-gray-900">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ReviewStep;