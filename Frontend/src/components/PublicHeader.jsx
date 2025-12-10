// import React from 'react';
// import { Link } from 'react-router-dom';
// import { motion } from 'framer-motion';
// import NexintelLogo from '../assets/nexintel.jpg';

// const PublicHeader = () => {
//   const handleLogin = () => {
//     // This will be handled by the PublicLayout or a global context
//     // For now, we'll just navigate
//     window.location.href = '/login'; 
//   };

//   return (
//     <nav className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-sm shadow-sm z-50 border-b border-gray-100">
//       <div className="container mx-auto px-4 sm:px-6 lg:px-8">
//         <div className="flex justify-between items-center h-16">
//           <div className="flex items-center space-x-2">
//             <Link to="/">
//               <img src={NexintelLogo} alt="Nexintel AI Logo" className="h-8 w-auto" />
//             </Link>
//           </div>
          
//           <div className="hidden md:flex items-center space-x-8 ml-auto mr-8">
//             <Link to="/" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Home</Link>
//             <Link to="/services" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Services</Link>
//             <Link to="/pricing" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Pricing</Link>
//             <Link to="/AboutUs" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">AboutUs</Link>
//           </div>

//           <motion.button
//             whileHover={{ scale: 1.05 }}
//             whileTap={{ scale: 0.95 }}
//             onClick={handleLogin}
//             className="text-white text-sm font-medium px-5 py-2 rounded-md transition-all"
//             style={{ backgroundColor: '#21C1B6' }}
//             onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1AA49B'}
//             onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21C1B6'}
//           >
//             Login
//           </motion.button>
//         </div>
//       </div>
//     </nav>
//   );
// };

// export default PublicHeader;



// import React from 'react';
// import NexintelLogo from '../assets/nexintel.jpg';

// const PublicHeader = () => {
//   const handleNavigation = (path) => {
//     // Handle navigation - in a real app, this would use your router
//     console.log(`Navigating to: ${path}`);
//     window.location.href = path;
//   };

//   const handleLogin = () => {
//     window.location.href = '/login';
//   };

//   return (
//     <nav className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-sm shadow-sm z-50 border-b border-gray-100">
//       <div className="container mx-auto px-4 sm:px-6 lg:px-8">
//         <div className="flex justify-between items-center h-16">
//           <div className="flex items-center space-x-2">
//             <button 
//               onClick={() => handleNavigation('/')}
//               className="flex items-center focus:outline-none focus:ring-2 focus:ring-teal-500 rounded-md"
//             >
//               <img src={NexintelLogo} alt="Nexintel AI Logo" className="h-8 w-auto" />
//             </button>
//           </div>
          
//           <div className="hidden md:flex items-center space-x-8 ml-auto mr-8">
//             <button 
//               onClick={() => handleNavigation('/')} 
//               className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors"
//             >
//               Home
//             </button>
//             <button 
//               onClick={() => handleNavigation('/services')} 
//               className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors"
//             >
//               Services
//             </button>
//             <button 
//               onClick={() => handleNavigation('/pricing')} 
//               className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors"
//             >
//               Pricing
//             </button>
//             <button 
//               onClick={() => handleNavigation('/about-us')} 
//               className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors"
//             >
//               About Us
//             </button>
//           </div>

//           <button
//             onClick={handleLogin}
//             onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//             onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//             className="text-white text-sm font-medium px-5 py-2 rounded-md transition-all transform hover:scale-105 active:scale-95"
//             style={{ 
//               backgroundColor: '#21C1B6',
//               transition: 'all 0.2s ease-in-out'
//             }}
//           >
//             Login
//           </button>
//         </div>
//       </div>
//     </nav>
//   );
// };

// export default PublicHeader;




import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import JuriNexGavelLogo from '../assets/JuriNex_gavel_logo.png';

const PublicHeader = () => {
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogin = () => {
    navigate('/login');
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  // Close mobile menu when route changes
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <nav className="fixed top-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-6xl rounded-[30px] bg-white/10 backdrop-blur-md shadow-xl z-50" style={{ background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05))' }}>
      <div className="container px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        {/* <div className="flex items-center">
          <Link to="/" className="flex items-center space-x-2">
            <img src={JuriNexGavelLogo} alt="JuriNex Logo" className="h-8 w-auto" />
            <span className="text-white text-xl font-bold" style={{ color: '#21C1B6' }}>Juri</span>
            <span className="text-black text-xl font-bold relative">Nex
              <span className="absolute text-xs font-normal" style={{ top: '0', right: '-0.6em', color: '#0b0c0cff' }}>™</span>
            </span>
          </Link>
        </div> */}
        <div className="flex items-center">
  <Link to="/" className="flex items-center space-x-2">
    <img src={JuriNexGavelLogo} alt="JuriNex Logo" className="h-8 w-auto" />

    <span className="text-xl font-bold">
      <span style={{ color: '#21C1B6' }}>Juri</span>
      <span className="text-black relative">Nex
        <span
          className="absolute text-xs font-normal"
          style={{ top: '0', right: '-0.6em', color: '#0b0c0cff' }}
        >
          ™
        </span>
      </span>
    </span>

  </Link>
</div>


        {/* Desktop Navigation Links */}
        <div className="hidden lg:flex flex-1 justify-center items-center space-x-8">
          <Link to="/" className="text-base text-black hover:text-gray-200 font-medium transition-colors">Home</Link>
          <Link to="/services" className="text-base text-black hover:text-gray-200 font-medium transition-colors">Services</Link>
          <Link to="/pricing" className="text-base text-black hover:text-gray-200 font-medium transition-colors">Pricing</Link>
          <Link to="/aboutus" className="text-base text-black hover:text-gray-200 font-medium transition-colors">About Us</Link>
        </div>

        {/* Login Button - Desktop */}
        <div className="hidden lg:flex items-center">
          <button
            onClick={handleLogin}
            className="text-white text-base font-medium py-2.5 px-6 rounded-full transition-all shadow-md"
            style={{ backgroundColor: '#21C1B6' }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1AA49B'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21C1B6'}
          >
            Login
          </button>
        </div>

        {/* Mobile Menu Toggle */}
        <div className="lg:hidden flex items-center">
          <button
            onClick={toggleMobileMenu}
            className="p-2 rounded-md text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40" onClick={toggleMobileMenu}>
          <div className="fixed top-0 right-0 w-64 h-full bg-white shadow-lg p-6 transform transition-transform ease-in-out duration-300 translate-x-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end mb-4">
              <button
                onClick={toggleMobileMenu}
                className="p-2 rounded-md text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <nav className="flex flex-col space-y-4">
              <Link to="/" className="text-base text-black hover:text-teal-500 font-medium" onClick={toggleMobileMenu}>Home</Link>
              <Link to="/services" className="text-base text-black hover:text-teal-500 font-medium" onClick={toggleMobileMenu}>Services</Link>
              <Link to="/pricing" className="text-base text-black hover:text-teal-500 font-medium" onClick={toggleMobileMenu}>Pricing</Link>
              <Link to="/aboutus" className="text-base text-black hover:text-teal-500 font-medium" onClick={toggleMobileMenu}>About Us</Link>
              <button
                onClick={() => { handleLogin(); toggleMobileMenu(); }}
                className="w-full text-white text-base font-medium py-2.5 px-6 rounded-lg transition-all shadow-md"
                style={{ backgroundColor: '#21C1B6' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1AA49B'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21C1B6'}
              >
                Login
              </button>
            </nav>
          </div>
        </div>
      )}
    </nav>
  );
};

export default PublicHeader;
