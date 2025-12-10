// import React from 'react';

// const AboutUsPage = () => {
//   return (
//     <div className="min-h-screen bg-white font-inter py-16 px-4 sm:px-6 lg:px-8">
//       <div className="container mx-auto">
//         <div className="text-center mb-12">
//           <h3 className="text-3xl sm:text-4xl font-semibold text-gray-800 mb-4">About Nexintel AI</h3>
//           <p className="text-gray-600 font-medium max-w-2xl mx-auto">
//             Built for modern legal professionals who demand efficiency, security, and comprehensive functionality.
//           </p>
//         </div>
        
//         <div className="max-w-4xl mx-auto text-lg text-gray-700 leading-relaxed">
//           <p className="mb-6">
//             Nexintel AI is at the forefront of legal technology, dedicated to transforming how legal professionals
//             interact with documents. Our mission is to empower lawyers, paralegals, and legal researchers with
//             intelligent tools that streamline workflows, enhance accuracy, and provide deeper insights into legal data.
//           </p>
//           <p className="mb-6">
//             Founded by a team of legal experts and AI innovators, we understand the unique challenges of the legal
//             industry. We are committed to delivering secure, reliable, and user-friendly solutions that meet the
//             highest standards of professional practice.
//           </p>
//           <p>
//             Join us in shaping the future of legal practice with AI-powered efficiency and intelligence.
//           </p>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default AboutUsPage;



// import React from 'react';
// import { useNavigate } from 'react-router-dom';
// // import missionImage from '../assets/2 pic.jpg';
// // import visionImage from '../assets/4.jpg';

// // A simple checkmark icon component
// const CheckIcon = () => (
//   <svg className="w-6 h-6 text-teal-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
//     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
//   </svg>
// );

// const AboutUsPage = () => {
//   const navigate = useNavigate();

//   const handleExploreClick = () => {
//     const token = localStorage.getItem('token');
//     if (token) {
//       navigate('/dashboard');
//     } else {
//       navigate('/login');
//     }
//   };

//   return (
//     <div className="bg-white font-inter">
//       <div className="container mx-auto py-16 px-4 sm:px-6 lg:px-8">
//         <div className="text-center mb-16">
//           <h1 className="text-3xl sm:text-4xl font-semibold text-gray-800 mb-4">About Nexintel AI</h1>
//           <p className="text-slate-600 font-medium max-w-3xl mx-auto">
//             Built for modern legal professionals who demand efficiency, security, and comprehensive functionality. We are at the forefront of legal technology, dedicated to transforming how legal professionals interact with documents.
//           </p>
//         </div>

//         <div className="max-w-6xl mx-auto">
//           {/* Mission Section */}
//           <div className="grid md:grid-cols-2 gap-12 items-center mb-16">
//             <div className="order-2 md:order-1">
//               <h2 className="text-3xl font-semibold text-gray-800 mb-4">Our Mission</h2>
//               <p className="text-slate-600 mb-6">
//                 At Nexintel AI, our mission is to empower legal professionals with intelligent tools that simplify and accelerate legal work. We aim to remove repetitive manual tasks through AI-driven solutions.
//               </p>
//               <ul className="space-y-4">
//                 <li className="flex items-start">
//                   <CheckIcon />
//                   <span className="ml-3 text-slate-600">Securely upload and manage documents with ease.</span>
//                 </li>
//                 <li className="flex items-start">
//                   <CheckIcon />
//                   <span className="ml-3 text-slate-600">Analyze legal content with unparalleled precision.</span>
//                 </li>
//                 <li className="flex items-start">
//                   <CheckIcon />
//                   <span className="ml-3 text-slate-600">Draft professional documents in a fraction of the time.</span>
//                 </li>
//               </ul>
//             </div>
//             <div className="order-1 md:order-2">
//               <img src={missionImage} alt="Our Mission" className="rounded-xl shadow-lg w-full aspect-video object-cover cursor-pointer transition-shadow duration-300 hover:shadow-2xl" />
//             </div>
//           </div>

//           {/* Divider */}
//           <div className="border-t border-slate-200 my-16"></div>

//           {/* Vision Section */}
//           <div className="grid md:grid-cols-2 gap-12 items-center">
//             <div>
//               <img src={visionImage} alt="Our Vision" className="rounded-xl shadow-lg w-full aspect-video object-cover cursor-pointer transition-shadow duration-300 hover:shadow-2xl" />
//             </div>
//             <div>
//               <h2 className="text-3xl font-semibold text-gray-800 mb-4">Our Vision</h2>
//               <p className="text-slate-600 mb-6">
//                 Our vision is to build the world’s most trusted Legal AI partner—a platform where legal professionals can seamlessly manage documents, gain insights through advanced AI analysis, and create accurate legal drafts in minutes.
//               </p>
//               <ul className="space-y-4">
//                 <li className="flex items-start">
//                   <CheckIcon />
//                   <span className="ml-3 text-slate-600">Enhance legal expertise, not replace it.</span>
//                 </li>
//                 <li className="flex items-start">
//                   <CheckIcon />
//                   <span className="ml-3 text-slate-600">Make legal services faster and smarter.</span>
//                 </li>
//                 <li className="flex items-start">
//                   <CheckIcon />
//                   <span className="ml-3 text-slate-600">Increase accessibility to justice for everyone.</span>
//                 </li>
//               </ul>
//             </div>
//           </div>

//           {/* CTA Row */}
//           <div className="text-center mt-20">
//             <h3 className="text-3xl font-semibold text-gray-800 mb-4">Join Us in Shaping the Future</h3>
//             <p className="text-slate-600 max-w-2xl mx-auto mb-8">
//               Discover how Nexintel AI can transform your legal practice. Explore our features or contact us for a demo.
//             </p>
//             <div className="flex justify-center gap-4">
//               <button
//                 onClick={handleExploreClick}
//                 className="bg-teal-500 text-white font-semibold py-3 px-8 rounded-lg hover:bg-teal-600 transition-transform transform hover:scale-105 shadow-md"
//               >
//                 Explore Features
//               </button>
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default AboutUsPage;



// import React, { useEffect, useRef } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { motion, useScroll, useTransform, useInView } from 'framer-motion';
// import NexintelLogo from '../assets/nexintel.jpg';
// import missionImage from '../assets/ai law02.jpeg';
// import visionImage from '../assets/ai law01.jpeg';

// // A simple checkmark icon component
// const CheckIcon = () => (
//   <svg className="w-6 h-6 text-teal-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
//     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
//   </svg>
// );

// const AboutUsPage = () => {
//   const navigate = useNavigate();

//   const handleExploreClick = () => {
//     const token = localStorage.getItem('token');
//     if (token) {
//       navigate('/dashboard');
//     } else {
//       navigate('/login');
//     }
//   };

//   const handleLogin = () => {
//     navigate('/login');
//   };

//   const handleRegister = () => {
//     navigate('/register');
//   };

//   const { scrollY } = useScroll();
//   const heroRef = useRef(null);
//   const isHeroInView = useInView(heroRef, { once: true });

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


//   return (
//     <div className="min-h-screen bg-white overflow-y-auto">
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
//           <div className="text-center mb-16">
//             <h1 className="text-3xl sm:text-4xl font-semibold text-gray-800 mb-4">About Nexintel AI</h1>
//             <p className="text-slate-600 font-medium max-w-3xl mx-auto">
//               Built for modern legal professionals who demand efficiency, security, and comprehensive functionality. We are at the forefront of legal technology, dedicated to transforming how legal professionals interact with documents.
//             </p>
//           </div>

//           <div className="max-w-6xl mx-auto">
//             {/* Mission Section */}
//             <div className="grid md:grid-cols-2 gap-12 items-center mb-16">
//               <div className="order-2 md:order-1">
//                 <h2 className="text-3xl font-semibold text-gray-800 mb-4">Our Mission</h2>
//                 <p className="text-slate-600 mb-6">
//                   At Nexintel AI, our mission is to empower legal professionals with intelligent tools that simplify and accelerate legal work. We aim to remove repetitive manual tasks through AI-driven solutions.
//                 </p>
//                 <ul className="space-y-4">
//                   <li className="flex items-start">
//                     <CheckIcon />
//                     <span className="ml-3 text-slate-600">Securely upload and manage documents with ease.</span>
//                   </li>
//                   <li className="flex items-start">
//                     <CheckIcon />
//                     <span className="ml-3 text-slate-600">Analyze legal content with unparalleled precision.</span>
//                   </li>
//                   <li className="flex items-start">
//                     <CheckIcon />
//                     <span className="ml-3 text-slate-600">Draft professional documents in a fraction of the time.</span>
//                   </li>
//                 </ul>
//               </div>
//               <div className="order-1 md:order-2">
//                 <img src={missionImage} alt="Our Mission" className="rounded-xl shadow-lg w-full aspect-video object-cover cursor-pointer transition-shadow duration-300 hover:shadow-2xl" />
//               </div>
//             </div>

//             {/* Divider */}
//             <div className="border-t border-slate-200 my-16"></div>

//             {/* Vision Section */}
//             <div className="grid md:grid-cols-2 gap-12 items-center">
//               <div>
//                 <img src={visionImage} alt="Our Vision" className="rounded-xl shadow-lg w-full aspect-video object-cover cursor-pointer transition-shadow duration-300 hover:shadow-2xl" />
//               </div>
//               <div>
//                 <h2 className="text-3xl font-semibold text-gray-800 mb-4">Our Vision</h2>
//                 <p className="text-slate-600 mb-6">
//                   Our vision is to build the world’s most trusted Legal AI partner—a platform where legal professionals can seamlessly manage documents, gain insights through advanced AI analysis, and create accurate legal drafts in minutes.
//                 </p>
//                 <ul className="space-y-4">
//                   <li className="flex items-start">
//                     <CheckIcon />
//                     <span className="ml-3 text-slate-600">Enhance legal expertise, not replace it.</span>
//                   </li>
//                   <li className="flex items-start">
//                     <CheckIcon />
//                     <span className="ml-3 text-slate-600">Make legal services faster and smarter.</span>
//                   </li>
//                   <li className="flex items-start">
//                     <CheckIcon />
//                     <span className="ml-3 text-slate-600">Increase accessibility to justice for everyone.</span>
//                   </li>
//                 </ul>
//               </div>
//             </div>

//             {/* CTA Row */}
//             <div className="text-center mt-20">
//               <h3 className="text-3xl font-semibold text-gray-800 mb-4">Join Us in Shaping the Future</h3>
//               <p className="text-slate-600 max-w-2xl mx-auto mb-8">
//                 Discover how Nexintel AI can transform your legal practice. Explore our features or contact us for a demo.
//               </p>
//               <div className="flex justify-center gap-4">
//                 <button
//                   onClick={handleExploreClick}
//                   className="bg-teal-500 text-white font-semibold py-3 px-8 rounded-lg hover:bg-teal-600 transition-transform transform hover:scale-105 shadow-md"
//                 >
//                   Explore Features
//                 </button>
//               </div>
//             </div>
//           </div>
//         </motion.div>
//       </motion.section>
//     </div>
//   );
// };

// export default AboutUsPage;


import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useScroll, useTransform, useInView } from 'framer-motion';
import missionImage from '../assets/ai law02.jpeg';
import visionImage from '../assets/ai law01.jpeg';
import Footer from '../components/Footer';

// Checkmark icon component
const CheckIcon = () => (
  <svg 
    className="w-6 h-6 flex-shrink-0" 
    style={{ color: '#21C1B6' }}
    fill="none" 
    stroke="currentColor" 
    viewBox="0 0 24 24" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
  </svg>
);

const AboutUsPage = () => {
  const navigate = useNavigate();
  const heroRef = useRef(null);
  const missionRef = useRef(null);
  const visionRef = useRef(null);
  const ctaRef = useRef(null);

  const { scrollY } = useScroll();
  const isHeroInView = useInView(heroRef, { once: true });
  const isMissionInView = useInView(missionRef, { once: true, margin: "-100px" });
  const isVisionInView = useInView(visionRef, { once: true, margin: "-100px" });
  const isCtaInView = useInView(ctaRef, { once: true, margin: "-100px" });

  const heroY = useTransform(scrollY, [0, 500], [0, -50]);
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0.8]);

  const handleExploreClick = () => {
    const token = localStorage.getItem('token');
    if (token) {
      navigate('/dashboard');
    } else {
      navigate('/login');
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: {
      opacity: 0,
      y: 30,
      scale: 0.95
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: 0.6,
        ease: [0.25, 0.46, 0.45, 0.94]
      }
    }
  };

  const imageVariants = {
    hidden: {
      opacity: 0,
      scale: 0.9
    },
    visible: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: 0.8,
        ease: [0.25, 0.46, 0.45, 0.94]
      }
    }
  };

  const listItemVariants = {
    hidden: {
      opacity: 0,
      x: -20
    },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        duration: 0.5,
        ease: [0.25, 0.46, 0.45, 0.94]
      }
    }
  };

  return (
    <>
      <div className="min-h-screen bg-white overflow-y-auto">
        {/* Hero Section */}
        <motion.section
          ref={heroRef}
          className="relative pt-32 pb-20 overflow-hidden"
          style={{
            y: heroY,
            opacity: heroOpacity,
            background: 'linear-gradient(to bottom right, #f9fafb, #ffffff, #f0fffe)'
          }}
        >
          <motion.div
            className="container mx-auto text-center px-4 sm:px-6 lg:px-8 relative z-10"
            variants={containerVariants}
            initial="hidden"
            animate={isHeroInView ? "visible" : "hidden"}
          >
            <motion.div className="text-center mb-16" variants={itemVariants}>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900 mb-4">
                About Nexintel AI
              </h1>
              <p className="text-lg text-gray-600 max-w-3xl mx-auto leading-relaxed">
                Built for modern legal professionals who demand efficiency, security, and comprehensive functionality.
                We are at the forefront of legal technology, dedicated to transforming how legal professionals interact with documents.
              </p>
            </motion.div>

            <div className="max-w-6xl mx-auto">
              {/* Mission Section */}
              <motion.div
                ref={missionRef}
                className="grid md:grid-cols-2 gap-12 items-center mb-16"
                variants={containerVariants}
                initial="hidden"
                animate={isMissionInView ? "visible" : "hidden"}
              >
                <motion.div className="order-2 md:order-1" variants={itemVariants}>
                  <h2 className="text-3xl font-bold text-gray-900 mb-4">Our Mission</h2>
                  <p className="text-gray-600 mb-6 leading-relaxed">
                    At Nexintel AI, our mission is to empower legal professionals with intelligent tools that simplify
                    and accelerate legal work. We aim to remove repetitive manual tasks through AI-driven solutions.
                  </p>
                  <motion.ul
                    className="space-y-4"
                    variants={containerVariants}
                    initial="hidden"
                    animate={isMissionInView ? "visible" : "hidden"}
                  >
                    {[
                      "Securely upload and manage documents with ease.",
                      "Analyze legal content with unparalleled precision.",
                      "Draft professional documents in a fraction of the time."
                    ].map((text, index) => (
                      <motion.li
                        key={index}
                        className="flex items-start"
                        variants={listItemVariants}
                      >
                        <CheckIcon />
                        <span className="ml-3 text-gray-600">{text}</span>
                      </motion.li>
                    ))}
                  </motion.ul>
                </motion.div>
                
                <motion.div
                  className="order-1 md:order-2"
                  variants={imageVariants}
                >
                  <motion.img
                    src={missionImage}
                    alt="Our Mission"
                    className="rounded-xl shadow-lg w-full aspect-video object-cover"
                    whileHover={{ scale: 1.02, boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)" }}
                    transition={{ duration: 0.3 }}
                  />
                </motion.div>
              </motion.div>

              {/* Divider */}
              <motion.div
                className="border-t border-gray-200 my-16"
                initial={{ scaleX: 0 }}
                animate={isMissionInView ? { scaleX: 1 } : { scaleX: 0 }}
                transition={{ duration: 0.8, delay: 0.5 }}
              />

              {/* Vision Section */}
              <motion.div
                ref={visionRef}
                className="grid md:grid-cols-2 gap-12 items-center"
                variants={containerVariants}
                initial="hidden"
                animate={isVisionInView ? "visible" : "hidden"}
              >
                <motion.div variants={imageVariants}>
                  <motion.img
                    src={visionImage}
                    alt="Our Vision"
                    className="rounded-xl shadow-lg w-full aspect-video object-cover"
                    whileHover={{ scale: 1.02, boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)" }}
                    transition={{ duration: 0.3 }}
                  />
                </motion.div>
                
                <motion.div variants={itemVariants}>
                  <h2 className="text-3xl font-bold text-gray-900 mb-4">Our Vision</h2>
                  <p className="text-gray-600 mb-6 leading-relaxed">
                    Our vision is to build the world's most trusted Legal AI partner—a platform where legal professionals
                    can seamlessly manage documents, gain insights through advanced AI analysis, and create accurate legal
                    drafts in minutes.
                  </p>
                  <motion.ul
                    className="space-y-4"
                    variants={containerVariants}
                    initial="hidden"
                    animate={isVisionInView ? "visible" : "hidden"}
                  >
                    {[
                      "Enhance legal expertise, not replace it.",
                      "Make legal services faster and smarter.",
                      "Increase accessibility to justice for everyone."
                    ].map((text, index) => (
                      <motion.li
                        key={index}
                        className="flex items-start"
                        variants={listItemVariants}
                      >
                        <CheckIcon />
                        <span className="ml-3 text-gray-600">{text}</span>
                      </motion.li>
                    ))}
                  </motion.ul>
                </motion.div>
              </motion.div>

              {/* CTA Section */}
              <motion.div
                ref={ctaRef}
                className="text-center mt-20"
                variants={containerVariants}
                initial="hidden"
                animate={isCtaInView ? "visible" : "hidden"}
              >
                <motion.h3
                  className="text-3xl font-bold text-gray-900 mb-4"
                  variants={itemVariants}
                >
                  Join Us in Shaping the Future
                </motion.h3>
                <motion.p
                  className="text-gray-600 max-w-2xl mx-auto mb-8 leading-relaxed"
                  variants={itemVariants}
                >
                  Discover how Nexintel AI can transform your legal practice. Explore our features or contact us for a demo.
                </motion.p>
                <motion.div
                  className="flex justify-center gap-4"
                  variants={itemVariants}
                >
                  <motion.button
                    onClick={handleExploreClick}
                    className="text-white font-semibold py-3 px-8 rounded-lg shadow-md"
                    style={{ backgroundColor: '#21C1B6' }}
                    whileHover={{
                      scale: 1.05,
                      backgroundColor: '#1AA49B',
                      boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)"
                    }}
                    whileTap={{ scale: 0.98 }}
                    transition={{ duration: 0.2 }}
                  >
                    Explore Features
                  </motion.button>
                </motion.div>
              </motion.div>
            </div>
          </motion.div>
        </motion.section>
      </div>
      <Footer />
    </>
  );
};

export default AboutUsPage;
