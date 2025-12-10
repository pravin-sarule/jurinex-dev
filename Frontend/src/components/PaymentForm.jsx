import React, { useState } from 'react';

const PaymentForm = ({ plan, onClose, onPaymentSuccess }) => {
  const [cardNumber, setCardNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [cvc, setCvc] = useState('');
  const [nameOnCard, setNameOnCard] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (cardNumber.length < 16 || expiryDate.length < 5 || cvc.length < 3 || nameOnCard.length === 0) {
        throw new Error('Please fill in all payment details correctly.');
      }

      setSuccess(true);
      onPaymentSuccess(plan.name); // Call the success callback with the plan name
      console.log(`Payment successful for ${plan.name} plan!`);
      // Optionally, close the form after a short delay to show success message
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Complete Your Purchase</h2>
        {plan && (
          <div className="mb-6 p-4 bg-blue-50 rounded-md">
            <p className="text-lg font-semibold text-blue-800">Selected Plan: {plan.name}</p>
            <p className="text-md text-blue-700">Price: {plan.prices.monthly} / month</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="cardNumber" className="block text-sm font-medium text-gray-700">
              Card Number
            </label>
            <input
              type="text"
              id="cardNumber"
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="**** **** **** ****"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="expiryDate" className="block text-sm font-medium text-gray-700">
                Expiry Date (MM/YY)
              </label>
              <input
                type="text"
                id="expiryDate"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                placeholder="MM/YY"
                required
              />
            </div>
            <div>
              <label htmlFor="cvc" className="block text-sm font-medium text-gray-700">
                CVC
              </label>
              <input
                type="text"
                id="cvc"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                value={cvc}
                onChange={(e) => setCvc(e.target.value)}
                placeholder="***"
                required
              />
            </div>
          </div>
          <div className="mb-6">
            <label htmlFor="nameOnCard" className="block text-sm font-medium text-gray-700">
              Name on Card
            </label>
            <input
              type="text"
              id="nameOnCard"
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              value={nameOnCard}
              onChange={(e) => setNameOnCard(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
          {success && <p className="text-green-600 text-sm mb-4">Payment successful!</p>}

          <div className="flex justify-end space-x-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Pay Now'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PaymentForm;