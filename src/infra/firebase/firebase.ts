import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { firebaseOptions } from '../../app/config';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

if (firebaseOptions) {
  app = initializeApp(firebaseOptions);
  auth = getAuth(app);
}

export { app as firebaseApp, auth as firebaseAuth };
