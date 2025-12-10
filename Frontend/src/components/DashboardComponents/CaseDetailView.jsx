// import React, { useEffect, useState } from 'react';
// import { useParams, useNavigate } from 'react-router-dom';
// import { ArrowLeft, Save, Edit2, X } from 'lucide-react';
// import documentApi from '../../services/documentApi';
// import { toast } from 'react-toastify';

// const CaseDetailView = () => {
//   const { id } = useParams();
//   const navigate = useNavigate();
//   const [caseData, setCaseData] = useState(null);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState(null);
//   const [isEditing, setIsEditing] = useState(false);
//   const [formData, setFormData] = useState({});
//   const [saving, setSaving] = useState(false);

//   useEffect(() => {
//     fetchCaseDetails();
//   }, [id]);

//   const fetchCaseDetails = async () => {
//     try {
//       setLoading(true);
//       const response = await documentApi.getCaseById(id);
//       const caseItem = response.case || null; // Correctly extract from response.case
//       setCaseData(caseItem);
//       setFormData(caseItem);
//     } catch (err) {
//       console.error('Error fetching case details:', err);
//       setError(err);
//       toast.error('Failed to fetch case details.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleInputChange = (e) => {
//     const { name, value } = e.target;
//     setFormData(prev => ({
//       ...prev,
//       [name]: value
//     }));
//   };

//   const handleArrayInputChange = (e, fieldName) => {
//     const { value } = e.target;
//     const arrayValue = value.split(',').map(item => item.trim()).filter(item => item);
//     setFormData(prev => ({
//       ...prev,
//       [fieldName]: arrayValue
//     }));
//   };

//   const handleSave = async () => {
//     try {
//       setSaving(true);
//       await documentApi.updateCase(id, formData);
//       setCaseData(formData);
//       setIsEditing(false);
//       toast.success('Case updated successfully!');
//     } catch (err) {
//       console.error('Error updating case:', err);
//       toast.error('Failed to update case.');
//     } finally {
//       setSaving(false);
//     }
//   };

//   const handleCancel = () => {
//     setFormData(caseData);
//     setIsEditing(false);
//   };

//   if (loading) {
//     return (
//       <div className="flex justify-center items-center h-screen">
//         <div className="text-gray-600 text-lg">Loading case details...</div>
//       </div>
//     );
//   }

//   if (error) {
//     return (
//       <div className="max-w-4xl mx-auto mt-8 p-6">
//         <div className="bg-red-50 border border-red-200 rounded-lg p-4">
//           <p className="text-red-600">Error loading case: {error.message}</p>
//           <button
//             onClick={() => navigate('/dashboard')}
//             className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
//           >
//             Back to Dashboard
//           </button>
//         </div>
//       </div>
//     );
//   }

//   if (!caseData) {
//     return (
//       <div className="max-w-4xl mx-auto mt-8 p-6 text-center">
//         <p className="text-gray-600">No case details found.</p>
//         <button
//           onClick={() => navigate('/dashboard')}
//           className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
//         >
//           Back to Dashboard
//         </button>
//       </div>
//     );
//   }

//   return (
//     <div className="max-w-7xl mx-auto p-6">
//       {/* Header */}
//       <div className="flex justify-between items-center mb-6">
//         <div className="flex items-center gap-4">
//           <button
//             onClick={() => navigate(-1)}
//             className="text-gray-600 hover:text-gray-900 transition-colors"
//           >
//             <ArrowLeft size={24} />
//           </button>
//           <div>
//             <h1 className="text-2xl font-bold text-gray-900">
//               {caseData?.case_number || 'Case Details'}
//             </h1>
//             <p className="text-sm text-gray-500 mt-1">
//               {caseData?.case_title}
//             </p>
//           </div>
//         </div>
        
//         <div className="flex gap-3">
//           {isEditing ? (
//             <>
//               <button
//                 onClick={handleCancel}
//                 className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
//               >
//                 <X size={18} />
//                 Cancel
//               </button>
//               <button
//                 onClick={handleSave}
//                 disabled={saving}
//                 className="flex items-center gap-2 px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1aa89f] transition-colors disabled:opacity-50"
//               >
//                 <Save size={18} />
//                 {saving ? 'Saving...' : 'Save Changes'}
//               </button>
//             </>
//           ) : (
//             <button
//               onClick={() => {
//                 setFormData(caseData); // Initialize formData with current caseData
//                 setIsEditing(true);
//               }}
//               className="flex items-center gap-2 px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1aa89f] transition-colors"
//             >
//               <Edit2 size={18} />
//               Edit Case
//             </button>
//           )}
//         </div>
//       </div>

//       {/* Case Details Form */}
//       <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
//         {/* Basic Information Section */}
//         <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
//           <h2 className="text-lg font-semibold text-gray-900">Basic Information</h2>
//         </div>
//         <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
//           {/* Case Title */}
//           <div className="md:col-span-2">
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Case Title
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="case_title"
//                 value={formData.case_title || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.case_title || 'N/A'}</p>
//             )}
//           </div>

//           {/* Case Number */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Case Number
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="case_number"
//                 value={formData.case_number || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.case_number || 'N/A'}</p>
//             )}
//           </div>

//           {/* Filing Date */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Filing Date
//             </label>
//             {isEditing ? (
//               <input
//                 type="date"
//                 name="filing_date"
//                 value={formData.filing_date ? formData.filing_date.split('T')[0] : ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">
//                 {caseData?.filing_date ? new Date(caseData.filing_date).toLocaleDateString() : 'N/A'}
//               </p>
//             )}
//           </div>

//           {/* Case Type */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Case Type
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="case_type"
//                 value={formData.case_type || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.case_type || 'N/A'}</p>
//             )}
//           </div>

//           {/* Sub Type */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Sub Type
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="sub_type"
//                 value={formData.sub_type || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.sub_type || 'N/A'}</p>
//             )}
//           </div>

//           {/* Status */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Status
//             </label>
//             {isEditing ? (
//               <select
//                 name="status"
//                 value={formData.status || 'Pending'}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               >
//                 <option value="Active">Active</option>
//                 <option value="Pending">Pending</option>
//                 <option value="Inactive">Inactive</option>
//                 <option value="Disposed">Disposed</option>
//                 <option value="Completed">Completed</option>
//                 <option value="Closed">Closed</option>
//               </select>
//             ) : (
//               <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
//                 caseData?.status === 'Active'
//                   ? 'bg-green-100 text-green-800'
//                   : caseData?.status === 'Pending'
//                   ? 'bg-yellow-100 text-yellow-800'
//                   : caseData?.status === 'Disposed' || caseData?.status === 'Completed'
//                   ? 'bg-blue-100 text-blue-800'
//                   : 'bg-gray-100 text-gray-800'
//               }`}>
//                 {caseData?.status || 'N/A'}
//               </span>
//             )}
//           </div>
//         </div>

//         {/* Court Information Section */}
//         <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
//           <h2 className="text-lg font-semibold text-gray-900">Court Information</h2>
//         </div>
//         <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
//           {/* Court Name */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Court Name
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="court_name"
//                 value={formData.court_name || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.court_name || 'N/A'}</p>
//             )}
//           </div>

//           {/* Court Level */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Court Level
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="court_level"
//                 value={formData.court_level || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.court_level || 'N/A'}</p>
//             )}
//           </div>

//           {/* Bench Division */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Bench Division
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="bench_division"
//                 value={formData.bench_division || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.bench_division || 'N/A'}</p>
//             )}
//           </div>

//           {/* Court Room No */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Court Room No.
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="court_room_no"
//                 value={formData.court_room_no || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.court_room_no || 'N/A'}</p>
//             )}
//           </div>

//           {/* Jurisdiction */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Jurisdiction
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="jurisdiction"
//                 value={formData.jurisdiction || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.jurisdiction || 'N/A'}</p>
//             )}
//           </div>

//           {/* State */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               State
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="state"
//                 value={formData.state || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.state || 'N/A'}</p>
//             )}
//           </div>

//           {/* Judges */}
//           <div className="md:col-span-2 lg:col-span-3">
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Judges (comma-separated)
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="judges"
//                 value={Array.isArray(formData.judges) ? formData.judges.join(', ') : formData.judges || ''}
//                 onChange={(e) => handleArrayInputChange(e, 'judges')}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//                 placeholder="Enter judge names separated by commas"
//               />
//             ) : (
//               <p className="text-gray-900">
//                 {Array.isArray(caseData?.judges) && caseData.judges.length > 0
//                   ? caseData.judges.join(', ')
//                   : 'N/A'}
//               </p>
//             )}
//           </div>
//         </div>

//         {/* Parties Information Section */}
//         <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
//           <h2 className="text-lg font-semibold text-gray-900">Parties Information</h2>
//         </div>
//         <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
//           {/* Petitioners */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Petitioners (comma-separated)
//             </label>
//             {isEditing ? (
//               <textarea
//                 name="petitioners"
//                 value={Array.isArray(formData.petitioners) ? formData.petitioners.join(', ') : formData.petitioners || ''}
//                 onChange={(e) => handleArrayInputChange(e, 'petitioners')}
//                 rows="3"
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//                 placeholder="Enter names separated by commas"
//               />
//             ) : (
//               <p className="text-gray-900">
//                 {Array.isArray(caseData?.petitioners) && caseData.petitioners.length > 0
//                   ? caseData.petitioners.join(', ')
//                   : 'N/A'}
//               </p>
//             )}
//           </div>

//           {/* Respondents */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Respondents (comma-separated)
//             </label>
//             {isEditing ? (
//               <textarea
//                 name="respondents"
//                 value={Array.isArray(formData.respondents) ? formData.respondents.join(', ') : formData.respondents || ''}
//                 onChange={(e) => handleArrayInputChange(e, 'respondents')}
//                 rows="3"
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent"
//                 placeholder="Enter names separated by commas"
//               />
//             ) : (
//               <p className="text-gray-900">
//                 {Array.isArray(caseData?.respondents) && caseData.respondents.length > 0
//                   ? caseData.respondents.join(', ')
//                   : 'N/A'}
//               </p>
//             )}
//           </div>
//         </div>

//         {/* Case Classification Section */}
//         <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
//           <h2 className="text-lg font-semibold text-gray-900">Case Classification</h2>
//         </div>
//         <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
//           {/* Category Type */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Category Type
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="category_type"
//                 value={formData.category_type || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.category_type || 'N/A'}</p>
//             )}
//           </div>

//           {/* Primary Category */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Primary Category
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="primary_category"
//                 value={formData.primary_category || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.primary_category || 'N/A'}</p>
//             )}
//           </div>

//           {/* Sub Category */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Sub Category
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="sub_category"
//                 value={formData.sub_category || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.sub_category || 'N/A'}</p>
//             )}
//           </div>

//           {/* Complexity */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Complexity
//             </label>
//             {isEditing ? (
//               <select
//                 name="complexity"
//                 value={formData.complexity || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               >
//                 <option value="">Select Complexity</option>
//                 <option value="Low">Low</option>
//                 <option value="Medium">Medium</option>
//                 <option value="High">High</option>
//               </select>
//             ) : (
//               <p className="text-gray-900">{caseData?.complexity || 'N/A'}</p>
//             )}
//           </div>

//           {/* Priority Level */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Priority Level
//             </label>
//             {isEditing ? (
//               <select
//                 name="priority_level"
//                 value={formData.priority_level || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               >
//                 <option value="">Select Priority</option>
//                 <option value="Low">Low</option>
//                 <option value="Medium">Medium</option>
//                 <option value="High">High</option>
//                 <option value="Critical">Critical</option>
//               </select>
//             ) : (
//               <p className="text-gray-900">{caseData?.priority_level || 'N/A'}</p>
//             )}
//           </div>

//           {/* Monetary Value */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Monetary Value
//             </label>
//             {isEditing ? (
//               <input
//                 type="number"
//                 step="0.01"
//                 name="monetary_value"
//                 value={formData.monetary_value || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">
//                 ${parseFloat(caseData?.monetary_value || 0).toLocaleString()}
//               </p>
//             )}
//           </div>
//         </div>

//         {/* Additional Information Section */}
//         <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
//           <h2 className="text-lg font-semibold text-gray-900">Additional Information</h2>
//         </div>
//         <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
//           {/* Folder ID */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Folder ID
//             </label>
//             <p className="text-gray-900 text-sm font-mono">{caseData?.folder_id || 'N/A'}</p>
//           </div>

//           {/* Created At */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Created At
//             </label>
//             <p className="text-gray-900">
//               {caseData?.created_at ? new Date(caseData.created_at).toLocaleString() : 'N/A'}
//             </p>
//           </div>

//           {/* Updated At */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Updated At
//             </label>
//             <p className="text-gray-900">
//               {caseData?.updated_at ? new Date(caseData.updated_at).toLocaleString() : 'N/A'}
//             </p>
//           </div>

//           {/* User ID */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               User ID
//             </label>
//             <p className="text-gray-900">{caseData?.user_id || 'N/A'}</p>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default CaseDetailView;



// import React, { useEffect, useState } from 'react';
// import { useParams, useNavigate } from 'react-router-dom';
// import { ArrowLeft, Save, Edit2, X } from 'lucide-react';
// import documentApi from '../../services/documentApi';
// import { toast } from 'react-toastify';

// const CaseDetailView = () => {
//   const { id } = useParams();
//   const navigate = useNavigate();
//   const [caseData, setCaseData] = useState(null);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState(null);
//   const [isEditing, setIsEditing] = useState(false);
//   const [formData, setFormData] = useState({});
//   const [saving, setSaving] = useState(false);

//   useEffect(() => {
//     fetchCaseDetails();
//   }, [id]);

//   const fetchCaseDetails = async () => {
//     try {
//       setLoading(true);
//       const response = await documentApi.getCaseById(id);
//       const caseItem = response.case || response.data || response;
//       setCaseData(caseItem);
//       setFormData(caseItem);
//     } catch (err) {
//       console.error('Error fetching case details:', err);
//       setError(err);
//       toast.error('Failed to fetch case details.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   // Helper function to extract names from party objects
//   const extractPartyNames = (parties) => {
//     if (!parties) return '';
//     if (typeof parties === 'string') return parties;
//     if (!Array.isArray(parties)) return '';
//     if (parties.length === 0) return '';
    
//     return parties.map(party => {
//       if (typeof party === 'string') return party;
//       if (typeof party === 'object') {
//         return party.fullName || party.name || party.party_name || `${party.role || 'Unknown'}`;
//       }
//       return String(party);
//     }).filter(name => name && name.trim()).join(', ');
//   };

//   // Helper function to extract judges
//   const extractJudgeNames = (judges) => {
//     if (!judges) return '';
//     if (typeof judges === 'string') return judges;
//     if (!Array.isArray(judges)) return '';
//     if (judges.length === 0) return '';
    
//     return judges.map(judge => {
//       if (typeof judge === 'string') return judge;
//       if (typeof judge === 'object') {
//         return judge.name || judge.fullName || judge.judgeName || String(judge);
//       }
//       return String(judge);
//     }).filter(name => name && name.trim()).join(', ');
//   };

//   // Helper function to convert names back to objects
//   const convertNamesToPartyObjects = (namesString) => {
//     if (!namesString || namesString.trim() === '') return [];
    
//     const names = namesString.split(',').map(name => name.trim()).filter(name => name);
//     return names.map(name => ({
//       fullName: name,
//       role: 'Individual',
//       contact: '',
//       advocateName: '',
//       barRegistration: ''
//     }));
//   };

//   // Helper function to convert judge names to array
//   const convertNamesToJudgeArray = (namesString) => {
//     if (!namesString || namesString.trim() === '') return [];
//     return namesString.split(',').map(name => name.trim()).filter(name => name);
//   };

//   const handleInputChange = (e) => {
//     const { name, value } = e.target;
//     setFormData(prev => ({
//       ...prev,
//       [name]: value
//     }));
//   };

//   const handleArrayInputChange = (e, fieldName) => {
//     const { value } = e.target;
//     if (fieldName === 'judges') {
//       const judgeArray = convertNamesToJudgeArray(value);
//       setFormData(prev => ({
//         ...prev,
//         [fieldName]: judgeArray
//       }));
//     } else {
//       const arrayValue = value.split(',').map(item => item.trim()).filter(item => item);
//       setFormData(prev => ({
//         ...prev,
//         [fieldName]: arrayValue
//       }));
//     }
//   };

//   // Special handler for party objects
//   const handlePartyInputChange = (e, fieldName) => {
//     const { value } = e.target;
//     const partyObjects = convertNamesToPartyObjects(value);
//     setFormData(prev => ({
//       ...prev,
//       [fieldName]: partyObjects
//     }));
//   };

//   const handleSave = async () => {
//     try {
//       setSaving(true);
//       await documentApi.updateCase(id, formData);
//       setCaseData(formData);
//       setIsEditing(false);
//       toast.success('Case updated successfully!');
//       // Refetch the case to ensure we have the latest data
//       await fetchCaseDetails();
//     } catch (err) {
//       console.error('Error updating case:', err);
//       toast.error('Failed to update case.');
//     } finally {
//       setSaving(false);
//     }
//   };

//   const handleCancel = () => {
//     setFormData(caseData);
//     setIsEditing(false);
//   };

//   if (loading) {
//     return (
//       <div className="flex justify-center items-center h-screen">
//         <div className="text-gray-600 text-lg">Loading case details...</div>
//       </div>
//     );
//   }

//   if (error) {
//     return (
//       <div className="max-w-4xl mx-auto mt-8 p-6">
//         <div className="bg-red-50 border border-red-200 rounded-lg p-4">
//           <p className="text-red-600">Error loading case: {error.message}</p>
//           <button
//             onClick={() => navigate('/dashboard')}
//             className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
//           >
//             Back to Dashboard
//           </button>
//         </div>
//       </div>
//     );
//   }

//   if (!caseData) {
//     return (
//       <div className="max-w-4xl mx-auto mt-8 p-6 text-center">
//         <p className="text-gray-600">No case details found.</p>
//         <button
//           onClick={() => navigate('/dashboard')}
//           className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
//         >
//           Back to Dashboard
//         </button>
//       </div>
//     );
//   }

//   return (
//     <div className="max-w-7xl mx-auto p-6">
//       {/* Header */}
//       <div className="flex justify-between items-center mb-6">
//         <div className="flex items-center gap-4">
//           <button
//             onClick={() => navigate(-1)}
//             className="text-gray-600 hover:text-gray-900 transition-colors"
//           >
//             <ArrowLeft size={24} />
//           </button>
//           <div>
//             <h1 className="text-2xl font-bold text-gray-900">
//               {caseData?.case_number || 'Case Details'}
//             </h1>
//             <p className="text-sm text-gray-500 mt-1">
//               {caseData?.case_title}
//             </p>
//           </div>
//         </div>
        
//         <div className="flex gap-3">
//           {isEditing ? (
//             <>
//               <button
//                 onClick={handleCancel}
//                 className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
//               >
//                 <X size={18} />
//                 Cancel
//               </button>
//               <button
//                 onClick={handleSave}
//                 disabled={saving}
//                 className="flex items-center gap-2 px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1aa89f] transition-colors disabled:opacity-50"
//               >
//                 <Save size={18} />
//                 {saving ? 'Saving...' : 'Save Changes'}
//               </button>
//             </>
//           ) : (
//             <button
//               onClick={() => {
//                 setFormData(caseData);
//                 setIsEditing(true);
//               }}
//               className="flex items-center gap-2 px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1aa89f] transition-colors"
//             >
//               <Edit2 size={18} />
//               Edit Case
//             </button>
//           )}
//         </div>
//       </div>

//       {/* Case Details Form */}
//       <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
//         {/* Basic Information Section */}
//         <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
//           <h2 className="text-lg font-semibold text-gray-900">Basic Information</h2>
//         </div>
//         <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
//           {/* Case Title */}
//           <div className="md:col-span-2">
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Case Title
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="case_title"
//                 value={formData.case_title || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.case_title || 'N/A'}</p>
//             )}
//           </div>

//           {/* Case Number */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Case Number
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="case_number"
//                 value={formData.case_number || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.case_number || 'N/A'}</p>
//             )}
//           </div>

//           {/* Filing Date */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Filing Date
//             </label>
//             {isEditing ? (
//               <input
//                 type="date"
//                 name="filing_date"
//                 value={formData.filing_date ? formData.filing_date.split('T')[0] : ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">
//                 {caseData?.filing_date ? new Date(caseData.filing_date).toLocaleDateString() : 'N/A'}
//               </p>
//             )}
//           </div>

//           {/* Case Type */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Case Type
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="case_type"
//                 value={formData.case_type || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.case_type || 'N/A'}</p>
//             )}
//           </div>

//           {/* Sub Type */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Sub Type
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="sub_type"
//                 value={formData.sub_type || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.sub_type || 'N/A'}</p>
//             )}
//           </div>

//           {/* Status */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Status
//             </label>
//             {isEditing ? (
//               <select
//                 name="status"
//                 value={formData.status || 'Pending'}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               >
//                 <option value="Active">Active</option>
//                 <option value="Pending">Pending</option>
//                 <option value="Inactive">Inactive</option>
//                 <option value="Disposed">Disposed</option>
//                 <option value="Completed">Completed</option>
//                 <option value="Closed">Closed</option>
//                 <option value="Under Hearing">Under Hearing</option>
//                 <option value="Awaiting Judgment">Awaiting Judgment</option>
//               </select>
//             ) : (
//               <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
//                 caseData?.status === 'Active'
//                   ? 'bg-green-100 text-green-800'
//                   : caseData?.status === 'Pending'
//                   ? 'bg-yellow-100 text-yellow-800'
//                   : caseData?.status === 'Disposed' || caseData?.status === 'Completed'
//                   ? 'bg-blue-100 text-blue-800'
//                   : 'bg-gray-100 text-gray-800'
//               }`}>
//                 {caseData?.status || 'N/A'}
//               </span>
//             )}
//           </div>
//         </div>

//         {/* Court Information Section */}
//         <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
//           <h2 className="text-lg font-semibold text-gray-900">Court Information</h2>
//         </div>
//         <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
//           {/* Court Name */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Court Name
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="court_name"
//                 value={formData.court_name || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.court_name || 'N/A'}</p>
//             )}
//           </div>

//           {/* Court Level */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Court Level
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="court_level"
//                 value={formData.court_level || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.court_level || 'N/A'}</p>
//             )}
//           </div>

//           {/* Bench Division */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Bench Division
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="bench_division"
//                 value={formData.bench_division || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.bench_division || 'N/A'}</p>
//             )}
//           </div>

//           {/* Court Room No */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Court Room No.
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="court_room_no"
//                 value={formData.court_room_no || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//                 placeholder="Enter court room number"
//               />
//             ) : (
//               <p className="text-gray-900">
//                 {caseData?.court_room_no || 'Not assigned'}
//               </p>
//             )}
//           </div>

//           {/* Jurisdiction */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Jurisdiction
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="jurisdiction"
//                 value={formData.jurisdiction || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.jurisdiction || 'N/A'}</p>
//             )}
//           </div>

//           {/* State */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               State
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="state"
//                 value={formData.state || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.state || 'N/A'}</p>
//             )}
//           </div>

//           {/* Judges */}
//           <div className="md:col-span-2 lg:col-span-3">
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Judges (comma-separated)
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="judges"
//                 value={extractJudgeNames(formData.judges)}
//                 onChange={(e) => handleArrayInputChange(e, 'judges')}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//                 placeholder="Enter judge names separated by commas"
//               />
//             ) : (
//               <p className="text-gray-900">
//                 {extractJudgeNames(caseData?.judges) || 'No judges assigned'}
//               </p>
//             )}
//           </div>
//         </div>

//         {/* Parties Information Section */}
//         <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
//           <h2 className="text-lg font-semibold text-gray-900">Parties Information</h2>
//         </div>
//         <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
//           {/* Petitioners */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Petitioners (comma-separated names)
//             </label>
//             {isEditing ? (
//               <textarea
//                 name="petitioners"
//                 value={extractPartyNames(formData.petitioners)}
//                 onChange={(e) => handlePartyInputChange(e, 'petitioners')}
//                 rows="3"
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//                 placeholder="Enter names separated by commas"
//               />
//             ) : (
//               <p className="text-gray-900">
//                 {extractPartyNames(caseData?.petitioners) || 'N/A'}
//               </p>
//             )}
//           </div>

//           {/* Respondents */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Respondents (comma-separated names)
//             </label>
//             {isEditing ? (
//               <textarea
//                 name="respondents"
//                 value={extractPartyNames(formData.respondents)}
//                 onChange={(e) => handlePartyInputChange(e, 'respondents')}
//                 rows="3"
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//                 placeholder="Enter names separated by commas"
//               />
//             ) : (
//               <p className="text-gray-900">
//                 {extractPartyNames(caseData?.respondents) || 'N/A'}
//               </p>
//             )}
//           </div>
//         </div>

//         {/* Case Classification Section */}
//         <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
//           <h2 className="text-lg font-semibold text-gray-900">Case Classification</h2>
//         </div>
//         <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
//           {/* Category Type */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Category Type
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="category_type"
//                 value={formData.category_type || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.category_type || 'N/A'}</p>
//             )}
//           </div>

//           {/* Primary Category */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Primary Category
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="primary_category"
//                 value={formData.primary_category || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.primary_category || 'N/A'}</p>
//             )}
//           </div>

//           {/* Sub Category */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Sub Category
//             </label>
//             {isEditing ? (
//               <input
//                 type="text"
//                 name="sub_category"
//                 value={formData.sub_category || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">{caseData?.sub_category || 'N/A'}</p>
//             )}
//           </div>

//           {/* Complexity */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Complexity
//             </label>
//             {isEditing ? (
//               <select
//                 name="complexity"
//                 value={formData.complexity || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               >
//                 <option value="">Select Complexity</option>
//                 <option value="Low">Low</option>
//                 <option value="Medium">Medium</option>
//                 <option value="High">High</option>
//                 <option value="Moderate">Moderate</option>
//               </select>
//             ) : (
//               <p className="text-gray-900">{caseData?.complexity || 'N/A'}</p>
//             )}
//           </div>

//           {/* Priority Level */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Priority Level
//             </label>
//             {isEditing ? (
//               <select
//                 name="priority_level"
//                 value={formData.priority_level || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               >
//                 <option value="">Select Priority</option>
//                 <option value="Low">Low</option>
//                 <option value="Medium">Medium</option>
//                 <option value="High">High</option>
//                 <option value="Critical">Critical</option>
//               </select>
//             ) : (
//               <p className="text-gray-900">{caseData?.priority_level || 'N/A'}</p>
//             )}
//           </div>

//           {/* Monetary Value */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Monetary Value
//             </label>
//             {isEditing ? (
//               <input
//                 type="number"
//                 step="0.01"
//                 name="monetary_value"
//                 value={formData.monetary_value || ''}
//                 onChange={handleInputChange}
//                 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white"
//               />
//             ) : (
//               <p className="text-gray-900">
//                 {caseData?.monetary_value ? `$${parseFloat(caseData.monetary_value).toLocaleString()}` : 'N/A'}
//               </p>
//             )}
//           </div>
//         </div>

//         {/* Additional Information Section */}
//         <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
//           <h2 className="text-lg font-semibold text-gray-900">Additional Information</h2>
//         </div>
//         <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
//           {/* Folder ID */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Folder ID
//             </label>
//             <p className="text-gray-900 text-sm font-mono">{caseData?.folder_id || 'N/A'}</p>
//           </div>

//           {/* Created At */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Created At
//             </label>
//             <p className="text-gray-900">
//               {caseData?.created_at ? new Date(caseData.created_at).toLocaleString() : 'N/A'}
//             </p>
//           </div>

//           {/* Updated At */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               Updated At
//             </label>
//             <p className="text-gray-900">
//               {caseData?.updated_at ? new Date(caseData.updated_at).toLocaleString() : 'N/A'}
//             </p>
//           </div>

//           {/* User ID */}
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-2">
//               User ID
//             </label>
//             <p className="text-gray-900">{caseData?.user_id || 'N/A'}</p>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default CaseDetailView;



import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Edit2, X } from 'lucide-react';
import documentApi from '../../services/documentApi';
import { toast } from 'react-toastify';

const CaseDetailView = () => {
 const { id } = useParams();
 const navigate = useNavigate();
 const [caseData, setCaseData] = useState(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(null);
 const [isEditing, setIsEditing] = useState(false);
 const [formData, setFormData] = useState({});
 const [saving, setSaving] = useState(false);

 useEffect(() => {
 fetchCaseDetails();
 }, [id]);

 const fetchCaseDetails = async () => {
 try {
 setLoading(true);
 const response = await documentApi.getCaseById(id);
 const caseItem = response.case || response.data || response;
 setCaseData(caseItem);
 setFormData(caseItem);
 } catch (err) {
 console.error('Error fetching case details:', err);
 setError(err);
 toast.error('Failed to fetch case details.');
 } finally {
 setLoading(false);
 }
 };

 // Helper function to extract names from party objects
 const extractPartyNames = (parties) => {
 if (!parties) return '';
 if (typeof parties === 'string') return parties;
 if (!Array.isArray(parties)) return '';
 if (parties.length === 0) return '';
 
 return parties.map(party => {
 if (typeof party === 'string') return party;
 if (typeof party === 'object') {
 return party.fullName || party.name || party.party_name || `${party.role || 'Unknown'}`;
 }
 return String(party);
 }).filter(name => name && name.trim()).join(', ');
 };

 // Helper function to extract judges
 const extractJudgeNames = (judges) => {
 if (!judges) return '';
 if (typeof judges === 'string') return judges;
 if (!Array.isArray(judges)) return '';
 if (judges.length === 0) return '';
 
 return judges.map(judge => {
 if (typeof judge === 'string') return judge;
 if (typeof judge === 'object') {
 return judge.name || judge.fullName || judge.judgeName || String(judge);
 }
 return String(judge);
 }).filter(name => name && name.trim()).join(', ');
 };

 // Helper function to convert names back to objects
 const convertNamesToPartyObjects = (namesString) => {
 if (!namesString || namesString.trim() === '') return [];
 
 const names = namesString.split(',').map(name => name.trim()).filter(name => name);
 return names.map(name => ({
 fullName: name,
 role: 'Individual',
 contact: '',
 advocateName: '',
 barRegistration: ''
 }));
 };

 // Helper function to convert judge names to array
 const convertNamesToJudgeArray = (namesString) => {
 if (!namesString || namesString.trim() === '') return [];
 return namesString.split(',').map(name => name.trim()).filter(name => name);
 };

 const handleInputChange = (e) => {
 const { name, value } = e.target;
 setFormData(prev => ({
 ...prev,
 [name]: value
 }));
 };

 const handleArrayInputChange = (e, fieldName) => {
 const { value } = e.target;
 if (fieldName === 'judges') {
 const judgeArray = convertNamesToJudgeArray(value);
 setFormData(prev => ({
 ...prev,
 [fieldName]: judgeArray
 }));
 } else {
 const arrayValue = value.split(',').map(item => item.trim()).filter(item => item);
 setFormData(prev => ({
 ...prev,
 [fieldName]: arrayValue
 }));
 }
 };

 // Special handler for party objects
 const handlePartyInputChange = (e, fieldName) => {
 const { value } = e.target;
 const partyObjects = convertNamesToPartyObjects(value);
 setFormData(prev => ({
 ...prev,
 [fieldName]: partyObjects
 }));
 };

 const handleSave = async () => {
 try {
 setSaving(true);
 await documentApi.updateCase(id, formData);
 setCaseData(formData);
 setIsEditing(false);
 toast.success('Case updated successfully!');
 // Refetch the case to ensure we have the latest data
 await fetchCaseDetails();
 } catch (err) {
 console.error('Error updating case:', err);
 toast.error('Failed to update case.');
 } finally {
 setSaving(false);
 }
 };

 const handleCancel = () => {
 setFormData(caseData);
 setIsEditing(false);
 };

 if (loading) {
 return (
 <div className="flex justify-center items-center min-h-screen px-4">
 <div className="text-gray-600 text-base sm:text-lg">Loading case details...</div>
 </div>
 );
 }

 if (error) {
 return (
 <div className="max-w-4xl mx-auto mt-4 sm:mt-8 p-4 sm:p-6">
 <div className="bg-red-50 border border-red-200 rounded-lg p-4">
 <p className="text-red-600 text-sm sm:text-base">Error loading case: {error.message}</p>
 <button
 onClick={() => navigate('/dashboard')}
 className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm sm:text-base w-full sm:w-auto"
 >
 Back to Dashboard
 </button>
 </div>
 </div>
 );
 }

 if (!caseData) {
 return (
 <div className="max-w-4xl mx-auto mt-4 sm:mt-8 p-4 sm:p-6 text-center">
 <p className="text-gray-600 text-sm sm:text-base">No case details found.</p>
 <button
 onClick={() => navigate('/dashboard')}
 className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm sm:text-base w-full sm:w-auto"
 >
 Back to Dashboard
 </button>
 </div>
 );
 }

 return (
 <div className="min-h-screen bg-gray-50 pb-6">
 <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
 {/* Header */}
 <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-4 sm:mb-6">
 <div className="flex items-start sm:items-center gap-3 sm:gap-4">
 <button
 onClick={() => navigate(-1)}
 className="text-gray-600 hover:text-gray-900 transition-colors mt-1 sm:mt-0 flex-shrink-0"
 aria-label="Go back"
 >
 <ArrowLeft size={20} className="sm:w-6 sm:h-6" />
 </button>
 <div className="min-w-0 flex-1">
 <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 break-words">
 {caseData?.case_number || 'Case Details'}
 </h1>
 <p className="text-xs sm:text-sm text-gray-500 mt-1 break-words line-clamp-2">
 {caseData?.case_title}
 </p>
 </div>
 </div>
 
 <div className="flex gap-2 sm:gap-3 flex-shrink-0">
 {isEditing ? (
 <>
 <button
 onClick={handleCancel}
 className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors text-sm sm:text-base flex-1 sm:flex-initial"
 >
 <X size={16} className="sm:w-[18px] sm:h-[18px]" />
 <span className="hidden xs:inline">Cancel</span>
 </button>
 <button
 onClick={handleSave}
 disabled={saving}
 className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1aa89f] transition-colors disabled:opacity-50 text-sm sm:text-base flex-1 sm:flex-initial"
 >
 <Save size={16} className="sm:w-[18px] sm:h-[18px]" />
 <span>{saving ? 'Saving...' : 'Save'}</span>
 </button>
 </>
 ) : (
 <button
 onClick={() => {
 setFormData(caseData);
 setIsEditing(true);
 }}
 className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1aa89f] transition-colors text-sm sm:text-base w-full sm:w-auto"
 >
 <Edit2 size={16} className="sm:w-[18px] sm:h-[18px]" />
 <span>Edit Case</span>
 </button>
 )}
 </div>
 </div>

 {/* Case Details Form */}
 <div className="bg-white rounded-lg sm:rounded-xl shadow-sm border border-gray-200 overflow-hidden">
 {/* Basic Information Section */}
 <div className="bg-gray-50 px-4 sm:px-6 py-2.5 sm:py-3 border-b border-gray-200">
 <h2 className="text-base sm:text-lg font-semibold text-gray-900">Basic Information</h2>
 </div>
 <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
 {/* Case Title */}
 <div className="sm:col-span-2 lg:col-span-2">
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Case Title
 </label>
 {isEditing ? (
 <input
 type="text"
 name="case_title"
 value={formData.case_title || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">{caseData?.case_title || 'N/A'}</p>
 )}
 </div>

 {/* Case Number */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Case Number
 </label>
 {isEditing ? (
 <input
 type="text"
 name="case_number"
 value={formData.case_number || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">{caseData?.case_number || 'N/A'}</p>
 )}
 </div>

 {/* Filing Date */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Filing Date
 </label>
 {isEditing ? (
 <input
 type="date"
 name="filing_date"
 value={formData.filing_date ? formData.filing_date.split('T')[0] : ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base">
 {caseData?.filing_date ? new Date(caseData.filing_date).toLocaleDateString() : 'N/A'}
 </p>
 )}
 </div>

 {/* Case Type */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Case Type
 </label>
 {isEditing ? (
 <input
 type="text"
 name="case_type"
 value={formData.case_type || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">{caseData?.case_type || 'N/A'}</p>
 )}
 </div>

 {/* Sub Type */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Sub Type
 </label>
 {isEditing ? (
 <input
 type="text"
 name="sub_type"
 value={formData.sub_type || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">{caseData?.sub_type || 'N/A'}</p>
 )}
 </div>

 {/* Status */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Status
 </label>
 {isEditing ? (
 <select
 name="status"
 value={formData.status || 'Pending'}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 >
 <option value="Active">Active</option>
 <option value="Pending">Pending</option>
 <option value="Inactive">Inactive</option>
 <option value="Disposed">Disposed</option>
 <option value="Completed">Completed</option>
 <option value="Closed">Closed</option>
 <option value="Under Hearing">Under Hearing</option>
 <option value="Awaiting Judgment">Awaiting Judgment</option>
 </select>
 ) : (
 <span className={`inline-block px-2.5 sm:px-3 py-1 rounded-full text-xs font-medium ${
 caseData?.status === 'Active'
 ? 'bg-green-100 text-green-800'
 : caseData?.status === 'Pending'
 ? 'bg-yellow-100 text-yellow-800'
 : caseData?.status === 'Disposed' || caseData?.status === 'Completed'
 ? 'bg-blue-100 text-blue-800'
 : 'bg-gray-100 text-gray-800'
 }`}>
 {caseData?.status || 'N/A'}
 </span>
 )}
 </div>
 </div>

 {/* Court Information Section */}
 <div className="bg-gray-50 px-4 sm:px-6 py-2.5 sm:py-3 border-b border-gray-200">
 <h2 className="text-base sm:text-lg font-semibold text-gray-900">Court Information</h2>
 </div>
 <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
 {/* Court Name */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Court Name
 </label>
 {isEditing ? (
 <input
 type="text"
 name="court_name"
 value={formData.court_name || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">{caseData?.court_name || 'N/A'}</p>
 )}
 </div>

 {/* Court Level */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Court Level
 </label>
 {isEditing ? (
 <input
 type="text"
 name="court_level"
 value={formData.court_level || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">{caseData?.court_level || 'N/A'}</p>
 )}
 </div>

 {/* Bench Division */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Bench Division
 </label>
 {isEditing ? (
 <input
 type="text"
 name="bench_division"
 value={formData.bench_division || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">{caseData?.bench_division || 'N/A'}</p>
 )}
 </div>

 {/* Court Room No */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Court Room No.
 </label>
 {isEditing ? (
 <input
 type="text"
 name="court_room_no"
 value={formData.court_room_no || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 placeholder="Enter court room number"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base">
 {caseData?.court_room_no || 'Not assigned'}
 </p>
 )}
 </div>

 {/* Jurisdiction */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Jurisdiction
 </label>
 {isEditing ? (
 <input
 type="text"
 name="jurisdiction"
 value={formData.jurisdiction || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">{caseData?.jurisdiction || 'N/A'}</p>
 )}
 </div>

 {/* State */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 State
 </label>
 {isEditing ? (
 <input
 type="text"
 name="state"
 value={formData.state || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">{caseData?.state || 'N/A'}</p>
 )}
 </div>

 {/* Judges */}
 <div className="sm:col-span-2 lg:col-span-3">
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Judges (comma-separated)
 </label>
 {isEditing ? (
 <input
 type="text"
 name="judges"
 value={extractJudgeNames(formData.judges)}
 onChange={(e) => handleArrayInputChange(e, 'judges')}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 placeholder="Enter judge names separated by commas"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">
 {extractJudgeNames(caseData?.judges) || 'No judges assigned'}
 </p>
 )}
 </div>
 </div>

 {/* Parties Information Section */}
 <div className="bg-gray-50 px-4 sm:px-6 py-2.5 sm:py-3 border-b border-gray-200">
 <h2 className="text-base sm:text-lg font-semibold text-gray-900">Parties Information</h2>
 </div>
 <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
 {/* Petitioners */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Petitioners (comma-separated names)
 </label>
 {isEditing ? (
 <textarea
 name="petitioners"
 value={extractPartyNames(formData.petitioners)}
 onChange={(e) => handlePartyInputChange(e, 'petitioners')}
 rows="3"
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base resize-y"
 placeholder="Enter names separated by commas"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">
 {extractPartyNames(caseData?.petitioners) || 'N/A'}
 </p>
 )}
 </div>

 {/* Respondents */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Respondents (comma-separated names)
 </label>
 {isEditing ? (
 <textarea
 name="respondents"
 value={extractPartyNames(formData.respondents)}
 onChange={(e) => handlePartyInputChange(e, 'respondents')}
 rows="3"
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base resize-y"
 placeholder="Enter names separated by commas"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">
 {extractPartyNames(caseData?.respondents) || 'N/A'}
 </p>
 )}
 </div>
 </div>

 {/* Case Classification Section */}
 <div className="bg-gray-50 px-4 sm:px-6 py-2.5 sm:py-3 border-b border-gray-200">
 <h2 className="text-base sm:text-lg font-semibold text-gray-900">Case Classification</h2>
 </div>
 <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
 {/* Category Type */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Category Type
 </label>
 {isEditing ? (
 <input
 type="text"
 name="category_type"
 value={formData.category_type || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">{caseData?.category_type || 'N/A'}</p>
 )}
 </div>

 {/* Primary Category */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Primary Category
 </label>
 {isEditing ? (
 <input
 type="text"
 name="primary_category"
 value={formData.primary_category || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">{caseData?.primary_category || 'N/A'}</p>
 )}
 </div>

 {/* Sub Category */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Sub Category
 </label>
 {isEditing ? (
 <input
 type="text"
 name="sub_category"
 value={formData.sub_category || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base break-words">{caseData?.sub_category || 'N/A'}</p>
 )}
 </div>

 {/* Complexity */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Complexity
 </label>
 {isEditing ? (
 <select
 name="complexity"
 value={formData.complexity || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 >
 <option value="">Select Complexity</option>
 <option value="Low">Low</option>
 <option value="Medium">Medium</option>
 <option value="High">High</option>
 <option value="Moderate">Moderate</option>
 </select>
 ) : (
 <p className="text-gray-900 text-sm sm:text-base">{caseData?.complexity || 'N/A'}</p>
 )}
 </div>

 {/* Priority Level */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Priority Level
 </label>
 {isEditing ? (
 <select
 name="priority_level"
 value={formData.priority_level || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 >
 <option value="">Select Priority</option>
 <option value="Low">Low</option>
 <option value="Medium">Medium</option>
 <option value="High">High</option>
 <option value="Critical">Critical</option>
 </select>
 ) : (
 <p className="text-gray-900 text-sm sm:text-base">{caseData?.priority_level || 'N/A'}</p>
 )}
 </div>

 {/* Monetary Value */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Monetary Value
 </label>
 {isEditing ? (
 <input
 type="number"
 step="0.01"
 name="monetary_value"
 value={formData.monetary_value || ''}
 onChange={handleInputChange}
 className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent text-gray-700 bg-white text-sm sm:text-base"
 />
 ) : (
 <p className="text-gray-900 text-sm sm:text-base">
 {caseData?.monetary_value ? `$${parseFloat(caseData.monetary_value).toLocaleString()}` : 'N/A'}
 </p>
 )}
 </div>
 </div>

 {/* Additional Information Section */}
 <div className="bg-gray-50 px-4 sm:px-6 py-2.5 sm:py-3 border-b border-gray-200">
 <h2 className="text-base sm:text-lg font-semibold text-gray-900">Additional Information</h2>
 </div>
 <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
 {/* Folder ID */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Folder ID
 </label>
 <p className="text-gray-900 text-xs sm:text-sm font-mono break-all">{caseData?.folder_id || 'N/A'}</p>
 </div>

 {/* Created At */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Created At
 </label>
 <p className="text-gray-900 text-xs sm:text-sm">
 {caseData?.created_at ? new Date(caseData.created_at).toLocaleString() : 'N/A'}
 </p>
 </div>

 {/* Updated At */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 Updated At
 </label>
 <p className="text-gray-900 text-xs sm:text-sm">
 {caseData?.updated_at ? new Date(caseData.updated_at).toLocaleString() : 'N/A'}
 </p>
 </div>

 {/* User ID */}
 <div>
 <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
 User ID
 </label>
 <p className="text-gray-900 text-xs sm:text-sm break-all">{caseData?.user_id || 'N/A'}</p>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
};

export default CaseDetailView;