// import React from 'react';
// import PropTypes from 'prop-types';

// const ACTIVE_COLOR = '#21C1B6';
// const INACTIVE_BORDER = 'rgb(209, 213, 219)';
// const INACTIVE_TEXT = 'rgb(107, 114, 128)';

// /**
//  * Professional step progress component (Create New Case style).
//  * - Title top left, "Step X of Y" below, Cancel top right
//  * - Horizontal steps: circular icons + labels, thin connecting lines
//  * - Active step: teal fill, white icon, shadow; inactive: light gray outline
//  * - Accessible, responsive, with smooth transitions
//  */
// const StepProgress = ({
//   title,
//   totalSteps,
//   currentStep,
//   steps,
//   onCancel,
//   onStepClick,
//   cancelLabel = 'Cancel',
// }) => {
//   const safeStep = Math.max(1, Math.min(currentStep, totalSteps));

//   return (
//     <div className="w-full mb-0" role="navigation" aria-label={`${title}, step ${safeStep} of ${totalSteps}`}>
//       {/* Header: title + step count (stacked left), Cancel right - compact height */}
//       <div className="flex items-start justify-between gap-4 mb-1">
//         <div>
//           <h1 className="text-base sm:text-lg font-bold text-gray-900 leading-tight">{title}</h1>
//           <p className="text-xs text-gray-500 mt-0.5" aria-live="polite">
//             Step {safeStep} of {totalSteps}
//           </p>
//         </div>
//         {onCancel && (
//           <button
//             type="button"
//             onClick={onCancel}
//             className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#21C1B6] rounded px-1 py-0.5 transition-colors shrink-0"
//             aria-label={`${cancelLabel}, exit wizard`}
//           >
//             {cancelLabel}
//           </button>
//         )}
//       </div>

//       {/* Step bar: larger circles, more gap between steps; reduced top margin for shorter height */}
//       <div
//         className="flex justify-center overflow-x-auto mt-3"
//         role="progressbar"
//         aria-valuenow={safeStep}
//         aria-valuemin={1}
//         aria-valuemax={totalSteps}
//         aria-valuetext={`Step ${safeStep} of ${totalSteps}`}
//       >
//         <div className="flex items-center gap-6">
//           {steps.map((step, index) => {
//           const stepNumber = index + 1;
//           const isActive = stepNumber === safeStep;
//           const isComplete = safeStep > stepNumber;
//           const Icon = step.icon;

//           return (
//             <React.Fragment key={stepNumber}>
//               {index > 0 && (
//                 <div
//                   className="flex-shrink-0 flex-1 min-w-[24px] max-w-[48px] h-px self-center transition-colors duration-300"
//                   style={{
//                     backgroundColor: safeStep > index ? ACTIVE_COLOR : INACTIVE_BORDER,
//                   }}
//                   aria-hidden
//                 />
//               )}

//               <button
//                 type="button"
//                 onClick={() => onStepClick && onStepClick(stepNumber)}
//                 disabled={!onStepClick}
//                 className={`
//                   flex flex-col items-center flex-shrink-0 py-0
//                   ${onStepClick ? 'cursor-pointer' : 'cursor-default'}
//                   focus:outline-none rounded-full
//                 `}
//                 aria-current={isActive ? 'step' : undefined}
//                 aria-label={`${step.label}${isActive ? ', current step' : ''}`}
//               >
//                 <span
//                   className={`
//                     flex items-center justify-center w-10 h-10 rounded-full
//                     ${isActive
//                       ? 'bg-[#21C1B6] text-white'
//                       : isComplete
//                         ? 'bg-[#21C1B6]/10 text-[#21C1B6] border border-[#21C1B6]/20'
//                         : 'bg-white border border-gray-300 text-gray-400'
//                     }
//                   `}
//                 >
//                   {Icon && <Icon className="w-5 h-5" aria-hidden />}
//                 </span>
//                 <span
//                   className={`
//                     mt-2 text-[11px] sm:text-xs font-medium text-center max-w-[72px] truncate
//                     ${isActive ? 'text-gray-900 font-semibold' : isComplete ? 'text-gray-600' : 'text-gray-400'}
//                   `}
//                 >
//                   {step.label}
//                 </span>
//               </button>
//             </React.Fragment>
//           );
//           })}
//         </div>
//       </div>
//     </div>
//   );
// };

// StepProgress.propTypes = {
//   title: PropTypes.string.isRequired,
//   totalSteps: PropTypes.number.isRequired,
//   currentStep: PropTypes.number.isRequired,
//   steps: PropTypes.arrayOf(
//     PropTypes.shape({
//       label: PropTypes.string.isRequired,
//       icon: PropTypes.elementType,
//     })
//   ).isRequired,
//   onCancel: PropTypes.func,
//   onStepClick: PropTypes.func,
//   cancelLabel: PropTypes.string,
// };

// export default StepProgress;


import React from 'react';
import PropTypes from 'prop-types';

const ACTIVE_COLOR = '#21C1B6';
const INACTIVE_BORDER = 'rgb(209, 213, 219)';
const INACTIVE_TEXT = 'rgb(107, 114, 128)';

/**
 * Professional step progress component (Create New Case style).
 * - Title top left, "Step X of Y" below, Cancel top right
 * - Horizontal steps: circular icons + labels, thin connecting lines
 * - Active step: teal fill, white icon, shadow; inactive: light gray outline
 * - Accessible, responsive, with smooth transitions
 */
const StepProgress = ({
  title,
  totalSteps,
  currentStep,
  steps,
  onCancel,
  onStepClick,
  onRename,
  cancelLabel = 'Cancel',
}) => {
  const safeStep = Math.max(1, Math.min(currentStep, totalSteps));

  return (
    <div className="w-full mb-0" role="navigation" aria-label={`${title}, step ${safeStep} of ${totalSteps}`}>
      {/* Header: title + step count (stacked left), Cancel right - compact height */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 group">
            <h1 className="text-base sm:text-lg font-bold text-gray-900 leading-tight">{title}</h1>
            {onRename && (
              <button
                type="button"
                onClick={onRename}
                className="p-1 text-gray-400 hover:text-[#21C1B6] hover:bg-[#21C1B6]/10 rounded-md transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                title="Rename Draft"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5" aria-live="polite">
            Step {safeStep} of {totalSteps}
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#21C1B6] rounded px-1 py-0.5 transition-colors shrink-0"
            aria-label={`${cancelLabel}, exit wizard`}
          >
            {cancelLabel}
          </button>
        )}
      </div>

      {/* Step bar: Updated design to match screenshot */}
      <div
        className="flex justify-center overflow-x-auto mt-4"
        role="progressbar"
        aria-valuenow={safeStep}
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-valuetext={`Step ${safeStep} of ${totalSteps}`}
      >
        <div className="flex items-center">
          {steps.map((step, index) => {
            const stepNumber = index + 1;
            const isActive = stepNumber === safeStep;
            const isComplete = safeStep > stepNumber;
            const Icon = step.icon;

            return (
              <React.Fragment key={stepNumber}>
                {/* Connecting line - updated styling */}
                {index > 0 && (
                  <div
                    className="h-px transition-colors duration-300"
                    style={{
                      width: '80px',
                      backgroundColor: safeStep > index ? ACTIVE_COLOR : INACTIVE_BORDER,
                    }}
                    aria-hidden="true"
                  />
                )}

                {/* Step button */}
                <button
                  type="button"
                  onClick={() => onStepClick && onStepClick(stepNumber)}
                  disabled={!onStepClick}
                  className={`
                    flex flex-col items-center
                    ${onStepClick ? 'cursor-pointer' : 'cursor-default'}
                    focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#21C1B6] rounded-lg p-1
                  `}
                  aria-current={isActive ? 'step' : undefined}
                  aria-label={`${step.label}${isActive ? ', current step' : ''}`}
                >
                  {/* Circle - updated to match screenshot design */}
                  <span
                    className={`
                      flex items-center justify-center w-12 h-12 rounded-full transition-all duration-300
                      ${isActive
                        ? 'bg-[#21C1B6] text-white shadow-md'
                        : 'bg-gray-200 text-gray-400'
                      }
                    `}
                  >
                    {Icon && <Icon className="w-5 h-5" aria-hidden="true" />}
                  </span>

                  {/* Label - updated styling */}
                  <span
                    className={`
                      mt-2 text-xs font-medium text-center max-w-[80px] truncate transition-colors duration-300
                      ${isActive ? 'text-gray-900' : 'text-gray-500'}
                    `}
                  >
                    {step.label}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
};

StepProgress.propTypes = {
  title: PropTypes.string.isRequired,
  totalSteps: PropTypes.number.isRequired,
  currentStep: PropTypes.number.isRequired,
  steps: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      icon: PropTypes.elementType,
    })
  ).isRequired,
  onCancel: PropTypes.func,
  onStepClick: PropTypes.func,
  cancelLabel: PropTypes.string,
};

export default StepProgress;