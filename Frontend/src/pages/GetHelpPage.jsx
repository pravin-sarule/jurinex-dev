
// // import React, { useState } from "react";
// // import { Link } from "react-router-dom";
// // import { toast } from "react-toastify"; // Import toast
// // import apiService from "../services/api"; // Import ApiService
// // import {
// //   Loader2,
// //   CheckCircle,
// //   AlertCircle,
// //   Paperclip,
// //   ChevronDown,
// //   ChevronUp,
// //   MessageSquare,
// //   Search,
// //   X,
// // } from "lucide-react";

// // const GetHelpPage = () => {
// //   const [formData, setFormData] = useState({
// //     subject: "",
// //     priority: "",
// //     message: "",
// //     attachment: null,
// //   });

// //   const [status, setStatus] = useState("");
// //   const [loading, setLoading] = useState(false);
// //   const [showForm, setShowForm] = useState(false);
// //   const [openFAQ, setOpenFAQ] = useState(null);
// //   const [search, setSearch] = useState("");

// //   const faqs = [
// //     {
// //       question: "How long does it take to get a response?",
// //       answer:
// //         "Our support team usually responds within 24-48 hours depending on the query priority.",
// //     },
// //     {
// //       question: "Can I track my support requests?",
// //       answer:
// //         "Yes. Once submitted, you will receive an email with a ticket ID to track your request.",
// //     },
// //     {
// //       question: "What file types can I attach?",
// //       answer:
// //         "You can attach images (JPG, PNG), PDFs, and documents (DOCX). Max size: 10MB.",
// //     },
// //     {
// //       question: "How do I update my account details?",
// //       answer:
// //         "You can update your details by visiting the Settings page in your dashboard.",
// //     },
// //     {
// //       question: "How can I reset my password?",
// //       answer:
// //         "Go to the login page and click on 'Forgot Password' to reset your password.",
// //     },
// //   ];

// //   const filteredFaqs = faqs.filter((faq) =>
// //     faq.question.toLowerCase().includes(search.toLowerCase())
// //   );

// //   const handleChange = (e) => {
// //     const { name, value, files } = e.target;
// //     if (name === "attachment") {
// //       setFormData((prev) => ({ ...prev, [name]: files[0] }));
// //     } else {
// //       setFormData((prev) => ({ ...prev, [name]: value }));
// //     }
// //   };

// //   const handleSubmit = async (e) => {
// //     e.preventDefault();
// //     setLoading(true);
// //     setStatus("");

// //     try {
// //       const queryData = {
// //         subject: formData.subject,
// //         priority: formData.priority,
// //         message: formData.message,
// //       };

// //       // If there's an attachment, we need to send it as FormData
// //       // Otherwise, send as JSON
// //       if (formData.attachment) {
// //         const formPayload = new FormData();
// //         formPayload.append("subject", formData.subject);
// //         formPayload.append("priority", formData.priority);
// //         formPayload.append("message", formData.message);
// //         formPayload.append("attachment", formData.attachment);

// //         await apiService.submitSupportQuery(formPayload); // Use the new API service method
// //       } else {
// //         await apiService.submitSupportQuery(queryData); // Use the new API service method
// //       }

// //       toast.success("Your query has been sent successfully!"); // Show success toast
// //       setFormData({
// //         subject: "",
// //         priority: "",
// //         message: "",
// //         attachment: null,
// //       });
// //       setShowForm(false);
// //     } catch (error) {
// //       console.error("Error submitting query:", error);
// //       toast.error("Something went wrong. Please try again."); // Show error toast
// //     } finally {
// //       setLoading(false);
// //     }
// //   };

// //   return (
// //     <div className="min-h-screen bg-gray-50 px-4 py-10 flex justify-center">
// //       <div className="w-full max-w-3xl">
// //         {/* Header with Raise Query Button */}
// //         <div className="flex items-center justify-between mb-6">
// //           <div>
// //             <h1 className="text-3xl font-bold text-gray-900">Help Center</h1>
// //             <p className="text-gray-600 text-base">
// //               Browse FAQs or raise a support query if you still need help.
// //             </p>
// //           </div>
// //           <button
// //             onClick={() => setShowForm(!showForm)}
// //             className="hidden sm:inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-900 text-white font-semibold py-2.5 px-5 rounded-lg shadow-md transition-all duration-200"
// //           >
// //             <MessageSquare className="h-5 w-5" />
// //             Raise a Query
// //           </button>
// //         </div>

// //         {/* Inline Form Section */}
// //         {showForm && (
// //           <div className="bg-white rounded-xl shadow-md p-6 mb-8 border">
// //             <div className="flex justify-between items-center mb-4">
// //               <h2 className="text-lg font-semibold text-gray-800">
// //                 Submit Your Query
// //               </h2>
// //               <button
// //                 onClick={() => setShowForm(false)}
// //                 className="text-gray-500 hover:text-gray-700"
// //               >
// //                 <X className="h-6 w-6" />
// //               </button>
// //             </div>

// //             <form onSubmit={handleSubmit} className="space-y-5">
// //               {/* Subject Dropdown */}
// //               <div>
// //                 <label className="block text-gray-700 text-sm font-medium mb-2">
// //                   Subject
// //                 </label>
// //                 <select
// //                   name="subject"
// //                   className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
// //                   value={formData.subject}
// //                   onChange={handleChange}
// //                   required
// //                 >
// //                   <option value="">Select a subject</option>
// //                   <option value="billing">Billing</option>
// //                   <option value="technical">Technical Support</option>
// //                   <option value="account">Account Issue</option>
// //                   <option value="general">General Inquiry</option>
// //                   <option value="feedback">Feedback</option>
// //                 </select>
// //               </div>

// //               {/* Priority Dropdown */}
// //               <div>
// //                 <label className="block text-gray-700 text-sm font-medium mb-2">
// //                   Priority
// //                 </label>
// //                 <select
// //                   name="priority"
// //                   className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
// //                   value={formData.priority}
// //                   onChange={handleChange}
// //                   required
// //                 >
// //                   <option value="">Select priority</option>
// //                   <option value="low">Low</option>
// //                   <option value="medium">Medium</option>
// //                   <option value="high">High</option>
// //                   <option value="urgent">Urgent</option>
// //                 </select>
// //               </div>

// //               {/* Message */}
// //               <div>
// //                 <label className="block text-gray-700 text-sm font-medium mb-2">
// //                   Message
// //                 </label>
// //                 <textarea
// //                   name="message"
// //                   rows="5"
// //                   className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
// //                   value={formData.message}
// //                   onChange={handleChange}
// //                   placeholder="Please provide details about your query..."
// //                   required
// //                 ></textarea>
// //               </div>

// //               {/* Attachment */}
// //               <div>
// //                 <label className="block text-gray-700 text-sm font-medium mb-2">
// //                   Attachment (optional)
// //                 </label>
// //                 <div className="flex items-center border rounded-lg px-3 py-2 bg-gray-50">
// //                   <Paperclip className="h-5 w-5 text-gray-500 mr-2" />
// //                   <input
// //                     type="file"
// //                     name="attachment"
// //                     onChange={handleChange}
// //                     className="w-full text-sm text-gray-600"
// //                   />
// //                 </div>
// //                 {formData.attachment && (
// //                   <p className="mt-2 text-sm text-gray-500">
// //                     Selected: {formData.attachment.name}
// //                   </p>
// //                 )}
// //               </div>

// //               {/* Submit Button */}
// //               <button
// //                 type="submit"
// //                 disabled={loading}
// //                 className="w-full flex items-center justify-center bg-gray-800 hover:bg-gray-900 text-white font-semibold py-3 px-4 rounded-lg shadow-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
// //               >
// //                 {loading ? (
// //                   <>
// //                     <Loader2 className="animate-spin mr-2 h-5 w-5" /> Sending...
// //                   </>
// //                 ) : (
// //                   "Send Query"
// //                 )}
// //               </button>
// //             </form>

// //             {/* Status Messages - Removed as Toastify handles this */}
// //           </div>
// //         )}

// //         {/* Search Bar */}
// //         <div className="relative mb-6">
// //           <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
// //           <input
// //             type="text"
// //             placeholder="Search FAQs..."
// //             value={search}
// //             onChange={(e) => setSearch(e.target.value)}
// //             className="w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-500"
// //           />
// //         </div>

// //         {/* FAQ Section */}
// //         <div className="bg-white rounded-xl shadow-md p-6 mb-8 border">
// //           <h2 className="text-xl font-semibold text-gray-800 mb-4">
// //             Frequently Asked Questions
// //           </h2>
// //           <div className="space-y-3">
// //             {filteredFaqs.length > 0 ? (
// //               filteredFaqs.map((faq, index) => (
// //                 <div key={index} className="border rounded-lg">
// //                   <button
// //                     type="button"
// //                     className="flex items-center justify-between w-full p-4 text-left hover:bg-gray-50 transition"
// //                     onClick={() =>
// //                       setOpenFAQ(openFAQ === index ? null : index)
// //                     }
// //                   >
// //                     <span className="text-gray-800 font-medium">
// //                       {faq.question}
// //                     </span>
// //                     {openFAQ === index ? (
// //                       <ChevronUp className="h-5 w-5 text-gray-600" />
// //                     ) : (
// //                       <ChevronDown className="h-5 w-5 text-gray-600" />
// //                     )}
// //                   </button>
// //                   {openFAQ === index && (
// //                     <div className="px-4 pb-4 text-sm text-gray-600">
// //                       {faq.answer}
// //                     </div>
// //                   )}
// //                 </div>
// //               ))
// //             ) : (
// //               <p className="text-gray-500 text-sm text-center py-4">
// //                 No FAQs found for your search.
// //               </p>
// //             )}
// //           </div>
// //         </div>

// //         {/* Back Link */}
// //         <div className="mt-8 text-center">
// //           <Link
// //             to="/settings"
// //             className="text-gray-700 hover:text-gray-900 text-sm font-medium"
// //           >
// //             ← Back to Settings
// //           </Link>
// //         </div>
// //       </div>
// //     </div>
// //   );
// // };

// // export default GetHelpPage;



// import React, { useState } from "react";
// import { Link } from "react-router-dom";
// import { toast } from "react-toastify"; // Import toast
// import apiService from "../services/api"; // Import ApiService
// import {
//   Loader2,
//   CheckCircle,
//   AlertCircle,
//   Paperclip,
//   ChevronDown,
//   ChevronUp,
//   MessageSquare,
//   Search,
//   X,
// } from "lucide-react";

// const GetHelpPage = () => {
//   const [formData, setFormData] = useState({
//     subject: "",
//     priority: "",
//     message: "",
//     attachment: null,
//   });

//   const [status, setStatus] = useState("");
//   const [loading, setLoading] = useState(false);
//   const [showForm, setShowForm] = useState(false);
//   const [openFAQ, setOpenFAQ] = useState(null);
//   const [search, setSearch] = useState("");

//   const faqs = [
//     {
//       question: "How long does it take to get a response?",
//       answer:
//         "Our support team usually responds within 24-48 hours depending on the query priority.",
//     },
//     {
//       question: "Can I track my support requests?",
//       answer:
//         "Yes. Once submitted, you will receive an email with a ticket ID to track your request.",
//     },
//     {
//       question: "What file types can I attach?",
//       answer:
//         "You can attach images (JPG, PNG), PDFs, and documents (DOCX). Max size: 10MB.",
//     },
//     {
//       question: "How do I update my account details?",
//       answer:
//         "You can update your details by visiting the Settings page in your dashboard.",
//     },
//     {
//       question: "How can I reset my password?",
//       answer:
//         "Go to the login page and click on 'Forgot Password' to reset your password.",
//     },
//   ];

//   const filteredFaqs = faqs.filter((faq) =>
//     faq.question.toLowerCase().includes(search.toLowerCase())
//   );

//   const handleChange = (e) => {
//     const { name, value, files } = e.target;
//     if (name === "attachment") {
//       setFormData((prev) => ({ ...prev, [name]: files[0] }));
//     } else {
//       setFormData((prev) => ({ ...prev, [name]: value }));
//     }
//   };

//   const handleSubmit = async (e) => {
//     e.preventDefault();
//     setLoading(true);
//     setStatus("");

//     try {
//       const queryData = {
//         subject: formData.subject,
//         priority: formData.priority,
//         message: formData.message,
//       };

//       // If there's an attachment, we need to send it as FormData
//       // Otherwise, send as JSON
//       if (formData.attachment) {
//         const formPayload = new FormData();
//         formPayload.append("subject", formData.subject);
//         formPayload.append("priority", formData.priority);
//         formPayload.append("message", formData.message);
//         formPayload.append("attachment", formData.attachment);

//         await apiService.submitSupportQuery(formPayload); // Use the new API service method
//       } else {
//         await apiService.submitSupportQuery(queryData); // Use the new API service method
//       }

//       toast.success("Your query has been sent successfully!"); // Show success toast
//       setFormData({
//         subject: "",
//         priority: "",
//         message: "",
//         attachment: null,
//       });
//       setShowForm(false);
//     } catch (error) {
//       console.error("Error submitting query:", error);
//       toast.error("Something went wrong. Please try again."); // Show error toast
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <div className="min-h-screen bg-gray-50 px-4 py-10 flex justify-center">
//       <div className="w-full max-w-3xl">
//         {/* Header with Raise Query Button */}
//         <div className="flex items-center justify-between mb-6">
//           <div>
//             <h1 className="text-3xl font-bold text-gray-900">Help Center</h1>
//             <p className="text-gray-600 text-base">
//               Browse FAQs or raise a support query if you still need help.
//             </p>
//           </div>
//           <button
//             onClick={() => setShowForm(!showForm)}
//             onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//             onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//             className="hidden sm:inline-flex items-center gap-2 bg-black text-white font-semibold py-2.5 px-5 rounded-lg shadow-md transition-all duration-200"
//           >
//             <MessageSquare className="h-5 w-5" />
//             Raise a Query
//           </button>
//         </div>

//         {/* Inline Form Section */}
//         {showForm && (
//           <div className="bg-white rounded-xl shadow-md p-6 mb-8 border">
//             <div className="flex justify-between items-center mb-4">
//               <h2 className="text-lg font-semibold text-gray-800">
//                 Submit Your Query
//               </h2>
//               <button
//                 onClick={() => setShowForm(false)}
//                 className="text-gray-500 hover:text-gray-700"
//               >
//                 <X className="h-6 w-6" />
//               </button>
//             </div>

//             <form onSubmit={handleSubmit} className="space-y-5">
//               {/* Subject Dropdown */}
//               <div>
//                 <label className="block text-gray-700 text-sm font-medium mb-2">
//                   Subject
//                 </label>
//                 <select
//                   name="subject"
//                   className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white text-black focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
//                   value={formData.subject}
//                   onChange={handleChange}
//                   required
//                 >
//                   <option value="">Select a subject</option>
//                   <option value="billing">Billing</option>
//                   <option value="technical">Technical Support</option>
//                   <option value="account">Account Issue</option>
//                   <option value="general">General Inquiry</option>
//                   <option value="feedback">Feedback</option>
//                 </select>
//               </div>

//               {/* Priority Dropdown */}
//               <div>
//                 <label className="block text-gray-700 text-sm font-medium mb-2">
//                   Priority
//                 </label>
//                 <select
//                   name="priority"
//                   className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white text-black focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
//                   value={formData.priority}
//                   onChange={handleChange}
//                   required
//                 >
//                   <option value="">Select priority</option>
//                   <option value="low">Low</option>
//                   <option value="medium">Medium</option>
//                   <option value="high">High</option>
//                   <option value="urgent">Urgent</option>
//                 </select>
//               </div>

//               {/* Message */}
//               <div>
//                 <label className="block text-gray-700 text-sm font-medium mb-2">
//                   Message
//                 </label>
//                 <textarea
//                   name="message"
//                   rows="5"
//                   className="w-full rounded-lg border border-gray-300 px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
//                   value={formData.message}
//                   onChange={handleChange}
//                   placeholder="Please provide details about your query..."
//                   required
//                 ></textarea>
//               </div>

//               {/* Attachment */}
//               <div>
//                 <label className="block text-gray-700 text-sm font-medium mb-2">
//                   Attachment (optional)
//                 </label>
//                 <div className="flex items-center border rounded-lg px-3 py-2 bg-gray-50">
//                   <Paperclip className="h-5 w-5 text-gray-500 mr-2" />
//                   <input
//                     type="file"
//                     name="attachment"
//                     onChange={handleChange}
//                     className="w-full text-sm text-black"
//                   />
//                 </div>
//                 {formData.attachment && (
//                   <p className="mt-2 text-sm text-gray-500">
//                     Selected: {formData.attachment.name}
//                   </p>
//                 )}
//               </div>

//               {/* Submit Button */}
//               <button
//                 type="submit"
//                 disabled={loading}
//                 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//                 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//                 className="w-full flex items-center justify-center bg-black text-white font-semibold py-3 px-4 rounded-lg shadow-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
//               >
//                 {loading ? (
//                   <>
//                     <Loader2 className="animate-spin mr-2 h-5 w-5" /> Sending...
//                   </>
//                 ) : (
//                   "Send Query"
//                 )}
//               </button>
//             </form>

//             {/* Status Messages - Removed as Toastify handles this */}
//           </div>
//         )}

//         {/* Search Bar */}
//         <div className="relative mb-6">
//           <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
//           <input
//             type="text"
//             placeholder="Search FAQs..."
//             value={search}
//             onChange={(e) => setSearch(e.target.value)}
//             className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-gray-500"
//           />
//         </div>

//         {/* FAQ Section */}
//         <div className="bg-white rounded-xl shadow-md p-6 mb-8 border">
//           <h2 className="text-xl font-semibold text-gray-800 mb-4">
//             Frequently Asked Questions
//           </h2>
//           <div className="space-y-3">
//             {filteredFaqs.length > 0 ? (
//               filteredFaqs.map((faq, index) => (
//                 <div key={index} className="border rounded-lg">
//                   <button
//                     type="button"
//                     className="flex items-center justify-between w-full p-4 text-left hover:bg-gray-50 transition"
//                     onClick={() =>
//                       setOpenFAQ(openFAQ === index ? null : index)
//                     }
//                   >
//                     <span className="text-gray-800 font-medium">
//                       {faq.question}
//                     </span>
//                     {openFAQ === index ? (
//                       <ChevronUp className="h-5 w-5 text-gray-600" />
//                     ) : (
//                       <ChevronDown className="h-5 w-5 text-gray-600" />
//                     )}
//                   </button>
//                   {openFAQ === index && (
//                     <div className="px-4 pb-4 text-sm text-gray-600">
//                       {faq.answer}
//                     </div>
//                   )}
//                 </div>
//               ))
//             ) : (
//               <p className="text-gray-500 text-sm text-center py-4">
//                 No FAQs found for your search.
//               </p>
//             )}
//           </div>
//         </div>

//         {/* Back Link */}
//         <div className="mt-8 text-center">
//           <Link
//             to="/settings"
//             className="text-gray-700 hover:text-gray-900 text-sm font-medium"
//           >
//             ← Back to Settings
//           </Link>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default GetHelpPage;

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import apiService from "../services/api";
import {
  Loader2,
  Paperclip,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Search,
  X,
} from "lucide-react";

const GetHelpPage = () => {
  const [formData, setFormData] = useState({
    subject: "",
    priority: "",
    message: "",
    attachment: null,
  });

  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [openFAQ, setOpenFAQ] = useState(null);
  const [search, setSearch] = useState("");

  const faqs = [
    {
      question: "How long does it take to get a response?",
      answer:
        "Our support team usually responds within 24-48 hours depending on the query priority.",
    },
    {
      question: "Can I track my support requests?",
      answer:
        "Yes. Once submitted, you will receive an email with a ticket ID to track your request.",
    },
    {
      question: "What file types can I attach?",
      answer:
        "You can attach images (JPG, PNG), PDFs, and documents (DOCX). Max size: 10MB.",
    },
    {
      question: "How do I update my account details?",
      answer:
        "You can update your details by visiting the Settings page in your dashboard.",
    },
    {
      question: "How can I reset my password?",
      answer:
        "Go to the login page and click on 'Forgot Password' to reset your password.",
    },
  ];

  const filteredFaqs = faqs.filter((faq) =>
    faq.question.toLowerCase().includes(search.toLowerCase())
  );

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (name === "attachment") {
      setFormData((prev) => ({ ...prev, [name]: files[0] }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const queryData = {
        subject: formData.subject,
        priority: formData.priority,
        message: formData.message,
      };

      if (formData.attachment) {
        const formPayload = new FormData();
        Object.entries(queryData).forEach(([key, val]) =>
          formPayload.append(key, val)
        );
        formPayload.append("attachment", formData.attachment);
        await apiService.submitSupportQuery(formPayload);
      } else {
        await apiService.submitSupportQuery(queryData);
      }

      toast.success("Your query has been sent successfully!");
      setFormData({ subject: "", priority: "", message: "", attachment: null });
      setShowForm(false);
    } catch (error) {
      console.error("Error submitting query:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10 flex justify-center">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Help Center</h1>
            <p className="text-gray-600 text-base">
              Browse FAQs or raise a support query if you still need help.
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="hidden sm:inline-flex items-center gap-2 bg-[#21C1B6] hover:bg-[#1AA49B] text-white font-semibold py-2.5 px-5 rounded-lg shadow-md transition-all duration-200"
          >
            <MessageSquare className="h-5 w-5" />
            Raise a Query
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-md p-6 mb-8 border border-[#21C1B6]">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-800">
                Submit Your Query
              </h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Subject */}
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Subject
                </label>
                <select
                  name="subject"
                  className="w-full rounded-lg border border-[#21C1B6] px-3 py-2 bg-white text-black focus:outline-none focus:ring-2 focus:ring-[#21C1B6]"
                  value={formData.subject}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select a subject</option>
                  <option value="billing">Billing</option>
                  <option value="technical">Technical Support</option>
                  <option value="account">Account Issue</option>
                  <option value="general">General Inquiry</option>
                  <option value="feedback">Feedback</option>
                </select>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Priority
                </label>
                <select
                  name="priority"
                  className="w-full rounded-lg border border-[#21C1B6] px-3 py-2 bg-white text-black focus:outline-none focus:ring-2 focus:ring-[#21C1B6]"
                  value={formData.priority}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select priority</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              {/* Message */}
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Message
                </label>
                <textarea
                  name="message"
                  rows="5"
                  className="w-full rounded-lg border border-[#21C1B6] px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-[#21C1B6]"
                  value={formData.message}
                  onChange={handleChange}
                  placeholder="Please provide details about your query..."
                  required
                ></textarea>
              </div>

              {/* Attachment */}
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Attachment (optional)
                </label>
                <div className="flex items-center border border-[#21C1B6] rounded-lg px-3 py-2 bg-gray-50">
                  <Paperclip className="h-5 w-5 text-[#21C1B6] mr-2" />
                  <input
                    type="file"
                    name="attachment"
                    onChange={handleChange}
                    className="w-full text-sm text-black"
                  />
                </div>
                {formData.attachment && (
                  <p className="mt-2 text-sm text-gray-500">
                    Selected: {formData.attachment.name}
                  </p>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center bg-[#21C1B6] hover:bg-[#1AA49B] text-white font-semibold py-3 px-4 rounded-lg shadow-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin mr-2 h-5 w-5" /> Sending...
                  </>
                ) : (
                  "Send Query"
                )}
              </button>
            </form>
          </div>
        )}

        {/* Search Bar */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-3 h-5 w-5 text-[#21C1B6]" />
          <input
            type="text"
            placeholder="Search FAQs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-[#21C1B6] rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-[#21C1B6]"
          />
        </div>

        {/* FAQ Section */}
        <div className="bg-white rounded-xl shadow-md p-6 mb-8 border border-[#21C1B6]">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            Frequently Asked Questions
          </h2>
          <div className="space-y-3">
            {filteredFaqs.length > 0 ? (
              filteredFaqs.map((faq, index) => (
                <div
                  key={index}
                  className="border border-[#21C1B6] rounded-lg transition"
                >
                  <button
                    type="button"
                    className="flex items-center justify-between w-full p-4 text-left hover:bg-gray-50 transition"
                    onClick={() =>
                      setOpenFAQ(openFAQ === index ? null : index)
                    }
                  >
                    <span className="text-gray-800 font-medium">
                      {faq.question}
                    </span>
                    {openFAQ === index ? (
                      <ChevronUp className="h-5 w-5 text-[#21C1B6]" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-[#21C1B6]" />
                    )}
                  </button>
                  {openFAQ === index && (
                    <div className="px-4 pb-4 text-sm text-gray-600">
                      {faq.answer}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-sm text-center py-4">
                No FAQs found for your search.
              </p>
            )}
          </div>
        </div>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <Link
            to="/settings"
            className="text-[#21C1B6] hover:text-[#1AA49B] text-sm font-medium"
          >
            ← Back to Settings
          </Link>
        </div>
      </div>
    </div>
  );
};

export default GetHelpPage;
