import React from 'react';

const DocumentUploadPage = () => {
  return (
    <div>
      <div className="grid md:grid-cols-3 gap-6 mb-6">
        <div className="md:col-span-1 bg-bg-secondary p-6 rounded-xl border border-border-color">
          <div className="flex justify-between items-center mb-4">
            <h4 className="font-semibold text-text-primary">Case Folders</h4>
            <button className="bg-accent-color text-bg-secondary text-xs font-semibold px-3 py-1.5 rounded-md hover:opacity-90">
              + New Folder
            </button>
          </div>
          <div className="space-y-1">
          </div>
        </div>
        <div className="md:col-span-2 bg-bg-secondary p-6 rounded-xl border border-border-color flex items-center justify-center">
          <div className="text-center text-text-secondary">
            <div className="text-3xl mb-2">📂</div>
            <div>Select a folder from the left to view details</div>
          </div>
        </div>
      </div>
      <div className="bg-bg-secondary border-2 border-dashed border-border-color rounded-xl p-12 text-center hover:border-accent-color transition-all">
        <div className="bg-bg-primary h-12 w-12 rounded-lg inline-flex items-center justify-center mb-4">
          <span className="text-2xl">📁</span>
        </div>
        <h3 className="font-semibold text-text-primary mb-2">Upload Case Documents</h3>
        <p className="text-sm text-text-secondary mb-4">
          Drag and drop your PDF, TIFF, PNG, or JPG files here, or click to browse
        </p>
        <button className="bg-accent-color text-bg-secondary font-semibold px-6 py-2.5 rounded-lg hover:opacity-90">
          Choose Files
        </button>
      </div>
    </div>
  );
};

export default DocumentUploadPage;