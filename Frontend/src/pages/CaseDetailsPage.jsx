import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { FileManagerContext } from '../context/FileManagerContext';
import { DOCS_BASE_URL } from '../config/apiConfig';
import {
  ArrowLeft,
  Scale,
  Calendar,
  MapPin,
  FileText,
  User,
  Building,
  Edit,
  Trash2,
  FolderOpen,
  Loader2,
} from 'lucide-react';

const CaseDetailsPage = () => {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useContext(FileManagerContext);

  const [caseData, setCaseData] = useState(location.state?.case || null);
  const [loading, setLoading] = useState(!caseData);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!caseData && caseId) {
      fetchCaseDetails();
    }
  }, [caseId, caseData]);

  const fetchCaseDetails = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = user?.token;
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`${DOCS_BASE_URL}/cases/${caseId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch case details');
      }

      setCaseData(data.case || data);
    } catch (err) {
      console.error('Error fetching case details:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const statusLower = status?.toLowerCase();
    switch (statusLower) {
      case 'active':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'closed':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'disposed':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleGoToFolder = () => {
    if (caseData?.folder_id) {
      navigate(`/documents/${caseData.case_title}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-[#21C1B6] animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading case details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <p className="text-red-800 font-semibold mb-2">Error Loading Case</p>
            <p className="text-red-700 text-sm mb-4">{error}</p>
            <button
              onClick={() => navigate('/cases')}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Back to Cases
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!caseData) {
    return (
      <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Case not found</p>
          <button
            onClick={() => navigate('/cases')}
            className="px-4 py-2 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA49B]"
          >
            Back to Cases
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFCFB] p-8">
      <div className="max-w-6xl mx-auto">
        <button
          onClick={() => navigate('/cases')}
          className="flex items-center text-gray-600 hover:text-gray-800 mb-6 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back to Cases
        </button>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex items-start flex-1">
              <div className="w-16 h-16 bg-[#9CDFE1] bg-opacity-20 rounded-lg flex items-center justify-center mr-4">
                <Scale className="w-8 h-8 text-[#21C1B6]" />
              </div>
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                  {caseData.case_title || 'Untitled Case'}
                </h1>
                {caseData.case_number && (
                  <p className="text-gray-600 mb-3">Case No: {caseData.case_number}</p>
                )}
                <div className="flex items-center space-x-4">
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(
                      caseData.status
                    )}`}
                  >
                    {caseData.status || 'Unknown'}
                  </span>
                  {caseData.case_type && (
                    <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm font-medium">
                      {caseData.case_type}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 ml-4">
              <button
                onClick={() => alert('Edit functionality coming soon')}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                title="Edit Case"
              >
                <Edit className="w-5 h-5" />
              </button>
              <button
                onClick={() => alert('Delete functionality coming soon')}
                className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="Delete Case"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <Building className="w-5 h-5 mr-2 text-[#21C1B6]" />
                Court Information
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500 mb-1">Court Name</p>
                  <p className="text-base font-medium text-gray-900">
                    {caseData.court_name || 'Not specified'}
                  </p>
                </div>
                {caseData.court_level && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Court Level</p>
                    <p className="text-base font-medium text-gray-900">
                      {caseData.court_level}
                    </p>
                  </div>
                )}
                {caseData.bench_division && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Bench/Division</p>
                    <p className="text-base font-medium text-gray-900">
                      {caseData.bench_division}
                    </p>
                  </div>
                )}
                {caseData.court_room_no && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Court Room</p>
                    <p className="text-base font-medium text-gray-900">
                      {caseData.court_room_no}
                    </p>
                  </div>
                )}
                {caseData.jurisdiction && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Jurisdiction</p>
                    <p className="text-base font-medium text-gray-900">
                      {caseData.jurisdiction}
                    </p>
                  </div>
                )}
                {caseData.state && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">State</p>
                    <p className="text-base font-medium text-gray-900">
                      {caseData.state}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <User className="w-5 h-5 mr-2 text-[#21C1B6]" />
                Parties
              </h2>
              <div className="space-y-4">
                {caseData.petitioners && (
                  <div>
                    <p className="text-sm text-gray-500 mb-2">Petitioners</p>
                    <div className="bg-gray-50 rounded-md p-3">
                      <pre className="text-sm text-gray-900 whitespace-pre-wrap">
                        {typeof caseData.petitioners === 'string'
                          ? caseData.petitioners
                          : JSON.stringify(caseData.petitioners, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
                {caseData.respondents && (
                  <div>
                    <p className="text-sm text-gray-500 mb-2">Respondents</p>
                    <div className="bg-gray-50 rounded-md p-3">
                      <pre className="text-sm text-gray-900 whitespace-pre-wrap">
                        {typeof caseData.respondents === 'string'
                          ? caseData.respondents
                          : JSON.stringify(caseData.respondents, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {(caseData.judges || caseData.complexity || caseData.monetary_value) && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-semibold mb-4">Additional Details</h2>
                <div className="grid grid-cols-2 gap-4">
                  {caseData.judges && (
                    <div className="col-span-2">
                      <p className="text-sm text-gray-500 mb-1">Judges</p>
                      <p className="text-base font-medium text-gray-900">
                        {typeof caseData.judges === 'string'
                          ? caseData.judges
                          : JSON.stringify(caseData.judges)}
                      </p>
                    </div>
                  )}
                  {caseData.complexity && (
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Complexity</p>
                      <p className="text-base font-medium text-gray-900">
                        {caseData.complexity}
                      </p>
                    </div>
                  )}
                  {caseData.monetary_value && (
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Monetary Value</p>
                      <p className="text-base font-medium text-gray-900">
                        ₹{parseFloat(caseData.monetary_value).toLocaleString('en-IN')}
                      </p>
                    </div>
                  )}
                  {caseData.priority_level && (
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Priority</p>
                      <p className="text-base font-medium text-gray-900">
                        {caseData.priority_level}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <Calendar className="w-5 h-5 mr-2 text-[#21C1B6]" />
                Timeline
              </h3>
              <div className="space-y-3">
                {caseData.filing_date && (
                  <div>
                    <p className="text-sm text-gray-500">Filing Date</p>
                    <p className="text-base font-medium text-gray-900">
                      {new Date(caseData.filing_date).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                )}
                {caseData.created_at && (
                  <div>
                    <p className="text-sm text-gray-500">Created</p>
                    <p className="text-base font-medium text-gray-900">
                      {new Date(caseData.created_at).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                )}
                {caseData.updated_at && (
                  <div>
                    <p className="text-sm text-gray-500">Last Updated</p>
                    <p className="text-base font-medium text-gray-900">
                      {new Date(caseData.updated_at).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
              <div className="space-y-2">
                {caseData.folder_id && (
                  <button
                    onClick={handleGoToFolder}
                    className="w-full px-4 py-3 bg-[#21C1B6] text-white rounded-md hover:bg-[#1AA49B] transition-colors flex items-center justify-center"
                  >
                    <FolderOpen className="w-5 h-5 mr-2" />
                    Open Documents Folder
                  </button>
                )}
                <button
                  onClick={() => alert('Upload documents feature coming soon')}
                  className="w-full px-4 py-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center justify-center"
                >
                  <FileText className="w-5 h-5 mr-2" />
                  Upload Documents
                </button>
              </div>
            </div>

            {(caseData.category_type || caseData.primary_category || caseData.sub_category) && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold mb-4">Categories</h3>
                <div className="space-y-2">
                  {caseData.category_type && (
                    <div>
                      <p className="text-sm text-gray-500">Category Type</p>
                      <p className="text-base font-medium text-gray-900">
                        {caseData.category_type}
                      </p>
                    </div>
                  )}
                  {caseData.primary_category && (
                    <div>
                      <p className="text-sm text-gray-500">Primary Category</p>
                      <p className="text-base font-medium text-gray-900">
                        {caseData.primary_category}
                      </p>
                    </div>
                  )}
                  {caseData.sub_category && (
                    <div>
                      <p className="text-sm text-gray-500">Sub Category</p>
                      <p className="text-base font-medium text-gray-900">
                        {caseData.sub_category}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CaseDetailsPage;