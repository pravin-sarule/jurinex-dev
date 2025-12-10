// import React from 'react';
// import { CheckCircle, Clock, AlertCircle } from 'lucide-react';

// // Processing stages configuration
// const PROCESSING_STAGES = [
//   { start: 0, end: 5, label: "Queued & Job Creation", color: "bg-amber-500", shortLabel: "Queued" },
//   { start: 5, end: 15, label: "Document Upload to Cloud", color: "bg-blue-500", shortLabel: "Upload" },
//   { start: 15, end: 20, label: "Batch Processing Initialization", color: "bg-indigo-500", shortLabel: "Init" },
//   { start: 20, end: 42, label: "Batch Document AI Processing (OCR)", color: "bg-purple-500", shortLabel: "OCR" },
//   { start: 42, end: 45, label: "Fetching Batch Results", color: "bg-pink-500", shortLabel: "Fetch" },
//   { start: 45, end: 48, label: "Configuration Fetching", color: "bg-rose-500", shortLabel: "Config" },
//   { start: 48, end: 58, label: "Document Chunking", color: "bg-orange-500", shortLabel: "Chunk" },
//   { start: 58, end: 76, label: "Embedding Generation", color: "bg-yellow-500", shortLabel: "Embed" },
//   { start: 76, end: 82, label: "Saving Chunks to Database", color: "bg-lime-500", shortLabel: "Save" },
//   { start: 82, end: 88, label: "Storing Vector Embeddings", color: "bg-green-500", shortLabel: "Vector" },
//   { start: 88, end: 96, label: "AI Summary Generation", color: "bg-emerald-500", shortLabel: "Summary" },
//   { start: 96, end: 100, label: "Finalizing & Metadata Update", color: "bg-teal-500", shortLabel: "Finalize" },
//   { start: 100, end: 100, label: "Completed", color: "bg-green-600", shortLabel: "Done" }
// ];

// const ProgressStageIndicator = ({ 
//   progress = 0, 
//   status = 'pending', 
//   compact = false, 
//   showLabels = true,
//   className = '' 
// }) => {
//   const getCurrentStage = (progress) => {
//     if (progress >= 100) {
//       return PROCESSING_STAGES.find(stage => stage.start === 100);
//     }
    
//     return PROCESSING_STAGES.find(stage => 
//       progress >= stage.start && progress < stage.end
//     ) || PROCESSING_STAGES[0];
//   };

//   const getCompletedStages = (progress) => {
//     return PROCESSING_STAGES.filter(stage => progress > stage.end);
//   };

//   const getStageProgress = (progress, stage) => {
//     if (progress <= stage.start) return 0;
//     if (progress >= stage.end) return 100;
    
//     const stageRange = stage.end - stage.start;
//     const progressInStage = progress - stage.start;
//     return (progressInStage / stageRange) * 100;
//   };

//   const getStageIcon = (stage, isCompleted, isCurrent, isFailed) => {
//     if (isFailed) {
//       return <AlertCircle className="w-3 h-3 text-red-600" />;
//     } else if (isCompleted) {
//       return <CheckCircle className="w-3 h-3 text-green-600" />;
//     } else if (isCurrent) {
//       return <Clock className="w-3 h-3 text-blue-600 animate-spin" />;
//     } else {
//       return <div className="w-3 h-3 rounded-full border-2 border-gray-300"></div>;
//     }
//   };

//   const currentStage = getCurrentStage(progress);
//   const completedStages = getCompletedStages(progress);
//   const isFailed = ['failed', 'error'].includes(status.toLowerCase());
//   const isCompleted = ['completed', 'processed', 'ready', 'success'].includes(status.toLowerCase());

//   if (compact) {
//     return (
//       <div className={`flex items-center space-x-1 ${className}`}>
//         {PROCESSING_STAGES.filter(stage => stage.start < 100).map((stage, index) => {
//           const isStageCompleted = completedStages.includes(stage);
//           const isCurrentStage = currentStage?.start === stage.start;
//           const stageProgress = getStageProgress(progress, stage);
          
//           return (
//             <div
//               key={index}
//               className="relative group"
//               title={`${stage.label} (${stage.start}% - ${stage.end}%)`}
//             >
//               <div className="w-6 h-2 bg-gray-200 rounded-full overflow-hidden">
//                 <div
//                   className={`h-full transition-all duration-300 ${
//                     isFailed && isCurrentStage
//                       ? 'bg-red-500'
//                       : isStageCompleted
//                       ? 'bg-green-500'
//                       : isCurrentStage
//                       ? stage.color
//                       : 'bg-gray-300'
//                   }`}
//                   style={{
//                     width: `${
//                       isFailed && isCurrentStage
//                         ? 100
//                         : isStageCompleted
//                         ? 100
//                         : isCurrentStage
//                         ? stageProgress
//                         : 0
//                     }%`
//                   }}
//                 ></div>
//               </div>
              
//               {/* Tooltip */}
//               <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-10">
//                 {stage.label}
//               </div>
//             </div>
//           );
//         })}
//       </div>
//     );
//   }

//   return (
//     <div className={`space-y-2 ${className}`}>
//       {/* Overall Progress */}
//       <div className="flex items-center justify-between mb-3">
//         <span className="text-sm font-medium text-gray-700">Overall Progress</span>
//         <span className="text-sm font-bold text-gray-900">{progress.toFixed(1)}%</span>
//       </div>
      
//       <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
//         <div
//           className={`h-3 rounded-full transition-all duration-500 ${
//             isFailed ? 'bg-red-500' : isCompleted ? 'bg-green-500' : 'bg-blue-500'
//           }`}
//           style={{ width: `${progress}%` }}
//         ></div>
//       </div>

//       {/* Current Stage Highlight */}
//       {currentStage && !isCompleted && (
//         <div className="mb-4 p-3 bg-blue-50 rounded-md border-l-4 border-blue-500">
//           <div className="flex items-center justify-between mb-1">
//             <span className="text-sm font-medium text-blue-800">Current Stage</span>
//             <span className="text-xs text-blue-600">
//               {currentStage.start}% - {currentStage.end}%
//             </span>
//           </div>
//           <p className="text-sm text-blue-700 mb-2">{currentStage.label}</p>
          
//           {/* Stage Progress Bar */}
//           <div className="w-full bg-blue-200 rounded-full h-2">
//             <div
//               className={`h-2 rounded-full transition-all duration-300 ${
//                 isFailed ? 'bg-red-500' : currentStage.color
//               }`}
//               style={{ width: `${getStageProgress(progress, currentStage)}%` }}
//             ></div>
//           </div>
//         </div>
//       )}

//       {/* Detailed Stages */}
//       {showLabels && (
//         <div className="space-y-2">
//           <h4 className="text-sm font-medium text-gray-800">Processing Stages</h4>
//           {PROCESSING_STAGES.filter(stage => stage.start < 100).map((stage, index) => {
//             const isStageCompleted = completedStages.includes(stage);
//             const isCurrentStage = currentStage?.start === stage.start;
//             const stageProgress = getStageProgress(progress, stage);
//             const isFailedStage = isFailed && isCurrentStage;
            
//             return (
//               <div
//                 key={index}
//                 className={`p-2 rounded-md border ${
//                   isFailedStage
//                     ? 'border-red-300 bg-red-50'
//                     : isCurrentStage
//                     ? 'border-blue-300 bg-blue-50'
//                     : isStageCompleted
//                     ? 'border-green-300 bg-green-50'
//                     : 'border-gray-200 bg-white'
//                 }`}
//               >
//                 <div className="flex items-center justify-between mb-1">
//                   <div className="flex items-center gap-2">
//                     {getStageIcon(stage, isStageCompleted, isCurrentStage, isFailedStage)}
//                     <span className="text-xs font-medium text-gray-700">
//                       {stage.label}
//                     </span>
//                   </div>
//                   <span className="text-xs text-gray-500">
//                     {stage.start}% - {stage.end}%
//                   </span>
//                 </div>
                
//                 {/* Stage-specific progress bar */}
//                 <div className="w-full bg-gray-200 rounded-full h-1.5">
//                   <div
//                     className={`h-1.5 rounded-full transition-all duration-300 ${
//                       isFailedStage
//                         ? 'bg-red-500'
//                         : isStageCompleted
//                         ? 'bg-green-500'
//                         : isCurrentStage
//                         ? stage.color
//                         : 'bg-gray-300'
//                     }`}
//                     style={{
//                       width: `${
//                         isFailedStage
//                           ? 100
//                           : isStageCompleted
//                           ? 100
//                           : isCurrentStage
//                           ? stageProgress
//                           : 0
//                       }%`
//                     }}
//                   ></div>
//                 </div>
//               </div>
//             );
//           })}
//         </div>
//       )}

//       {/* Completion Status */}
//       {isCompleted && (
//         <div className="mt-3 p-3 bg-green-50 rounded-md border-l-4 border-green-500">
//           <div className="flex items-center gap-2">
//             <CheckCircle className="w-4 h-4 text-green-600" />
//             <span className="text-sm font-medium text-green-800">Processing Complete</span>
//             <span className="text-sm text-green-600">100%</span>
//           </div>
//         </div>
//       )}

//       {/* Error Status */}
//       {isFailed && (
//         <div className="mt-3 p-3 bg-red-50 rounded-md border-l-4 border-red-500">
//           <div className="flex items-center gap-2">
//             <AlertCircle className="w-4 h-4 text-red-600" />
//             <span className="text-sm font-medium text-red-800">Processing Failed</span>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default ProgressStageIndicator;