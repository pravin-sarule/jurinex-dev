import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import googleDriveApi, { openGooglePicker, loadGooglePickerApi } from '../services/googleDriveApi';

// Get API key from environment
const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

const GoogleDocsTestPage = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [checkingConnection, setCheckingConnection] = useState(true);
    const [selectedDocument, setSelectedDocument] = useState(null);
    const [savedDocuments, setSavedDocuments] = useState([]);
    const [currentAccessToken, setCurrentAccessToken] = useState(null);

    // Check connection status on mount
    useEffect(() => {
        checkConnectionStatus();
        loadSavedDocuments();
    }, []);

    const checkConnectionStatus = async () => {
        try {
            setCheckingConnection(true);
            const status = await googleDriveApi.getConnectionStatus();
            setIsConnected(status.connected);
        } catch (error) {
            console.error('[GoogleDocsTest] Error checking status:', error);
            setIsConnected(false);
        } finally {
            setCheckingConnection(false);
        }
    };

    const loadSavedDocuments = async () => {
        try {
            const result = await googleDriveApi.getDocuments();
            if (result.success) {
                setSavedDocuments(result.documents);
            }
        } catch (error) {
            console.error('[GoogleDocsTest] Error loading documents:', error);
        }
    };

    const handleConnectDrive = async () => {
        try {
            setIsLoading(true);
            const { authUrl } = await googleDriveApi.initiateAuth();

            // Open OAuth in popup
            const width = 600;
            const height = 700;
            const left = window.screenX + (window.outerWidth - width) / 2;
            const top = window.screenY + (window.outerHeight - height) / 2;

            const popup = window.open(
                authUrl,
                'google-drive-auth',
                `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
            );

            // Poll for popup close
            const pollTimer = setInterval(() => {
                if (popup?.closed) {
                    clearInterval(pollTimer);
                    setIsLoading(false);
                    checkConnectionStatus();
                }
            }, 500);

        } catch (error) {
            console.error('[GoogleDocsTest] Error initiating auth:', error);
            toast.error('Failed to start Google Drive connection');
            setIsLoading(false);
        }
    };

    const handleSelectDocument = async () => {
        try {
            setIsLoading(true);

            // Get fresh access token
            let tokenData;
            try {
                tokenData = await googleDriveApi.getAccessToken();
            } catch (error) {
                if (error.response?.data?.needsAuth) {
                    setIsConnected(false);
                    toast.info('Please reconnect your Google Drive');
                    return;
                }
                throw error;
            }

            setCurrentAccessToken(tokenData.accessToken);

            // Load and open picker - filter to only show Google Docs
            await loadGooglePickerApi();

            // Create a custom picker that only shows Google Docs
            const docsView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCUMENTS)
                .setIncludeFolders(false)
                .setSelectFolderEnabled(false)
                .setMode(window.google.picker.DocsViewMode.LIST)
                .setMimeTypes('application/vnd.google-apps.document');

            const picker = new window.google.picker.PickerBuilder()
                .addView(docsView)
                .setOAuthToken(tokenData.accessToken)
                .setDeveloperKey(GOOGLE_API_KEY)
                .setCallback((data) => {
                    if (data.action === window.google.picker.Action.PICKED) {
                        const doc = data.docs[0];
                        handleDocumentPicked({
                            id: doc.id,
                            name: doc.name,
                            mimeType: doc.mimeType,
                            url: doc.url
                        }, tokenData.accessToken);
                    } else if (data.action === window.google.picker.Action.CANCEL) {
                        console.log('[GoogleDocsTest] Picker cancelled');
                    }
                })
                .setTitle('Select a Google Doc to Edit')
                .setSize(1051, 650)
                .setOrigin(window.location.protocol + '//' + window.location.host)
                .build();

            picker.setVisible(true);

        } catch (error) {
            console.error('[GoogleDocsTest] Error opening picker:', error);
            toast.error('Failed to open Google Drive picker');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDocumentPicked = async (doc, accessToken) => {
        console.log('[GoogleDocsTest] Document picked:', doc);

        try {
            setIsLoading(true);
            toast.info('Saving document...');

            // Step 1: Save document to database
            const saveResult = await googleDriveApi.saveDocument(doc.id, doc.name);
            if (!saveResult.success) {
                throw new Error('Failed to save document');
            }
            console.log('[GoogleDocsTest] Document saved:', saveResult);

            // Step 2: Verify/grant access
            toast.info('Verifying access...');
            const accessResult = await googleDriveApi.verifyDocumentAccess(doc.id, accessToken);
            console.log('[GoogleDocsTest] Access result:', accessResult);

            if (accessResult.granted) {
                toast.success('Writer access granted!');
            } else if (accessResult.hasAccess) {
                toast.success('Document ready for editing!');
            } else {
                toast.warning('Could not verify access. You may not be able to edit.');
            }

            // Step 3: Set the selected document to display in iframe
            setSelectedDocument({
                id: doc.id,
                name: doc.name,
                embedUrl: saveResult.document.embedUrl
            });

            // Reload saved documents list
            loadSavedDocuments();

        } catch (error) {
            console.error('[GoogleDocsTest] Error processing document:', error);
            toast.error(error.response?.data?.error || error.message || 'Failed to process document');
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoadDocument = (doc) => {
        setSelectedDocument({
            id: doc.google_file_id,
            name: doc.document_name,
            embedUrl: doc.embedUrl
        });
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <div className="max-w-7xl mx-auto">
                <h1 className="text-3xl font-bold mb-6">Google Docs Editor Test</h1>

                {/* Connection Status & Actions */}
                <div className="bg-gray-800 rounded-lg p-6 mb-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-semibold mb-2">Google Drive Connection</h2>
                            <p className="text-gray-400">
                                {checkingConnection
                                    ? 'Checking connection...'
                                    : isConnected
                                        ? '✅ Connected to Google Drive'
                                        : '❌ Not connected'}
                            </p>
                        </div>
                        <div className="flex gap-4">
                            {!isConnected && !checkingConnection && (
                                <button
                                    onClick={handleConnectDrive}
                                    disabled={isLoading}
                                    className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors disabled:opacity-50"
                                >
                                    {isLoading ? 'Connecting...' : 'Connect Google Drive'}
                                </button>
                            )}
                            {isConnected && (
                                <button
                                    onClick={handleSelectDocument}
                                    disabled={isLoading}
                                    className="px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors disabled:opacity-50"
                                >
                                    {isLoading ? 'Loading...' : '📄 Select Google Doc'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Saved Documents List */}
                {savedDocuments.length > 0 && (
                    <div className="bg-gray-800 rounded-lg p-6 mb-6">
                        <h2 className="text-xl font-semibold mb-4">Saved Documents</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {savedDocuments.map((doc) => (
                                <div
                                    key={doc.id}
                                    onClick={() => handleLoadDocument(doc)}
                                    className={`p-4 rounded-lg cursor-pointer transition-colors ${selectedDocument?.id === doc.google_file_id
                                            ? 'bg-blue-600'
                                            : 'bg-gray-700 hover:bg-gray-600'
                                        }`}
                                >
                                    <p className="font-medium truncate">{doc.document_name}</p>
                                    <p className="text-sm text-gray-400 mt-1">
                                        {new Date(doc.created_at).toLocaleDateString()}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Document Editor */}
                {selectedDocument && (
                    <div className="bg-gray-800 rounded-lg p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold">{selectedDocument.name}</h2>
                            <button
                                onClick={() => setSelectedDocument(null)}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                            >
                                Close
                            </button>
                        </div>
                        <div className="border border-gray-700 rounded-lg overflow-hidden">
                            <iframe
                                src={selectedDocument.embedUrl}
                                width="100%"
                                height="700"
                                style={{ border: 'none', background: 'white' }}
                                allow="clipboard-read; clipboard-write"
                                title={`Google Doc: ${selectedDocument.name}`}
                            />
                        </div>
                        <p className="text-sm text-gray-500 mt-2">
                            Embed URL: {selectedDocument.embedUrl}
                        </p>
                    </div>
                )}

                {/* Instructions */}
                {!selectedDocument && (
                    <div className="bg-gray-800 rounded-lg p-6">
                        <h2 className="text-xl font-semibold mb-4">Instructions</h2>
                        <ol className="list-decimal list-inside space-y-2 text-gray-300">
                            <li>Connect your Google Drive account if not already connected</li>
                            <li>Click "Select Google Doc" to open the Google Picker</li>
                            <li>Choose a Google Doc from your Drive</li>
                            <li>The document will be saved and displayed in an embedded editor</li>
                            <li>You can edit the document directly in the iframe</li>
                        </ol>
                        <div className="mt-4 p-4 bg-gray-700 rounded-lg">
                            <p className="text-sm text-gray-400">
                                <strong>Note:</strong> The iframe uses <code>allow="clipboard-read; clipboard-write"</code>
                                for clipboard functionality. Make sure you have edit permissions on the selected document.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default GoogleDocsTestPage;
