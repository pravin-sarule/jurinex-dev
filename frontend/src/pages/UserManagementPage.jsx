import React from 'react';

const UserManagementPage = () => {
  return (
    <div className="min-h-[60vh] px-6 py-8 bg-gray-50">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">User Management</h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage your firm users, roles, and access. This page is currently a placeholder and can be
            extended with full user management features.
          </p>
        </header>

        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-gray-700 font-medium mb-2">User management coming soon</p>
          <p className="text-sm text-gray-500">
            The navigation and routing are wired up. Implement the full user management UI here when ready.
          </p>
        </div>
      </div>
    </div>
  );
};

export default UserManagementPage;

