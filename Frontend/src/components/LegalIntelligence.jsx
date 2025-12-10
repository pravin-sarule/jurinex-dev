import React from 'react';
import { Link } from 'react-router-dom';
import { ChartBarIcon, CalendarIcon, DocumentTextIcon } from '@heroicons/react/24/outline';

const LegalIntelligence = ({ isCollapsed }) => {
  return (
    <div className="mb-6">
      {!isCollapsed && (
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 mb-2">
          Legal Intelligence
        </div>
      )}
      <Link
        to="/evidence-matrix"
        className={`flex items-center px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 hover:text-blue-600 group ${isCollapsed ? 'justify-center' : ''}`}
        title={isCollapsed ? 'Evidence Matrix' : undefined}
      >
        <ChartBarIcon className={`h-6 w-6 text-gray-500 group-hover:text-blue-600 ${isCollapsed ? '' : 'mr-3'}`} />
        {!isCollapsed && <span>Evidence Matrix</span>}
      </Link>
      <Link
        to="/timeline"
        className={`flex items-center px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 hover:text-blue-600 group ${isCollapsed ? 'justify-center' : ''}`}
        title={isCollapsed ? 'Timeline' : undefined}
      >
        <CalendarIcon className={`h-6 w-6 text-gray-500 group-hover:text-blue-600 ${isCollapsed ? '' : 'mr-3'}`} />
        {!isCollapsed && <span>Timeline</span>}
      </Link>
      <Link
        to="/ground-summary"
        className={`flex items-center px-2 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 hover:text-blue-600 group ${isCollapsed ? 'justify-center' : ''}`}
        title={isCollapsed ? 'Ground-wise Summary' : undefined}
      >
        <DocumentTextIcon className={`h-6 w-6 text-gray-500 group-hover:text-blue-600 ${isCollapsed ? '' : 'mr-3'}`} />
        {!isCollapsed && <span>Ground-wise Summary</span>}
      </Link>
    </div>
  );
};

export default LegalIntelligence;