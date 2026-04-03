# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.


Original                   Replace With

http://localhost:5000	gateway-service
http://localhost:5002	document-service
http://localhost:5017	drafting-agents (Template Analyzer)
http://localhost:8000	all-drafting-agent (agent-draft-service: templates, drafts)

## Google Drive Picker Env

Set these in `frontend/.env` before using Google Drive picker integrations:

```
VITE_GOOGLE_DRIVE_API_KEY=AIza...
```

Notes:
- `VITE_GOOGLE_DRIVE_API_KEY` must be a browser API key from Google Cloud with Drive Picker/Drive API access enabled.
- `VITE_GOOGLE_API_KEY` is still accepted as a legacy fallback, but `VITE_GOOGLE_DRIVE_API_KEY` is preferred.
- Restart the frontend dev server after changing env vars.
