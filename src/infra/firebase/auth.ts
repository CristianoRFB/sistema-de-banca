import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { firebaseAuth } from './firebase';

export function watchAdmin(userChanged: (user: User | null) => void, failed?: (error: Error) => void) {
  if (!firebaseAuth) return () => undefined;
  return onAuthStateChanged(firebaseAuth, userChanged, (error) => failed?.(error));
}

export async function loginAdmin(email: string, password: string) {
  if (!firebaseAuth) throw new Error('O Firebase ainda não foi configurado neste ambiente.');
  const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
  return credential.user;
}

export async function logoutAdmin() {
  if (firebaseAuth) await signOut(firebaseAuth);
}
