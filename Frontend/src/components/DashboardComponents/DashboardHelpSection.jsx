// import React from 'react';
// import { Paperclip, Send } from 'lucide-react';

// const DashboardHelpSection = () => {
//   return (
//     <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8 shadow-sm">
//       <h2 className="text-lg font-medium text-gray-900 mb-4">How can I help you today ?</h2>
      
//       <div className="flex gap-3 mb-4">
//         <button 
//           className="px-4 py-2 rounded-lg text-white font-medium text-sm transition-colors"
//           style={{ backgroundColor: '#21C1B6' }}
//           onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//           onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//         >
//           Summarize Case Brief
//         </button>
//         <button className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700 font-medium text-sm hover:bg-gray-200 transition-colors">
//           Find Precedents
//         </button>
//         <button className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700 font-medium text-sm hover:bg-gray-200 transition-colors">
//           Draft Petition
//         </button>
//         <button className="px-4 py-2 bg-gray-100 rounded-lg text-gray-700 font-medium text-sm hover:bg-gray-200 transition-colors">
//           Generate Client Summary
//         </button>
//       </div>

//       <div className="relative">
//         <input 
//           type="text" 
//           placeholder="Ask anything about your cases or upload documents to get started..."
//           className="w-full px-4 py-3 border border-gray-300 rounded-lg pr-20 focus:outline-none focus:border-gray-400"
//         />
//         <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-2">
//           <button className="p-1.5 hover:bg-gray-100 rounded">
//             <Paperclip className="w-5 h-5 text-gray-500" />
//           </button>
//           <button className="p-1.5 hover:bg-gray-100 rounded">
//             <Send className="w-5 h-5 text-gray-500" />
//           </button>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default DashboardHelpSection;