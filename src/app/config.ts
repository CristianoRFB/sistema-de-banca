import type { FirebaseOptions } from 'firebase/app';

const env = import.meta.env;

export const BANCA = {
  id: env.VITE_BANCA_ID || 'banca-ana-maria',
  name: 'Banca Ana Maria',
  phone: '+55 17 99153-6969',
  phoneDigits: '5517991536969',
  address: 'R. Sete, Santa Fé do Sul - SP, CEP 15775-000',
  city: 'Santa Fé do Sul - SP',
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=R.%20Sete%2C%20Santa%20F%C3%A9%20do%20Sul%20-%20SP',
  hours: [
    { day: 'Segunda a sexta', hours: '08h–18h' },
    { day: 'Sábado', hours: '08h–13h' },
    { day: 'Domingo', hours: 'Fechado' },
  ],
} as const;

export const apiBaseUrl = (env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export const firebaseOptions: FirebaseOptions | null = env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID
  ? {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
    }
  : null;

export const firebaseReady = firebaseOptions !== null;
