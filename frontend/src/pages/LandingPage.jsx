import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import HomePage from './HomePage';

const LandingPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingSection, setPendingSection] = useState(location.state?.scrollTo || null);

  return (
    <HomePage
      onNavigateLogin={() => navigate('/login')}
      onNavigateContact={() => navigate('/contact')}
      pendingSection={pendingSection}
      onPendingSectionConsumed={() => setPendingSection(null)}
    />
  );
};

export default LandingPage;
