import React from 'react';

const RoleSelection = ({ isCollapsed }) => {
  return (
    <div className="mb-6">
      {!isCollapsed && (
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 mb-2">
          User Roles
        </div>
      )}
      <a
        href="#"
        className={`flex items-center px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 hover:text-blue-600 group ${isCollapsed ? 'justify-center' : ''}`}
        title={isCollapsed ? 'Client' : undefined}
      >
        <span className={`w-6 h-6 ${isCollapsed ? '' : 'mr-3'}`}>👤</span>
        {!isCollapsed && <span>Client</span>}
      </a>
      <a
        href="#"
        className={`flex items-center px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 hover:text-blue-600 group ${isCollapsed ? 'justify-center' : ''}`}
        title={isCollapsed ? 'Lawyer' : undefined}
      >
        <span className={`w-6 h-6 ${isCollapsed ? '' : 'mr-3'}`}>⚖️</span>
        {!isCollapsed && <span>Lawyer</span>}
      </a>
      <a
        href="#"
        className={`flex items-center px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 hover:text-blue-600 group ${isCollapsed ? 'justify-center' : ''}`}
        title={isCollapsed ? 'Judge' : undefined}
      >
        <span className={`w-6 h-6 ${isCollapsed ? '' : 'mr-3'}`}>👨‍⚖️</span>
        {!isCollapsed && <span>Judge</span>}
      </a>
      <a
        href="#"
        className={`flex items-center px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 hover:text-blue-600 group ${isCollapsed ? 'justify-center' : ''}`}
        title={isCollapsed ? 'Paralegal' : undefined}
      >
        <span className={`w-6 h-6 ${isCollapsed ? '' : 'mr-3'}`}>📋</span>
        {!isCollapsed && <span>Paralegal</span>}
      </a>
    </div>
  );
};

export default RoleSelection;