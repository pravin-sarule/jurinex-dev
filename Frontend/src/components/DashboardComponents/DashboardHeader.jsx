// import React, { useEffect, useState } from 'react';

// const DashboardHeader = () => {
//   const [userName, setUserName] = useState('User');

//   useEffect(() => {
//     const storedUser = localStorage.getItem('user');
//     if (storedUser) {
//       const user = JSON.parse(storedUser);
//       setUserName(user.username || 'User');
//     }
//   }, []);

//   return (
//     <div className="flex justify-between items-center mb-8">
//       <h1 className="text-2xl font-semibold text-gray-900">Hello, {userName}</h1>
//       {/* <button 
//         className="px-6 py-2 rounded-lg text-white font-medium transition-colors"
//         style={{ backgroundColor: '#21C1B6' }}
//         onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
//         onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
//       >
//         Create New Case
//       </button> */}
//     </div>
//   );
// };

// export default DashboardHeader;


import React, { useEffect, useState } from 'react';

const DashboardHeader = ({ user }) => {
  const [userName, setUserName] = useState('User');

  useEffect(() => {
    // First priority: use the user prop passed from DashboardPage
    if (user) {
      console.log('DashboardHeader - Received user prop:', user);
      const name = user.username || user.displayName || user.firstName || 'User';
      console.log('DashboardHeader - Setting userName from prop:', name);
      setUserName(name);
      return;
    }

    // Fallback: read directly from localStorage
    const storedUser = localStorage.getItem('user');
    console.log('DashboardHeader - Reading from localStorage:', storedUser);
    
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        console.log('DashboardHeader - Parsed user from localStorage:', parsedUser);
        
        // Handle both authentication methods
        let name = 'User';
        if (parsedUser.username) {
          name = parsedUser.username; // Manual login
          console.log('DashboardHeader - Using username field:', name);
        } else if (parsedUser.displayName) {
          name = parsedUser.displayName; // Google sign-in
          console.log('DashboardHeader - Using displayName field:', name);
        } else if (parsedUser.firstName) {
          name = parsedUser.firstName; // Fallback to firstName
          console.log('DashboardHeader - Using firstName field:', name);
        }
        
        setUserName(name);
      } catch (error) {
        console.error('DashboardHeader - Error parsing localStorage user:', error);
        setUserName('User');
      }
    }
  }, [user]); // Re-run when user prop changes

  return (
    <div className="flex justify-between items-center mb-8">
      <h1 className="text-2xl font-semibold text-gray-900">Hello, {userName}</h1>
      {/* <button 
        className="px-6 py-2 rounded-lg text-white font-medium transition-colors"
        style={{ backgroundColor: '#21C1B6' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
      >
        Create New Case
      </button> */}
    </div>
  );
};

export default DashboardHeader;