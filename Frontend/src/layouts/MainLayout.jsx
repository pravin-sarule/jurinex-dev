import React from 'react';
import Sidebar from '../components/Sidebar';
import MainContent from '../components/MainContent';
import { useSidebar } from '../context/SidebarContext';

const MainLayout = ({ children }) => {
  const { isSidebarHidden } = useSidebar();
  const pageTitle = children.type.name.replace('Page', '');
  const pageSubtitle = `This is the ${pageTitle} page.`;

  return (
    <div className="flex h-screen">
      {!isSidebarHidden && <Sidebar />}
      <MainContent pageTitle={pageTitle} pageSubtitle={pageSubtitle}>
        {children}
      </MainContent>
    </div>
  );
};

export default MainLayout;