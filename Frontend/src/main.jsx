// import { StrictMode } from 'react';
// import { createRoot } from 'react-dom/client';
// import './index.css';
// import './styles/ClaudeAI.css'; // Import Claude AI-like global styles
// import App from './App.jsx';
// import { AuthProvider } from './context/AuthContext.jsx';
// import { ThemeProvider } from './context/ThemeContext.jsx'; // Import ThemeProvider

// createRoot(document.getElementById('root')).render(
//   <StrictMode>
//     <AuthProvider>
//       <ThemeProvider> {/* Wrap App with ThemeProvider */}
//         <App />
//       </ThemeProvider>
//     </AuthProvider>
//   </StrictMode>,
// );


import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/ClaudeAI.css'; // Your custom styles
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </AuthProvider>
  </StrictMode>
);