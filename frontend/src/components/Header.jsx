import React, { useEffect, useState, useRef } from 'react';

const Bars3Icon = ({ className }) => (
 <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
 </svg>
);

const UserCircleIcon = ({ className }) => (
 <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
 </svg>
);

const mockApiService = {
 logout: async () => {
 return new Promise((resolve) => setTimeout(resolve, 500));
 }
};

const mockNavigate = (path, options) => {
 console.log('Navigate to:', path, options);
};

const Header = ({ 
 apiService = mockApiService, 
 navigate = mockNavigate,
 logoSrc = 'https://via.placeholder.com/150x50?text=Nexintel+AI'
}) => {
 const [user, setUser] = useState(null);
 const [isDropdownOpen, setIsDropdownOpen] = useState(false);
 const [isLoggingOut, setIsLoggingOut] = useState(false);
 const dropdownRef = useRef(null);
 const isMountedRef = useRef(true);

 useEffect(() => {
 isMountedRef.current = true;
 return () => {
 isMountedRef.current = false;
 };
 }, []);

 useEffect(() => {
 const loadUser = () => {
 try {
 const userData = localStorage.getItem('user');
 if (userData && userData !== 'undefined' && userData !== 'null') {
 const parsedUser = JSON.parse(userData);
 if (parsedUser && typeof parsedUser === 'object') {
 if (isMountedRef.current) {
 setUser(parsedUser);
 }
 } else {
 console.warn('Invalid user data in localStorage');
 localStorage.removeItem('user');
 if (isMountedRef.current) {
 setUser(null);
 }
 }
 } else {
 if (isMountedRef.current) {
 setUser(null);
 }
 }
 } catch (err) {
 console.error('Error parsing user from localStorage:', err);
 localStorage.removeItem('user');
 if (isMountedRef.current) {
 setUser(null);
 }
 }
 };

 loadUser();

 window.addEventListener('userUpdated', loadUser);
 return () => {
 window.removeEventListener('userUpdated', loadUser);
 };
 }, []);

 useEffect(() => {
 const handleClickOutside = (event) => {
 if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
 setIsDropdownOpen(false);
 }
 };

 if (isDropdownOpen) {
 document.addEventListener('mousedown', handleClickOutside);
 }

 return () => {
 document.removeEventListener('mousedown', handleClickOutside);
 };
 }, [isDropdownOpen]);

 const clearUserData = () => {
 try {
 localStorage.removeItem('token');
 localStorage.removeItem('user');
 window.dispatchEvent(new Event('userUpdated'));
 } catch (err) {
 console.error('Error clearing user data:', err);
 }
 };

 const handleLogout = async () => {
 if (isLoggingOut) return;

 setIsLoggingOut(true);
 setIsDropdownOpen(false);

 try {
 await apiService.logout();
 clearUserData();
 navigate('/login', { replace: true });
 } catch (error) {
 console.error('Logout failed:', error);
 
 const errorMessage = error?.message || 'Unknown error occurred';
 const isAuthError = 
 errorMessage.includes('Session expired') || 
 errorMessage.includes('401') || 
 errorMessage.includes('403') ||
 errorMessage.includes('unauthorized') ||
 errorMessage.includes('token');

 if (isAuthError) {
 clearUserData();
 navigate('/login', { replace: true });
 } else {
 alert(`Logout failed: ${errorMessage}. Clearing local session.`);
 clearUserData();
 navigate('/login', { replace: true });
 }
 } finally {
 if (isMountedRef.current) {
 setIsLoggingOut(false);
 }
 }
 };

 const getUserDisplayName = () => {
 if (!user) return '';
 const firstName = user.first_name?.trim() || '';
 const lastName = user.last_name?.trim() || '';
 return `${firstName} ${lastName}`.trim() || 'User';
 };

 const getUserEmail = () => {
 return user?.email || 'No email';
 };

 return (
 <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
 <div className="flex items-center space-x-4">
 <img 
 src={logoSrc} 
 alt="Nexintel AI Logo" 
 className="h-8 w-auto"
 onError={(e) => {
 e.target.style.display = 'none';
 console.error('Failed to load logo image');
 }}
 />
 </div>
 
 <div className="flex items-center space-x-4">
 {user ? (
 <div className="text-right">
 <div className="text-sm font-semibold text-slate-700">
 {getUserDisplayName()}
 </div>
 <div className="text-xs text-slate-500">{getUserEmail()}</div>
 </div>
 ) : (
 <div className="text-right">
 <div className="text-sm text-slate-400">Not logged in</div>
 </div>
 )}

 <div className="relative" ref={dropdownRef}>
 <button
 onClick={() => !isLoggingOut && setIsDropdownOpen(!isDropdownOpen)}
 className="focus:outline-none relative"
 disabled={isLoggingOut}
 aria-label="User menu"
 aria-expanded={isDropdownOpen}
 >
 <UserCircleIcon className={`h-10 w-10 ${isLoggingOut ? 'text-slate-300' : 'text-slate-500'}`} />
 {user && !isLoggingOut && (
 <span 
 className="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full bg-green-400 ring-2 ring-white"
 aria-label="Online status"
 />
 )}
 </button>

 {isDropdownOpen && !isLoggingOut && (
 <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 border border-gray-100">
 <button
 onClick={handleLogout}
 className="block w-full text-left px-4 py-2 text-sm text-gray-700 transition-colors"
 style={{ backgroundColor: '#21C1B6' }}
 onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
 onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
 disabled={isLoggingOut}
 >
 Logout
 </button>
 </div>
 )}

 {isLoggingOut && (
 <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 border border-gray-100">
 <div className="px-4 py-2 text-sm text-gray-500 text-center">
 Logging out...
 </div>
 </div>
 )}
 </div>

 <button 
 className="md:hidden bg-gray-100 p-2 rounded-lg hover:bg-gray-200 transition-colors"
 aria-label="Open menu"
 >
 <Bars3Icon className="h-6 w-6 text-gray-600" />
 </button>
 </div>
 </div>
 );
};

export default Header;