

// import React, { useRef, useEffect } from 'react';
// import { X } from 'lucide-react';

// const TermsAndConditions = ({
//   isOpen,
//   onClose,
//   onAccept,
//   showAcceptButton = true,
//   companyName = 'NexIntel AI',
//   effectiveDate = 'January 1, 2025',
// }) => {
//   const modalRef = useRef(null);

//   useEffect(() => {
//     const handleEsc = (e) => {
//       if (e.key === 'Escape') onClose();
//     };
//     if (isOpen) window.addEventListener('keydown', handleEsc);
//     return () => window.removeEventListener('keydown', handleEsc);
//   }, [isOpen, onClose]);

//   useEffect(() => {
//     const handleClickOutside = (e) => {
//       if (modalRef.current && !modalRef.current.contains(e.target)) {
//         onClose();
//       }
//     };
//     if (isOpen) document.addEventListener('mousedown', handleClickOutside);
//     return () => document.removeEventListener('mousedown', handleClickOutside);
//   }, [isOpen, onClose]);

//   if (!isOpen) return null;

//   const handleAccept = () => {
//     onAccept?.();
//     onClose();
//   };

//   return (
//     <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
//       <div
//         ref={modalRef}
//         className="w-full max-w-2xl bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col"
//         style={{ maxHeight: '90vh' }}
//       >
//         {/* HEADER - Now teal/gray to match register page */}
//         <div className="flex items-center justify-between p-4 bg-gray-800">
//           <div className="flex items-center gap-3">
//             <div className="w-8 h-8 rounded bg-[#1AA49B] flex items-center justify-center">
//               <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
//                 <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z"/>
//               </svg>
//             </div>
//             <h2 className="text-lg font-semibold text-white">Terms & Conditions</h2>
//           </div>
//           <button
//             onClick={onClose}
//             className="text-gray-400 hover:text-white transition p-1 rounded-full hover:bg-white/10"
//           >
//             <X size={22} />
//           </button>
//         </div>

//         {/* BODY */}
//         <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-gray-700">
//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">1. Introduction</h3>
//             <p className="leading-relaxed">
//               Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse varius enim in eros elementum tristique. Duis cursus, mi quis viverra ornare, eros dolor interdum nulla, ut commodo diam libero vitae erat. Aenean faucibus nibh et justo cursus id rutrum lorem imperdiet. Nunc ut sem vitae risus tristique posuere.
//             </p>
//           </section>

//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">2. User Obligations</h3>
//             <p className="leading-relaxed">
//               Praesent dapibus, neque id cursus faucibus, tortor neque egestas augue, eu vulputate magna eros eu erat. Aliquam erat volutpat. Nam dui mi, tincidunt quis, accumsan porttitor, facilisis luctus, metus. Phasellus ultricies nulla quis nibh. Quisque a lectus. Donec consectetuer ligula vulputate sem tristique cursus.
//             </p>
//           </section>

//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">3. Intellectual Property</h3>
//             <p className="leading-relaxed">
//               Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Vestibulum tortor quam, feugiat vitae, ultricies eget, tempor sit amet, ante. Donec eu libero sit amet quam egestas semper. Aenean ultricies mi vitae est. Mauris placerat eleifend leo.
//             </p>
//           </section>

//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">4. Limitation of Liability</h3>
//             <p className="leading-relaxed">
//               Etiam cursus leo vel metus. Nulla facilisi. Aenean nec eros. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia Curae; Suspendisse sollicitudin velit sed leo. Ut pharetra augue nec augue. Nam elit magna, hendrerit sit amet, tincidunt ac, viverra sed, nulla.
//             </p>
//           </section>

//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">5. Governing Law</h3>
//             <p className="leading-relaxed">
//               Fusce euismod consequat ante. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque sed dolor. Aliquam congue fermentum nisl. Mauris accumsan nulla vel diam. Sed in lacus ut enim adipiscing aliquet.
//             </p>
//           </section>
//         </div>

//         {/* FOOTER - Buttons now match Register button colors */}
//         <div className="flex items-center justify-between p-4 bg-gray-50 border-t border-gray-200">
//           <p className="text-xs text-gray-500">Effective Date: {effectiveDate}</p>
//           <div className="flex gap-2">
//             <button
//               onClick={onClose}
//               className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-100 transition"
//             >
//               Close
//             </button>
//             {showAcceptButton && (
//               <button
//                 onClick={handleAccept}
//                 className="px-4 py-2 text-sm font-medium text-white rounded transition flex items-center justify-center"
//                 style={{ backgroundColor: '#21C1B6' }}
//                 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//                 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//               >
//                 Accept & Close
//               </button>
//             )}
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default TermsAndConditions;

// import React, { useRef, useEffect } from 'react';
// import { X } from 'lucide-react';

// const TermsAndConditions = ({
//   isOpen,
//   onClose,
//   onAccept,
//   showAcceptButton = true,
//   companyName = 'JuriNex AI',
//   effectiveDate = 'January 1, 2025',
// }) => {
//   const modalRef = useRef(null);

//   useEffect(() => {
//     const handleEsc = (e) => {
//       if (e.key === 'Escape') onClose();
//     };
//     if (isOpen) window.addEventListener('keydown', handleEsc);
//     return () => window.removeEventListener('keydown', handleEsc);
//   }, [isOpen, onClose]);

//   useEffect(() => {
//     const handleClickOutside = (e) => {
//       if (modalRef.current && !modalRef.current.contains(e.target)) {
//         onClose();
//       }
//     };
//     if (isOpen) document.addEventListener('mousedown', handleClickOutside);
//     return () => document.removeEventListener('mousedown', handleClickOutside);
//   }, [isOpen, onClose]);

//   if (!isOpen) return null;

//   const handleAccept = () => {
//     onAccept?.();
//     onClose();
//   };

//   return (
//     <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
//       <div
//         ref={modalRef}
//         className="w-full max-w-2xl bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col"
//         style={{ maxHeight: '90vh' }}
//       >
//         {/* HEADER - Now teal/gray to match register page */}
//         <div className="flex items-center justify-between p-4 bg-gray-800">
//           <div className="flex items-center gap-3">
//             <div className="w-8 h-8 rounded bg-[#1AA49B] flex items-center justify-center">
//               <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
//                 <path d="M3 3h8l4 4-4 4H3V3zm10 10h8v8h-8l-4-4 4-4z"/>
//               </svg>
//             </div>
//             <h2 className="text-lg font-semibold text-white">Terms & Conditions</h2>
//           </div>
//           <button
//             onClick={onClose}
//             className="text-gray-400 hover:text-white transition p-1 rounded-full hover:bg-white/10"
//           >
//             <X size={22} />
//           </button>
//         </div>

//         {/* BODY */}
//         <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-gray-700">
//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">1. Introduction and Service Description</h3>
//             <p className="leading-relaxed">
//               Welcome to {companyName}, an AI-powered legal document summarization platform. Our service uses advanced artificial intelligence to analyze, summarize, and extract key insights from legal documents including contracts, case files, statutes, regulations, and other legal materials. By accessing or using our platform, you agree to be bound by these Terms & Conditions.
//             </p>
//           </section>

//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">2. AI Technology and Accuracy Disclaimer</h3>
//             <p className="leading-relaxed">
//               Our AI summarization technology is designed to assist legal professionals but should not replace human legal expertise. While we strive for accuracy, AI-generated summaries may contain errors, omissions, or misinterpretations. Users must review all AI outputs and verify information independently. {companyName} does not guarantee the completeness or accuracy of AI-generated content and disclaims liability for decisions based solely on our summaries.
//             </p>
//           </section>

//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">3. Professional Use and Legal Advice Limitation</h3>
//             <p className="leading-relaxed">
//               Our platform is intended for use by qualified legal professionals, law students, and authorized personnel within legal organizations. The summaries and insights provided do not constitute legal advice, legal opinions, or attorney-client privileged communications. Users must exercise professional judgment and consult with qualified attorneys before making legal decisions based on our AI-generated content.
//             </p>
//           </section>

//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">4. Document Security and Confidentiality</h3>
//             <p className="leading-relaxed">
//               We implement enterprise-grade security measures to protect uploaded legal documents. All documents are encrypted in transit and at rest. We maintain strict confidentiality protocols and do not share, sell, or use your documents for training purposes without explicit consent. Users remain responsible for ensuring they have proper authorization to upload and process documents through our platform, including compliance with attorney-client privilege and confidentiality requirements.
//             </p>
//           </section>

//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">5. Data Processing and Compliance</h3>
//             <p className="leading-relaxed">
//               Our platform processes legal documents in accordance with applicable data protection laws including GDPR, CCPA, and legal industry standards. We maintain audit trails of document processing activities and provide data portability options. Users consent to necessary data processing for AI analysis while retaining ownership of their original documents and generated summaries.
//             </p>
//           </section>

//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">6. Intellectual Property and Usage Rights</h3>
//             <p className="leading-relaxed">
//               Users retain full ownership of uploaded documents and generated summaries. {companyName} owns the underlying AI technology, algorithms, and platform infrastructure. Users are granted a non-exclusive license to use our platform for legitimate legal and professional purposes. Reverse engineering, unauthorized copying, or misuse of our AI technology is strictly prohibited.
//             </p>
//           </section>

//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">7. Limitation of Liability and Professional Responsibility</h3>
//             <p className="leading-relaxed">
//               {companyName} shall not be liable for any direct, indirect, incidental, or consequential damages arising from the use of AI-generated summaries in legal proceedings, client advice, or professional decisions. Users acknowledge that they bear full professional responsibility for verifying AI outputs and maintaining compliance with legal ethics rules, bar regulations, and professional standards in their jurisdiction.
//             </p>
//           </section>

//           <section>
//             <h3 className="font-semibold text-gray-900 mb-2">8. Governing Law and Dispute Resolution</h3>
//             <p className="leading-relaxed">
//               These terms are governed by the laws of [Jurisdiction]. Any disputes arising from the use of our legal AI platform shall be resolved through binding arbitration in accordance with commercial arbitration rules, with specific provisions for handling confidential legal materials and maintaining attorney-client privilege during dispute resolution proceedings.
//             </p>
//           </section>
//         </div>

//         {/* FOOTER - Buttons now match Register button colors */}
//         <div className="flex items-center justify-between p-4 bg-gray-50 border-t border-gray-200">
//           <p className="text-xs text-gray-500">Effective Date: {effectiveDate}</p>
//           <div className="flex gap-2">
//             <button
//               onClick={onClose}
//               className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-100 transition"
//             >
//               Close
//             </button>
//             {showAcceptButton && (
//               <button
//                 onClick={handleAccept}
//                 className="px-4 py-2 text-sm font-medium text-white rounded transition flex items-center justify-center"
//                 style={{ backgroundColor: '#21C1B6' }}
//                 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//                 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//               >
//                 Accept & Close
//               </button>
//             )}
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default TermsAndConditions;


import React, { useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import JuriNexLogo from '/src/assets/JuriNex_gavel_logo.png';

const TermsAndConditions = ({
  isOpen,
  onClose,
  onAccept,
  showAcceptButton = true,
  companyName = 'JuriNex AI',
  effectiveDate = 'January 1, 2025',
}) => {
  const modalRef = useRef(null);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onClose();
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleAccept = () => {
    onAccept?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        ref={modalRef}
        className="w-full max-w-2xl bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh' }}
      >
        {/* HEADER - Now teal/gray to match register page */}
        <div className="flex items-center justify-between p-4 bg-gray-800">
          <div className="flex items-center gap-3">
            <img 
              src={JuriNexLogo} 
              alt="JuriNex Logo" 
              className="w-8 h-8 object-contain"
            />
            <h2 className="text-lg font-semibold text-white">Terms & Conditions</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition p-1 rounded-full hover:bg-white/10"
          >
            <X size={22} />
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-gray-700">
          <section>
            <h3 className="font-semibold text-gray-900 mb-2">1. Introduction and Service Description</h3>
            <p className="leading-relaxed">
              Welcome to {companyName}, an AI-powered legal document summarization platform. Our service uses advanced artificial intelligence to analyze, summarize, and extract key insights from legal documents including contracts, case files, statutes, regulations, and other legal materials. By accessing or using our platform, you agree to be bound by these Terms & Conditions.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-2">2. AI Technology and Accuracy Disclaimer</h3>
            <p className="leading-relaxed">
              Our AI summarization technology is designed to assist legal professionals but should not replace human legal expertise. While we strive for accuracy, AI-generated summaries may contain errors, omissions, or misinterpretations. Users must review all AI outputs and verify information independently. {companyName} does not guarantee the completeness or accuracy of AI-generated content and disclaims liability for decisions based solely on our summaries.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-2">3. Professional Use and Legal Advice Limitation</h3>
            <p className="leading-relaxed">
              Our platform is intended for use by qualified legal professionals, law students, and authorized personnel within legal organizations. The summaries and insights provided do not constitute legal advice, legal opinions, or attorney-client privileged communications. Users must exercise professional judgment and consult with qualified attorneys before making legal decisions based on our AI-generated content.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-2">4. Document Security and Confidentiality</h3>
            <p className="leading-relaxed">
              We implement enterprise-grade security measures to protect uploaded legal documents. All documents are encrypted in transit and at rest. We maintain strict confidentiality protocols and do not share, sell, or use your documents for training purposes without explicit consent. Users remain responsible for ensuring they have proper authorization to upload and process documents through our platform, including compliance with attorney-client privilege and confidentiality requirements.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-2">5. Data Processing and Compliance</h3>
            <p className="leading-relaxed">
              Our platform processes legal documents in accordance with applicable data protection laws including GDPR, CCPA, and legal industry standards. We maintain audit trails of document processing activities and provide data portability options. Users consent to necessary data processing for AI analysis while retaining ownership of their original documents and generated summaries.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-2">6. Intellectual Property and Usage Rights</h3>
            <p className="leading-relaxed">
              Users retain full ownership of uploaded documents and generated summaries. {companyName} owns the underlying AI technology, algorithms, and platform infrastructure. Users are granted a non-exclusive license to use our platform for legitimate legal and professional purposes. Reverse engineering, unauthorized copying, or misuse of our AI technology is strictly prohibited.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-2">7. Limitation of Liability and Professional Responsibility</h3>
            <p className="leading-relaxed">
              {companyName} shall not be liable for any direct, indirect, incidental, or consequential damages arising from the use of AI-generated summaries in legal proceedings, client advice, or professional decisions. Users acknowledge that they bear full professional responsibility for verifying AI outputs and maintaining compliance with legal ethics rules, bar regulations, and professional standards in their jurisdiction.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-2">8. Governing Law and Dispute Resolution</h3>
            <p className="leading-relaxed">
              These terms are governed by the laws of [Jurisdiction]. Any disputes arising from the use of our legal AI platform shall be resolved through binding arbitration in accordance with commercial arbitration rules, with specific provisions for handling confidential legal materials and maintaining attorney-client privilege during dispute resolution proceedings.
            </p>
          </section>
        </div>

        {/* FOOTER - Buttons now match Register button colors */}
        <div className="flex items-center justify-between p-4 bg-gray-50 border-t border-gray-200">
          <p className="text-xs text-gray-500">Effective Date: {effectiveDate}</p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-100 transition"
            >
              Close
            </button>
            {showAcceptButton && (
              <button
                onClick={handleAccept}
                className="px-4 py-2 text-sm font-medium text-white rounded transition flex items-center justify-center"
                style={{ backgroundColor: '#21C1B6' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
              >
                Accept & Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TermsAndConditions;