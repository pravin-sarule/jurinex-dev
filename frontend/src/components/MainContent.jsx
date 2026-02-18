import React from 'react';

const MainContent = ({ children, noPadding = false }) => {
  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      <div className={`flex-1 overflow-y-auto bg-gray-50 ${noPadding ? '' : 'p-8'}`}>
        {children}
      </div>
    </div>
  );
};

export default MainContent;
