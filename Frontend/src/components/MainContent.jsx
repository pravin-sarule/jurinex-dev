import React from 'react';

const MainContent = ({ children }) => {
  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      <div className="flex-1 p-8 overflow-y-auto bg-gray-50">
        {children}
      </div>
    </div>
  );
};

export default MainContent;
