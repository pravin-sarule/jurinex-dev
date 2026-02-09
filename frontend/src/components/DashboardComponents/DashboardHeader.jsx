import React, { useEffect, useState } from 'react';

const DashboardHeader = ({ user }) => {
  const [userName, setUserName] = useState('User');

  useEffect(() => {
    if (user) {
      console.log('DashboardHeader - Received user prop:', user);
      const name = user.username || user.displayName || user.firstName || 'User';
      console.log('DashboardHeader - Setting userName from prop:', name);
      setUserName(name);
      return;
    }

    const storedUser = localStorage.getItem('user');
    console.log('DashboardHeader - Reading from localStorage:', storedUser);
    
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        console.log('DashboardHeader - Parsed user from localStorage:', parsedUser);
        
        let name = 'User';
        if (parsedUser.username) {
          name = parsedUser.username;
          console.log('DashboardHeader - Using username field:', name);
        } else if (parsedUser.displayName) {
          name = parsedUser.displayName;
          console.log('DashboardHeader - Using displayName field:', name);
        } else if (parsedUser.firstName) {
          name = parsedUser.firstName;
          console.log('DashboardHeader - Using firstName field:', name);
        }
        
        setUserName(name);
      } catch (error) {
        console.error('DashboardHeader - Error parsing localStorage user:', error);
        setUserName('User');
      }
    }
  }, [user]);

  return (
    <div className="flex justify-between items-center mb-8">
      <h1 className="text-2xl font-semibold text-gray-900">Hello, {userName}</h1>
    </div>
  );
};

export default DashboardHeader;