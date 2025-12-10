// import React, { useState, useEffect, useContext } from 'react';
// import { documentApi } from '../../services/documentApi';
// import { FileManagerContext } from '../../context/FileManagerContext';
// import CreateFolderModal from './CreateFolderModal';

// const FolderBrowser = () => {
//   const { folders, setFolders, setSelectedFolder, selectedFolder } = useContext(FileManagerContext);
//   const [isModalOpen, setIsModalOpen] = useState(false);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState(null);

//   const fetchFolders = async () => {
//     setLoading(true);
//     setError(null);
//     try {
//       const data = await documentApi.getFoldersAndFiles();
//       setFolders(data.folders);
//     } catch (err) {
//       setError('Failed to fetch folders.');
//       console.error('Error fetching folders:', err);
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchFolders();
//   }, []);

//   const handleFolderClick = (folderName) => {
//     setSelectedFolder(folderName);
//   };

//   const handleCreateFolder = async (newFolderName) => {
//     try {
//       await documentApi.createFolder(newFolderName);
//       fetchFolders(); // Refresh folders after creation
//       setIsModalOpen(false);
//     } catch (err) {
//       setError(`Failed to create folder: ${err.response?.data?.details || err.message}`);
//     }
//   };

//   if (loading) return <div>Loading folders...</div>;
//   if (error) return <div className="text-red-500">Error: {error}</div>;

//   return (
//     <div className="flex flex-col h-full bg-gray-800 text-white p-4 rounded-lg shadow-lg">
//       <div className="flex justify-between items-center mb-4">
//         <h2 className="text-xl font-semibold">Your Folders</h2>
//         <button
//           onClick={() => setIsModalOpen(true)}
//           className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm transition-colors duration-200"
//         >
//           + New Folder
//         </button>
//       </div>

//       <div className="flex-grow overflow-y-auto space-y-2">
//         {folders.length === 0 ? (
//           <p className="text-gray-400">No folders yet. Create one to get started!</p>
//         ) : (
//           folders.map((folder) => (
//             <div
//               key={folder.id}
//               className={`flex items-center p-3 rounded-md cursor-pointer transition-colors duration-200
//                 ${selectedFolder === folder.name ? 'bg-blue-700' : 'hover:bg-gray-700'}`}
//               onClick={() => handleFolderClick(folder.name)}
//             >
//               <svg
//                 xmlns="http://www.w3.org/2000/svg"
//                 className="h-5 w-5 mr-3 text-yellow-400"
//                 viewBox="0 0 20 20"
//                 fill="currentColor"
//               >
//                 <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
//               </svg>
//               <span className="font-medium">{folder.name}</span>
//             </div>
//           ))
//         )}
//       </div>

//       <CreateFolderModal
//         isOpen={isModalOpen}
//         onClose={() => setIsModalOpen(false)}
//         onCreate={handleCreateFolder}
//       />
//     </div>
//   );
// };

// export default FolderBrowser;


import React, { useState, useEffect, useContext } from 'react';
import { documentApi } from '../../services/documentApi';
import { FileManagerContext } from '../../context/FileManagerContext';
import CreateFolderModal from './CreateFolderModal';

const FolderBrowser = () => {
  const { folders, setFolders, setSelectedFolder, selectedFolder } = useContext(FileManagerContext);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFolders = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await documentApi.getFoldersAndFiles();
      setFolders(data.folders || []);
    } catch (err) {
      setError('Failed to fetch folders.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFolders(); }, []);

  const handleCreateFolder = async (name) => {
    try {
      await documentApi.createFolder(name);
      await fetchFolders();
      setIsModalOpen(false);
    } catch (err) {
      setError(err?.response?.data?.details || err.message || 'Failed to create folder.');
    }
  };

  if (loading) return <div>Loading folders...</div>;
  if (error) return <div className="text-red-500">{error}</div>;

  return (
    <div className="flex flex-col h-full bg-white text-gray-800 p-4 rounded-lg shadow-sm border border-gray-200">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Your Folders</h2>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-black text-white px-4 py-2 rounded-md text-sm hover:bg-gray-800"
        >
          + New Folder
        </button>
      </div>

      <div className="flex-grow overflow-y-auto space-y-2">
        {folders.length === 0 ? (
          <p className="text-gray-400">No folders yet. Create one to get started!</p>
        ) : (
          folders.map((folder) => (
            <div
              key={folder.id}
              className={`flex items-center p-3 rounded-md cursor-pointer border border-transparent
                ${selectedFolder === folder.name ? 'bg-gray-100 border-gray-300' : 'hover:bg-gray-50'}`}
              onClick={() => setSelectedFolder(folder.name)}
            >
              <span className="mr-3">📁</span>
              <span className="font-medium">{folder.name}</span>
            </div>
          ))
        )}
      </div>

      <CreateFolderModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onCreate={handleCreateFolder} />
    </div>
  );
};

export default FolderBrowser;
