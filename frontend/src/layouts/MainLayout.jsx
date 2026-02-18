import React, { useEffect } from 'react';
import Sidebar from '../components/Sidebar';
import MainContent from '../components/MainContent';
import { useSidebar } from '../context/SidebarContext';
import { useAuth } from '../context/AuthContext';

const MainLayout = ({ children, useNoPadding = false }) => {
  const { isSidebarHidden, setIsSidebarHidden } = useSidebar();
  const { isAuthenticated, loading } = useAuth();
  const pageTitle = children.type?.name?.replace('Page', '') || 'Drafting';
  const pageSubtitle = `This is the ${pageTitle} page.`;

  // Force sidebar to be visible when user is authenticated
  useEffect(() => {
    if (isAuthenticated && !loading) {
      console.log('MainLayout: User authenticated, forcing sidebar to be visible');
      setIsSidebarHidden(false);
    }
  }, [isAuthenticated, loading, setIsSidebarHidden]);

  // Always show sidebar when authenticated
  const shouldShowSidebar = isAuthenticated && !loading;

  console.log('MainLayout render:', { isAuthenticated, loading, shouldShowSidebar, isSidebarHidden });

  return (
    <div className="flex h-screen overflow-hidden">
      {shouldShowSidebar && <Sidebar />}
      <MainContent pageTitle={pageTitle} pageSubtitle={pageSubtitle} noPadding={useNoPadding}>
        {children}
      </MainContent>
    </div>
  );
};

export default MainLayout;
