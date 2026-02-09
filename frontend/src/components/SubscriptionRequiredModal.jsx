import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CreditCard, X } from 'lucide-react';

const SubscriptionRequiredModal = ({ isOpen, onClose, message }) => {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleSubscribe = () => {
    onClose();
    navigate('/subscription-plans');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md mx-4 w-full animate-fadeIn">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
            <AlertCircle className="w-10 h-10 text-red-600" />
          </div>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
          Subscription Required
        </h2>

        <p className="text-gray-600 text-center mb-6">
          {message || 'You need an active subscription plan to upload and process documents. Please subscribe to continue.'}
        </p>

        <div className="flex flex-col space-y-3">
          <button
            onClick={handleSubscribe}
            className="flex items-center justify-center px-6 py-3 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA89E] transition-all duration-200 font-semibold shadow-md hover:shadow-lg"
          >
            <CreditCard className="w-5 h-5 mr-2" />
            View Subscription Plans
          </button>
          <button
            onClick={onClose}
            className="px-6 py-2 text-gray-600 hover:text-gray-900 transition-colors font-medium"
          >
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionRequiredModal;

