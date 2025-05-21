import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  define: {
    'process.env': {
      REACT_APP_CLOUDINARY_CLOUD_NAME: 'detwqpana',
      REACT_APP_CLOUDINARY_UPLOAD_PRESET: 'screen',
    },
  },
});