// import React from 'react';
// import { Link } from 'react-router-dom';
// import { Scale, FileText, BarChart3 } from 'lucide-react';

// const ServicesPage = () => {
//   return (
//     <div className="min-h-screen bg-white font-inter py-16 px-4 sm:px-6 lg:px-8">
//       <div className="container mx-auto">
//         <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 text-center mb-12">Our Core Services</h2>
//         <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
//           {/* Service Card 1 */}
//           <div className="bg-gray-50 p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-200 hover:border-gray-300">
//             <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-lg mb-6 mx-auto">
//               <FileText className="w-8 h-8 text-gray-600" />
//             </div>
//             <h4 className="text-xl font-semibold text-gray-800 mb-3 text-center">Document Upload</h4>
//             <p className="text-gray-600 text-center font-medium leading-relaxed mb-5">
//               Securely upload and organize all your legal documents. Our platform supports various formats,
//               ensuring your data is always accessible and protected.
//             </p>
//             <Link to="/document-upload" className="text-gray-700 hover:text-gray-900 font-medium block text-center" target="_blank" rel="noopener noreferrer">
//               Learn More &rarr;
//             </Link>
//           </div>

//           {/* Service Card 2 */}
//           <div className="bg-gray-50 p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-200 hover:border-gray-300">
//             <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-lg mb-6 mx-auto">
//               <BarChart3 className="w-8 h-8 text-gray-600" />
//             </div>
//             <h4 className="text-xl font-semibold text-gray-800 mb-3 text-center">AI Analysis</h4>
//             <p className="text-gray-600 text-center font-medium leading-relaxed mb-5">
//               Utilize advanced AI to summarize complex legal texts, identify key entities, and extract critical
//               information, saving you countless hours.
//             </p>
//             <Link to="/ai-analysis" className="text-gray-700 hover:text-gray-900 font-medium block text-center" target="_blank" rel="noopener noreferrer">
//               Learn More &rarr;
//             </Link>
//           </div>

//           {/* Service Card 3 */}
//           <div className="bg-gray-50 p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-200 hover:border-gray-300">
//             <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-lg mb-6 mx-auto">
//               <Scale className="w-8 h-8 text-gray-600" />
//             </div>
//             <h4 className="text-xl font-semibold text-gray-800 mb-3 text-center">Document Drafting</h4>
//             <p className="text-gray-600 text-center font-medium leading-relaxed mb-5">
//               Generate precise legal documents, contracts, and briefs with AI-powered drafting tools and customizable
//               templates, ensuring accuracy and compliance.
//             </p>
//             <Link to="/document-drafting" className="text-gray-700 hover:text-gray-900 font-medium block text-center" target="_blank" rel="noopener noreferrer">
//               Learn More &rarr;
//             </Link>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default ServicesPage;

// import React, { useEffect } from 'react';
// import { Link } from 'react-router-dom';
// import { Scale, FileText, BarChart3 } from 'lucide-react';

// const ServicesPage = () => {
//   useEffect(() => {
//     const originalOverflow = document.body.style.overflow;
//     document.body.style.overflow = 'hidden';

//     return () => {
//       document.body.style.overflow = originalOverflow;
//     };
//   }, []);

//   return (
//     <div className="h-full bg-white font-inter flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
//       <div className="container mx-auto text-center">
//         <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-12">Our Core Services</h2>
//         <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
//           {/* Service Card 1 */}
//           <div className="bg-gray-50 p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-200 hover:border-gray-300">
//             <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-lg mb-6 mx-auto">
//               <FileText className="w-8 h-8 text-gray-600" />
//             </div>
//             <h4 className="text-xl font-semibold text-gray-800 mb-3 text-center">Document Upload</h4>
//             <p className="text-gray-600 text-center font-medium leading-relaxed mb-5">
//               Securely upload and organize all your legal documents. Our platform supports various formats,
//               ensuring your data is always accessible and protected.
//             </p>
//             <Link to="/document-upload" className="text-gray-700 hover:text-gray-900 font-medium block text-center" target="_blank" rel="noopener noreferrer">
//               Learn More &rarr;
//             </Link>
//           </div>

//           {/* Service Card 2 */}
//           <div className="bg-gray-50 p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-200 hover:border-gray-300">
//             <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-lg mb-6 mx-auto">
//               <BarChart3 className="w-8 h-8 text-gray-600" />
//             </div>
//             <h4 className="text-xl font-semibold text-gray-800 mb-3 text-center">AI Analysis</h4>
//             <p className="text-gray-600 text-center font-medium leading-relaxed mb-5">
//               Utilize advanced AI to summarize complex legal texts, identify key entities, and extract critical
//               information, saving you countless hours.
//             </p>
//             <Link to="/ai-analysis" className="text-gray-700 hover:text-gray-900 font-medium block text-center" target="_blank" rel="noopener noreferrer">
//               Learn More &rarr;
//             </Link>
//           </div>

//           {/* Service Card 3 */}
//           <div className="bg-gray-50 p-8 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-200 hover:border-gray-300">
//             <div className="flex items-center justify-center w-16 h-16 bg-gray-100 rounded-lg mb-6 mx-auto">
//               <Scale className="w-8 h-8 text-gray-600" />
//             </div>
//             <h4 className="text-xl font-semibold text-gray-800 mb-3 text-center">Document Drafting</h4>
//             <p className="text-gray-600 text-center font-medium leading-relaxed mb-5">
//               Generate precise legal documents, contracts, and briefs with AI-powered drafting tools and customizable
//               templates, ensuring accuracy and compliance.
//             </p>
//             <Link to="/document-drafting" className="text-gray-700 hover:text-gray-900 font-medium block text-center" target="_blank" rel="noopener noreferrer">
//               Learn More &rarr;
//             </Link>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default ServicesPage;

// import React, { useEffect, useRef } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { Scale, FileText, BarChart3 } from 'lucide-react';
// import { motion, useScroll, useTransform, useInView } from 'framer-motion';
// import NexintelLogo from '../assets/nexintel.jpg';


// const ServicesPage = () => {
//   const navigate = useNavigate();
//   const { scrollY } = useScroll();
//   const heroRef = useRef(null); // Using heroRef for the main content section
//   const isHeroInView = useInView(heroRef, { once: true });

//   const handleLogin = () => {
//     navigate('/login');
//   };

//   const handleRegister = () => {
//     navigate('/register');
//   };

//   const heroY = useTransform(scrollY, [0, 500], [0, -50]);
//   const heroOpacity = useTransform(scrollY, [0, 300], [1, 0.8]);

//   const containerVariants = {
//     hidden: { opacity: 0 },
//     visible: {
//       opacity: 1,
//       transition: {
//         staggerChildren: 0.15,
//         delayChildren: 0.1
//       }
//     }
//   };

//   const itemVariants = {
//     hidden: {
//       opacity: 0,
//       y: 30,
//       scale: 0.95
//     },
//     visible: {
//       opacity: 1,
//       y: 0,
//       scale: 1,
//       transition: {
//         duration: 0.6,
//         ease: [0.25, 0.46, 0.45, 0.94]
//       }
//     }
//   };

//   const cardVariants = {
//     hidden: {
//       opacity: 0,
//       y: 50,
//       rotateX: -15
//     },
//     visible: {
//       opacity: 1,
//       y: 0,
//       rotateX: 0,
//       transition: {
//         duration: 0.7,
//         ease: [0.25, 0.46, 0.45, 0.94]
//       }
//     }
//   };

//   useEffect(() => {
//     const originalOverflow = document.body.style.overflow;
//     document.body.style.overflow = 'hidden';

//     return () => {
//       document.body.style.overflow = originalOverflow;
//     };
//   }, []);

//   return (
//     <div className="min-h-screen bg-white">
//       {/* Navigation */}
//       <nav className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-sm shadow-sm z-50 border-b border-gray-100">
//         <div className="container mx-auto px-4 sm:px-6 lg:px-8">
//           <div className="flex justify-between items-center h-16">
//             <div className="flex items-center space-x-2">
//               <img src={NexintelLogo} alt="Nexintel AI Logo" className="h-8 w-auto" />
//             </div>
            
//             <div className="hidden md:flex items-center space-x-8 ml-auto mr-8">
//               <Link to="/" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Home</Link>
//               <Link to="/services" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Services</Link>
//               <Link to="/pricing" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Pricing</Link>
//               <Link to="/aboutus" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">About Us</Link>
//             </div>

//             <motion.button
//               whileHover={{ scale: 1.05 }}
//               whileTap={{ scale: 0.95 }}
//               onClick={handleLogin}
//               className="text-white text-sm font-medium px-5 py-2 rounded-md transition-all"
//               style={{ backgroundColor: '#21C1B6' }}
//               onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1AA49B'}
//               onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21C1B6'}
//             >
//               Login
//             </motion.button>
//           </div>
//         </div>
//       </nav>

//       {/* Main Content Section */}
//       <motion.section
//         ref={heroRef}
//         className="relative pt-32 pb-20 overflow-hidden"
//         style={{
//           y: heroY,
//           opacity: heroOpacity,
//           background: 'linear-gradient(to bottom right, #f9fafb, #ffffff, #f0fffe)'
//         }}
//       >
//         <motion.div
//           className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10"
//           variants={containerVariants}
//           initial="hidden"
//           animate={isHeroInView ? "visible" : "hidden"}
//         >
//           <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-12">Our Core Services</h2>
//           <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
//             {/* Service Card 1 */}
//             <motion.div
//               className="group relative"
//               variants={cardVariants}
//               whileHover={{
//                 y: -10,
//                 transition: { duration: 0.3 }
//               }}
//             >
//               <motion.div
//                 className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
//                 style={{ backgroundColor: '#21C1B6' }}
//                 animate={{
//                   scale: [1, 1.05, 1]
//                 }}
//                 transition={{
//                   duration: 2,
//                   repeat: Infinity,
//                   ease: "easeInOut"
//                 }}
//               />
//               <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500">
//                 <motion.div
//                   className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
//                   style={{ backgroundColor: '#e0f7f6' }}
//                   whileHover={{
//                     rotate: [0, -10, 10, 0],
//                     scale: 1.1
//                   }}
//                   transition={{ duration: 0.4 }}
//                 >
//                   <FileText className="w-8 h-8" style={{ color: '#21C1B6' }} />
//                 </motion.div>
//                 <h4 className="text-xl font-bold text-gray-900 mb-3 text-center">Document Upload</h4>
//                 <p className="text-sm text-gray-600 text-center leading-relaxed mb-5">
//                   Securely upload and organize all your legal documents. Our platform supports various formats,
//                   ensuring your data is always accessible and protected.
//                 </p>
//                 <Link to="/document-upload" className="text-gray-700 hover:text-gray-900 font-medium block text-center" target="_blank" rel="noopener noreferrer">
//                   Learn More &rarr;
//                 </Link>
//               </div>
//             </motion.div>

//             {/* Service Card 2 */}
//             <motion.div
//               className="group relative"
//               variants={cardVariants}
//               whileHover={{
//                 y: -10,
//                 transition: { duration: 0.3 }
//               }}
//             >
//               <motion.div
//                 className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
//                 style={{ backgroundColor: '#21C1B6' }}
//                 animate={{
//                   scale: [1, 1.05, 1]
//                 }}
//                 transition={{
//                   duration: 2,
//                   repeat: Infinity,
//                   ease: "easeInOut",
//                   delay: 0.7
//                 }}
//               />
//               <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500">
//                 <motion.div
//                   className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
//                   style={{ backgroundColor: '#e0f7f6' }}
//                   whileHover={{
//                     rotate: [0, 180, 360],
//                     scale: 1.1
//                   }}
//                   transition={{ duration: 0.8 }}
//                 >
//                   <BarChart3 className="w-8 h-8" style={{ color: '#21C1B6' }} />
//                 </motion.div>
//                 <h4 className="text-xl font-bold text-gray-900 mb-3 text-center">AI Analysis</h4>
//                 <p className="text-sm text-gray-600 text-center leading-relaxed mb-5">
//                   Utilize advanced AI to summarize complex legal texts, identify key entities, and extract critical
//                   information, saving you countless hours.
//                 </p>
//                 <Link to="/ai-analysis" className="text-gray-700 hover:text-gray-900 font-medium block text-center" target="_blank" rel="noopener noreferrer">
//                   Learn More &rarr;
//                 </Link>
//               </div>
//             </motion.div>

//             {/* Service Card 3 */}
//             <motion.div
//               className="group relative"
//               variants={cardVariants}
//               whileHover={{
//                 y: -10,
//                 transition: { duration: 0.3 }
//               }}
//             >
//               <motion.div
//                 className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
//                 style={{ backgroundColor: '#21C1B6' }}
//                 animate={{
//                   scale: [1, 1.05, 1]
//                 }}
//                 transition={{
//                   duration: 2,
//                   repeat: Infinity,
//                   ease: "easeInOut",
//                   delay: 1.4
//                 }}
//               />
//               <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl transition-all duration-500">
//                 <motion.div
//                   className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg"
//                   style={{ backgroundColor: '#e0f7f6' }}
//                   whileHover={{
//                     scale: [1, 1.2, 1],
//                     rotate: [0, 10, -10, 0]
//                   }}
//                   transition={{ duration: 0.6 }}
//                 >
//                   <Scale className="w-8 h-8" style={{ color: '#21C1B6' }} />
//                 </motion.div>
//                 <h4 className="text-xl font-bold text-gray-900 mb-3 text-center">Document Drafting</h4>
//                 <p className="text-sm text-gray-600 text-center leading-relaxed mb-5">
//                   Generate precise legal documents, contracts, and briefs with AI-powered drafting tools and customizable
//                   templates, ensuring accuracy and compliance.
//                 </p>
//                 <Link to="/document-drafting" className="text-gray-700 hover:text-gray-900 font-medium block text-center" target="_blank" rel="noopener noreferrer">
//                   Learn More &rarr;
//                 </Link>
//               </div>
//             </motion.div>
//           </div>
//         </motion.div>
//       </motion.section>

//     </div>
//   );
// };

// export default ServicesPage;
//    import React, { useRef } from 'react';
// import { Scale, FileText, BarChart3 } from 'lucide-react';
// import Footer from '../components/Footer';


// const ServicesPage = () => {
//   const heroRef = useRef(null);

//   const services = [
//     {
//       icon: FileText,
//       title: "Document Upload",
//       description: "Securely upload and organize all your legal documents. Our platform supports various formats, ensuring your data is always accessible and protected.",
//       link: "/document-upload",
//       delay: 0
//     },
//     {
//       icon: BarChart3,
//       title: "AI Analysis",
//       description: "Utilize advanced AI to summarize complex legal texts, identify key entities, and extract critical information, saving you countless hours.",
//       link: "/ai-analysis",
//       delay: 0.7
//     },
//     {
//       icon: Scale,
//       title: "Document Drafting",
//       description: "Generate precise legal documents, contracts, and briefs with AI-powered drafting tools and customizable templates, ensuring accuracy and compliance.",
//       link: "/document-drafting",
//       delay: 1.4
//     }
//   ];

//   return (
//     <div className="bg-white">
//       <section
//         ref={heroRef}
//         className="relative pt-32 pb-20"
//         style={{
//           background: 'linear-gradient(to bottom right, #f9fafb, #ffffff, #f0fffe)'
//         }}
//       >
//         <div className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10">
//           <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-12 animate-fade-in">
//             Our Core Services
//           </h2>
//           <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
//             {services.map((service, index) => {
//               const Icon = service.icon;
//               return (
//                 <div
//                   key={index}
//                   className="group relative animate-slide-up"
//                   style={{ animationDelay: `${index * 150}ms` }}
//                 >
//                   <div
//                     className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500 animate-pulse-slow"
//                     style={{ backgroundColor: '#21C1B6' }}
//                   />
//                   <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl group-hover:-translate-y-2 transition-all duration-500">
//                     <div
//                       className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg group-hover:scale-110 group-hover:rotate-6 transition-all duration-400"
//                       style={{ backgroundColor: '#e0f7f6' }}
//                     >
//                       <Icon className="w-8 h-8" style={{ color: '#21C1B6' }} />
//                     </div>
//                     <h4 className="text-xl font-bold text-gray-900 mb-3 text-center">
//                       {service.title}
//                     </h4>
//                     <p className="text-sm text-gray-600 text-center leading-relaxed mb-5">
//                       {service.description}
//                     </p>
//                     <a
//                       href={service.link}
//                       className="text-gray-700 hover:text-gray-900 font-medium block text-center transition-colors duration-300"
//                     >
//                       Learn More &rarr;
//                     </a>
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         </div>
//       </section>

//       <style jsx>{`
//         @keyframes fade-in {
//           from {
//             opacity: 0;
//             transform: translateY(-20px);
//           }
//           to {
//             opacity: 1;
//             transform: translateY(0);
//           }
//         }

//         @keyframes slide-up {
//           from {
//             opacity: 0;
//             transform: translateY(50px) rotateX(-15deg);
//           }
//           to {
//             opacity: 1;
//             transform: translateY(0) rotateX(0);
//           }
//         }

//         @keyframes pulse-slow {
//           0%, 100% {
//             transform: scale(1);
//           }
//           50% {
//             transform: scale(1.05);
//           }
//         }

//         .animate-fade-in {
//           animation: fade-in 0.8s ease-out forwards;
//         }

//         .animate-slide-up {
//           animation: slide-up 0.7s ease-out forwards;
//           opacity: 0;
//         }

//         .animate-pulse-slow {
//           animation: pulse-slow 2s ease-in-out infinite;
//         }
//       `}</style>
//       <Footer />
//     </div>
//   );
// };

// export default ServicesPage;



import React, { useRef } from 'react';
import { Scale, FileText, BarChart3 } from 'lucide-react';
import Footer from '../components/Footer';


const ServicesPage = () => {
  const heroRef = useRef(null);

  const services = [
    {
      icon: FileText,
      title: "Document Upload",
      description: "Securely upload and organize all your legal documents. Our platform supports various formats, ensuring your data is always accessible and protected.",
      link: "/document-upload",
      delay: 0
    },
    {
      icon: BarChart3,
      title: "AI Analysis",
      description: "Utilize advanced AI to summarize complex legal texts, identify key entities, and extract critical information, saving you countless hours.",
      link: "/ai-analysis",
      delay: 0.7
    },
    {
      icon: Scale,
      title: "Document Drafting",
      description: "Generate precise legal documents, contracts, and briefs with AI-powered drafting tools and customizable templates, ensuring accuracy and compliance.",
      link: "/document-drafting",
      delay: 1.4
    }
  ];

  return (
    <div className="bg-white">
      <section
        ref={heroRef}
        className="relative pt-32 pb-20"
        style={{
          background: 'linear-gradient(to bottom right, #f9fafb, #ffffff, #f0fffe)'
        }}
      >
        <div className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10">
          <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-12 animate-fade-in">
            Our Core Services
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {services.map((service, index) => {
              const Icon = service.icon;
              return (
                <div
                  key={index}
                  className="group relative animate-slide-up"
                  style={{ animationDelay: `${index * 150}ms` }}
                >
                  <div
                    className="absolute inset-0 rounded-2xl blur-xl opacity-0 group-hover:opacity-20 transition-opacity duration-500 animate-pulse-slow"
                    style={{ backgroundColor: '#21C1B6' }}
                  />
                  <div className="relative p-8 bg-white rounded-2xl shadow-lg border border-gray-100 group-hover:shadow-xl group-hover:-translate-y-2 transition-all duration-500">
                    <div
                      className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6 shadow-lg group-hover:scale-110 group-hover:rotate-6 transition-all duration-400"
                      style={{ backgroundColor: '#e0f7f6' }}
                    >
                      <Icon className="w-8 h-8" style={{ color: '#21C1B6' }} />
                    </div>
                    <h4 className="text-xl font-bold text-gray-900 mb-3 text-center">
                      {service.title}
                    </h4>
                    <p className="text-sm text-gray-600 text-center leading-relaxed mb-5">
                      {service.description}
                    </p>
                    <a
                      href={service.link}
                      className="text-gray-700 hover:text-gray-900 font-medium block text-center transition-colors duration-300"
                    >
                      Learn More &rarr;
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(50px) rotateX(-15deg);
          }
          to {
            opacity: 1;
            transform: translateY(0) rotateX(0);
          }
        }

        @keyframes pulse-slow {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.05);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.8s ease-out forwards;
        }

        .animate-slide-up {
          animation: slide-up 0.7s ease-out forwards;
          opacity: 0;
        }

        .animate-pulse-slow {
          animation: pulse-slow 2s ease-in-out infinite;
        }
      `}</style>
      <Footer />
    </div>
  );
};

export default ServicesPage;
