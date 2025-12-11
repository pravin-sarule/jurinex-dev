// import React from "react";
// import {
//   FileText,
//   Calendar,
//   Users,
//   FileCheck,
//   Lightbulb,
//   Paperclip,
//   CheckCircle,
// } from "lucide-react";

// const CaseDetailsPage = () => {
//   const caseInfo = {
//     caseNo: "CRL.A 1234/2025",
//     caseType: "Criminal",
//     filingDate: "2025-01-15",
//     courtBranch: "Delhi High Court",
//   };

//   const parties = {
//     petitioner: "Rajesh Kumar Singh",
//     respondent: "State of Delhi & Ors.",
//     advocate: "Adv. Priya Sharma",
//   };

//   const timeline = {
//     filingDate: "2025-01-15",
//     firstHearing: "2025-02-10",
//     newHearing: "2025-03-15",
//   };

//   const documents = [
//     { type: "Petitions", count: 1 },
//     { type: "Orders", count: 2 },
//     { type: "Annexures", count: 8 },
//     { type: "Evidence Files", count: 3 },
//   ];

//   const keyPoints = {
//     respondent:
//       "Challenge to detention order under preventive detention laws. Relief sought includes quashing of detention order and immediate release of petitioner.",
//   };

//   const uploadedDocs = [
//     { name: "Petition.pdf", date: "2025-10-01", status: "Processed" },
//     { name: "Annexure_A.docx", date: "2025-10-01", status: "Processed" },
//     { name: "Evidence_01.jpg", date: "2025-10-01", status: "OCR Done" },
//     { name: "CourtOrder_Sept.pdf", date: "2025-10-01", status: "Processed" },
//   ];

//   return (
//     <div className="min-h-screen bg-[#f8f9fa] py-10 px-6">
//       <div className="max-w-6xl mx-auto">
//         <h1 className="text-xl font-semibold text-gray-900 text-center mb-1">
//           Customize Your Legal Workspace
//         </h1>
//         <p className="text-center text-gray-500 mb-10">
//           Tell us a bit about your work so we can personalize your experience.
//         </p>

//         <div className="grid grid-cols-3 gap-8">
//           {/* LEFT SIDE */}
//           <div className="col-span-2 space-y-6">
//             {/* Case Info */}
//             <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
//               <div className="flex items-center justify-between mb-4">
//                 <h2 className="flex items-center text-gray-900 font-semibold">
//                   <FileText className="w-5 h-5 mr-2 text-[#21C1B6]" />
//                   Case Information
//                 </h2>
//                 <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
//                   90% Confidence
//                 </span>
//               </div>
//               <div className="grid grid-cols-2 gap-4">
//                 <input
//                   type="text"
//                   value={caseInfo.caseNo}
//                   readOnly
//                   className="border rounded-md px-3 py-2 text-sm w-full"
//                 />
//                 <input
//                   type="text"
//                   value={caseInfo.caseType}
//                   readOnly
//                   className="border rounded-md px-3 py-2 text-sm w-full"
//                 />
//                 <input
//                   type="date"
//                   value={caseInfo.filingDate}
//                   readOnly
//                   className="border rounded-md px-3 py-2 text-sm w-full"
//                 />
//                 <input
//                   type="text"
//                   value={caseInfo.courtBranch}
//                   readOnly
//                   className="border rounded-md px-3 py-2 text-sm w-full"
//                 />
//               </div>
//             </div>

//             {/* Parties */}
//             <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
//               <div className="flex items-center justify-between mb-4">
//                 <h2 className="flex items-center text-gray-900 font-semibold">
//                   <Users className="w-5 h-5 mr-2 text-[#21C1B6]" />
//                   Parties Involved
//                 </h2>
//                 <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">
//                   78% Confidence
//                 </span>
//               </div>
//               <div className="space-y-3">
//                 <input
//                   type="text"
//                   value={parties.petitioner}
//                   readOnly
//                   className="border rounded-md px-3 py-2 text-sm w-full"
//                 />
//                 <input
//                   type="text"
//                   value={parties.respondent}
//                   readOnly
//                   className="border rounded-md px-3 py-2 text-sm w-full"
//                 />
//                 <input
//                   type="text"
//                   value={parties.advocate}
//                   readOnly
//                   className="border rounded-md px-3 py-2 text-sm w-full"
//                 />
//               </div>
//             </div>

//             {/* Timeline */}
//             <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
//               <div className="flex items-center justify-between mb-4">
//                 <h2 className="flex items-center text-gray-900 font-semibold">
//                   <Calendar className="w-5 h-5 mr-2 text-[#21C1B6]" />
//                   Timeline
//                 </h2>
//                 <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
//                   92% Confidence
//                 </span>
//               </div>
//               <div className="grid grid-cols-3 gap-4">
//                 <input
//                   type="date"
//                   value={timeline.filingDate}
//                   readOnly
//                   className="border rounded-md px-3 py-2 text-sm"
//                 />
//                 <input
//                   type="date"
//                   value={timeline.firstHearing}
//                   readOnly
//                   className="border rounded-md px-3 py-2 text-sm"
//                 />
//                 <input
//                   type="date"
//                   value={timeline.newHearing}
//                   readOnly
//                   className="border rounded-md px-3 py-2 text-sm"
//                 />
//               </div>
//             </div>

//             {/* Documents Identified */}
//             <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
//               <div className="flex items-center justify-between mb-4">
//                 <h2 className="flex items-center text-gray-900 font-semibold">
//                   <FileCheck className="w-5 h-5 mr-2 text-[#21C1B6]" />
//                   Documents Identified
//                 </h2>
//                 <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
//                   88% Confidence
//                 </span>
//               </div>
//               <div className="grid grid-cols-2 gap-2 text-sm">
//                 {documents.map((doc) => (
//                   <div key={doc.type} className="flex justify-between">
//                     <span>{doc.type}</span>
//                     <span className="font-medium">{doc.count}</span>
//                   </div>
//                 ))}
//               </div>
//             </div>

//             {/* Key Legal Points */}
//             <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
//               <div className="flex items-center justify-between mb-4">
//                 <h2 className="flex items-center text-gray-900 font-semibold">
//                   <Lightbulb className="w-5 h-5 mr-2 text-[#21C1B6]" />
//                   Key Legal Points
//                 </h2>
//                 <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
//                   85% Confidence
//                 </span>
//               </div>
//               <textarea
//                 value={keyPoints.respondent}
//                 readOnly
//                 rows="3"
//                 className="border rounded-md px-3 py-2 text-sm w-full resize-none"
//               />
//             </div>
//           </div>

//           {/* RIGHT SIDE */}
//           <div className="col-span-1">
//             <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
//               <h2 className="flex items-center text-gray-900 font-semibold mb-4">
//                 <Paperclip className="w-5 h-5 mr-2 text-[#21C1B6]" />
//                 Uploaded Documents
//               </h2>
//               <ul className="space-y-3">
//                 {uploadedDocs.map((doc) => (
//                   <li
//                     key={doc.name}
//                     className="flex items-center justify-between border rounded-md px-3 py-2 text-sm"
//                   >
//                     <div>
//                       <p className="font-medium text-gray-800">{doc.name}</p>
//                       <p className="text-xs text-gray-500">{doc.date}</p>
//                     </div>
//                     <span className="text-xs text-gray-600">{doc.status}</span>
//                   </li>
//                 ))}
//               </ul>
//             </div>
//           </div>
//         </div>

//         {/* Footer Buttons */}
//         <div className="flex justify-end mt-8 space-x-3">
//           <button className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-50">
//             Add Missing Data
//           </button>
//           <button className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-50">
//             Edit Case Info
//           </button>
//           <button className="px-4 py-2 bg-red-500 text-white rounded-md text-sm hover:bg-red-600">
//             Continue →
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default CaseDetailsPage;
import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { FileManagerContext } from '../context/FileManagerContext';
import {
  ArrowLeft,
  Scale,
  Calendar,
  MapPin,
  FileText,
  User,
  Building,
  Edit,
  Trash2,
  FolderOpen,
  Loader2,
} from 'lucide-react';

const CaseDetailsPage = () => {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useContext(FileManagerContext);

  const [caseData, setCaseData] = useState(location.state?.case || null);
  const [loading, setLoading] = useState(!caseData);
  const [error, setError] = useState(null);

  // Fetch case details if not passed via navigation state
  useEffect(() => {
    if (!caseData && caseId) {
      fetchCaseDetails();
    }
  }, [caseId, caseData]);

  const fetchCaseDetails = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = user?.token;
      if (!token) {
        throw new Error('Authentication required');
      }

      // Assuming you have an endpoint to get a single case
      const response = await fetch(`http://localhost:5000/docs/cases/${caseId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch case details');
      }

      setCaseData(data.case || data);
    } catch (err) {
      console.error('Error fetching case details:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const statusLower = status?.toLowerCase();
    switch (statusLower) {
      case 'active':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'closed':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'disposed':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleGoToFolder = () => {
    if (caseData?.folder_id) {
      // Navigate to the folder associated with this case
      navigate(`/documents/${caseData.case_title}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-[#21C1B6] animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading case details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <p className="text-red-800 font-semibold mb-2">Error Loading Case</p>
            <p className="text-red-700 text-sm mb-4">{error}</p>
            <button
              onClick={() => navigate('/cases')}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Back to Cases
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Case not found</p>
          <button
            onClick={() => navigate('/cases')}
            className="px-4 py-2 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA49B]"
          >
            Back to Cases
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFCFB] p-8">
      <div className="max-w-6xl mx-auto">
        {/* Back Button */}
        <button
          onClick={() => navigate('/cases')}
          className="flex items-center text-gray-600 hover:text-gray-800 mb-6 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back to Cases
        </button>

        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start flex-1">
              <div className="w-16 h-16 bg-[#9CDFE1] bg-opacity-20 rounded-lg flex items-center justify-center mr-4">
                <Scale className="w-8 h-8 text-[#21C1B6]" />
              </div>
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                  {caseData.case_title || 'Untitled Case'}
                </h1>
                {caseData.case_number && (
                  <p className="text-gray-600 mb-3">Case No: {caseData.case_number}</p>
                )}
                <div className="flex items-center space-x-4">
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(
                      caseData.status
                    )}`}
                  >
                    {caseData.status || 'Unknown'}
                  </span>
                  {caseData.case_type && (
                    <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm font-medium">
                      {caseData.case_type}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center space-x-2 ml-4">
              <button
                onClick={() => alert('Edit functionality coming soon')}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                title="Edit Case"
              >
                <Edit className="w-5 h-5" />
              </button>
              <button
                onClick={() => alert('Delete functionality coming soon')}
                className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="Delete Case"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Case Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Court Information */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <Building className="w-5 h-5 mr-2 text-[#21C1B6]" />
                Court Information
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500 mb-1">Court Name</p>
                  <p className="text-base font-medium text-gray-900">
                    {caseData.court_name || 'Not specified'}
                  </p>
                </div>
                {caseData.court_level && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Court Level</p>
                    <p className="text-base font-medium text-gray-900">
                      {caseData.court_level}
                    </p>
                  </div>
                )}
                {caseData.bench_division && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Bench/Division</p>
                    <p className="text-base font-medium text-gray-900">
                      {caseData.bench_division}
                    </p>
                  </div>
                )}
                {caseData.court_room_no && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Court Room</p>
                    <p className="text-base font-medium text-gray-900">
                      {caseData.court_room_no}
                    </p>
                  </div>
                )}
                {caseData.jurisdiction && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Jurisdiction</p>
                    <p className="text-base font-medium text-gray-900">
                      {caseData.jurisdiction}
                    </p>
                  </div>
                )}
                {caseData.state && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">State</p>
                    <p className="text-base font-medium text-gray-900">
                      {caseData.state}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Parties Information */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <User className="w-5 h-5 mr-2 text-[#21C1B6]" />
                Parties
              </h2>
              <div className="space-y-4">
                {caseData.petitioners && (
                  <div>
                    <p className="text-sm text-gray-500 mb-2">Petitioners</p>
                    <div className="bg-gray-50 rounded-md p-3">
                      <pre className="text-sm text-gray-900 whitespace-pre-wrap">
                        {typeof caseData.petitioners === 'string'
                          ? caseData.petitioners
                          : JSON.stringify(caseData.petitioners, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
                {caseData.respondents && (
                  <div>
                    <p className="text-sm text-gray-500 mb-2">Respondents</p>
                    <div className="bg-gray-50 rounded-md p-3">
                      <pre className="text-sm text-gray-900 whitespace-pre-wrap">
                        {typeof caseData.respondents === 'string'
                          ? caseData.respondents
                          : JSON.stringify(caseData.respondents, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Additional Details */}
            {(caseData.judges || caseData.complexity || caseData.monetary_value) && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-semibold mb-4">Additional Details</h2>
                <div className="grid grid-cols-2 gap-4">
                  {caseData.judges && (
                    <div className="col-span-2">
                      <p className="text-sm text-gray-500 mb-1">Judges</p>
                      <p className="text-base font-medium text-gray-900">
                        {typeof caseData.judges === 'string'
                          ? caseData.judges
                          : JSON.stringify(caseData.judges)}
                      </p>
                    </div>
                  )}
                  {caseData.complexity && (
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Complexity</p>
                      <p className="text-base font-medium text-gray-900">
                        {caseData.complexity}
                      </p>
                    </div>
                  )}
                  {caseData.monetary_value && (
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Monetary Value</p>
                      <p className="text-base font-medium text-gray-900">
                        ₹{parseFloat(caseData.monetary_value).toLocaleString('en-IN')}
                      </p>
                    </div>
                  )}
                  {caseData.priority_level && (
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Priority</p>
                      <p className="text-base font-medium text-gray-900">
                        {caseData.priority_level}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Quick Info */}
          <div className="space-y-6">
            {/* Timeline */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <Calendar className="w-5 h-5 mr-2 text-[#21C1B6]" />
                Timeline
              </h3>
              <div className="space-y-3">
                {caseData.filing_date && (
                  <div>
                    <p className="text-sm text-gray-500">Filing Date</p>
                    <p className="text-base font-medium text-gray-900">
                      {new Date(caseData.filing_date).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                )}
                {caseData.created_at && (
                  <div>
                    <p className="text-sm text-gray-500">Created</p>
                    <p className="text-base font-medium text-gray-900">
                      {new Date(caseData.created_at).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                )}
                {caseData.updated_at && (
                  <div>
                    <p className="text-sm text-gray-500">Last Updated</p>
                    <p className="text-base font-medium text-gray-900">
                      {new Date(caseData.updated_at).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
              <div className="space-y-2">
                {caseData.folder_id && (
                  <button
                    onClick={handleGoToFolder}
                    className="w-full px-4 py-3 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA49B] transition-colors flex items-center justify-center"
                  >
                    <FolderOpen className="w-5 h-5 mr-2" />
                    Open Documents Folder
                  </button>
                )}
                <button
                  onClick={() => alert('Upload documents feature coming soon')}
                  className="w-full px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center"
                >
                  <FileText className="w-5 h-5 mr-2" />
                  Upload Documents
                </button>
              </div>
            </div>

            {/* Categories */}
            {(caseData.category_type || caseData.primary_category || caseData.sub_category) && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold mb-4">Categories</h3>
                <div className="space-y-2">
                  {caseData.category_type && (
                    <div>
                      <p className="text-sm text-gray-500">Category Type</p>
                      <p className="text-base font-medium text-gray-900">
                        {caseData.category_type}
                      </p>
                    </div>
                  )}
                  {caseData.primary_category && (
                    <div>
                      <p className="text-sm text-gray-500">Primary Category</p>
                      <p className="text-base font-medium text-gray-900">
                        {caseData.primary_category}
                      </p>
                    </div>
                  )}
                  {caseData.sub_category && (
                    <div>
                      <p className="text-sm text-gray-500">Sub Category</p>
                      <p className="text-base font-medium text-gray-900">
                        {caseData.sub_category}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CaseDetailsPage;