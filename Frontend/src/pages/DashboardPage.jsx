// import React from 'react';

// const DashboardPage = () => {
//   return (
//     <div className="flex flex-col items-center justify-center h-full text-center">
//       {/* <div className="bg-blue-100 rounded-2xl p-4 mb-6"> */}
//       <div className="bg-white-100 rounded-2xl p-4 mb-6">

//         <span className="text-4xl">⚖️</span>
//       </div>
//       <h1 className="text-3xl font-semibold text-gray-800 mb-3">Welcome to Nexintel AI</h1>
//       <p className="text-gray-600 mb-8 max-w-md">
//         Your AI-powered legal assistant for document processing, case analysis, and legal drafting. Choose an action
//         below to get started.
//       </p>
//       {/* <div className="grid md:grid-cols-3 gap-4 w-full max-w-2xl">
//         <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-blue-500 hover:shadow-lg transition-all cursor-pointer">
//           <div className="bg-blue-600 h-8 w-8 rounded-md mb-3"></div>
//           <h3 className="font-semibold text-gray-800 mb-1">Upload Documents</h3>
//           <p className="text-sm text-gray-600">Upload case files for AI-powered analysis and summarization</p>
//         </div>
//         <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-blue-500 hover:shadow-lg transition-all cursor-pointer">
//           <div className="bg-blue-600 h-8 w-8 rounded-md mb-3"></div>
//           <h3 className="font-semibold text-gray-800 mb-1">AI Case Analysis</h3>
//           <p className="text-sm text-gray-600">Get role-specific summaries for judges, lawyers, and clients</p>
//         </div>
//         <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-blue-500 hover:shadow-lg transition-all cursor-pointer">
//           <div className="bg-blue-600 h-8 w-8 rounded-md mb-3"></div>
//           <h3 className="font-semibold text-gray-800 mb-1">Document Drafting</h3>
//           <p className="text-sm text-gray-600">Generate legal documents using AI and templates</p>
//         </div>
//       </div> */}
//     </div>
//   );
// };

// export default DashboardPage;


// import React, { useState } from 'react';
// import { Calendar, Lightbulb, FileEdit, Plus, Search, Paperclip, Send } from 'lucide-react';

// const DashboardPage = () => {
//   const [hoveredCard, setHoveredCard] = useState(null);

//   const insights = [
//     {
//       icon: <Calendar className="w-5 h-5" />,
//       title: "Upcoming Hearing",
//       description: "For CRL/567/2024 has a hearing in less than 48 hours (DT-J HC). Prepare for hearing.",
//       action: "Prepare for hearing",
//       color: "#21C1B6"
//     },
//     {
//       icon: <Lightbulb className="w-5 h-5" />,
//       title: "AI Suggested Precedent",
//       description: "For CIV/123/2023, AI recommends checking ABC v. XYZ similar arguments.",
//       action: "View precedent",
//       color: "#21C1B6"
//     },
//     {
//       icon: <FileEdit className="w-5 h-5" />,
//       title: "Drafting Enhancement",
//       description: "Consider incorporating latest amendments for TAX/789/2022 draft based on recent circulars.",
//       action: "Review Draft",
//       color: "#21C1B6"
//     }
//   ];

//   const cases = [
//     {
//       caseNo: "CRL/567/2024",
//       court: "Delhi HC - Bench 3",
//       type: "Criminal/Trial",
//       client: "Raj Kumar Singh vs State",
//       advocate: "A. Sharma",
//       nextHearing: "12-Oct-2025",
//       status: "Active",
//       docs: "23"
//     },
//     {
//       caseNo: "CIV/234/2024",
//       court: "Bombay HC - Bench 1",
//       type: "Civil/Appeal",
//       client: "Tech Solutions Ltd vs ABC Corp",
//       advocate: "P. Mehta",
//       nextHearing: "15-Oct-2025",
//       status: "Active",
//       docs: "42"
//     },
//     {
//       caseNo: "CON/789/2024",
//       court: "Supreme Court - Bench 2",
//       type: "Constitutional/Review",
//       client: "Citizens Forum vs Union of India",
//       advocate: "S. Verma",
//       nextHearing: "18-Oct-2025",
//       status: "Active",
//       docs: "15"
//     },
//     {
//       caseNo: "CIV/456/2024",
//       court: "Karnataka HC - Bench",
//       type: "Civil/Trial",
//       client: "Priya Enterprises vs Bank Ltd",
//       advocate: "R. Nair",
//       nextHearing: "22-Oct-2025",
//       status: "Pending",
//       docs: "22"
//     }
//   ];

//   return (
//     <div className="min-h-screen bg-white p-8">
//       {/* Header */}
//       <div className="flex justify-between items-center mb-8">
//         <h1 className="text-2xl font-semibold text-gray-900">Hello, Adv. Vikram Sharma</h1>
//         <button 
//           className="px-6 py-2 rounded-lg text-white font-medium transition-colors"
//           style={{ backgroundColor: '#21C1B6' }}
//           onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//           onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//         >
//           Create New Case
//         </button>
//       </div>

//       {/* Help Section */}
//       <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8 shadow-sm">
//         <h2 className="text-lg font-medium text-gray-900 mb-4">How can I help you today ?</h2>
        
//         <div className="flex gap-3 mb-4">
//           <button 
//             className="px-4 py-2 rounded-lg text-white font-medium text-sm transition-colors"
//             style={{ backgroundColor: '#21C1B6' }}
//             onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//             onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//           >
//             Summarize Case Brief
//           </button>
//           <button className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700 font-medium text-sm hover:bg-gray-200 transition-colors">
//             Find Precedents
//           </button>
//           <button className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700 font-medium text-sm hover:bg-gray-200 transition-colors">
//             Draft Petition
//           </button>
//           <button className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700 font-medium text-sm hover:bg-gray-200 transition-colors">
//             Generate Client Summary
//           </button>
//         </div>

//         <div className="relative">
//           <input 
//             type="text" 
//             placeholder="Ask anything about your cases or upload documents to get started..."
//             className="w-full px-4 py-3 border border-gray-300 rounded-lg pr-20 focus:outline-none focus:border-gray-400"
//           />
//           <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2">
//             <button className="p-1.5 hover:bg-gray-100 rounded">
//               <Paperclip className="w-5 h-5 text-gray-500" />
//             </button>
//             <button className="p-1.5 hover:bg-gray-100 rounded">
//               <Send className="w-5 h-5 text-gray-500" />
//             </button>
//           </div>
//         </div>
//       </div>

//       {/* Insights & Recommendations */}
//       <div className="mb-8">
//         <h2 className="text-lg font-semibold text-gray-900 mb-4">Insights & Recommendations</h2>
//         <div className="grid grid-cols-3 gap-6">
//           {insights.map((insight, index) => (
//             <div 
//               key={index}
//               className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
//             >
//               <div className="flex items-start gap-3 mb-4">
//                 <div 
//                   className="p-2 rounded-lg text-white"
//                   style={{ backgroundColor: insight.color }}
//                 >
//                   {insight.icon}
//                 </div>
//                 <h3 className="font-semibold text-gray-900 flex-1">{insight.title}</h3>
//               </div>
//               <p className="text-sm text-gray-600 mb-4">{insight.description}</p>
//               <button 
//                 className="text-sm font-medium flex items-center gap-1 transition-colors"
//                 style={{ color: '#21C1B6' }}
//                 onMouseEnter={(e) => (e.currentTarget.style.color = '#1AA49B')}
//                 onMouseLeave={(e) => (e.currentTarget.style.color = '#21C1B6')}
//               >
//                 {insight.action} →
//               </button>
//             </div>
//           ))}
//         </div>
//       </div>

//       {/* Cases Section */}
//       <div>
//         <div className="flex justify-between items-center mb-4">
//           <h2 className="text-lg font-semibold text-gray-900">Cases</h2>
//         </div>

//         <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
//           <div className="flex border-b border-gray-200">
//             <button 
//               className="px-6 py-3 font-medium text-sm transition-colors"
//               style={{ color: '#21C1B6', borderBottom: '2px solid #21C1B6' }}
//             >
//               Ongoing (4)
//             </button>
//             <button className="px-6 py-3 text-gray-600 font-medium text-sm hover:text-gray-900">
//               Disposed (08)
//             </button>
//             <button className="px-6 py-3 text-gray-600 font-medium text-sm hover:text-gray-900">
//               Archived (12)
//             </button>
//           </div>

//           <table className="w-full">
//             <thead className="bg-gray-50 border-b border-gray-200">
//               <tr>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Case No.</th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Court/Bench</th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Case Type/Stage</th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Client/Opponent</th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Advocate-in-Charge</th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Next Hearing</th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Status</th>
//                 <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Docs</th>
//               </tr>
//             </thead>
//             <tbody className="bg-white divide-y divide-gray-200">
//               {cases.map((caseItem, index) => (
//                 <tr key={index} className="hover:bg-gray-50 transition-colors">
//                   <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{caseItem.caseNo}</td>
//                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{caseItem.court}</td>
//                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{caseItem.type}</td>
//                   <td className="px-6 py-4 text-sm text-gray-600">{caseItem.client}</td>
//                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{caseItem.advocate}</td>
//                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{caseItem.nextHearing}</td>
//                   <td className="px-6 py-4 whitespace-nowrap">
//                     <span className={`px-3 py-1 rounded-full text-xs font-medium ${
//                       caseItem.status === 'Active' 
//                         ? 'bg-green-100 text-green-800' 
//                         : 'bg-yellow-100 text-yellow-800'
//                     }`}>
//                       {caseItem.status}
//                     </span>
//                   </td>
//                   <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{caseItem.docs}</td>
//                 </tr>
//               ))}
//             </tbody>
//           </table>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default DashboardPage;





// import React, { useState } from 'react';
// import { Calendar, Lightbulb, FileEdit } from 'lucide-react';
// import DashboardHeader from '../components/DashboardComponents/DashboardHeader';
// // import DashboardHelpSection from '../components/DashboardComponents/DashboardHelpSection';
// import DashboardInsights from '../components/DashboardComponents/DashboardInsights';
// import DashboardCasesTable from '../components/DashboardComponents/DashboardCasesTable';

// const DashboardPage = () => {
//   const insights = [
//     {
//       icon: <Calendar className="w-5 h-5" />,
//       title: "Upcoming Hearing",
//       description: "For CRL/567/2024 has a hearing in less than 48 hours (DT-J HC). Prepare for hearing.",
//       action: "Prepare for hearing",
//       color: "#21C1B6"
//     },
//     {
//       icon: <Lightbulb className="w-5 h-5" />,
//       title: "AI Suggested Precedent",
//       description: "For CIV/123/2023, AI recommends checking ABC v. XYZ similar arguments.",
//       action: "View precedent",
//       color: "#21C1B6"
//     },
//     {
//       icon: <FileEdit className="w-5 h-5" />,
//       title: "Drafting Enhancement",
//       description: "Consider incorporating latest amendments for TAX/789/2022 draft based on recent circulars.",
//       action: "Review Draft",
//       color: "#21C1B6"
//     }
//   ];

//   const cases = [
//     {
//       caseNo: "CRL/567/2024",
//       court: "Delhi HC - Bench 3",
//       type: "Criminal/Trial",
//       client: "Raj Kumar Singh vs State",
//       advocate: "A. Sharma",
//       nextHearing: "12-Oct-2025",
//       status: "Active",
//       docs: "23"
//     },
//     {
//       caseNo: "CIV/234/2024",
//       court: "Bombay HC - Bench 1",
//       type: "Civil/Appeal",
//       client: "Tech Solutions Ltd vs ABC Corp",
//       advocate: "P. Mehta",
//       nextHearing: "15-Oct-2025",
//       status: "Active",
//       docs: "42"
//     },
//     {
//       caseNo: "CON/789/2024",
//       court: "Supreme Court - Bench 2",
//       type: "Constitutional/Review",
//       client: "Citizens Forum vs Union of India",
//       advocate: "S. Verma",
//       nextHearing: "18-Oct-2025",
//       status: "Active",
//       docs: "15"
//     },
//     {
//       caseNo: "CIV/456/2024",
//       court: "Karnataka HC - Bench",
//       type: "Civil/Trial",
//       client: "Priya Enterprises vs Bank Ltd",
//       advocate: "R. Nair",
//       nextHearing: "22-Oct-2025",
//       status: "Pending",
//       docs: "22"
//     }
//   ];

//   return (
//     <div className="flex flex-col h-full bg-white overflow-hidden">
//       <div className="p-8">
//         <DashboardHeader />
//       </div>
//       {/* <DashboardHelpSection /> */}
//       <div className="flex-grow overflow-y-auto p-8 pt-0">
//         <DashboardInsights insights={insights} />
//         <DashboardCasesTable cases={cases} />
//       </div>
//     </div>
//   );
// };

// export default DashboardPage;



import React, { useState } from 'react';
import { Calendar, Lightbulb, FileEdit, FolderOpen, Brain } from 'lucide-react';
import { useNavigate } from 'react-router-dom'; // Add this import for navigation
import DashboardHeader from '../components/DashboardComponents/DashboardHeader';
// import DashboardHelpSection from '../components/DashboardComponents/DashboardHelpSection';
import DashboardInsights from '../components/DashboardComponents/DashboardInsights';
import DashboardCasesTable from '../components/DashboardComponents/DashboardCasesTable';

const DashboardPage = () => {
  const navigate = useNavigate();

  const insights = [
    {
      icon: <FolderOpen className="w-5 h-5" />,
      title: "Case Management",
      description: "Organize and manage your case documents efficiently. Access all case files, evidence, and documentation in one place.",
      action: "Manage Cases",
      color: "#21C1B6",
      onClick: () => navigate('/documents') // Navigate to projects page
    },
    {
      icon: <Brain className="w-5 h-5" />,
      title: "Document Analysis ",
      description: "AI-powered legal analysis ready for your cases. Get intelligent insights and recommendations for better case preparation.",
      action: "View Analysis",
      color: "#21C1B6",
      onClick: () => navigate('/analysis') // Navigate to analysis page
    },
    {
      icon: <FileEdit className="w-5 h-5" />,
      title: "Drafting Enhancement",
      description: "Consider incorporating latest amendments for TAX/789/2022 draft based on recent circulars.",
      action: "Review Draft",
      color: "#21C1B6",
      onClick: () => {} // Keep as is - no navigation
    }
  ];

  const cases = [
    {
      caseNo: "CRL/567/2024",
      court: "Delhi HC - Bench 3",
      type: "Criminal/Trial",
      client: "Raj Kumar Singh vs State",
      advocate: "A. Sharma",
      nextHearing: "12-Oct-2025",
      status: "Active",
      docs: "23"
    },
    {
      caseNo: "CIV/234/2024",
      court: "Bombay HC - Bench 1",
      type: "Civil/Appeal",
      client: "Tech Solutions Ltd vs ABC Corp",
      advocate: "P. Mehta",
      nextHearing: "15-Oct-2025",
      status: "Active",
      docs: "42"
    },
    {
      caseNo: "CON/789/2024",
      court: "Supreme Court - Bench 2",
      type: "Constitutional/Review",
      client: "Citizens Forum vs Union of India",
      advocate: "S. Verma",
      nextHearing: "18-Oct-2025",
      status: "Active",
      docs: "15"
    },
    {
      caseNo: "CIV/456/2024",
      court: "Karnataka HC - Bench",
      type: "Civil/Trial",
      client: "Priya Enterprises vs Bank Ltd",
      advocate: "R. Nair",
      nextHearing: "22-Oct-2025",
      status: "Pending",
      docs: "22"
    }
  ];

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <div className="p-8">
        <DashboardHeader />
      </div>
      {/* <DashboardHelpSection /> */}
      <div className="flex-grow overflow-y-auto p-8 pt-0">
        <DashboardInsights insights={insights} />
        <DashboardCasesTable cases={cases} />
      </div>
    </div>
  );
};

export default DashboardPage;