import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DraftSelectionCard from '../components/DraftComponents/DraftSelectionCard';
import WordLogo from '../assets/Wordlogo.svg.png';
import ZohoLogo from '../assets/zoho-logo-web.png';
import draftApi from '../services/draftApi';
import { toast } from 'react-toastify';

const DraftSelectionPage = () => {
  const navigate = useNavigate();
  const [isConnecting, setIsConnecting] = useState(false);

  const draftOptions = [
    {
      id: 'google-docs',
      title: 'Google Docs',
      description: 'Create and edit documents with Google Docs integration. Collaborate in real-time with cloud storage.',
      icon: 'google',
      iconBgColor: '#4285F4',
      route: '/drafts?platform=google-docs',
      disabled: false
    },
    {
      id: 'microsoft-word',
      title: 'Microsoft Word',
      description: 'Use Microsoft Word for professional document drafting. Full Office 365 integration available.',
      icon: 'microsoft',
      iconBgColor: '#2B579A',
      logo: WordLogo,
      route: '/drafting?platform=microsoft-word',
      disabled: false
    },
    {
      id: 'template-based',
      title: 'Zoho Office',
      description: 'Start with pre-built legal templates and customize them to your needs.',
      icon: 'template',
      iconBgColor: '#9C27B0',
      logo: ZohoLogo,
      logoSize: 'large',
      route: '/draft/zoho-office',
      disabled: false
    }
  ];

  const handleMicrosoftWordClick = async () => {
    try {
      setIsConnecting(true);
      
      // Check if already connected
      const connectionStatus = await draftApi.getMicrosoftStatus();
      
      if (connectionStatus.isConnected) {
        // Already connected, navigate to Microsoft Word page
        navigate('/draft/microsoft-word');
      } else {
        // Not connected, initiate Microsoft sign-in (redirects automatically)
        await draftApi.signInWithMicrosoft();
        // Note: signInWithMicrosoft redirects the page, so we don't need to reset isConnecting
      }
    } catch (error) {
      console.error('Error connecting to Microsoft Word:', error);
      toast.error('Failed to connect to Microsoft Office. Please try again.');
      setIsConnecting(false);
    }
  };

  const handleCardClick = (option) => {
    if (option.id === 'microsoft-word') {
      handleMicrosoftWordClick();
    } else {
      navigate(option.route);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Document Drafting
          </h1>
          <p className="text-gray-600 text-sm">
            Select the platform you prefer to create and manage your legal documents
          </p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {draftOptions.map((option) => (
            <DraftSelectionCard
              key={option.id}
              title={option.title}
              description={option.description}
              icon={option.icon}
              iconBgColor={option.iconBgColor}
              logo={option.logo}
              logoSize={option.logoSize}
              onClick={() => handleCardClick(option)}
              disabled={option.disabled || (option.id === 'microsoft-word' && isConnecting)}
            />
          ))}
        </div>
        
        {isConnecting && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-8 text-center max-w-md">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#21C1B6] mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Connecting to Microsoft Word</h3>
              <p className="text-gray-600">Please wait while we redirect you to Microsoft Office...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DraftSelectionPage;


