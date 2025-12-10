// import React from 'react';
// import { Calendar, Lightbulb, FileEdit } from 'lucide-react';

// const DashboardInsights = ({ insights }) => {
//   return (
//     <div className="mb-8">
//       <h2 className="text-lg font-semibold text-gray-900 mb-4">Insights & Recommendations</h2>
//       <div className="grid grid-cols-3 gap-6">
//         {insights.map((insight, index) => (
//           <div 
//             key={index}
//             className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
//           >
//             <div className="flex items-start gap-3 mb-4">
//               <div 
//                 className="p-2 rounded-lg text-white"
//                 style={{ backgroundColor: insight.color }}
//               >
//                 {insight.icon}
//               </div>
//               <h3 className="font-semibold text-gray-900 flex-1">{insight.title}</h3>
//             </div>
//             <p className="text-sm text-gray-600 mb-4">{insight.description}</p>
//             <button 
//               className="text-sm font-medium flex items-center gap-1 transition-colors"
//               style={{ color: '#21C1B6' }}
//               onMouseEnter={(e) => (e.currentTarget.style.color = '#1AA49B')}
//               onMouseLeave={(e) => (e.currentTarget.style.color = '#21C1B6')}
//             >
//               {insight.action} →
//             </button>
//           </div>
//         ))}
//       </div>
//     </div>
//   );
// };

// export default DashboardInsights;



// import React from 'react';

// const DashboardInsights = ({ insights }) => {
//   return (
//     <div className="mb-8">
//       <h2 className="text-lg font-semibold text-gray-900 mb-4">Insights & Recommendations</h2>
//       <div className="grid grid-cols-3 gap-6">
//         {insights.map((insight, index) => (
//           <div 
//             key={index}
//             className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
//           >
//             <div className="flex items-start gap-3 mb-4">
//               <div 
//                 className="p-2 rounded-lg text-white"
//                 style={{ backgroundColor: insight.color }}
//               >
//                 {insight.icon}
//               </div>
//               <h3 className="font-semibold text-gray-900 flex-1">{insight.title}</h3>
//             </div>
//             <p className="text-sm text-gray-600 mb-4">{insight.description}</p>
//             <button 
//               className="text-sm font-medium flex items-center gap-1 transition-colors cursor-pointer"
//               style={{ color: '#21C1B6' }}
//               onMouseEnter={(e) => (e.currentTarget.style.color = '#1AA49B')}
//               onMouseLeave={(e) => (e.currentTarget.style.color = '#21C1B6')}
//               onClick={insight.onClick} // Add onClick handler
//             >
//               {insight.action} →
//             </button>
//           </div>
//         ))}
//       </div>
//     </div>
//   );
// };

// export default DashboardInsights;


import React from 'react';

const DashboardInsights = ({ insights }) => {
  return (
    <div className="mb-6 sm:mb-8 px-2 sm:px-0">
      <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">
        Insights & Recommendations
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
        {insights.map((insight, index) => (
          <div 
            key={index}
            className="bg-white border border-gray-200 rounded-lg sm:rounded-xl p-4 sm:p-5 lg:p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-start gap-2.5 sm:gap-3 mb-3 sm:mb-4">
              <div 
                className="p-1.5 sm:p-2 rounded-lg text-white flex-shrink-0"
                style={{ backgroundColor: insight.color }}
              >
                <div className="w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center">
                  {insight.icon}
                </div>
              </div>
              <h3 className="font-semibold text-gray-900 flex-1 text-sm sm:text-base leading-tight">
                {insight.title}
              </h3>
            </div>
            <p className="text-xs sm:text-sm text-gray-600 mb-3 sm:mb-4 leading-relaxed">
              {insight.description}
            </p>
            <button 
              className="text-xs sm:text-sm font-medium flex items-center gap-1 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:ring-offset-2 rounded px-1 -mx-1"
              style={{ color: '#21C1B6' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#1AA49B')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#21C1B6')}
              onClick={insight.onClick}
              aria-label={insight.action}
            >
              <span>{insight.action}</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DashboardInsights;